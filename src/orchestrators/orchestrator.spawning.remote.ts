import {
  ROLE_SCOUT,
  ROLE_REMOTE_MINER,
  ROLE_REMOTE_HAULER,
  ROLE_RESERVER,
  ROLE_SCORE_HUNTER,
} from "../config/config.roles";
import { getThreatInfo } from "../services/services.combat";
import { MAX_BODY_PART_COUNT } from "../config/config.spawning";
import { getRemoteSourcePathLength, remoteRoadsEnabled } from "../services/services.remote";
import {
  getUnclaimedScoreTargetCount,
  getScoreScanRooms,
  scoreHunterSupported,
  homeHasObserver,
  SCORE_SCOUT_RADIUS,
} from "./orchestrator.score";
import {
  calculateBodyPartCost,
  getCreepsByRole,
  getRoomSpawningCount,
  trackedSpawn,
  bodyBudget,
  spawnLeadTicks,
  isRetiring,
  waitForFullBody,
} from "./orchestrator.spawning.shared";

// A remote post is a long walk from the spawn, so its replacement has to be
// ordered that much earlier. The outgoing creep's own body is a good stand-in
// for the size of the one that relieves it.
function isRemoteCreepRetiring(home: Room, creep: Creep): boolean {
  const target = creep.memory.targetRoom;
  if (!target) return false;
  const lead = spawnLeadTicks(creep.body.length, remoteTravelTicks(home, target, creep.memory.remoteSourceId));
  return isRetiring(creep, lead);
}

// Walk time out to a remote post: the measured path to the creep's own source,
// or for a hauler the farthest source in its room. The rough room-distance
// estimate only stands in until a path has been measured.
function remoteTravelTicks(home: Room, roomName: string, sourceId?: string): number {
  const remote = home.memory.remoteRooms?.find((r) => r.roomName === roomName);
  if (!remote) return estimateRemoteDistance(home, roomName);
  const sources = sourceId ? remote.sources.filter((s) => s.sourceId === sourceId) : remote.sources;
  if (sources.length === 0) return estimateRemoteDistance(home, roomName);
  return Math.max(...sources.map((s) => getRemoteSourceDistance(home, remote, s)));
}

// Remotes we could send creeps to. A room we have since claimed, one someone
// else owns or reserves, and one with invaders currently in it are all left out.
// An Invader reservation stops harvesting too, but a reserver can take it back,
// so the "reserve" view keeps those rooms. Picking which remotes to work looks
// past invaders (`ignoreInvaders`): they leave or get killed, and dropping the
// room for the visit would hand its spawn time to another remote meanwhile.
function isRemoteEligible(
  room: Room,
  r: RemoteRoomData,
  purpose: "harvest" | "reserve",
  ignoreInvaders = false
): boolean {
  if (r.hostile || r.sources.length === 0) return false;
  if (!ignoreInvaders && r.invaderUntil !== undefined && r.invaderUntil > Game.time) return false;
  const ctrl = Game.rooms[r.roomName]?.controller;
  const intel = Memory.intel?.[r.roomName];
  const owner = ctrl ? ctrl.owner?.username : intel?.owner;
  if (ctrl?.my || owner) return false;
  const reservedBy = ctrl ? ctrl.reservation?.username : intel?.reservedBy;
  if (!reservedBy || reservedBy === room.controller?.owner?.username) return true;
  return reservedBy === "Invader" && purpose === "reserve";
}

// Remotes worth sending creeps to: the eligible ones cut down to the sources
// this home picked (see pickRemoteSources), best room first. Each entry is a
// copy holding only the picked sources; the source entries themselves are the
// ones in memory.
export function getActiveRemoteRooms(
  room: Room,
  purpose: "harvest" | "reserve" = "harvest"
): RemoteRoomData[] {
  const picked = pickRemoteSources(room);
  const out: RemoteRoomData[] = [];
  for (const r of room.memory.remoteRooms ?? []) {
    if (!isRemoteEligible(room, r, purpose)) continue;
    const sources = r.sources.filter((s) => picked.has(s.sourceId));
    if (sources.length > 0) out.push({ ...r, sources });
  }
  const rank = (r: RemoteRoomData) => Math.min(...r.sources.map((s) => picked.get(s.sourceId)!));
  return out.sort((a, b) => rank(a) - rank(b));
}

