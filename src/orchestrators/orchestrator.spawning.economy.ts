import {
  ROLE_BUILDER,
  ROLE_HARVESTER,
  ROLE_UPGRADER,
  ROLE_REPAIRER,
  ROLE_MINER,
  ROLE_HAULER,
  ROLE_FILLER,
  ROLE_MINERAL_MINER,
  ROLE_APOTHECARY,
} from "../config/config.roles";
import { barrierTargetFn, isEnergyEmergency, keptUp } from "../services/services.creep";
import { BODY_PATTERNS, MAX_BODY_PART_COUNT } from "../config/config.spawning";
import { getRoomMemory } from "../services/services.memory";
import { getSources } from "../services/services.creep";
import { upgraderStorageFloor } from "../services/services.treasury";
import {
  buildScaledBody,
  calculateBodyPartCost,
  getCreepsByRole,
  getCreepsByRoleInRoom,
  getRoomSpawningCount,
  trackedSpawn,
  countByRoleInRoom,
  holdSpawnFor,
  bodyBudget,
  spawnLeadTicks,
  isRetiring,
  waitForFullBody,
  getRoomPhase,
  buildBoostQueue,
  boostMemory,
} from "./orchestrator.spawning.shared";

// Spawn -> miner container path length, reusing the distance cache the hauler
// sizing already maintains. The furthest post sets the lead so that no post is
// left empty while its replacement walks. 999 is the cache's "unreachable"
// marker, which would otherwise read as an enormous lead.
const UNREACHABLE_DISTANCE = 999;

function getMinerTravelTicks(room: Room): number {
  const spawn = getSpawnForRoom(room);
  if (!spawn) return 0;
  const containers = (room.memory.minerContainerIds ?? [])
    .map((id) => Game.getObjectById(id))
    .filter(Boolean) as StructureContainer[];
  if (containers.length === 0) return 0;
  const distances = getContainerDistances(room, spawn, containers);
  let furthest = 0;
  for (const c of containers) {
    const d = distances[c.id] ?? 0;
    if (d < UNREACHABLE_DISTANCE) furthest = Math.max(furthest, d);
  }
  return furthest;
}

// A miner tops out at five WORK (600 energy), so the margin bodyBudget keeps on
// a capacity target never shortened its wait - it only cost it a WORK part:
// RCL 2's 550 capacity got a three-WORK miner instead of four, and a spawn-only
// 300 got one WORK instead of two, for the miner's whole life. Size it from
// capacity itself.
function minerBudget(room: Room): number {
  return room.energyCapacityAvailable;
}

function getMinerReplacementLead(room: Room): number {
  const allowed = minerBudget(room);
  return spawnLeadTicks(buildMinerBody(allowed).length, getMinerTravelTicks(room));
}

export function hasEnergyGatherers(room: Room): boolean {
  const harvesters = getCreepsByRoleInRoom(ROLE_HARVESTER, room);
  const miners = getCreepsByRoleInRoom(ROLE_MINER, room);
  return harvesters.length + miners.length > 0;
}

export function countHomeHaulers(room: Room): number {
  const live = getCreepsByRole(ROLE_HAULER).filter(
    (c) => !c.spawning && (c.memory.homeRoom ?? c.room.name) === room.name
  ).length;
  return live + getRoomSpawningCount(room, ROLE_HAULER);
}

// Something has to carry energy into spawn and extensions for a held spawn to
// ever see the energy it is holding for.
function hasCoreRefiller(room: Room): boolean {
  return (
    countHomeHaulers(room) > 0 ||
    countByRoleInRoom(ROLE_FILLER, room) > 0 ||
    countByRoleInRoom(ROLE_HARVESTER, room) > 0
  );
}

// A source refills 10 energy a tick, which takes five WORK parts to keep up
// with. A flat two harvesters per room - one WORK each at RCL 1 - worked the
// sources at a fifth of that, and until miners and haulers exist they are all
// that fills the spawn. Crew each source no miner has taken yet up to five
// WORK, but with no more harvesters than the tiles around it can hold.
const SOURCE_WORK_TO_DRAIN = 5;

