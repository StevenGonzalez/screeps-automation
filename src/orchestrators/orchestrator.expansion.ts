import { getThreatInfo, isSourceKeeperRoom } from "../services/services.combat";
import { ROLE_MINER, ROLE_HAULER, ROLE_CONQUEROR } from "../config/config.roles";
import { getCpuStats } from "../services/services.profiler";
import { KEEP_FUND_FLOOR } from "../services/services.treasury";
import { castleName, chronicle, wildsName } from "../services/services.chronicle";

const BOOTSTRAP_MIN_RCL = 3;
const BOOTSTRAP_MIN_STORAGE_ENERGY = 10_000;

const BOOTSTRAP_INVASION_PAUSE = 200;

const BOOTSTRAP_TIMEOUT = 6_000;

const CLAIM_TIMEOUT = 1_500;
const CLAIM_FAILED_COOLDOWN = 20_000;

const ESTABLISHED_RETENTION = 1_000;

const W_SOURCE_FIRST = 50;
const W_SOURCE_SECOND = 60;
const W_SOURCE_EXTRA = 15;

const W_DIST_PENALTY = 6;

const W_MINERAL_NEW = 25;
const W_MINERAL_RARE = 25;

const W_EXIT_PENALTY = 12;
const W_CHOKEPOINT_BONUS = 30;

const W_REMOTE = 35;
const MAX_SCORED_REMOTES = 4;

const W_ENEMY_PENALTY = 20;
const ENEMY_DANGER_RADIUS = 4;
const STRONG_ENEMY_MILITARY = 8;

const W_SWAMP_PENALTY = 40;
const SWAMP_TOLERANCE = 0.35;
const MAX_TERRAIN_SCANS_PER_TICK = 6;

const MAX_CLAIM_RANGE = 4;
const MAX_INTEL_CANDIDATES = 25;
// Longest room-to-room route from the funding home we'll try to claim across.
const MAX_CLAIM_ROUTE = 10;

const AUTO_EXPAND_CHECK_INTERVAL = 50;

const MIN_HOME_RCL = 4;
// Below the floor a saving castle keeps, so one sitting on its floor qualifies.
export const MIN_HOME_STORAGE_ENERGY = KEEP_FUND_FLOOR - 5_000;
const MIN_BUCKET = 5_000;
// Every keep costs CPU each tick for good. Auto-expansion stops queueing new
// ones once the empire's average use passes this share of the limit.
const MAX_CPU_SHARE_TO_EXPAND = 0.55;

export interface ExpansionCandidate {
  room: string;
  homeRoom: string;
  score: number;
  sources: number;
  dist: number;
  remotes?: number;
  exits?: number;
  mineral?: MineralConstant;
}