// Remote rooms this home has picked sources in, invaded or not. Remote
// defenders guard these, and remote construction sites are kept only in these.
export function getPickedRemoteRoomNames(room: Room): Set<string> {
  const picked = pickRemoteSources(room);
  const out = new Set<string>();
  for (const r of room.memory.remoteRooms ?? []) {
    if (r.sources.some((s) => picked.has(s.sourceId))) out.add(r.roomName);
  }
  return out;
}

// A hard ceiling on remote sources per home, whatever the budget says. Remotes
// are adjacent rooms only, so this is at most four rooms' worth anyway.
const MAX_REMOTE_SOURCES = 6;

// Share of the home's spawn time remotes may plan on. The rest is headroom for
// defenders and for replacements that happen to come due together.
const REMOTE_SPAWN_SHARE = 0.8;

// Share of the remote budget a new source must leave spare to be taken on.
const REMOTE_PICK_HEADROOM = 0.1;

// Below this bucket, keep working the remotes already mined but add none.
const REMOTE_CPU_BUCKET_FLOOR = 5000;

const REMOTE_ECONOMY_ROLES = new Set<string>([
  ROLE_REMOTE_MINER,
  ROLE_REMOTE_HAULER,
  ROLE_RESERVER,
]);

// Energy per tick a remote source yields: full while we hold the reservation,
// half when the home cannot afford a reserver and the source stays neutral.
function remoteSourceOutput(room: Room): number {
  const canReserve =
    room.energyCapacityAvailable >= BODYPART_COST[CLAIM] + BODYPART_COST[MOVE];
  return (
    (canReserve ? SOURCE_ENERGY_CAPACITY : SOURCE_ENERGY_NEUTRAL_CAPACITY) / ENERGY_REGEN_TIME
  );
}

// CARRY parts it takes to move a source's output over a round trip of `dist`.
function remoteHaulCarry(output: number, dist: number): number {
  return (output * 2 * dist) / CARRY_CAPACITY;
}

function getRemoteSourceDistance(
  room: Room,
  remote: RemoteRoomData,
  src: RemoteSourceData
): number {
  return (
    getRemoteSourcePathLength(room, remote, src) ?? estimateRemoteDistance(room, remote.roomName)
  );
}

// Net energy per tick a remote source earns, and the spawn time per creep
// lifetime it takes to keep it worked. Upkeep is the miner, the hauler carry
// for its round trip, its share of the room's reserver, and decay on its
// container and (once roads are laid) the road out to it.
export function planRemoteSource(
  room: Room,
  remote: RemoteRoomData,
  src: RemoteSourceData
): { profit: number; spawnTime: number } {
  const capacity = room.energyCapacityAvailable;
  const output = remoteSourceOutput(room);
  const dist = getRemoteSourceDistance(room, remote, src);
  const roads = remoteRoadsEnabled(room);

  const miner = buildRemoteMinerBody(capacity);
  const hauler = buildRemoteHaulerBody(bodyBudget(room, "capacity"), roads);
  const haulerCarry = Math.max(1, hauler.filter((p) => p === CARRY).length);
  const carry = remoteHaulCarry(output, dist);
  const haulerCostPerCarry = calculateBodyPartCost(hauler) / haulerCarry;
  const haulerPartsPerCarry = hauler.length / haulerCarry;
  // A reserver lives CREEP_CLAIM_LIFE_TIME, so it is bought that much more
  // often than the others, and it serves every source in its room.
  const reserver = buildReserverBody(capacity);
  const reserverShare = 1 / remote.sources.length;
  const reserverRespawns = CREEP_LIFE_TIME / CREEP_CLAIM_LIFE_TIME;

  const roadTiles = src.roadTiles ? src.roadTiles.split(";").length : dist;
  const decay =
    (CONTAINER_DECAY / CONTAINER_DECAY_TIME) * REPAIR_COST +
    (roads ? (roadTiles * ROAD_DECAY_AMOUNT * REPAIR_COST) / ROAD_DECAY_TIME : 0);

  const upkeep =
    calculateBodyPartCost(miner) / CREEP_LIFE_TIME +
    (carry * haulerCostPerCarry) / CREEP_LIFE_TIME +
    (calculateBodyPartCost(reserver) * reserverShare) / CREEP_CLAIM_LIFE_TIME +
    decay;
  const parts =
    miner.length + carry * haulerPartsPerCarry + reserver.length * reserverShare * reserverRespawns;
  return { profit: output - upkeep, spawnTime: parts * CREEP_SPAWN_TIME };
}

