import { getThreatInfo } from "../services/services.combat";
import { ROLE_MINER, ROLE_HAULER } from "../config/config.roles";

// Closes the growth loop: when GCL frees a colony slot and a healthy home room
// can fund it, automatically claim the best scouted candidate — no console command.
// Reuses the existing Memory.expansion state machine (claiming → bootstrapping →
// established); this orchestrator *sets* Memory.expansion (exactly as
// Game.arca.claim() does) AND now *drives its lifecycle*: it auto-completes the
// bootstrap, aborts contested claims, and pauses bootstrap when the child is
// invaded. Candidate auto-selection is disabled by default (Game.arca.autoexpand);
// the lifecycle management below always runs so a manually-claimed expansion
// (Game.arca.claim) finishes correctly too.

// Extra runtime flags we hang off Memory.expansion. ExpansionData in types.d.ts
// does NOT declare these yet, so we read/write them through this narrowed view.
// NOTE (types.d.ts owner): add the following optional fields to interface
// ExpansionData so these casts can be dropped:
//   establishedAt?: number;        // (already present)
//   pausedUntil?: number;          // bootstrap paused (child invaded) until this tick
//   needsDefender?: boolean;       // home room should spawn a defender for roomName
//   abortReason?: string;          // why a claim was abandoned (diagnostics only)
interface ExpansionRuntime extends ExpansionData {
  pausedUntil?: number;
  needsDefender?: boolean;
  abortReason?: string;
}

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

const EXPANSION_CANDIDATE_SOURCES_WEIGHT = 40;
const EXPANSION_CANDIDATE_DIST_PENALTY = 5;

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
}

// Rank non-hostile, unowned rooms from every owned room's scout data. Shared with
// Game.arca.expand() so the console and the auto-expander always agree on choice.
export function rankExpansionCandidates(): ExpansionCandidate[] {
  const candidates: ExpansionCandidate[] = [];

  for (const rn in Game.rooms) {
    const room = Game.rooms[rn];
    if (!room.controller?.my) continue;
    for (const remote of room.memory.remoteRooms ?? []) {
      if (isRemoteContested(remote)) continue;
      const targetRoom = Game.rooms[remote.roomName];
      if (targetRoom?.controller?.my) continue; // already ours
      if (targetRoom && isRoomContested(targetRoom)) continue; // owned/reserved/hostile right now
      const dist = Game.map.getRoomLinearDistance(rn, remote.roomName);
      const score =
        remote.sources.length * EXPANSION_CANDIDATE_SOURCES_WEIGHT -
        dist * EXPANSION_CANDIDATE_DIST_PENALTY;
      candidates.push({
        room: remote.roomName,
        homeRoom: rn,
        score,
        sources: remote.sources.length,
        dist,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
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

  while (queue.length > 0) {
    const next = queue.shift()!;

    // Skip targets we already own or that turned hostile while waiting.
    const targetRoom = Game.rooms[next.roomName];
    if (targetRoom?.controller?.my) continue;
    if (targetRoom && isRoomContested(targetRoom)) continue;
    const rec = findRemoteRecord(next.roomName);
    if (rec && isRemoteContested(rec)) continue;

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
  const exp = Memory.expansion as ExpansionRuntime | undefined;
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
      clearExpansion(`claim timed out after ${CLAIM_TIMEOUT} ticks`);
      return;
    }
  }

  // ── Bootstrap phase: defense + completion ───────────────────────────────────
  if (exp.phase === "bootstrapping") {
    // Hard timeout: a bootstrap that never completes is throwing energy away.
    if (Game.time - exp.startedAt > BOOTSTRAP_TIMEOUT && !isChildSelfSufficient(child)) {
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
        // NOTE (orchestrator.spawning owner): two requested changes when a child is
        // invaded during bootstrap —
        //  (1) shouldSpawnSettler() should `return false` while
        //      Memory.expansion.pausedUntil > Game.time, so we stop feeding settlers
        //      into the fight (they retreat on their own; see role.settler).
        //  (2) when Memory.expansion.needsDefender is true, the funding home room
        //      (Memory.expansion.homeRoom) should spawn a defender (knight/cleric)
        //      with memory.targetRoom = Memory.expansion.roomName that travels to the
        //      child room and engages.
        // Neither rule exists yet; until added, the child relies on its own
        // towers/defenders and settlers simply retreat.
      } else {
        // Clear once the room is verifiably safe again.
        if (exp.needsDefender) exp.needsDefender = false;
        if (exp.pausedUntil && exp.pausedUntil <= Game.time) exp.pausedUntil = undefined;
      }

      // Completion check — authoritative, explicit, documented criteria.
      // NOTE (orchestrator.spawning owner): shouldSpawnSettler() currently flips
      // phase to "established" as soon as ANY spawn exists in the child room. That is
      // premature — it can happen at RCL 1 with no economy, stopping settlers before
      // the room can sustain itself. Please REMOVE that early transition from
      // shouldSpawnSettler() (just `return false` when a spawn exists / when phase is
      // no longer "bootstrapping"); this orchestrator is now the single authority on
      // the bootstrapping → established transition using the criteria below.
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

export function loop() {
  // Lifecycle management always runs — a manually claimed (Game.arca.claim)
  // expansion must complete/abort even with autoExpand off.
  manageActiveExpansion();

  // Pump the pipeline every tick: if a slot is free and something is queued (manual
  // Game.arca.queueExpand OR auto-enqueued below), start the next viable target.
  if (!Memory.expansion) advanceExpansionQueue();

  if (Memory.autoExpand !== true) return;
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