function countOpenTilesAround(room: Room, pos: RoomPosition): number {
  const terrain = room.getTerrain();
  let open = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const x = pos.x + dx;
      const y = pos.y + dy;
      if (x < 0 || x > 49 || y < 0 || y > 49) continue;
      if (terrain.get(x, y) !== TERRAIN_MASK_WALL) open++;
    }
  }
  return open;
}

function getHarvesterCrewTarget(room: Room, minerCount: number): number {
  const sources = getSources(room);
  const uncovered = Math.max(0, sources.length - minerCount);
  if (uncovered === 0) return 0;
  const taken = new Set(
    getCreepsByRoleInRoom(ROLE_MINER, room).map((c) => c.memory.assignedSourceId)
  );
  const work = buildScaledBody(ROLE_HARVESTER, room.energyCapacityAvailable).filter(
    (p) => p === WORK
  ).length;
  const perSource = Math.ceil(SOURCE_WORK_TO_DRAIN / Math.max(1, work));
  return sources
    .filter((s) => !taken.has(s.id))
    .slice(0, uncovered)
    .reduce((sum, s) => sum + Math.min(perSource, countOpenTilesAround(room, s.pos)), 0);
}

function getHarvesterPopulationTarget(room: Room): number {
  const minerCount = getCreepsByRoleInRoom(ROLE_MINER, room).length;
  const phase = getRoomPhase(room);
  if (phase === "bootstrap") return getHarvesterCrewTarget(room, minerCount);
  if (isEnergyEmergency(room)) return minerCount > 0 ? Math.min(1, 2 - minerCount) : 2;
  if (room.storage && room.storage.store[RESOURCE_ENERGY] > 10000) return 0;
  return getHarvesterCrewTarget(room, minerCount);
}

export const CONTROLLER_DOWNGRADE_SAFETY = 5000;

// Before storage the containers are the room's only bank. Energy piling up in
// them is income nothing is spending, and one or two upgraders - two WORK each
// at RCL 2 - spend a fraction of what two sources yield. Add an upgrader for
// every NO_STORAGE_ENERGY_PER_UPGRADER banked; they draw from those same
// containers, so the count backs off as the bank drains.
const NO_STORAGE_ENERGY_PER_UPGRADER = 1000;

const NO_STORAGE_MAX_UPGRADERS = 5;

const STORAGE_ENERGY_PER_UPGRADER = 20_000;

function getContainerEnergy(room: Room): number {
  let total = 0;
  for (const id of room.memory.containerIds ?? []) {
    const container = Game.getObjectById(id);
    if (container) total += container.store[RESOURCE_ENERGY];
  }
  return total;
}

export function getUpgraderPopulationTarget(room: Room): number {
  const controller = room.controller;
  if (controller?.my && controller.ticksToDowngrade < CONTROLLER_DOWNGRADE_SAFETY) return 1;

  if (isEnergyEmergency(room)) return 0;

  const phase = getRoomPhase(room);
  const rcl = room.controller?.level ?? 0;

  // An RCL 8 controller takes at most CONTROLLER_MAX_UPGRADE_PER_TICK (15)
  // energy a tick, which one 15-WORK upgrader already spends.
  if (rcl >= 8) return 1;

  const storage = room.storage;
  if (!storage) {
    const base = phase === "bootstrap" ? 1 : 2;
    const extra = Math.floor(getContainerEnergy(room) / NO_STORAGE_ENERGY_PER_UPGRADER);
    return Math.min(NO_STORAGE_MAX_UPGRADERS, base + extra);
  }

  // Upgraders stop drawing at the storage floor, so count only what sits
  // above it. Stepping from zero in 50k units kept a fresh RCL 4-5 storage on a
  // single upgrader while it filled. At or below the floor an upgrader would
  // only stand idle, so none is kept; a downgrade is covered above.
  const cap = phase === "powerhouse" ? 4 : 3;
  const spare = storage.store[RESOURCE_ENERGY] - upgraderStorageFloor(room);
  if (spare <= 0) return 0;
  return Math.min(cap, 1 + Math.floor(spare / STORAGE_ENERGY_PER_UPGRADER));
}

let constructionSiteCacheTick = -1;

const constructionSiteCountByRoom: Record<string, number> = {};