// Spawn time per creep lifetime the home has left for remotes, after what its
// own creeps (and anything else it has spawned) already take.
function remoteSpawnBudget(room: Room): number {
  const spawns = room.find(FIND_MY_SPAWNS).length;
  let used = 0;
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (REMOTE_ECONOMY_ROLES.has(c.memory.role)) continue;
    if ((c.memory.homeRoom ?? c.room.name) !== room.name) continue;
    used += c.body.length * CREEP_SPAWN_TIME;
  }
  return spawns * CREEP_LIFE_TIME * REMOTE_SPAWN_SHARE - used;
}

const remotePickCache: Record<
  string,
  { tick: number; remotes: RemoteRoomData[] | undefined; picked: Map<string, number> }
> = {};

// The remote sources this home works, mapped to their rank (0 = best). Every
// eligible source is ranked by net energy per tick and taken best first while
// the home's spawn time covers it, up to MAX_REMOTE_SOURCES. A source that
// costs more than it earns is never taken. On a low CPU bucket only sources
// that already have a miner stay in.
function pickRemoteSources(room: Room): Map<string, number> {
  const cached = remotePickCache[room.name];
  if (cached && cached.tick === Game.time && cached.remotes === room.memory.remoteRooms) {
    return cached.picked;
  }

  const lowCpu = Game.cpu.bucket < REMOTE_CPU_BUCKET_FLOOR;
  const mined = new Set(
    getCreepsByRole(ROLE_REMOTE_MINER)
      .filter((c) => c.memory.homeRoom === room.name)
      .map((c) => c.memory.remoteSourceId)
  );
  const plans: Array<{ sourceId: string; profit: number; spawnTime: number }> = [];
  for (const r of room.memory.remoteRooms ?? []) {
    if (!isRemoteEligible(room, r, "reserve", true)) continue;
    for (const s of r.sources) {
      if (lowCpu && !mined.has(s.sourceId)) continue;
      const plan = planRemoteSource(room, r, s);
      if (plan.profit > 0) plans.push({ sourceId: s.sourceId, ...plan });
    }
  }
  plans.sort((a, b) => b.profit - a.profit);

  // The budget counts live creeps, so it breathes as home creeps die and are
  // replaced. A source not yet mined has to fit with REMOTE_PICK_HEADROOM to
  // spare, so that breathing does not keep adding and dropping the marginal one.
  const total = remoteSpawnBudget(room);
  let budget = total;
  const picked = new Map<string, number>();
  for (const p of plans) {
    if (picked.size >= MAX_REMOTE_SOURCES) break;
    const reserve = mined.has(p.sourceId as Id<Source>) ? 0 : total * REMOTE_PICK_HEADROOM;
    if (p.spawnTime > budget - reserve) continue;
    budget -= p.spawnTime;
    picked.set(p.sourceId, picked.size);
  }
  remotePickCache[room.name] = { tick: Game.time, remotes: room.memory.remoteRooms, picked };
  return picked;
}

function getScoutsForRoom(room: Room): Creep[] {
  return getCreepsByRole(ROLE_SCOUT).filter((c) => c.memory.homeRoom === room.name);
}

export function shouldSpawnScout(room: Room): boolean {
  const pending = room.memory.pendingScoutRooms ?? [];
  if (pending.length === 0) return false;
  const assignedRooms = new Set(getScoutsForRoom(room).map((c) => c.memory.targetRoom));
  return pending.some((r) => !assignedRooms.has(r));
}

export function spawnScout(room: Room, spawn: StructureSpawn): boolean {
  const pending = room.memory.pendingScoutRooms ?? [];
  const assignedRooms = new Set(getScoutsForRoom(room).map((c) => c.memory.targetRoom));
  const target = pending.find((r) => !assignedRooms.has(r));
  if (!target) return false;

  const res = trackedSpawn(room, spawn, [MOVE], `${ROLE_SCOUT}${Game.time}`, {
    memory: { role: ROLE_SCOUT, homeRoom: room.name, targetRoom: target },
  });
  return res === OK;
}

