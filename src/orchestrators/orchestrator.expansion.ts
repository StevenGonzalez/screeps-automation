import { getThreatInfo, isSourceKeeperRoom } from "../services/services.combat";
import { ROLE_MINER, ROLE_HAULER, ROLE_CONQUEROR } from "../config/config.roles";

// Closes the growth loop: when GCL frees a colony slot and a healthy home room
// can fund it, automatically claim the best scouted candidate — no console command.
// Reuses the existing Memory.expansion state machine (claiming → bootstrapping →
// established); this orchestrator *sets* Memory.expansion (exactly as
// Game.arca.claim() does) AND now *drives its lifecycle*: it auto-completes the
// bootstrap, aborts contested claims, and pauses bootstrap when the child is
// invaded. Candidate auto-selection is disabled by default (Game.arca.autoexpand);
// the lifecycle management below always runs so a manually-claimed expansion
// (Game.arca.claim) finishes correctly too.

// ── Bootstrap-completion / safety tuning ──────────────────────────────────────

// A child room is "self-sufficient" (bootstrap → established) when ALL hold:
//   1. We own its controller.
//   2. It has at least one OWN spawn that is BUILT (not just a construction site).
//   3. Controller RCL >= BOOTSTRAP_MIN_RCL.
//   4. Its economy can sustain itself without settlers: either it has a working
//      miner/hauler pair, or its own storage holds a comfortable energy buffer.
const BOOTSTRAP_MIN_RCL = 3;            // RCL 3 = towers + enough extensions to self-spawn
const BOOTSTRAP_MIN_STORAGE_ENERGY = 10_000; // alt. proof of a self-sustaining economy

// How long to pause a bootstrap after detecting hostiles in the child room. The
// pause keeps us from feeding settlers into a meat grinder; it lifts automatically
// once the room is clear (we re-check every tick the child is visible).
const BOOTSTRAP_INVASION_PAUSE = 200;

// Give up on a never-completing bootstrap after this long. Without a hard cap a
// settler op can churn energy forever (e.g. the spawn site keeps getting stomped).
const BOOTSTRAP_TIMEOUT = 6_000;

// Give up on a claim that never lands (unreachable target, perpetual enemy reservation).
// Without this a doomed target loops conqueror spawn→suicide forever and wedges the whole
// expansion queue behind it, since the queue can't advance while Memory.expansion exists.
const CLAIM_TIMEOUT = 1_500;

// Keep the record around briefly after "established" so console/tools can see the
// outcome, then the memory orchestrator (or the cleanup below) clears it.
const ESTABLISHED_RETENTION = 1_000;

// ── Multi-factor candidate scoring weights ────────────────────────────────────
// A candidate's score is a weighted sum of real settlement factors. The tuning goal
// (see rankExpansionCandidates) is that a 2-source, single-rare-mineral, 2-exit room
// near home with a couple of free remote neighbours and no enemies scores highest.
// Sources dominate (a 1-source room is a poor colony); distance matters but weighs
// less than sources; "remotes gained" is one of the biggest real multipliers.

// Sources: 2 is the sweet spot. We award the full bonus for the first source and a
// much smaller bonus for the second so a 2-source room far outscores a 1-source one,
// but a (rare) 3-source room doesn't run away. 0 sources is rejected outright.
const W_SOURCE_FIRST = 50;     // having ANY source at all
const W_SOURCE_SECOND = 60;    // the decisive jump from 1 → 2 sources (2-source preferred)
const W_SOURCE_EXTRA = 15;     // diminishing value for a 3rd+ source

// Distance from the funding home (linear room distance). Penalty per room — kept well
// below the source weights so a closer 1-source room never beats a 2-source room.
const W_DIST_PENALTY = 6;

// Mineral diversity: bonus for a mineral type the empire doesn't already mine, with an
// extra kicker for the rare catalyst (X), which unlocks the highest-tier lab boosts.
const W_MINERAL_NEW = 25;
const W_MINERAL_RARE = 25;     // additional, on top of W_MINERAL_NEW, for RESOURCE_CATALYST

// Defensibility: fewer exit sides = fewer attack avenues. We penalise per exit side and
// hand a chokepoint bonus to 2-exit rooms (corner/dead-end rooms that are easy to wall).
const W_EXIT_PENALTY = 12;        // per exit side beyond the unavoidable minimum
const W_CHOKEPOINT_BONUS = 30;    // 2-exit room: highly defensible

// Remotes gained: each neighbouring room that has sources and isn't already ours /
// contested is a future remote-mining target — a major chunk of a colony's value.
const W_REMOTE = 35;
const MAX_SCORED_REMOTES = 4;     // cap the per-candidate neighbour credit (CPU + realism)