function getConstructionSiteCount(room: Room): number {
  if (constructionSiteCacheTick !== Game.time) {
    constructionSiteCacheTick = Game.time;
    for (const k of Object.keys(constructionSiteCountByRoom)) delete constructionSiteCountByRoom[k];
  }
  if (constructionSiteCountByRoom[room.name] === undefined) {
    constructionSiteCountByRoom[room.name] = room.find(FIND_CONSTRUCTION_SITES).length;
  }
  return constructionSiteCountByRoom[room.name];
}

function getBuilderPopulationTarget(room: Room): number {
  if (isEnergyEmergency(room)) return 0;
  const siteCount = getConstructionSiteCount(room);
  if (siteCount === 0) return 0;
  const phase = getRoomPhase(room);
  if (phase === "bootstrap") return Math.min(3, siteCount);
  const target = Math.ceil(siteCount / 5);
  const buffer = room.storage?.store[RESOURCE_ENERGY] ?? 0;
  const cap = buffer > 30_000 ? 5 : 2;
  return Math.min(cap, Math.max(1, target));
}

function getSpawnForRoom(room: Room): StructureSpawn | null {
  const roomMemory = getRoomMemory(room);
  if (!roomMemory.spawnId) return null;
  return Game.getObjectById(roomMemory.spawnId) as StructureSpawn | null;
}

const HAULER_SPAWN = {
  MAX_HAULERS: 6,
  DISTANCE_CACHE_TTL: 500,
  SOURCE_OUTPUT: 10,
  CARRY_CAPACITY: CARRY_CAPACITY,
} as const;

const containerDistanceCache: Record<
  string,
  { distances: Record<string, number>; cachedAt: number }
> = {};

function getContainerDistances(
  room: Room,
  spawn: StructureSpawn,
  containers: StructureContainer[]
): Record<string, number> {
  // Keyed on the container set as well as the room: callers pass different
  // sets, and a container built or lost has to be measured straight away.
  const key = `${room.name}:${containers.map((c) => c.id).sort().join(",")}`;
  const cache = containerDistanceCache[key];
  if (cache && Game.time - cache.cachedAt < HAULER_SPAWN.DISTANCE_CACHE_TTL) {
    return cache.distances;
  }
  const distances: Record<string, number> = {};
  for (const c of containers) {
    const result = PathFinder.search(spawn.pos, { pos: c.pos, range: 1 }, {
      plainCost: 2,
      swampCost: 10,
      maxOps: 2000,
    });
    distances[c.id] = result.incomplete ? 999 : result.path.length;
  }
  // Container sets change over a room's life; drop stale keys so the cache stays bounded.
  for (const k in containerDistanceCache) {
    if (Game.time - containerDistanceCache[k].cachedAt >= HAULER_SPAWN.DISTANCE_CACHE_TTL) {
      delete containerDistanceCache[k];
    }
  }
  containerDistanceCache[key] = { distances, cachedAt: Game.time };
  return distances;
}

// Haulers carry this much more than the sources' output strictly needs, for
// the time they spend waiting at containers and on errands of their own.
const HAULER_CARRY_MARGIN = 1.5;
// No hauler is planned smaller than this many CARRY parts.
const MIN_HAULER_CARRY = 4;

interface HaulerPlan {
  count: number;
  // CARRY parts in each hauler's body.
  carryEach: number;
}