const BASELINE_SCORE_PATROLLERS = 3;

const MAX_SCORE_HUNTERS_PER_ROOM = 8;

// Without an observer, hunters are the vision system: each one buys sight, reach, and coverage
// density at once. Scale the fleet to the region so freshness holds; roughly one hunter per this
// many reachable rooms. Hunters are last in the spawn priority, so economy creeps still win the
// spawn and spare capacity naturally throttles this.
const ROOMS_PER_HUNTER = 3;

// With an observer, hunters stop scouting and become pure collectors. Keep a small standing fleet
// staged near home so a target the observer finds is claimed within a tick or two, then scale up
// to the number of unclaimed targets actually waiting.
const BASELINE_SCORE_COLLECTORS = 2;

export function shouldSpawnScoreHunter(room: Room): boolean {
  if (!scoreHunterSupported()) return false;
  if (getThreatInfo(room).score > 0) return false;
  if (room.energyAvailable < bodyBudget(room, "capacity")) return false;

  const unclaimed = getUnclaimedScoreTargetCount();
  let target: number;
  if (homeHasObserver(room.name)) {
    // Observer handles discovery; size the collector fleet to the work in flight.
    target = Math.min(MAX_SCORE_HUNTERS_PER_ROOM, Math.max(BASELINE_SCORE_COLLECTORS, unclaimed));
  } else {
    // No observer: hunters are the sensor grid. Spawn if there's a known target or a safe region
    // to search, and scale to cover that region. (Don't gate on pickPatrolRoom here: it only
    // resolves a destination for a creep already in the live fleet, so a not-yet-spawned hunter
    // would deadlock at zero.)
    const scanRooms = getScoreScanRooms(room.name, SCORE_SCOUT_RADIUS).length;
    if (unclaimed === 0 && scanRooms === 0) return false;
    const coverageNeed = Math.ceil(scanRooms / ROOMS_PER_HUNTER);
    target = Math.min(
      MAX_SCORE_HUNTERS_PER_ROOM,
      Math.max(BASELINE_SCORE_PATROLLERS, unclaimed, coverageNeed)
    );
  }

  const owned = getCreepsByRole(ROLE_SCORE_HUNTER).filter(
    (c) => !c.spawning && c.memory.homeRoom === room.name
  );
  return owned.length + getRoomSpawningCount(room, ROLE_SCORE_HUNTER) < target;
}

export function spawnScoreHunter(room: Room, spawn: StructureSpawn): boolean {
  const res = trackedSpawn(room, spawn, [MOVE], `${ROLE_SCORE_HUNTER}${Game.time}`, {
    memory: { role: ROLE_SCORE_HUNTER, homeRoom: room.name },
  });
  return res === OK;
}

function findUnassignedRemoteSource(
  room: Room
): { roomName: string; sourceId: Id<Source> } | null {
  // Any home's miner covers the source: two homes can share a neighbour.
  const covered = new Set(
    getCreepsByRole(ROLE_REMOTE_MINER)
      .filter((c) => {
        const home = (c.memory.homeRoom && Game.rooms[c.memory.homeRoom]) || room;
        return !isRemoteCreepRetiring(home, c);
      })
      .map((c) => c.memory.remoteSourceId)
  );
  for (const remote of getActiveRemoteRooms(room)) {
    for (const src of remote.sources) {
      if (!covered.has(src.sourceId)) {
        return { roomName: remote.roomName, sourceId: src.sourceId };
      }
    }
  }
  return null;
}

export function shouldSpawnRemoteMiner(room: Room): boolean {
  if ((room.controller?.level ?? 0) < 3) return false;
  const needed = findUnassignedRemoteSource(room) !== null;
  if (waitForFullBody(room, ROLE_REMOTE_MINER, needed)) return false;
  return needed;
}

export function spawnRemoteMiner(room: Room, spawn: StructureSpawn): boolean {
  const assignment = findUnassignedRemoteSource(room);
  if (!assignment) return false;

  const allowedEnergy = bodyBudget(room, "available");
  const body = buildRemoteMinerBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;

  const res = trackedSpawn(room, spawn, body, `${ROLE_REMOTE_MINER}${Game.time}`, {
    memory: {
      role: ROLE_REMOTE_MINER,
      homeRoom: room.name,
      targetRoom: assignment.roomName,
      remoteSourceId: assignment.sourceId,
    },
  });
  return res === OK;
}