export function rankExpansionCandidates(): ExpansionCandidate[] {
  const ownedMinerals = scanOwnedMinerals();
  const claimFailed = recentClaimFailures();
  const terrainBudget = { remaining: MAX_TERRAIN_SCANS_PER_TICK };

  const byRoom = new Map<string, { home: string; dist: number; sourceCount: number }>();

  const consider = (roomName: string, home: string, sourceCount: number) => {
    const dist = Game.map.getRoomLinearDistance(home, roomName);
    const existing = byRoom.get(roomName);
    if (!existing || dist < existing.dist) {
      byRoom.set(roomName, { home, dist, sourceCount });
    }
  };

  for (const rn in Game.rooms) {
    const room = Game.rooms[rn];
    if (!room.controller?.my) continue;
    for (const remote of room.memory.remoteRooms ?? []) {
      if (isRemoteContested(remote)) continue;
      if (claimFailed.has(remote.roomName)) continue;
      const remoteIntel = Memory.intel?.[remote.roomName];
      if (remoteIntel && intelIsHostile(remoteIntel)) continue;
      const targetRoom = Game.rooms[remote.roomName];
      if (targetRoom?.controller?.my) continue;
      if (targetRoom && isRoomContested(targetRoom)) continue;
      consider(remote.roomName, rn, remote.sources.length);
    }
  }

  const homeNames: string[] = [];
  for (const rn in Game.rooms) {
    if (canFundKeeps(Game.rooms[rn])) homeNames.push(rn);
  }
  if (homeNames.length > 0 && Memory.intel) {
    let intelSeen = 0;
    for (const rn in Memory.intel) {
      if (intelSeen >= MAX_INTEL_CANDIDATES) break;
      if (byRoom.has(rn)) continue;
      if (claimFailed.has(rn)) continue;
      if (Game.rooms[rn]?.controller?.my) continue;
      const intel = Memory.intel[rn];
      if (intelIsHostile(intel)) continue;
      if (isSourceKeeperRoom(rn)) continue;
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
      const sourceCount = intel.sourcePos?.length ?? 0;
      consider(rn, bestHome, sourceCount);
    }
  }

  const candidates: ExpansionCandidate[] = [];
  for (const [roomName, info] of byRoom) {
    if (!isReachable(info.home, roomName)) continue;
    const scored = scoreCandidate(roomName, info.home, info.dist, info.sourceCount, ownedMinerals, terrainBudget);
    if (scored) candidates.push(scored);
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function scoreCandidate(
  roomName: string,
  home: string,
  dist: number,
  sourceCount: number,
  ownedMinerals: Set<MineralConstant>,
  terrainBudget: { remaining: number }
): ExpansionCandidate | undefined {
  if (sourceCount <= 0) return undefined;
  let score = W_SOURCE_FIRST;
  if (sourceCount >= 2) score += W_SOURCE_SECOND;
  if (sourceCount >= 3) score += (sourceCount - 2) * W_SOURCE_EXTRA;

  score -= dist * W_DIST_PENALTY;

  const mineral = mineralTypeOf(roomName);
  if (mineral && !ownedMinerals.has(mineral)) {
    score += W_MINERAL_NEW;
    if (mineral === RESOURCE_CATALYST) score += W_MINERAL_RARE;
  }

  const exitSides = countExitSides(roomName);
  score -= exitSides * W_EXIT_PENALTY;
  if (exitSides <= 2) score += W_CHOKEPOINT_BONUS;

  const remotes = countFreeRemoteNeighbours(roomName);
  score += remotes * W_REMOTE;

  score -= enemyProximityPenalty(roomName);

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

function mineralTypeOf(roomName: string): MineralConstant | undefined {
  const room = Game.rooms[roomName];
  if (room) {
    const mineral = room.find(FIND_MINERALS)[0];
    if (mineral) return mineral.mineralType;
  }
  return Memory.intel?.[roomName]?.mineralType;
}

function countExitSides(roomName: string): number {
  const exits = Game.map.describeExits(roomName);
  let n = 0;
  for (const dir in exits) {
    if (exits[dir as ExitKey]) n++;
  }
  return n;
}

function countFreeRemoteNeighbours(roomName: string): number {
  const exits = Game.map.describeExits(roomName);
  let count = 0;
  for (const dir in exits) {
    if (count >= MAX_SCORED_REMOTES) break;
    const neighbor = exits[dir as ExitKey];
    if (!neighbor) continue;
    if (Game.rooms[neighbor]?.controller?.my) continue;
    if (isSourceKeeperRoom(neighbor)) continue;
    const intel = Memory.intel?.[neighbor];
    if (!intel) continue;
    if (intelIsHostile(intel)) continue;
    const sources = intel.sourcePos?.length ?? 0;
    if (sources > 0) count++;
  }
  return count;
}

function enemyProximityPenalty(roomName: string): number {
  if (!Memory.players) return 0;
  const coords = roomNameToCoords(roomName);
  if (!coords) return 0;
  let penalty = 0;
  for (const username in Memory.players) {
    const p = Memory.players[username];
    if (p.username === myUsername()) continue;
    if (p.militaryStrength < STRONG_ENEMY_MILITARY) continue;
    const d = Math.max(Math.abs(coords.x - p.centroidX), Math.abs(coords.y - p.centroidY));
    if (d <= ENEMY_DANGER_RADIUS) {
      penalty += (ENEMY_DANGER_RADIUS - d + 1) * W_ENEMY_PENALTY;
    }
  }
  return penalty;
}

// A linear-distance neighbour can still be walled off or a long detour away.
function isReachable(home: string, roomName: string): boolean {
  const route = Game.map.findRoute(home, roomName);
  return route !== ERR_NO_PATH && route.length <= MAX_CLAIM_ROUTE;
}

// Rooms whose claim recently timed out, with expired entries dropped.
function recentClaimFailures(): Set<string> {
  const failures = Memory.claimFailures;
  const result = new Set<string>();
  if (!failures) return result;
  for (const rn in failures) {
    if (failures[rn] > Game.time) result.add(rn);
    else delete failures[rn];
  }
  if (result.size === 0) delete Memory.claimFailures;
  return result;
}

function swampFraction(roomName: string): number | undefined {
  const terrain = Game.map.getRoomTerrain(roomName);
  if (!terrain) return undefined;
  let swamp = 0;
  let sampled = 0;
  for (let x = 0; x < 50; x += 5) {
    for (let y = 0; y < 50; y += 5) {
      sampled++;
      if (terrain.get(x, y) === TERRAIN_MASK_SWAMP) swamp++;
    }
  }
  return sampled > 0 ? swamp / sampled : undefined;
}

function intelIsHostile(intel: RoomIntelData): boolean {
  const me = myUsername();
  if (intel.owner && intel.owner !== me) return true;
  if (intel.reservedBy && intel.reservedBy !== me) return true;
  if ((intel.threatLevel ?? 0) >= 5) return true;
  return false;
}

function roomNameToCoords(roomName: string): { x: number; y: number } | undefined {
  const m = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
  if (!m) return undefined;
  const x = m[1] === "W" ? -parseInt(m[2], 10) : parseInt(m[2], 10);
  const y = m[3] === "N" ? -parseInt(m[4], 10) : parseInt(m[4], 10);
  return { x, y };
}

function isRemoteContested(remote: RemoteRoomData): boolean {
  if (remote.hostile) return true;
  if (remote.hostileUntil !== undefined && remote.hostileUntil > Game.time) return true;
  return false;
}

function isRoomContested(room: Room): boolean {
  const ctrl = room.controller;
  if (ctrl) {
    if (ctrl.owner && !ctrl.my) return true;
    if (ctrl.reservation && ctrl.reservation.username !== myUsername()) {
      return true;
    }
  }
  if (getThreatInfo(room).score > 0) return true;
  return false;
}

function myUsername(): string | undefined {
  for (const rn in Game.rooms) {
    const owner = Game.rooms[rn].controller?.owner;
    if (Game.rooms[rn].controller?.my && owner) return owner.username;
  }
  return undefined;
}

function findRemoteRecord(roomName: string): RemoteRoomData | undefined {
  for (const rn in Game.rooms) {
    const room = Game.rooms[rn];
    if (!room.controller?.my) continue;
    const rec = (room.memory.remoteRooms ?? []).find((r) => r.roomName === roomName);
    if (rec) return rec;
  }
  return undefined;
}

// A castle that can fund a new keep once its treasury holds enough.
function canFundKeeps(room: Room): boolean {
  if (!room.controller?.my) return false;
  if ((room.controller.level ?? 0) < MIN_HOME_RCL) return false;
  if (!room.storage) return false;
  return getThreatInfo(room).score === 0;
}

function isHomeRoomHealthy(room: Room): boolean {
  return canFundKeeps(room) && room.storage!.store[RESOURCE_ENERGY] >= MIN_HOME_STORAGE_ENERGY;
}

function isChildSelfSufficient(child: Room | undefined): boolean {
  if (!child) return false;
  if (!child.controller?.my) return false;
  if ((child.controller.level ?? 0) < BOOTSTRAP_MIN_RCL) return false;

  if (child.find(FIND_MY_SPAWNS).length === 0) return false;

  const localCreeps = child.find(FIND_MY_CREEPS);
  const hasMiner = localCreeps.some((c) => c.memory.role === ROLE_MINER);
  const hasHauler = localCreeps.some((c) => c.memory.role === ROLE_HAULER);
  const storageEnergy = child.storage?.store[RESOURCE_ENERGY] ?? 0;
  const economyOk =
    (hasMiner && hasHauler) || storageEnergy >= BOOTSTRAP_MIN_STORAGE_ENERGY;
  if (!economyOk) return false;

  return true;
}

function clearExpansion(reason: string) {
  const exp = Memory.expansion;
  if (!exp) return;
  console.log(`[Expansion] Cleared ${exp.roomName} (${reason}).`);
  delete Memory.expansion;
  advanceExpansionQueue();
}

function advanceExpansionQueue(): void {
  if (Memory.expansion) return;
  const queue = Memory.expansionQueue;
  if (!queue || queue.length === 0) return;

  const ownedRooms = Object.values(Game.rooms).filter((r) => r.controller?.my);
  if (Game.gcl.level <= ownedRooms.length) return;
  if (Game.cpu.bucket < MIN_BUCKET) return;

  let toExamine = queue.length;
  while (queue.length > 0 && toExamine-- > 0) {
    const next = queue.shift()!;

    const targetRoom = Game.rooms[next.roomName];
    if (targetRoom?.controller?.my) continue;
    if (targetRoom?.controller?.owner) continue;

    const rec = findRemoteRecord(next.roomName);
    if ((targetRoom && isRoomContested(targetRoom)) || (rec && isRemoteContested(rec))) {
      queue.push(next);
      continue;
    }

    // No castle can fund this keep, so none can fund any other either. Keep
    // the queue's order, which planSavings saves toward.
    const home = resolveFundingHome(next.roomName, next.homeRoom);
    if (!home) {
      queue.unshift(next);
      return;
    }

    Memory.expansion = {
      roomName: next.roomName,
      homeRoom: home,
      phase: "claiming",
      startedAt: Game.time,
    };
    console.log(
      `[Expansion] Queue advanced -> claiming ${next.roomName} funded by ${home} ` +
      `(${queue.length} still queued)`
    );
    return;
  }
}

export function resolveFundingHome(
  roomName: string,
  preferred?: string,
  eligible: (room: Room) => boolean = isHomeRoomHealthy
): string | undefined {
  if (preferred) {
    const room = Game.rooms[preferred];
    if (room && eligible(room)) return preferred;
  }
  let best: Room | undefined;
  let bestDist = Infinity;
  for (const rn in Game.rooms) {
    const room = Game.rooms[rn];
    if (!eligible(room)) continue;
    const d = Game.map.getRoomLinearDistance(rn, roomName);
    if (d < bestDist) {
      bestDist = d;
      best = room;
    }
  }
  return best?.name;
}

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

function manageActiveExpansion() {
  const exp = Memory.expansion;
  if (!exp) return;

  const child = Game.rooms[exp.roomName];

  if (child && child.controller?.owner && !child.controller.my) {
    clearExpansion(`contested: ${exp.roomName} owned by ${child.controller.owner.username}`);
    return;
  }
  if (exp.phase === "claiming") {
    const rec = findRemoteRecord(exp.roomName);
    if (rec && isRemoteContested(rec)) {
      if (!Memory.expansionQueue) Memory.expansionQueue = [];
      if (!Memory.expansionQueue.some((q) => q.roomName === exp.roomName)) {
        Memory.expansionQueue.push({ roomName: exp.roomName, homeRoom: exp.homeRoom, queuedAt: Game.time });
      }
      clearExpansion(`contested: scout flagged ${exp.roomName} hostile pre-claim - re-queued`);
      return;
    }
    if (Game.time - exp.startedAt > CLAIM_TIMEOUT) {
      const claimerInRoom = Object.values(Game.creeps).some(
        (c) =>
          c.memory.role === ROLE_CONQUEROR &&
          c.memory.targetRoom === exp.roomName &&
          c.room.name === exp.roomName
      );
      if (!claimerInRoom) {
        // Cool the room down as an expansion target only; it stays minable as a remote.
        if (!Memory.claimFailures) Memory.claimFailures = {};
        Memory.claimFailures[exp.roomName] = Game.time + CLAIM_FAILED_COOLDOWN;
        chronicle(`The conqueror never reached the throne in the ${wildsName(exp.roomName)}. The claim is abandoned.`);
        clearExpansion(`claim timed out after ${CLAIM_TIMEOUT} ticks`);
        return;
      }
    }
  }

  if (exp.phase === "bootstrapping") {
    if (exp.bootstrapStartedAt === undefined) exp.bootstrapStartedAt = Game.time;
    if (Game.time - exp.bootstrapStartedAt > BOOTSTRAP_TIMEOUT && !isChildSelfSufficient(child)) {
      if (child?.controller?.my && child.find(FIND_MY_SPAWNS).length > 0) {
        // The keep has a spawn and stays ours; only the settlers stop coming.
        chronicle(`${castleName(exp.homeRoom)} sends no more settlers. ${castleName(exp.roomName)} must stand on its own now.`);
        clearExpansion(`bootstrap timed out after ${BOOTSTRAP_TIMEOUT} ticks`);
        return;
      }
      chronicle(`The settlers of ${castleName(exp.roomName)} could not make it stand. The keep is abandoned.`);
      if (child?.controller?.my) child.controller.unclaim();
      clearExpansion(`bootstrap timed out after ${BOOTSTRAP_TIMEOUT} ticks - no spawn, unclaimed`);
      return;
    }

    if (child) {
      const threat = getThreatInfo(child).score;
      if (threat > 0) {
        exp.pausedUntil = Game.time + BOOTSTRAP_INVASION_PAUSE;
        exp.needsDefender = true;
      } else {
        if (exp.needsDefender) exp.needsDefender = false;
        if (exp.pausedUntil && exp.pausedUntil <= Game.time) exp.pausedUntil = undefined;
      }

      if (isChildSelfSufficient(child)) {
        exp.phase = "established";
        exp.establishedAt = Game.time;
        exp.needsDefender = false;
        exp.pausedUntil = undefined;
        console.log(
          `[Expansion] ${exp.roomName} is self-sufficient (RCL ${child.controller!.level}, ` +
          `own spawn built) - established.`
        );
        chronicle(`${castleName(exp.roomName)} stands on its own, with a spawn of its own. The realm grows.`);
      }
    }
    return;
  }

  if (exp.phase === "established") {
    const since = exp.establishedAt ?? exp.startedAt;
    if (Game.time - since > ESTABLISHED_RETENTION) {
      clearExpansion("retention window elapsed");
    }
  }
}

const MAX_AUTO_QUEUE_DEPTH = 3;

function isExpansionPostureAllowed(): boolean {
  const posture = Memory.empire?.posture ?? "EXPAND";
  return posture === "EXPAND";
}

export function loop() {
  manageActiveExpansion();

  if (!Memory.expansion) advanceExpansionQueue();

  if (Game.time % AUTO_EXPAND_CHECK_INTERVAL !== 0) return;

  if (Memory.autoExpand !== false && isExpansionPostureAllowed()) autoQueue();

  planSavings();
}

function cpuShareUsed(): number {
  let total = 0;
  const stats = getCpuStats();
  for (const name in stats) total += stats[name].ema;
  return Game.cpu.limit ? total / Game.cpu.limit : 0;
}

function autoQueue(): void {
  if (Game.cpu.bucket < MIN_BUCKET) return;
  if (cpuShareUsed() > MAX_CPU_SHARE_TO_EXPAND) return;

  const ownedRooms = Object.values(Game.rooms).filter((r) => r.controller?.my);
  const activeCount = Memory.expansion ? 1 : 0;
  const queuedCount = Memory.expansionQueue?.length ?? 0;
  const gclHeadroom = Game.gcl.level - ownedRooms.length;
  const slotsFree = gclHeadroom - activeCount - queuedCount;
  if (slotsFree <= 0) return;

  if (!Memory.expansionQueue) Memory.expansionQueue = [];
  let enqueued = 0;
  for (const cand of rankExpansionCandidates()) {
    if (Memory.expansionQueue.length >= MAX_AUTO_QUEUE_DEPTH) break;
    if (enqueued >= slotsFree) break;
    if (Memory.expansion?.roomName === cand.room) continue;
    if (Memory.expansionQueue.some((q) => q.roomName === cand.room)) continue;
    // A castle short of gold still queues the keep; planSavings then has it
    // save toward the gate.
    const home = Game.rooms[cand.homeRoom];
    if (!home || !canFundKeeps(home)) continue;

    Memory.expansionQueue.push({ roomName: cand.room, homeRoom: cand.homeRoom, queuedAt: Game.time });
    enqueued++;
    console.log(
      `[AutoExpand] Queued ${cand.room} (score=${cand.score}, sources=${cand.sources}, ` +
      `dist=${cand.dist}) funded by ${cand.homeRoom} - GCL ${Game.gcl.level}/${ownedRooms.length + 1}`
    );
  }

  if (enqueued > 0 && !Memory.expansion) advanceExpansionQueue();
}

// The castle that will fund the next keep in the queue saves for it: its
// enchanters leave KEEP_FUND_FLOOR in the treasury instead of the usual floor
// (see services.treasury). A castle funding the active expansion holds the same
// floor without a plan.
function planSavings(): void {
  const next = Memory.expansionQueue?.[0];
  const home = next ? resolveFundingHome(next.roomName, next.homeRoom, canFundKeeps) : undefined;
  if (!next || !home) {
    delete Memory.expansionSavings;
    return;
  }
  const plan = Memory.expansionSavings;
  if (plan?.room === home && plan.target === next.roomName) return;
  Memory.expansionSavings = { room: home, target: next.roomName };
  chronicle(`${castleName(home)} fills its coffers to found a keep in the ${wildsName(next.roomName)}.`);
}