// How many haulers the room needs and how big. Each was built as large as the
// room could afford, and at least one per miner container: at RCL 6 two
// 26-CARRY porters carried 52 parts' worth for sources that needed 15, at
// nearly a tenth of the spawn's time. They are now sized to what the sources
// yield over the walk, split evenly between them.
//
// A source yields only what its miners dig. A young keep's two-WORK miners dig
// 4 gold a tick of the source's 10, and planning for 10 asked a 350-capacity
// keep for a fourth porter while its two containers held 100 gold between them.
function getHaulerPlan(room: Room): HaulerPlan | null {
  const containerIds = room.memory.containerIds ?? [];
  if (containerIds.length === 0) return null;
  const containers = containerIds
    .map((id) => Game.getObjectById(id))
    .filter(Boolean) as StructureContainer[];
  if (containers.length === 0) return null;

  const minerContainerIds = new Set(room.memory.minerContainerIds ?? []);
  const minerContainers = containers.filter((c) =>
    minerContainerIds.has(c.id as Id<StructureContainer>)
  );

  const spawn = getSpawnForRoom(room);
  let requiredCarry = 0;
  if (spawn) {
    const distances = getContainerDistances(room, spawn, minerContainers);
    const dug = minerWorkByContainer(room);
    // A post with no miner yet, or a runt, is planned for the miner the room
    // would raise for it now.
    const workTarget = getMinerWorkTarget(room);
    for (const c of minerContainers) {
      const dist = distances[c.id] ?? 0;
      const roundTrip = dist * 2;
      const output = Math.min(HAULER_SPAWN.SOURCE_OUTPUT, HARVEST_POWER * Math.max(workTarget, dug[c.id] ?? 0));
      requiredCarry += (output * roundTrip) / HAULER_SPAWN.CARRY_CAPACITY;
    }
  }
  const neededCarry = Math.ceil(requiredCarry * HAULER_CARRY_MARGIN);

  const idealRepeats = Math.min(
    Math.floor(MAX_BODY_PART_COUNT / 3),
    Math.floor(bodyBudget(room, "capacity") / 150)
  );
  const carryPerIdealHauler = Math.max(1, idealRepeats * 2);

  const count = Math.min(
    HAULER_SPAWN.MAX_HAULERS,
    Math.max(minerContainers.length, Math.ceil(neededCarry / carryPerIdealHauler))
  );
  const share = count > 0 ? 2 * Math.ceil(neededCarry / count / 2) : 0;
  const carryEach = Math.min(carryPerIdealHauler, Math.max(MIN_HAULER_CARRY, share));
  return { count, carryEach };
}

function minerWorkByContainer(room: Room): Record<string, number> {
  const work: Record<string, number> = {};
  for (const m of getCreepsByRoleInRoom(ROLE_MINER, room)) {
    const id = m.memory.assignedContainerId;
    if (id) work[id] = (work[id] ?? 0) + m.body.filter((p) => p.type === WORK).length;
  }
  return work;
}

export function shouldSpawnHauler(room: Room): boolean {
  const plan = getHaulerPlan(room);
  if (!plan) return false;

  const haulers = getCreepsByRole(ROLE_HAULER).filter(
    (c) => !c.spawning && (c.memory.homeRoom ?? c.room.name) === room.name
  );

  // The body's CARRY:CARRY:MOVE repeats, three parts each.
  const lead = spawnLeadTicks((plan.carryEach / 2) * 3, getMinerTravelTicks(room));
  const haulerCount =
    haulers.filter((h) => !isRetiring(h, lead)).length +
    getRoomSpawningCount(room, ROLE_HAULER);
  if (haulerCount < plan.count) return true;

  // Haulers born small in an energy crunch: add one while they carry less
  // than half the plan between them.
  if (haulers.length >= HAULER_SPAWN.MAX_HAULERS) return false;
  const totalCurrentCarry = haulers.reduce(
    (sum, h) => sum + h.body.filter((p) => p.type === CARRY).length,
    0
  );
  return totalCurrentCarry < plan.count * plan.carryEach * 0.5;
}

export function spawnHauler(room: Room, spawn: StructureSpawn): boolean {
  const existingHaulers = getCreepsByRole(ROLE_HAULER).filter(
    (c) => (c.memory.homeRoom ?? c.room.name) === room.name
  );

  const plan = getHaulerPlan(room);
  const planEnergy = plan ? (plan.carryEach / 2) * calculateBodyPartCost(BODY_PATTERNS[ROLE_HAULER]) : Infinity;
  const allowedEnergy = Math.min(
    planEnergy,
    bodyBudget(room, existingHaulers.length === 0 ? "available" : "capacity")
  );
  const body = buildScaledBody(ROLE_HAULER, allowedEnergy);
  const bodyCost = calculateBodyPartCost(body);

  if (room.energyAvailable < bodyCost) {
    // Only the first hauler may downgrade to whatever is in the bank right now.
    // Past that, wait for a full-size body: a runt hauler costs the energy the
    // miner is saving up for, and the miner never gets to spawn. Give up on the
    // wait once it has starved the rest of the room for SPAWN_HOLD_LIMIT ticks.
    if (existingHaulers.length > 0 && holdSpawnFor(room, ROLE_HAULER)) return true;
    const affordableEnergy = Math.min(planEnergy, bodyBudget(room, "available"));
    const affordableBody = buildScaledBody(ROLE_HAULER, affordableEnergy);
    if (room.energyAvailable < calculateBodyPartCost(affordableBody)) {
      // Below the cost of the smallest hauler there is nothing to save up for,
      // so let the chain move on rather than holding the spawn again.
      return false;
    }
    return trackedSpawn(room, spawn, affordableBody, {
      memory: { role: ROLE_HAULER, homeRoom: room.name },
    }) === OK;
  }

  return trackedSpawn(room, spawn, body, {
    memory: { role: ROLE_HAULER, homeRoom: room.name },
  }) === OK;
}