// Enemy proximity: penalise candidates sitting close to a strong enemy player's
// territory centroid. Rooms owned/reserved by a strong hostile are rejected entirely.
const W_ENEMY_PENALTY = 20;            // per room inside the danger radius, scaled by strength
const ENEMY_DANGER_RADIUS = 4;         // rooms; enemies further than this don't penalise
const STRONG_ENEMY_MILITARY = 8;       // PlayerIntelData.militaryStrength ≥ this ⇒ "strong"

// When we still have GCL headroom (room to control another room), don't fully cede the
// open border rooms a strong neighbour is expanding into — contest them instead of
// recoiling. The proximity penalty (the SOFT "nearby enemy" signal, not the hard
// owned/reserved rejection in intelIsHostile) is scaled down so good unclaimed rooms can
// still win. At/over the GCL cap there's nothing to claim anyway, so the full penalty stands.
const ENEMY_PENALTY_SCALE_WITH_GCL_HEADROOM = 0.4;

// Swamp ratio (optional, only when terrain is cheaply available): very swampy rooms have
// expensive hauling and slow building. Penalty scales with how far past "tolerable" the
// swamp fraction is. Skipped entirely when computing terrain would be too costly.
const W_SWAMP_PENALTY = 40;            // applied to (swampFraction − SWAMP_TOLERANCE)
const SWAMP_TOLERANCE = 0.35;          // up to this fraction of swamp is free of penalty
const MAX_TERRAIN_SCANS_PER_TICK = 6;  // bound the expensive getRoomTerrain calls per tick

// Candidate-pool widening: also pull rooms from Memory.intel that sit within claim range
// of a healthy home, not just a home's own remoteRooms. Bounded so scoring stays cheap.
const MAX_CLAIM_RANGE = 4;             // rooms; intel beyond this from every home is ignored
const MAX_INTEL_CANDIDATES = 25;       // cap intel-sourced candidates considered per tick

// Only re-evaluate occasionally — candidates change slowly and ranking is cheap,
// but there's no reason to scan every tick.
const AUTO_EXPAND_CHECK_INTERVAL = 50;

// A funding room must clear these bars before it's allowed to seed a colony, so
// auto-expansion never overextends into a room it can't defend or develop.
const MIN_HOME_RCL = 4;                 // RCL 4 = storage + ≥1300 energy capacity
const MIN_HOME_STORAGE_ENERGY = 50_000; // buffer left after funding conqueror + settlers
const MIN_BUCKET = 5_000;               // don't start a multi-hundred-tick op when CPU-starved

export interface ExpansionCandidate {
  room: string;
  homeRoom: string;
  score: number;
  sources: number;
  dist: number;
  // Diagnostic breakdown so the console can explain WHY a room ranks where it does.
  remotes?: number;       // free harvestable neighbour rooms credited
  exits?: number;         // exit sides (defensibility)
  mineral?: MineralConstant; // mineral type, if known
}

