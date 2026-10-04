import {
  ROLE_SCOUT,
  ROLE_REMOTE_MINER,
  ROLE_REMOTE_HAULER,
  ROLE_RESERVER,
  ROLE_SCORE_HUNTER,
  ROLE_SETTLER,
  ROLE_CONQUEROR,
  ROLE_KNIGHT,
  ROLE_WIZARD,
  ROLE_CLERIC,
} from "../config/config.roles";
import { getThreatInfo } from "../services/services.combat";
import { inPixelRefill } from "./orchestrator.pixels";
import { MAX_BODY_PART_COUNT } from "../config/config.spawning";
import {
  getRemoteSourcePathLength,
  remotePaved,
  remoteRoadsEnabled,
} from "../services/services.remote";
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

// Share of the home's remote spawn time a source not yet worked must leave
// spare to be taken on. Embercrag's budget swung by 90 to 120 ticks as each
// enchanter, mason or barmaid died and was replaced. A tenth of what was spare,
// about 65 ticks there, let it take on a source in such a dip, send a peddler
// and lay road sites to it, and drop it again when the creep was replaced.
const REMOTE_PICK_HEADROOM = 0.2;

// A source picked within this many ticks holds its place without the
// headroom, so a worked source is not lost while its miner is being replaced.
const REMOTE_PICK_HOLD = 100;

// Below this bucket, keep working the remotes already mined but add none. A
// bucket refilling after a pixel is not short of CPU: under the floor there, a
// source whose miner had just died lost its place, and stood idle with its
// merchants until the bucket climbed back.
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
// for its round trip (with REMOTE_HAUL_MARGIN), its share of the room's reserver, and decay on its
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
  const carry = remoteHaulCarry(output, dist) * REMOTE_HAUL_MARGIN;
  const haulerCostPerCarry = calculateBodyPartCost(hauler) / haulerCarry;
  const haulerPartsPerCarry = hauler.length / haulerCarry;
  // A reserver serves every source in its room. It lives CREEP_CLAIM_LIFE_TIME,
  // but each CLAIM past the first banks a tick of reservation for every tick it
  // works, and the bank lasts as long again once it is gone. Embercrag's
  // three-CLAIM envoys were costed as bought every 600 ticks, when one is
  // needed only every 1,600 or so.
  const reserver = buildReserverBody(capacity);
  const reserverShare = 1 / remote.sources.length;
  const claims = reserver.filter((p) => p === CLAIM).length;
  const reserverRespawns =
    CREEP_LIFE_TIME / (claims * Math.max(1, CREEP_CLAIM_LIFE_TIME - dist));

  const roadTiles = src.roadTiles ? src.roadTiles.split(";").length : dist;
  const decay =
    (CONTAINER_DECAY / CONTAINER_DECAY_TIME) * REPAIR_COST +
    (roads ? (roadTiles * ROAD_DECAY_AMOUNT * REPAIR_COST) / ROAD_DECAY_TIME : 0);

  const upkeep =
    calculateBodyPartCost(miner) / CREEP_LIFE_TIME +
    (carry * haulerCostPerCarry) / CREEP_LIFE_TIME +
    (calculateBodyPartCost(reserver) * reserverShare * reserverRespawns) / CREEP_LIFE_TIME +
    decay;
  const parts =
    miner.length + carry * haulerPartsPerCarry + reserver.length * reserverShare * reserverRespawns;
  return { profit: output - upkeep, spawnTime: parts * CREEP_SPAWN_TIME };
}

// Creeps that are not kept up as a matter of course: defenders raised against a
// raid, and the dark lord and pilgrims sent to found a keep. The headroom left
// by REMOTE_SPAWN_SHARE is what pays for them. Counted as standing upkeep, they
// cut the budget below a single source while a keep was being raised: the home
// dropped every remote, and its peddlers mined on with no merchant to carry the
// gold home.
const PASSING_ROLES = new Set<string>([
  ROLE_SETTLER,
  ROLE_CONQUEROR,
  ROLE_KNIGHT,
  ROLE_WIZARD,
  ROLE_CLERIC,
]);