function getMinerWorkTarget(room: Room): number {
  const allowed = minerBudget(room);
  return buildMinerBody(allowed).filter((p) => p === WORK).length;
}

export function shouldSpawnMiner(room: Room): boolean {
  // A post is manned once the miners at it dig as much as the miner the room
  // would raise for it now. A miner born during an energy crunch is undersized
  // for its whole life and caps income at a fraction of the source, so its post
  // needs another once we can afford better. Judging each miner on its own
  // replaced a young keep's two-WORK pair at a post as well, every time an
  // extension went up, though together they already outdug the replacement.
  const workTarget = getMinerWorkTarget(room);
  const lead = getMinerReplacementLead(room);
  const workAt: Record<string, number> = {};
  let unposted = 0;
  for (const c of getCreepsByRoleInRoom(ROLE_MINER, room)) {
    if (c.spawning || isRetiring(c, lead)) continue;
    const work = c.body.filter((p) => p.type === WORK).length;
    const post = c.memory.assignedContainerId;
    if (post) workAt[post] = (workAt[post] ?? 0) + work;
    else if (work >= workTarget) unposted++;
  }
  const posts = room.memory.minerContainerIds ?? [];
  const manned = posts.filter((id) => (workAt[id] ?? 0) >= workTarget).length;
  return manned + unposted + getRoomSpawningCount(room, ROLE_MINER) < posts.length;
}

// The first harvester goes out on whatever the core holds. The rest wait for a
// full body like the other roles do: spawned the moment 200 energy came in,
// every harvester was a one-WORK runt however many extensions the room had.
export function shouldSpawnHarvester(room: Room): boolean {
  const count = countByRoleInRoom(ROLE_HARVESTER, room);
  const needed = count < getHarvesterPopulationTarget(room);
  if (waitForFullBody(room, ROLE_HARVESTER, needed && count > 0)) return false;
  return needed;
}

export function shouldSpawnUpgrader(room: Room): boolean {
  const needed = countByRoleInRoom(ROLE_UPGRADER, room) < getUpgraderPopulationTarget(room);
  if (waitForFullBody(room, ROLE_UPGRADER, needed)) return false;
  return needed;
}

export function shouldSpawnBuilder(room: Room): boolean {
  const needed = countByRoleInRoom(ROLE_BUILDER, room) < getBuilderPopulationTarget(room);
  if (waitForFullBody(room, ROLE_BUILDER, needed)) return false;
  return needed;
}

const repairerTargetCache: Record<string, { value: number; tick: number }> = {};

export function getRepairerPopulationTarget(room: Room): number {
  if (isEnergyEmergency(room)) return 0;
  const cached = repairerTargetCache[room.name];
  if (cached && Game.time - cached.tick < 50) return cached.value;

  // 0.8 matches where the repair target picker starts caring about a structure.
  // Roads left off the blueprint decay on purpose and nobody repairs them, so
  // they must not call for repairers either.
  const kept = keptUp(room);
  const worn = room.find(FIND_STRUCTURES, {
    filter: (s) => {
      if (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) return false;
      const st = s as AnyStructure;
      return "hits" in st && "hitsMax" in st && st.hits < st.hitsMax * 0.8 && kept(st);
    },
  }) as AnyStructure[];
  const critical = worn.filter((s) => s.hits < s.hitsMax * 0.5);
  let value = Math.min(2, Math.ceil(critical.length / 5));

  const rcl = room.controller?.level ?? 0;
  if (rcl >= 2) {
    const hasEnergyBuffer =
      !room.storage || room.storage.store[RESOURCE_ENERGY] > 20_000;
    if (hasEnergyBuffer) {
      if (rcl >= 3 && worn.length > 0) value = Math.max(value, 1);
      const barrierTarget = barrierTargetFn(room);
      const wallsNeedRepair = room.find(FIND_STRUCTURES, {
        filter: (s): s is AnyStructure =>
          (s.structureType === STRUCTURE_RAMPART || s.structureType === STRUCTURE_WALL) &&
          (s as AnyStructure).hits < barrierTarget(s as AnyStructure),
      }).length > 0;
      if (wallsNeedRepair) value = Math.min(2, value + 1);
    }
  }

  const nukeDef = room.memory.nukeDefense;
  if (nukeDef && Object.keys(nukeDef.tiles).length > 0) {
    value = Math.max(value, 3);
  }

  repairerTargetCache[room.name] = { value, tick: Game.time };
  return value;
}