function estimateRemoteDistance(homeRoom: Room, remoteRoomName: string): number {
  const rooms = Game.map.getRoomLinearDistance(homeRoom.name, remoteRoomName);
  return rooms * 50 + 25;
}

// A sanity bound per remote rather than a throughput limit: two sources two
// rooms out need about this many full-size haulers.
const MAX_REMOTE_HAULERS_PER_ROOM = 6;

// Haulers each active remote needs, sized per source from its path distance.
function getRemoteHaulerTargets(room: Room): Record<string, number> {
  // Ask the body builder how much CARRY a hauler actually gets rather than
  // re-deriving it here. The copy this replaces divided by 200 while the body
  // pattern costs 150, so every remote was credited a quarter less carry than it
  // has and over-hauled to match.
  const carryPerHauler = Math.max(
    1,
    buildRemoteHaulerBody(bodyBudget(room, "capacity"), remoteRoadsEnabled(room)).filter(
      (p) => p === CARRY
    ).length
  );
  const output = remoteSourceOutput(room);

  const targets: Record<string, number> = {};
  for (const remote of getActiveRemoteRooms(room)) {
    let requiredCarry = 0;
    for (const src of remote.sources) {
      requiredCarry += remoteHaulCarry(output, getRemoteSourceDistance(room, remote, src));
    }
    targets[remote.roomName] = Math.min(
      MAX_REMOTE_HAULERS_PER_ROOM,
      Math.max(1, Math.ceil(requiredCarry / carryPerHauler))
    );
  }
  return targets;
}

function getRemoteHaulerTarget(room: Room): number {
  return Object.values(getRemoteHaulerTargets(room)).reduce((a, b) => a + b, 0);
}

export function shouldSpawnRemoteHauler(room: Room): boolean {
  if ((room.controller?.level ?? 0) < 3) return false;
  const activeRooms = getActiveRemoteRooms(room);
  if (activeRooms.length === 0) return false;

  const haulers = getCreepsByRole(ROLE_REMOTE_HAULER).filter(
    (c) => c.memory.homeRoom === room.name && !isRemoteCreepRetiring(room, c)
  );

  const needed = haulers.length < getRemoteHaulerTarget(room);
  if (waitForFullBody(room, ROLE_REMOTE_HAULER, needed)) return false;
  return needed;
}

export function spawnRemoteHauler(room: Room, spawn: StructureSpawn): boolean {
  const activeRooms = getActiveRemoteRooms(room);
  if (activeRooms.length === 0) return false;

  const haulers = getCreepsByRole(ROLE_REMOTE_HAULER).filter(
    (c) => c.memory.homeRoom === room.name
  );
  const haulersByRoom: Record<string, number> = {};
  for (const h of haulers) {
    const r = h.memory.targetRoom ?? "";
    haulersByRoom[r] = (haulersByRoom[r] ?? 0) + 1;
  }

  // Send it where the shortfall against that room's target is biggest, so a
  // far remote is not held to the same count as a near one.
  const targets = getRemoteHaulerTargets(room);
  let targetRoomName = activeRooms[0].roomName;
  let maxShortfall = -Infinity;
  for (const remote of activeRooms) {
    const shortfall = (targets[remote.roomName] ?? 0) - (haulersByRoom[remote.roomName] ?? 0);
    if (shortfall > maxShortfall) {
      maxShortfall = shortfall;
      targetRoomName = remote.roomName;
    }
  }

  // Remotes have no roads until the home can lay them, so the body keeps one
  // MOVE per CARRY; once roads are going in it also carries a WORK to build
  // and repair them on the way home.
  const allowedEnergy = bodyBudget(room, "available");
  const body = buildRemoteHaulerBody(allowedEnergy, remoteRoadsEnabled(room));
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;

  const res = trackedSpawn(room, spawn, body, `${ROLE_REMOTE_HAULER}${Game.time}`, {
    memory: {
      role: ROLE_REMOTE_HAULER,
      homeRoom: room.name,
      targetRoom: targetRoomName,
    },
  });
  return res === OK;
}