// Spawn time per creep lifetime the home has left for remotes, after what its
// own creeps (and anything else it keeps up) already take.
function remoteSpawnCapacity(room: Room): number {
  return room.find(FIND_MY_SPAWNS).length * CREEP_LIFE_TIME * REMOTE_SPAWN_SHARE;
}

function remoteSpawnBudget(room: Room): number {
  let used = 0;
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (REMOTE_ECONOMY_ROLES.has(c.memory.role) || PASSING_ROLES.has(c.memory.role)) continue;
    if ((c.memory.homeRoom ?? c.room.name) !== room.name) continue;
    used += c.body.length * CREEP_SPAWN_TIME;
  }
  return remoteSpawnCapacity(room) - used;
}

const remotePickCache: Record<
  string,
  {
    tick: number;
    remotes: RemoteRoomData[] | undefined;
    picked: Map<string, number>;
    // Tick each source was last picked.
    pickedAt: Record<string, number>;
  }
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

  const lowCpu = Game.cpu.bucket < REMOTE_CPU_BUCKET_FLOOR && !inPixelRefill();
  const peddlers = getCreepsByRole(ROLE_REMOTE_MINER);
  const mined = new Set(
    peddlers.filter((c) => c.memory.homeRoom === room.name).map((c) => c.memory.remoteSourceId)
  );
  // A remote next to two castles is in both their lists. A source the other
  // castle's peddler already works is left to it: only the peddler was kept
  // from being sent twice, so both castles would have raised merchants and an
  // envoy for the one source and split its gold between them.
  const minedElsewhere = new Set(
    peddlers.filter((c) => c.memory.homeRoom !== room.name).map((c) => c.memory.remoteSourceId)
  );
  const plans: Array<{ sourceId: string; profit: number; spawnTime: number }> = [];
  for (const r of room.memory.remoteRooms ?? []) {
    if (!isRemoteEligible(room, r, "reserve", true)) continue;
    for (const s of r.sources) {
      if (minedElsewhere.has(s.sourceId)) continue;
      if (lowCpu && !mined.has(s.sourceId)) continue;
      const plan = planRemoteSource(room, r, s);
      if (plan.profit > 0) plans.push({ sourceId: s.sourceId, ...plan });
    }
  }
  plans.sort((a, b) => b.profit - a.profit);

  // The budget counts live creeps, so it breathes as home creeps die and are
  // replaced. A source picked in the last REMOTE_PICK_HOLD ticks stays while it
  // fits; any other has to fit with REMOTE_PICK_HEADROOM to spare, so that
  // breathing does not keep adding and dropping the marginal one. Only the tick
  // before used to count, and fifty ticks of rivals in the Witch Weald lost it
  // to Embercrag, whose spare spawn time fell short of the headroom. A peddler
  // left on a source that was dropped does not hold it. Only after a global
  // reset, with no recent picks, do the miners stand in for them.
  const fresh = cached !== undefined && Game.time - cached.tick <= REMOTE_PICK_HOLD;
  const pickedAt = fresh ? cached.pickedAt : {};
  const headroom = remoteSpawnCapacity(room) * REMOTE_PICK_HEADROOM;
  let budget = remoteSpawnBudget(room);
  const picked = new Map<string, number>();
  for (const p of plans) {
    if (picked.size >= MAX_REMOTE_SOURCES) break;
    const held = fresh
      ? Game.time - (pickedAt[p.sourceId] ?? -Infinity) <= REMOTE_PICK_HOLD
      : mined.has(p.sourceId as Id<Source>);
    const reserve = held ? 0 : headroom;
    if (p.spawnTime > budget - reserve) continue;
    budget -= p.spawnTime;
    picked.set(p.sourceId, picked.size);
    pickedAt[p.sourceId] = Game.time;
  }
  remotePickCache[room.name] = { tick: Game.time, remotes: room.memory.remoteRooms, picked, pickedAt };
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

  const res = trackedSpawn(room, spawn, [MOVE], {
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
  const res = trackedSpawn(room, spawn, [MOVE], {
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

  const res = trackedSpawn(room, spawn, body, {
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
// rooms out need about this many full-size haulers. It bounds their CARRY, not
// their heads. Grimford's 800-gold merchants hold a third of a full-size one,
// and six of them carried home about half of what its peddlers dug two rooms
// out, while the rest overflowed the containers and rotted.
const MAX_REMOTE_HAULERS_PER_ROOM = 6;

// Remote haulers carry this much more than their sources' output strictly
// needs, for loading, road repairs and the walk across the home room.
const REMOTE_HAUL_MARGIN = 1.2;

// No remote hauler is planned smaller than this many CARRY parts.
const MIN_REMOTE_HAULER_CARRY = 4;

interface RemoteHaulPlan {
  count: number;
  // CARRY parts in each hauler's body.
  carryEach: number;
  paved: boolean;
}

// Haulers each active remote needs and how big, from its sources' path
// distances. The count is what full-size haulers would take to carry the
// output with REMOTE_HAUL_MARGIN on top, and that CARRY is split evenly
// between them. Every hauler used to be full size, so a remote needing 24
// CARRY got two 19-CARRY haulers. Counting them before the margin lost it
// whenever the haulers were already as big as the home could build: Grimford
// sent eleven 7-CARRY merchants to a remote needing 76 CARRY, and its
// containers overflowed while they walked.
function getRemoteHaulPlans(room: Room): Record<string, RemoteHaulPlan> {
  // Ask the body builder how much CARRY a hauler actually gets rather than
  // re-deriving it here. The copy this replaces divided by 200 while the body
  // pattern costs 150, so every remote was credited a quarter less carry than it
  // has and over-hauled to match.
  const roads = remoteRoadsEnabled(room);
  const budget = bodyBudget(room, "capacity");
  const carryOf = (paved: boolean) =>
    Math.max(1, buildRemoteHaulerBody(budget, roads, paved).filter((p) => p === CARRY).length);
  const carryOnFoot = carryOf(false);
  const carryPaved = carryOf(true);
  const fullSizeCarry = (paved: boolean) =>
    buildRemoteHaulerBody(Infinity, roads, paved).filter((p) => p === CARRY).length;
  const output = remoteSourceOutput(room);

  const plans: Record<string, RemoteHaulPlan> = {};
  for (const remote of getActiveRemoteRooms(room)) {
    const paved = roads && remotePaved(remote);
    const carryPerHauler = paved ? carryPaved : carryOnFoot;
    let requiredCarry = 0;
    for (const src of remote.sources) {
      requiredCarry += remoteHaulCarry(output, getRemoteSourceDistance(room, remote, src));
    }
    const carry = requiredCarry * REMOTE_HAUL_MARGIN;
    const count = Math.min(
      Math.ceil((MAX_REMOTE_HAULERS_PER_ROOM * fullSizeCarry(paved)) / carryPerHauler),
      Math.max(1, Math.ceil(carry / carryPerHauler))
    );
    const carryEach = Math.min(
      carryPerHauler,
      Math.max(MIN_REMOTE_HAULER_CARRY, Math.ceil(carry / count))
    );
    plans[remote.roomName] = { count, carryEach, paved };
  }
  return plans;
}

function getRemoteHaulerTarget(room: Room): number {
  return Object.values(getRemoteHaulPlans(room)).reduce((a, p) => a + p.count, 0);
}

// The active remote furthest short of its planned haulers.
function neediestRemote(
  activeRooms: RemoteRoomData[],
  plans: Record<string, RemoteHaulPlan>,
  haulersByRoom: Record<string, number>
): string {
  let neediest = activeRooms[0].roomName;
  let maxShortfall = -Infinity;
  for (const remote of activeRooms) {
    const shortfall = (plans[remote.roomName]?.count ?? 0) - (haulersByRoom[remote.roomName] ?? 0);
    if (shortfall > maxShortfall) {
      maxShortfall = shortfall;
      neediest = remote.roomName;
    }
  }
  return neediest;
}

// A merchant whose remote is no longer worked (claimed as a keep, taken by
// another player, or dropped from the picks) went on hauling from it, and still
// counted against the remotes that are: when a remote became a keep, its two
// merchants kept the home's other remote from getting any. It is sent to the
// neediest remote instead. One that is only fleeing invaders keeps its post.
//
// A remote holding more merchants than it plans for also gives the spare ones
// to a remote short of its plan. Once rivals left the Witch Weald, Embercrag's
// three merchants all served its other remote: the home's count still met its
// total, so none was raised for the Weald, and its peddler's gold lay rotting
// on the ground.
export function reassignStrayHaulers(room: Room): void {
  const haulers = getCreepsByRole(ROLE_REMOTE_HAULER).filter((c) => c.memory.homeRoom === room.name);
  if (haulers.length === 0) return;
  const worked = getPickedRemoteRoomNames(room);
  const strays = haulers.filter((c) => !worked.has(c.memory.targetRoom ?? ""));
  const activeRooms = getActiveRemoteRooms(room);
  if (activeRooms.length === 0) return;

  // Merchants near the end of their lives are left out of the counts, as when
  // raising one, so a merchant raised to relieve one is not taken for a spare.
  const serving = haulers.filter((c) => !strays.includes(c) && !isRemoteCreepRetiring(room, c));
  const haulersByRoom: Record<string, number> = {};
  for (const h of serving) {
    const r = h.memory.targetRoom!;
    haulersByRoom[r] = (haulersByRoom[r] ?? 0) + 1;
  }
  const plans = getRemoteHaulPlans(room);
  for (const c of strays) {
    const target = neediestRemote(activeRooms, plans, haulersByRoom);
    c.memory.targetRoom = target;
    haulersByRoom[target] = (haulersByRoom[target] ?? 0) + 1;
  }

  for (const remote of activeRooms) {
    const posted = serving.filter((c) => c.memory.targetRoom === remote.roomName);
    const spare = posted.length - (plans[remote.roomName]?.count ?? 0);
    for (const c of posted.slice(0, Math.max(0, spare))) {
      const target = neediestRemote(activeRooms, plans, haulersByRoom);
      if ((plans[target]?.count ?? 0) - (haulersByRoom[target] ?? 0) <= 0) return;
      c.memory.targetRoom = target;
      haulersByRoom[remote.roomName]--;
      haulersByRoom[target] = (haulersByRoom[target] ?? 0) + 1;
    }
  }
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

  // A merchant near the end of its life is not counted, as in
  // shouldSpawnRemoteHauler, so the one raised to relieve it goes to its
  // remote. Counted, it left that remote looking fully manned: Embercrag sent
  // a retiring merchant's relief, built for a paved road, to its other remote,
  // where it was one too many.
  const haulers = getCreepsByRole(ROLE_REMOTE_HAULER).filter(
    (c) => c.memory.homeRoom === room.name && !isRemoteCreepRetiring(room, c)
  );
  const haulersByRoom: Record<string, number> = {};
  for (const h of haulers) {
    const r = h.memory.targetRoom ?? "";
    haulersByRoom[r] = (haulersByRoom[r] ?? 0) + 1;
  }

  // Send it where the shortfall against that room's target is biggest, so a
  // far remote is not held to the same count as a near one.
  const plans = getRemoteHaulPlans(room);
  const targetRoomName = neediestRemote(activeRooms, plans, haulersByRoom);

  // Remotes have no roads until the home can lay them, so the body keeps one
  // MOVE per CARRY; once roads are going in it also carries a WORK to build
  // and repair them on the way home. Once the road is all but finished it
  // needs only one MOVE per two CARRY.
  const roads = remoteRoadsEnabled(room);
  const plan = plans[targetRoomName];
  const paved = plan?.paved ?? false;
  const planEnergy =
    plan === undefined
      ? Infinity
      : (roads ? BODYPART_COST[WORK] + BODYPART_COST[MOVE] : 0) +
        (paved
          ? Math.ceil(plan.carryEach / 2) * (2 * BODYPART_COST[CARRY] + BODYPART_COST[MOVE])
          : plan.carryEach * (BODYPART_COST[CARRY] + BODYPART_COST[MOVE]));
  const allowedEnergy = Math.min(planEnergy, bodyBudget(room, "available"));
  const body = buildRemoteHaulerBody(allowedEnergy, roads, paved);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;

  const res = trackedSpawn(room, spawn, body, {
    memory: {
      role: ROLE_REMOTE_HAULER,
      homeRoom: room.name,
      targetRoom: targetRoomName,
    },
  });
  return res === OK;
}

// Six WORK, one more than a reserved source's refill needs. A container
// outside a keep loses 5000 hits every 100 ticks, and the miner mends it
// itself: with five WORK that was ten ticks in every hundred not digging, and
// a tenth of every remote source was left in the ground when it refilled.
export function buildRemoteMinerBody(availableEnergy: number): BodyPartConstant[] {
  const maxWork = 6;
  const groupCost = 2 * BODYPART_COST[WORK] + BODYPART_COST[MOVE];
  const maxGroups = Math.max(1, Math.floor(availableEnergy / groupCost));
  const groups = Math.min(maxGroups, Math.ceil(maxWork / 2));
  let work = Math.min(maxWork, groups * 2);
  let move = groups;
  const cost = () => work * BODYPART_COST[WORK] + move * BODYPART_COST[MOVE];
  // One CARRY so the miner can build and repair its own container. Surplus
  // harvest still overflows into the container it stands on, so steady-state
  // mining is unchanged. The sixth WORK is the spare, and gives way to the
  // CARRY when the energy runs short of both.
  if (work === maxWork && availableEnergy < cost() + BODYPART_COST[CARRY]) work--;
  // Gold short of another pair still buys a fifth WORK, with a MOVE to keep
  // its pace when there is enough. A young keep spawning on 720 sent miners
  // with four, which dig a reserved source only eight tenths dry.
  const spare = availableEnergy - cost() - BODYPART_COST[CARRY];
  if (work < maxWork && spare >= BODYPART_COST[WORK]) {
    work++;
    if (spare >= BODYPART_COST[WORK] + BODYPART_COST[MOVE]) move++;
  }
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < work; i++) body.push(WORK);
  for (let i = 0; i < move; i++) body.push(MOVE);
  if (availableEnergy >= cost() + BODYPART_COST[CARRY]) body.push(CARRY);
  return body;
}

// `withWork` adds one WORK (and its MOVE) for building and repairing remote
// roads on the way; the CARRY pairs fill whatever is left. On a `paved` road one
// MOVE keeps two loaded CARRY going a tile a tick, so the pattern takes half
// the MOVE and the same gold buys a third more CARRY. Off the road such a
// hauler walks at half speed when loaded.
export function buildRemoteHaulerBody(
  availableEnergy: number,
  withWork = false,
  paved = false
): BodyPartConstant[] {
  const head: BodyPartConstant[] = withWork ? [WORK, MOVE] : [];
  const pattern: BodyPartConstant[] = paved ? [CARRY, CARRY, MOVE] : [CARRY, MOVE];
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

  const res = trackedSpawn(room, spawn, body, {
    memory: {
      role: ROLE_RESERVER,
      homeRoom: room.name,
      targetRoom: target,
    },
  });
  return res === OK;
}