export function shouldSpawnRepairer(room: Room): boolean {
  const target = getRepairerPopulationTarget(room);
  const needed = target > 0 && countByRoleInRoom(ROLE_REPAIRER, room) < target;
  if (waitForFullBody(room, ROLE_REPAIRER, needed)) return false;
  return needed;
}

function getFillerPopulationTarget(room: Room): number {
  if (!room.storage) return 0;
  return (room.controller?.level ?? 0) >= 7 ? 2 : 1;
}

// Fillers work beside the spawn, so the lead is just the time to build one.
export function shouldSpawnFiller(room: Room): boolean {
  const fillers = getCreepsByRoleInRoom(ROLE_FILLER, room).filter(
    (c) => !c.spawning && !isRetiring(c, spawnLeadTicks(c.body.length, 0))
  ).length;
  return fillers + getRoomSpawningCount(room, ROLE_FILLER) < getFillerPopulationTarget(room);
}

export function spawnFiller(room: Room, spawn: StructureSpawn): boolean {
  const allowedEnergy = bodyBudget(
    room,
    countByRoleInRoom(ROLE_FILLER, room) === 0 ? "available" : "capacity"
  );
  const body = buildScaledBody(ROLE_FILLER, allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const res = trackedSpawn(room, spawn, body, {
    memory: { role: ROLE_FILLER, homeRoom: room.name },
  });
  return res === OK;
}

export function spawnEmergencyHarvester(room: Room, spawn: StructureSpawn): boolean {
  if (room.energyAvailable < 200) return false;
  const sets = Math.min(3, Math.floor(room.energyAvailable / 200));
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) body.push(WORK, CARRY, MOVE);
  const res = trackedSpawn(room, spawn, body, {
    memory: { role: ROLE_HARVESTER, homeRoom: room.name },
  });
  return res === OK;
}

export function shouldSpawnMineralMiner(room: Room): boolean {
  if (!room.memory.mineralContainerId) return false;
  const container = Game.getObjectById(room.memory.mineralContainerId) as StructureContainer | null;
  if (!container) return false;

  const mineralId = room.memory.mineralId;
  if (!mineralId) return false;

  const mineral = Game.getObjectById(mineralId) as Mineral | null;
  if (!mineral) return false;
  // A depleted mineral still needs its miner while its container holds a spill.
  if (mineral.mineralAmount === 0 && container.store.getUsedCapacity() === 0) return false;

  const extractorId = room.memory.extractorId;
  if (!extractorId) return false;

  const extractor = Game.getObjectById(extractorId) as StructureExtractor | null;
  if (!extractor) return false;

  return countByRoleInRoom(ROLE_MINERAL_MINER, room) === 0;
}

export function spawnRepairer(room: Room, spawn: StructureSpawn): boolean {
  const allowedEnergy = bodyBudget(room, "available");
  const body = buildScaledBody(ROLE_REPAIRER, allowedEnergy);
  const res = trackedSpawn(room, spawn, body, {
    memory: { role: ROLE_REPAIRER, homeRoom: room.name },
  });
  return res === OK;
}