function buildRemoteMinerBody(availableEnergy: number): BodyPartConstant[] {
  const maxWork = 5;
  const groupCost = 2 * BODYPART_COST[WORK] + BODYPART_COST[MOVE];
  const maxGroups = Math.max(1, Math.floor(availableEnergy / groupCost));
  const groups = Math.min(maxGroups, Math.ceil(maxWork / 2));
  const work = Math.min(maxWork, groups * 2);
  const move = groups;
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < work; i++) body.push(WORK);
  for (let i = 0; i < move; i++) body.push(MOVE);
  // One CARRY so the miner can build and repair its own container. Surplus
  // harvest still overflows into the container it stands on, so steady-state
  // mining is unchanged.
  const cost = work * BODYPART_COST[WORK] + move * BODYPART_COST[MOVE];
  if (availableEnergy >= cost + BODYPART_COST[CARRY]) body.push(CARRY);
  return body;
}

// `withWork` adds one WORK (and its MOVE) for building and repairing remote
// roads on the way; the CARRY pairs fill whatever is left.
export function buildRemoteHaulerBody(
  availableEnergy: number,
  withWork = false
): BodyPartConstant[] {
  const head: BodyPartConstant[] = withWork ? [WORK, MOVE] : [];
  const pattern: BodyPartConstant[] = [CARRY, MOVE];
  const patternCost = calculateBodyPartCost(pattern);
  const maxByParts = Math.floor((MAX_BODY_PART_COUNT - head.length) / pattern.length);
  const maxByEnergy = Math.floor(
    (availableEnergy - calculateBodyPartCost(head)) / patternCost
  );
  const repeats = Math.max(2, Math.min(maxByParts, maxByEnergy));
  const body: BodyPartConstant[] = [...head];
  for (let i = 0; i < repeats; i++) body.push(...pattern);
  return body;
}

function getReserversForRoom(homeRoom: Room): Creep[] {
  return getCreepsByRole(ROLE_RESERVER).filter(
    (c) => c.memory.homeRoom === homeRoom.name
  );
}

// Top up a reservation before it runs low rather than holding it at the cap:
// a reservation only builds while a reserver stands on the controller.
const RESERVATION_TOP_UP_TICKS = 1500;

const MAX_RESERVER_CLAIM = 3;

function needsReservation(room: Room, roomName: string): boolean {
  const ctrl = Game.rooms[roomName]?.controller;
  // No vision: we cannot see the reservation, so assume it needs one.
  if (!ctrl) return true;
  const res = ctrl.reservation;
  if (!res || res.username !== room.controller?.owner?.username) return true;
  return res.ticksToEnd < RESERVATION_TOP_UP_TICKS;
}

function findReserverTarget(room: Room): string | null {
  if ((room.controller?.level ?? 0) < 3) return null;
  // A reserver about to die no longer covers its room, so its replacement is
  // ordered while it still works, the same way remote miners are.
  const covered = new Set(
    getReserversForRoom(room)
      .filter((c) => !isRemoteCreepRetiring(room, c))
      .map((c) => c.memory.targetRoom)
  );
  for (const r of getActiveRemoteRooms(room, "reserve")) {
    if (!covered.has(r.roomName) && needsReservation(room, r.roomName)) return r.roomName;
  }
  return null;
}

export function shouldSpawnReserver(room: Room): boolean {
  return findReserverTarget(room) !== null;
}

// One CLAIM only holds a reservation steady; each extra CLAIM builds it by a
// tick per tick. MOVE matches CLAIM because remotes have no roads.
export function buildReserverBody(capacity: number): BodyPartConstant[] {
  const pairCost = BODYPART_COST[CLAIM] + BODYPART_COST[MOVE];
  const pairs = Math.max(1, Math.min(MAX_RESERVER_CLAIM, Math.floor(capacity / pairCost)));
  return [...Array(pairs).fill(CLAIM), ...Array(pairs).fill(MOVE)] as BodyPartConstant[];
}

export function spawnReserver(room: Room, spawn: StructureSpawn): boolean {
  const target = findReserverTarget(room);
  if (!target) return false;

  const body = buildReserverBody(room.energyCapacityAvailable);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;

  const res = trackedSpawn(room, spawn, body, `${ROLE_RESERVER}${Game.time}`, {
    memory: {
      role: ROLE_RESERVER,
      homeRoom: room.name,
      targetRoom: target,
    },
  });
  return res === OK;
}