// Rank non-hostile, unowned rooms as colony candidates using a multi-factor model
// (sources, mineral diversity, defensibility, distance, free remotes, enemy proximity,
// terrain). Shared with Game.arca.expand() so the console and the auto-expander always
// agree on choice. Candidates come from BOTH every home's scouted remoteRooms AND from
// cached Memory.intel within claim range — no vision required, bounded per tick for CPU.
export function rankExpansionCandidates(): ExpansionCandidate[] {
  // Per-call caches: the empire's known minerals (for the diversity bonus) and a hard
  // budget on expensive getRoomTerrain calls so a big intel store can't blow the CPU.
  const ownedMinerals = scanOwnedMinerals();
  const terrainBudget = { remaining: MAX_TERRAIN_SCANS_PER_TICK };

  // Gather unique candidate (room, fundingHome) pairs. A room reachable from several
  // homes is scored once, against its CLOSEST healthy-ish home (lowest distance wins).
  const byRoom = new Map<string, { home: string; dist: number; sourceCount: number }>();

  const consider = (roomName: string, home: string, sourceCount: number) => {
    const dist = Game.map.getRoomLinearDistance(home, roomName);
    const existing = byRoom.get(roomName);
    if (!existing || dist < existing.dist) {
      byRoom.set(roomName, { home, dist, sourceCount });
    }
  };

  // ── Pool 1: each home's own scouted remoteRooms (the original source). ──────────
  for (const rn in Game.rooms) {
    const room = Game.rooms[rn];
    if (!room.controller?.my) continue;
    for (const remote of room.memory.remoteRooms ?? []) {
      if (isRemoteContested(remote)) continue;
      const targetRoom = Game.rooms[remote.roomName];
      if (targetRoom?.controller?.my) continue; // already ours
      if (targetRoom && isRoomContested(targetRoom)) continue; // owned/reserved/hostile now
      consider(remote.roomName, rn, remote.sources.length);
    }
  }

  // ── Pool 2: cached Memory.intel within claim range of a healthy home. ───────────
  // This widens beyond directly-scouted remotes to any room we have intel on, so the
  // auto-expander can reach good colonies a home never ran a remote into. Bounded by
  // MAX_INTEL_CANDIDATES so a large intel store stays cheap.
  const homeNames: string[] = [];
  for (const rn in Game.rooms) {
    if (isHomeRoomHealthy(Game.rooms[rn])) homeNames.push(rn);
  }
  if (homeNames.length > 0 && Memory.intel) {
    let intelSeen = 0;
    for (const rn in Memory.intel) {
      if (intelSeen >= MAX_INTEL_CANDIDATES) break;
      if (byRoom.has(rn)) continue;            // already covered by a remoteRooms entry
      if (Game.rooms[rn]?.controller?.my) continue; // already ours
      const intel = Memory.intel[rn];
      if (intelIsHostile(intel)) continue;     // owned/reserved/strong-threat → not claimable
      if (isSourceKeeperRoom(rn)) continue;    // SK rooms are never colony candidates
      // Closest healthy home within claim range.
      let bestHome: string | undefined;
      let bestDist = Infinity;
      for (const hn of homeNames) {
        const d = Game.map.getRoomLinearDistance(hn, rn);
        if (d <= MAX_CLAIM_RANGE && d < bestDist) {
          bestDist = d;
          bestHome = hn;
        }
      }
      if (!bestHome) continue;
      intelSeen++;
      // sourcePos (packed positions) tells us the source count without vision.
      const sourceCount = intel.sourcePos?.length ?? 0;
      consider(rn, bestHome, sourceCount);
    }
  }

  // ── Score every gathered candidate with the weighted model. ─────────────────────
  // Compute the enemy-proximity scale once: with GCL headroom we lean in to contest
  // border rooms; at the cap we keep the full penalty.
  const enemyPenaltyScale = expansionEnemyPenaltyScale();
  const candidates: ExpansionCandidate[] = [];
  for (const [roomName, info] of byRoom) {
    const scored = scoreCandidate(roomName, info.home, info.dist, info.sourceCount, ownedMinerals, terrainBudget, enemyPenaltyScale);
    if (scored) candidates.push(scored);
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

// Compute the weighted multi-factor score for one candidate room. Returns undefined to
// REJECT the room (0 sources, or owned/reserved by a strong hostile). `terrainBudget` is
// mutated to bound the number of getRoomTerrain scans across the whole ranking pass.
function scoreCandidate(
  roomName: string,
  home: string,
  dist: number,
  sourceCount: number,
  ownedMinerals: Set<MineralConstant>,
  terrainBudget: { remaining: number },
  enemyPenaltyScale: number
): ExpansionCandidate | undefined {
  // ── Sources (dominant). 0 sources is a non-starter for a colony. ────────────────
  if (sourceCount <= 0) return undefined;
  let score = W_SOURCE_FIRST;
  if (sourceCount >= 2) score += W_SOURCE_SECOND;
  if (sourceCount >= 3) score += (sourceCount - 2) * W_SOURCE_EXTRA;

  // ── Distance (matters, but weighed below sources). ──────────────────────────────
  score -= dist * W_DIST_PENALTY;

  // ── Mineral diversity: reward a type we don't already mine; extra for rare X. ────
  const mineral = mineralTypeOf(roomName);
  if (mineral && !ownedMinerals.has(mineral)) {
    score += W_MINERAL_NEW;
    if (mineral === RESOURCE_CATALYST) score += W_MINERAL_RARE;
  }

  // ── Defensibility via exit sides (cheap: describeExits is free of vision). ───────
  const exitSides = countExitSides(roomName);
  // Penalise each exit side; reward a true 2-exit chokepoint room.
  score -= exitSides * W_EXIT_PENALTY;
  if (exitSides <= 2) score += W_CHOKEPOINT_BONUS;

  // ── Remotes gained: harvestable, un-owned, un-contested neighbour rooms. ─────────
  const remotes = countFreeRemoteNeighbours(roomName);
  score += remotes * W_REMOTE;

  // ── Enemy proximity: penalise nearness to strong enemy centroids (scaled down when
  // we have GCL headroom so we contest, rather than cede, a neighbour's border rooms). ─
  score -= enemyProximityPenalty(roomName) * enemyPenaltyScale;

  // ── Swamp ratio (optional/cheap): only when terrain budget remains. ─────────────
  if (terrainBudget.remaining > 0) {
    const swamp = swampFraction(roomName);
    if (swamp !== undefined) {
      terrainBudget.remaining--;
      if (swamp > SWAMP_TOLERANCE) {
        score -= (swamp - SWAMP_TOLERANCE) * W_SWAMP_PENALTY;
      }
    }
  }

  return {
    room: roomName,
    homeRoom: home,
    score: Math.round(score),
    sources: sourceCount,
    dist,
    remotes,
    exits: exitSides,
    mineral,
  };
}

// ── Scoring helpers ───────────────────────────────────────────────────────────

// The mineral types the empire ALREADY mines (one per owned room with vision). Used to
// reward a candidate that brings a *new* type. Cheap: iterates owned rooms only.
function scanOwnedMinerals(): Set<MineralConstant> {
  const owned = new Set<MineralConstant>();
  for (const rn in Game.rooms) {
    const room = Game.rooms[rn];
    if (!room.controller?.my) continue;
    const mineral = room.find(FIND_MINERALS)[0];
    if (mineral) owned.add(mineral.mineralType);
  }
  return owned;
}

// Mineral type for a candidate room: live vision first, else cached Memory.intel.
function mineralTypeOf(roomName: string): MineralConstant | undefined {
  const room = Game.rooms[roomName];
  if (room) {
    const mineral = room.find(FIND_MINERALS)[0];
    if (mineral) return mineral.mineralType;
  }
  return Memory.intel?.[roomName]?.mineralType;
}

// Number of map edges with an exit (1–4). Fewer = more defensible. describeExits is a
// pure map query (no vision, very cheap).
function countExitSides(roomName: string): number {
  const exits = Game.map.describeExits(roomName);
  let n = 0;
  for (const dir in exits) {
    if (exits[dir as ExitKey]) n++;
  }
  return n;
}

// Count neighbour rooms that would make good remotes: they have sources and aren't ours,
// SK rooms, or owned/reserved/threatened by a hostile (per cached intel). Vision-free.
function countFreeRemoteNeighbours(roomName: string): number {
  const exits = Game.map.describeExits(roomName);
  let count = 0;
  for (const dir in exits) {
    if (count >= MAX_SCORED_REMOTES) break;
    const neighbor = exits[dir as ExitKey];
    if (!neighbor) continue;
    if (Game.rooms[neighbor]?.controller?.my) continue;  // our own room, not a free remote
    if (isSourceKeeperRoom(neighbor)) continue;          // SK rooms aren't simple remotes
    const intel = Memory.intel?.[neighbor];
    if (!intel) continue;                                // no intel ⇒ don't credit it
    if (intelIsHostile(intel)) continue;                 // owned/reserved/strong-threat
    const sources = intel.sourcePos?.length ?? 0;
    if (sources > 0) count++;
  }
  return count;
}

// Penalty for sitting close to strong enemy territory. Uses PlayerIntelData centroids
// (sector-grid average coords) and only counts players judged militarily strong. Rooms
// owned/reserved by a strong hostile are rejected earlier (intelIsHostile), so this is
// the softer "nearby enemy" signal.
function enemyProximityPenalty(roomName: string): number {
  if (!Memory.players) return 0;
  const coords = roomNameToCoords(roomName);
  if (!coords) return 0;
  let penalty = 0;
  for (const username in Memory.players) {
    const p = Memory.players[username];
    if (p.username === myUsername()) continue;
    if (p.militaryStrength < STRONG_ENEMY_MILITARY) continue;
    // Centroid is stored as sector-grid coords (same space as roomNameToCoords).
    const d = Math.max(Math.abs(coords.x - p.centroidX), Math.abs(coords.y - p.centroidY));
    if (d <= ENEMY_DANGER_RADIUS) {
      // Closer + stronger ⇒ larger penalty.
      penalty += (ENEMY_DANGER_RADIUS - d + 1) * W_ENEMY_PENALTY;
    }
  }
  return penalty;
}

// Scale factor applied to enemyProximityPenalty. With spare GCL (we can still control
// another room) we lean IN to contest the open border rooms a neighbour is expanding
// into, instead of recoiling from the whole neighbourhood and letting them box us in.
// At/over the GCL cap there's nothing to claim, so the full penalty stands.
function expansionEnemyPenaltyScale(): number {
  let owned = 0;
  for (const rn in Game.rooms) {
    if (Game.rooms[rn].controller?.my) owned++;
  }
  const spareGcl = Game.gcl.level - owned;
  return spareGcl >= 1 ? ENEMY_PENALTY_SCALE_WITH_GCL_HEADROOM : 1;
}

// Fraction of a room's tiles that are swamp, when terrain is cheaply available. Returns
// undefined when the terrain query isn't available (treated as "no penalty"). Sampling a
// coarse grid keeps the 2500-tile scan affordable.
function swampFraction(roomName: string): number | undefined {
  const terrain = Game.map.getRoomTerrain(roomName);
  if (!terrain) return undefined;
  let swamp = 0;
  let sampled = 0;
  // Sample every 5th tile in both axes (100 samples) — enough signal, ~25× cheaper.
  for (let x = 0; x < 50; x += 5) {
    for (let y = 0; y < 50; y += 5) {
      sampled++;
      if (terrain.get(x, y) === TERRAIN_MASK_SWAMP) swamp++;
    }
  }
  return sampled > 0 ? swamp / sampled : undefined;
}

// True if cached intel says a room is unclaimable: owned by another player, reserved by
// someone else, or holding a strong standing threat. Mirrors isRoomContested for the
// vision-free (intel-only) case.
function intelIsHostile(intel: RoomIntelData): boolean {
  const me = myUsername();
  if (intel.owner && intel.owner !== me) return true;
  if (intel.reservedBy && intel.reservedBy !== me) return true;
  // threatLevel is 0 (trivial) … 10 (fortress); a high standing threat means avoid.
  if ((intel.threatLevel ?? 0) >= 5) return true;
  return false;
}

// Parse a room name into signed sector-grid coordinates. MUST match parseRoomCoords in
// orchestrator.military.ts (W and N negative) so distances against the PlayerIntelData
// centroids — which are averaged in that exact space — are meaningful. Returns undefined
// for malformed names.
function roomNameToCoords(roomName: string): { x: number; y: number } | undefined {
  const m = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
  if (!m) return undefined;
  const x = m[1] === "W" ? -parseInt(m[2], 10) : parseInt(m[2], 10);
  const y = m[3] === "N" ? -parseInt(m[4], 10) : parseInt(m[4], 10);
  return { x, y };
}

// ── Contested-room safety ─────────────────────────────────────────────────────

// Scout-data view: a remote is contested if a scout flagged it hostile, or that
// hostile flag hasn't yet expired (hostileUntil is maintained by the scout/remote
// orchestrators). We never commit settlers into such a room.
function isRemoteContested(remote: RemoteRoomData): boolean {
  if (remote.hostile) return true;
  if (remote.hostileUntil !== undefined && remote.hostileUntil > Game.time) return true;
  return false;
}

// Live view (room is visible): contested if owned/reserved by another player, or
// if there are hostile creeps present right now. Used both for candidate selection
// and for aborting an in-flight claim that turned hot.
function isRoomContested(room: Room): boolean {
  const ctrl = room.controller;
  if (ctrl) {
    if (ctrl.owner && !ctrl.my) return true; // another player owns it
    if (ctrl.reservation && ctrl.reservation.username !== myUsername()) {
      return true; // reserved by someone other than us
    }
  }
  if (getThreatInfo(room).score > 0) return true;
  return false;
}

// Our own username, read off any controller we own (cached per tick is overkill —
// this runs at most a handful of times per tick).
function myUsername(): string | undefined {
  for (const rn in Game.rooms) {
    const owner = Game.rooms[rn].controller?.owner;
    if (Game.rooms[rn].controller?.my && owner) return owner.username;
  }
  return undefined;
}

// Look up the scout's RemoteRoomData record for a room across all home rooms.
function findRemoteRecord(roomName: string): RemoteRoomData | undefined {
  for (const rn in Game.rooms) {
    const room = Game.rooms[rn];
    if (!room.controller?.my) continue;
    const rec = (room.memory.remoteRooms ?? []).find((r) => r.roomName === roomName);
    if (rec) return rec;
  }
  return undefined;
}

// A home room healthy enough to seed and defend a child colony.
function isHomeRoomHealthy(room: Room): boolean {
  if (!room.controller?.my) return false;
  if ((room.controller.level ?? 0) < MIN_HOME_RCL) return false;
  if ((room.storage?.store[RESOURCE_ENERGY] ?? 0) < MIN_HOME_STORAGE_ENERGY) return false;
  // Don't fund expansion while the funding room is itself under attack.
  if (getThreatInfo(room).score > 0) return false;
  return true;
}

// ── Lifecycle: drive an active expansion to completion / abort ────────────────

// Detect a self-sufficient child room (see BOOTSTRAP_* constants for the criteria).
// Returns false whenever the room isn't visible — we never declare success blind.
function isChildSelfSufficient(child: Room | undefined): boolean {
  if (!child) return false;
  if (!child.controller?.my) return false;
  if ((child.controller.level ?? 0) < BOOTSTRAP_MIN_RCL) return false;

  // At least one OWN spawn that is fully built. FIND_MY_SPAWNS only returns
  // completed spawns (sites live under FIND_MY_CONSTRUCTION_SITES), so a non-empty
  // result already proves the spawn is built rather than still under construction.
  if (child.find(FIND_MY_SPAWNS).length === 0) return false;

  // Self-sustaining economy: either a working miner+hauler pair native to the room,
  // or its own storage already holds a comfortable buffer.
  const localCreeps = child.find(FIND_MY_CREEPS);
  const hasMiner = localCreeps.some((c) => c.memory.role === ROLE_MINER);
  const hasHauler = localCreeps.some((c) => c.memory.role === ROLE_HAULER);
  const storageEnergy = child.storage?.store[RESOURCE_ENERGY] ?? 0;
  const economyOk =
    (hasMiner && hasHauler) || storageEnergy >= BOOTSTRAP_MIN_STORAGE_ENERGY;
  if (!economyOk) return false;

  return true;
}

// Tear down the active expansion (completion OR abort) and ADVANCE the pipeline:
// this is the SINGLE place the multi-target queue pops/advances. After clearing the
// finished record we pop the next viable queued target and start claiming it, so a
// queued pipeline drains one room at a time without further console input.
function clearExpansion(reason: string) {
  const exp = Memory.expansion;
  if (!exp) return;
  console.log(`[Expansion] Cleared ${exp.roomName} (${reason}).`);
  delete Memory.expansion;
  advanceExpansionQueue();
}

// Pop the next queued target and begin claiming it, if conditions allow. Skips
// already-owned / contested entries and entries with no healthy funding room.
// Runs whenever a slot frees (clearExpansion) and is also polled in loop() so a
// target queued while no expansion was active starts promptly.
function advanceExpansionQueue(): void {
  if (Memory.expansion) return; // a slot must be free
  const queue = Memory.expansionQueue;
  if (!queue || queue.length === 0) return;

  // GCL headroom: never start a claim the global level can't support.
  const ownedRooms = Object.values(Game.rooms).filter((r) => r.controller?.my);
  if (Game.gcl.level <= ownedRooms.length) return;
  if (Game.cpu.bucket < MIN_BUCKET) return;

  // Bound the scan to one pass over the current entries so re-queued (still-contested)
  // targets don't spin forever within a single tick.
  let toExamine = queue.length;
  while (queue.length > 0 && toExamine-- > 0) {
    const next = queue.shift()!;

    // Already ours — drop it permanently, nothing left to claim.
    const targetRoom = Game.rooms[next.roomName];
    if (targetRoom?.controller?.my) continue;

    // Momentarily contested (a passing invader / brief enemy reservation) — re-queue at
    // the back to retry later rather than silently discarding a target the user chose.
    const rec = findRemoteRecord(next.roomName);
    if ((targetRoom && isRoomContested(targetRoom)) || (rec && isRemoteContested(rec))) {
      queue.push(next);
      continue;
    }

    // Resolve a healthy funding room: honour an explicit choice if still healthy,
    // else pick the closest healthy owned room.
    const home = resolveFundingHome(next.roomName, next.homeRoom);
    if (!home) {
      // No healthy home right now — re-queue at the back and stop (avoid spinning).
      queue.push(next);
      return;
    }

    Memory.expansion = {
      roomName: next.roomName,
      homeRoom: home,
      phase: "claiming",
      startedAt: Game.time,
    };
    console.log(
      `[Expansion] Queue advanced → claiming ${next.roomName} funded by ${home} ` +
      `(${queue.length} still queued)`
    );
    return;
  }
}

// Closest healthy owned room able to fund an expansion to `roomName`. Honours a
// preferred home only when it's still healthy; otherwise falls back to the closest.
function resolveFundingHome(roomName: string, preferred?: string): string | undefined {
  if (preferred) {
    const room = Game.rooms[preferred];
    if (room && isHomeRoomHealthy(room)) return preferred;
  }
  let best: Room | undefined;
  let bestDist = Infinity;
  for (const rn in Game.rooms) {
    const room = Game.rooms[rn];
    if (!isHomeRoomHealthy(room)) continue;
    const d = Game.map.getRoomLinearDistance(rn, roomName);
    if (d < bestDist) {
      bestDist = d;
      best = room;
    }
  }
  return best?.name;
}

// ── Expansion queue console API ───────────────────────────────────────────────

// Enqueue a target if not already active/queued. Returns an error string or null.
export function enqueueExpansion(roomName: string, homeRoom?: string): string | null {
  if (Memory.expansion?.roomName === roomName) return `${roomName} is already the active expansion`;
  if (!Memory.expansionQueue) Memory.expansionQueue = [];
  if (Memory.expansionQueue.some((q) => q.roomName === roomName)) {
    return `${roomName} is already queued`;
  }
  const targetRoom = Game.rooms[roomName];
  if (targetRoom?.controller?.my) return `${roomName} is already yours`;
  if (targetRoom?.controller?.owner && !targetRoom.controller.my) {
    return `${roomName} is owned by ${targetRoom.controller.owner.username}`;
  }
  Memory.expansionQueue.push({ roomName, homeRoom, queuedAt: Game.time });
  return null;
}

// Remove a queued target. Returns true if something was removed.
export function dequeueExpansion(roomName: string): boolean {
  const queue = Memory.expansionQueue;
  if (!queue) return false;
  const before = queue.length;
  Memory.expansionQueue = queue.filter((q) => q.roomName !== roomName);
  return Memory.expansionQueue.length !== before;
}

export function getExpansionQueue(): QueuedExpansion[] {
  return Memory.expansionQueue ?? [];
}

// Runs EVERY tick regardless of autoExpand — manages whatever expansion is active
// (whether auto-selected or set by Game.arca.claim).
function manageActiveExpansion() {
  const exp = Memory.expansion;
  if (!exp) return;

  const child = Game.rooms[exp.roomName];

  // ── Contested-room abort (claiming / bootstrapping) ─────────────────────────
  // If the target is now owned/reserved by another player, give up cleanly. (A
  // transient hostile-creep raid during bootstrapping is handled by the pause
  // below, not a full abort — losing the room to another owner is not.)
  if (child && child.controller?.owner && !child.controller.my) {
    clearExpansion(`contested: ${exp.roomName} owned by ${child.controller.owner.username}`);
    return;
  }
  // While still claiming, also honour fresh scout intel (room may be invisible).
  if (exp.phase === "claiming") {
    const rec = findRemoteRecord(exp.roomName);
    if (rec && isRemoteContested(rec)) {
      clearExpansion(`contested: scout flagged ${exp.roomName} hostile pre-claim`);
      return;
    }
    if (Game.time - exp.startedAt > CLAIM_TIMEOUT) {
      // Don't abort while a conqueror has actually reached the target room — the claim
      // may commit this very tick. Clearing now would delete the expansion record the
      // same tick the room becomes ours, orphaning it at RCL 1 with no bootstrap. The
      // timeout still fires for genuinely doomed claims (unreachable target / perpetual
      // enemy reservation), where the conqueror never makes it into the room.
      const claimerInRoom = Object.values(Game.creeps).some(
        (c) =>
          c.memory.role === ROLE_CONQUEROR &&
          c.memory.targetRoom === exp.roomName &&
          c.room.name === exp.roomName
      );
      if (!claimerInRoom) {
        clearExpansion(`claim timed out after ${CLAIM_TIMEOUT} ticks`);
        return;
      }
    }
  }

  // ── Bootstrap phase: defense + completion ───────────────────────────────────
  if (exp.phase === "bootstrapping") {
    // Stamp the bootstrap start the first tick we observe this phase, so the timeout
    // measures actual bootstrap time — not claim travel/reservation time. A slow claim
    // used to eat the bootstrap budget and abort a perfectly healthy child.
    if (exp.bootstrapStartedAt === undefined) exp.bootstrapStartedAt = Game.time;
    // Hard timeout: a bootstrap that never completes is throwing energy away.
    if (Game.time - exp.bootstrapStartedAt > BOOTSTRAP_TIMEOUT && !isChildSelfSufficient(child)) {
      clearExpansion(`bootstrap timed out after ${BOOTSTRAP_TIMEOUT} ticks`);
      return;
    }

    if (child) {
      const threat = getThreatInfo(child).score;
      if (threat > 0) {
        // Child is invaded: pause settler spawning and flag a defender request so a
        // home-room spawn rule can react. Settlers themselves retreat (role.settler).
        exp.pausedUntil = Game.time + BOOTSTRAP_INVASION_PAUSE;
        exp.needsDefender = true;
        // The spawn orchestrator consumes both flags: shouldSpawnSettler() halts settler
        // production while pausedUntil is in the future, and needsChildRoomDefender()
        // raises a knight (targetRoom = the child room) to clear it. Settlers retreat on
        // their own meanwhile (see role.settler).
      } else {
        // Clear once the room is verifiably safe again.
        if (exp.needsDefender) exp.needsDefender = false;
        if (exp.pausedUntil && exp.pausedUntil <= Game.time) exp.pausedUntil = undefined;
      }

      // Completion check — this orchestrator is the single authority on the
      // bootstrapping → established transition (shouldSpawnSettler defers to it), using
      // the authoritative self-sufficiency criteria below rather than "a spawn exists".
      if (isChildSelfSufficient(child)) {
        exp.phase = "established";
        exp.establishedAt = Game.time;
        exp.needsDefender = false;
        exp.pausedUntil = undefined;
        console.log(
          `[Expansion] ${exp.roomName} is self-sufficient (RCL ${child.controller!.level}, ` +
          `own spawn built) — established.`
        );
      }
    }
    return;
  }

  // ── Established: retain briefly, then clean up so the next target can start ──
  if (exp.phase === "established") {
    const since = exp.establishedAt ?? exp.startedAt;
    if (Game.time - since > ESTABLISHED_RETENTION) {
      clearExpansion("retention window elapsed");
    }
  }
}

// Cap on how many targets the auto-expander keeps queued ahead. The pipeline still
// claims one at a time; this just bounds how far ahead we plan so the queue doesn't
// balloon with stale candidates that change as scouting progresses.
const MAX_AUTO_QUEUE_DEPTH = 3;

// Whether the empire's strategic posture permits STARTING new auto-claims. Per the
// EmpireMemory contract a missing Memory.empire means "EXPAND" (backward-compatible
// default), so we only block when an explicit non-EXPAND posture is set. Manual claims
// (Game.arca) and already-running expansions are unaffected — they don't pass through here.
function isExpansionPostureAllowed(): boolean {
  const posture = Memory.empire?.posture ?? "EXPAND";
  return posture === "EXPAND";
}

export function loop() {
  // Lifecycle management always runs — a manually claimed (Game.arca.claim)
  // expansion must complete/abort even with autoExpand off.
  manageActiveExpansion();

  // Pump the pipeline every tick: if a slot is free and something is queued (manual
  // Game.arca.queueExpand OR auto-enqueued below), start the next viable target.
  if (!Memory.expansion) advanceExpansionQueue();

  if (Memory.autoExpand !== true) return;

  // Posture gate: only START NEW auto-claims while the empire is in EXPAND posture.
  // Note this gates ONLY the auto-enqueue below — manageActiveExpansion() and
  // advanceExpansionQueue() already ran above, so an in-progress expansion (or anything
  // a human queued via Game.arca) still finishes during TURTLE / RECOVER / WAR. We just
  // stop FEEDING the queue new candidates until the empire returns to EXPAND.
  if (!isExpansionPostureAllowed()) return;

  if (Game.time % AUTO_EXPAND_CHECK_INTERVAL !== 0) return;

  if (Game.cpu.bucket < MIN_BUCKET) return;

  // GCL headroom: don't queue beyond what the global level can support. One slot is
  // the active expansion; the rest can be lined up in the queue.
  const ownedRooms = Object.values(Game.rooms).filter((r) => r.controller?.my);
  const activeCount = Memory.expansion ? 1 : 0;
  const queuedCount = Memory.expansionQueue?.length ?? 0;
  const gclHeadroom = Game.gcl.level - ownedRooms.length; // rooms we may still add
  const slotsFree = gclHeadroom - activeCount - queuedCount;
  if (slotsFree <= 0) return;

  // ENQUEUE the best candidates whose funding room is healthy (rather than discarding
  // all but the top pick). Skips anything already active or queued. The queue-advance
  // mechanism converts the head into an active claim once a slot is free.
  if (!Memory.expansionQueue) Memory.expansionQueue = [];
  let enqueued = 0;
  for (const cand of rankExpansionCandidates()) {
    if (Memory.expansionQueue.length >= MAX_AUTO_QUEUE_DEPTH) break;
    if (enqueued >= slotsFree) break;
    if (Memory.expansion?.roomName === cand.room) continue;
    if (Memory.expansionQueue.some((q) => q.roomName === cand.room)) continue;
    const home = Game.rooms[cand.homeRoom];
    if (!home || !isHomeRoomHealthy(home)) continue;

    Memory.expansionQueue.push({ roomName: cand.room, homeRoom: cand.homeRoom, queuedAt: Game.time });
    enqueued++;
    console.log(
      `[AutoExpand] Queued ${cand.room} (score=${cand.score}, sources=${cand.sources}, ` +
      `dist=${cand.dist}) funded by ${cand.homeRoom} — GCL ${Game.gcl.level}/${ownedRooms.length + 1}`
    );
  }

  // Start immediately if a slot is free (don't wait a tick for the next loop pass).
  if (enqueued > 0 && !Memory.expansion) advanceExpansionQueue();
}