// The extractor's cooldown caps a mineral miner at one mineral per WORK part
// per EXTRACTOR_COOLDOWN ticks however big it is, so extra WORK buys nothing
// past the container's regen. What sets its output is CARRY, because it carries
// its own load to storage: with the one CARRY part buildMinerBody gives it, it
// walked off the extractor every 50 minerals and spent most of its life in
// transit. Trade the surplus WORK for CARRY and it stays on the mineral.
function buildMineralMinerBody(availableEnergy: number): BodyPartConstant[] {
  const workParts = 5;
  const baseMove = 3;
  const baseCost =
    workParts * BODYPART_COST[WORK] + baseMove * BODYPART_COST[MOVE];
  // Two CARRY to one MOVE: the route to the mineral is roaded like the rest of
  // the cardinal arteries.
  const unitCost = 2 * BODYPART_COST[CARRY] + BODYPART_COST[MOVE];
  const units = Math.max(
    1,
    Math.min(5, Math.floor((availableEnergy - baseCost) / unitCost))
  );

  return [
    ...Array(workParts).fill(WORK),
    ...Array(units * 2).fill(CARRY),
    ...Array(baseMove + units).fill(MOVE),
  ] as BodyPartConstant[];
}

export function spawnMineralMiner(room: Room, spawn: StructureSpawn): boolean {
  const allowedEnergy = bodyBudget(room, "available");
  const body = buildMineralMinerBody(allowedEnergy);
  const res = trackedSpawn(room, spawn, body, {
    memory: { role: ROLE_MINERAL_MINER, homeRoom: room.name },
  });
  return res === OK;
}

export function spawnHarvester(room: Room, spawn: StructureSpawn): boolean {
  const allowedEnergy = bodyBudget(room, "available");
  const body = buildScaledBody(ROLE_HARVESTER, allowedEnergy);
  const res = trackedSpawn(room, spawn, body, {
    memory: { role: ROLE_HARVESTER, homeRoom: room.name },
  });
  return res === OK;
}

function buildRcl8UpgraderBody(availableEnergy: number): BodyPartConstant[] {
  const group: BodyPartConstant[] = [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE];
  const groupCost = calculateBodyPartCost(group);
  // Three groups is 15 WORK: anything past that is capped away by the controller.
  const maxGroups = Math.min(3, Math.floor(availableEnergy / groupCost));
  const groups = Math.max(1, maxGroups);
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < groups; i++) body.push(...group);
  return body;
}

// Whole [WORK, WORK, CARRY, MOVE] patterns, then what is left goes to WORK
// with a MOVE per pair and a lone WORK last. Whole patterns alone left up to
// 250 energy of an RCL 2-3 room's capacity unspent on every upgrader.
export function buildUpgraderBody(availableEnergy: number): BodyPartConstant[] {
  const body = buildScaledBody(ROLE_UPGRADER, availableEnergy);
  let left = availableEnergy - calculateBodyPartCost(body);
  const pair = BODYPART_COST[WORK] + BODYPART_COST[MOVE];
  while (left >= pair && body.length + 2 <= MAX_BODY_PART_COUNT) {
    body.push(WORK, MOVE);
    left -= pair;
  }
  if (left >= BODYPART_COST[WORK] && body.length < MAX_BODY_PART_COUNT) body.push(WORK);
  return body;
}

export function spawnUpgrader(room: Room, spawn: StructureSpawn): boolean {
  const rcl = room.controller?.level ?? 0;

  const allowedEnergy = bodyBudget(room, rcl >= 8 ? "capacity" : "available");
  const body =
    rcl >= 8
      ? buildRcl8UpgraderBody(allowedEnergy)
      : buildUpgraderBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;

  let queue: string[] = [];
  if (rcl >= 7) {
    const workParts = body.filter((p) => p === WORK).length;
    queue = buildBoostQueue(room, "upgrader", workParts, 0);
  }

  const res = trackedSpawn(room, spawn, body, {
    memory: { role: ROLE_UPGRADER, homeRoom: room.name, ...boostMemory(queue) },
  });
  return res === OK;
}

export function spawnBuilder(room: Room, spawn: StructureSpawn): boolean {
  const allowedEnergy = bodyBudget(room, "available");
  const body = buildScaledBody(ROLE_BUILDER, allowedEnergy);
  const res = trackedSpawn(room, spawn, body, {
    memory: { role: ROLE_BUILDER, homeRoom: room.name },
  });
  return res === OK;
}

function buildMinerBody(availableEnergy: number): BodyPartConstant[] {
  const workCost = BODYPART_COST[WORK];
  const moveCost = BODYPART_COST[MOVE];
  const carryCost = BODYPART_COST[CARRY];
  const maxWork = 5;
  const workParts = Math.min(
    maxWork,
    Math.floor((availableEnergy - moveCost - carryCost) / workCost)
  );
  if (workParts <= 0) return [WORK, MOVE];
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < workParts; i++) body.push(WORK);
  body.push(CARRY);
  body.push(MOVE);
  return body;
}

export function spawnMiner(room: Room, spawn: StructureSpawn): boolean {
  const existingMiners = getCreepsByRoleInRoom(ROLE_MINER, room).length;

  const allowedEnergy =
    existingMiners === 0 ? bodyBudget(room, "available") : minerBudget(room);
  const body = buildMinerBody(allowedEnergy);

  if (room.energyAvailable < calculateBodyPartCost(body)) {
    // Once a miner exists, wait for a full-size body rather than falling through
    // to lower-priority roles (repairer/builder/upgrader) that would spend the
    // energy we're saving up on a runt. Block the spawn tick like spawnHauler
    // does, and give up on the wait on the same bounded terms.
    // With nothing refilling the core the hold can only run out the clock.
    if (existingMiners > 0 && hasCoreRefiller(room) && holdSpawnFor(room, ROLE_MINER)) return true;
    const affordable = buildMinerBody(bodyBudget(room, "available"));
    return trackedSpawn(room, spawn, affordable, {
      memory: { role: ROLE_MINER, homeRoom: room.name, ...inheritMinerPost(room) },
    }) === OK;
  }

  return trackedSpawn(room, spawn, body, {
    memory: { role: ROLE_MINER, homeRoom: room.name, ...inheritMinerPost(room) },
  }) === OK;
}

// A replacement ordered ahead of time would otherwise look for an unclaimed
// container, find the outgoing miner still holding its post, and go elsewhere
// or idle. Hand it the post of a miner that is retiring or undersized and that
// no other miner has already been sent to relieve.
function inheritMinerPost(room: Room): Pick<CreepMemory, "assignedSourceId" | "assignedContainerId"> {
  // Includes creeps still in the spawn, so a replacement already on order
  // counts as the post's second holder.
  const miners = getCreepsByRoleInRoom(ROLE_MINER, room);
  const workTarget = getMinerWorkTarget(room);
  const lead = getMinerReplacementLead(room);
  const holders: Record<string, number> = {};
  for (const c of miners) {
    const id = c.memory.assignedContainerId;
    if (id) holders[id] = (holders[id] ?? 0) + 1;
  }
  for (const c of miners) {
    const { assignedSourceId, assignedContainerId } = c.memory;
    if (c.spawning || !assignedSourceId || !assignedContainerId) continue;
    if (holders[assignedContainerId] > 1) continue;
    const undersized = c.body.filter((p) => p.type === WORK).length < workTarget;
    if (!undersized && !isRetiring(c, lead)) continue;
    return { assignedSourceId, assignedContainerId };
  }
  return {};
}

export function shouldSpawnApothecary(room: Room): boolean {
  if ((room.controller?.level ?? 0) < 6) return false;
  if (!room.memory.labSystem?.inputLabIds?.length) return false;
  return countByRoleInRoom(ROLE_APOTHECARY, room) < 1;
}

// The apothecary's body is capped at this many CARRY:CARRY:MOVE sets. Its
// walks are a few steps between storage, terminal and labs, and an RCL 6 lab
// block reacts under a unit a tick: a 45-part apothecary stood idle beside
// storage most of its life, at 1.5 gold a tick.
const APOTHECARY_MAX_SETS = 5;

export function spawnApothecary(room: Room, spawn: StructureSpawn): boolean {
  const allowedEnergy = Math.min(
    APOTHECARY_MAX_SETS * calculateBodyPartCost(BODY_PATTERNS[ROLE_APOTHECARY]),
    bodyBudget(room, "available")
  );
  const body = buildScaledBody(ROLE_APOTHECARY, allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const res = trackedSpawn(room, spawn, body, {
    memory: { role: ROLE_APOTHECARY },
  });
  return res === OK;
}
