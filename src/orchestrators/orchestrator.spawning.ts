import {
  ROLE_BUILDER,
  ROLE_HARVESTER,
  ROLE_UPGRADER,
  ROLE_REPAIRER,
  ROLE_MINER,
  ROLE_HAULER,
  ROLE_FILLER,
  ROLE_MINERAL_MINER,
  ROLE_SCOUT,
  ROLE_REMOTE_MINER,
  ROLE_REMOTE_HAULER,
  ROLE_RESERVER,
  ROLE_KNIGHT,
  ROLE_WIZARD,
  ROLE_CLERIC,
  ROLE_SIEGER,
  ROLE_DRAINER,
  ROLE_CONQUEROR,
  ROLE_SETTLER,
  ROLE_APOTHECARY,
  ROLE_POWER_ATTACKER,
  ROLE_POWER_HEALER,
  ROLE_POWER_CARRIER,
  ROLE_DEPOSIT_MINER,
  ROLE_DEPOSIT_HAULER,
  ROLE_SK_GUARDIAN,
  ROLE_SK_MINER,
  ROLE_SK_HAULER,
  ROLE_SCORE_HUNTER,
  ROLE_UNCLAIMER,
} from "../config/config.roles";
import {
  getThreatInfo,
  getThreatSeverity,
  refreshBlockade,
  isBlockaded,
  summarizeHostiles,
  meleeDefendersToWin,
} from "../services/services.combat";
import { towersCanHold } from "../roles/role.tower";
import { getDefenseOp, getDefenders, getDrainOpsForHome } from "./orchestrator.military";
import { getSkMembers, isOpPaused } from "./orchestrator.sourcekeeper";
import { getStockForCompound } from "../services/services.labs";
import { barrierTargetFn, isEnergyEmergency } from "../services/services.creep";

import {
  BODY_PATTERNS,
  MAX_BODY_PART_COUNT,
} from "../config/config.spawning";
import { getRoomMemory } from "../services/services.memory";
import { getSources } from "../services/services.creep";
import {
  getUnclaimedScoreTargetCount,
  getScoreScanRooms,
  scoreHunterSupported,
  homeHasObserver,
  SCORE_SCOUT_RADIUS,
} from "./orchestrator.score";

export function loop() {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my) continue;
    refreshBlockade(room);
    const spawns = room.find(FIND_MY_SPAWNS) as StructureSpawn[];
    for (const spawn of spawns) {
      if (!spawn.spawning) processRoomSpawning(room, spawn);
    }
  }
}

function buildScaledBody(
  role: string,
  availableEnergy: number
): BodyPartConstant[] {
  const pattern = BODY_PATTERNS[role] ?? [WORK, CARRY, MOVE];
  const patternCost = calculateBodyPartCost(pattern);
  const maxByParts = Math.floor(MAX_BODY_PART_COUNT / pattern.length);
  const maxByEnergy = Math.floor(availableEnergy / patternCost);
  const repeats = Math.max(1, Math.min(maxByParts, maxByEnergy));
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < repeats; i++) body.push(...pattern);
  return body;
}

function calculateBodyPartCost(parts: BodyPartConstant[]): number {
  return parts.reduce((cost, part) => cost + BODYPART_COST[part], 0);
}

let creepCacheTick = -1;
const creepsByRoleCache: Record<string, Creep[]> = {};

function rebuildCreepCache(): void {
  if (creepCacheTick === Game.time) return;
  creepCacheTick = Game.time;
  for (const key of Object.keys(creepsByRoleCache)) delete creepsByRoleCache[key];
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    const role = creep.memory.role;
    if (role) {
      if (!creepsByRoleCache[role]) creepsByRoleCache[role] = [];
      creepsByRoleCache[role].push(creep);
    }
  }
}

function getCreepsByRole(role: string): Creep[] {
  rebuildCreepCache();
  return creepsByRoleCache[role] ?? [];
}

function getCreepsByRoleInRoom(role: string, room: Room): Creep[] {
  return getCreepsByRole(role).filter((creep) => creep.room.name === room.name);
}

let spawningCacheTick = -1;
const spawningCache: Record<string, Record<string, number>> = {};

// A spawnCreep order only shows up on the spawn and in Game.creeps next tick, so
// another idle spawn deciding in the same tick has to count these orders itself.
let issuedTick = -1;
let issuedTotal = 0;
const issuedThisTick: Record<string, Record<string, number>> = {};

function getIssuedCount(room: Room, role: string): number {
  if (issuedTick !== Game.time) {
    issuedTick = Game.time;
    issuedTotal = 0;
    for (const k of Object.keys(issuedThisTick)) delete issuedThisTick[k];
  }
  return issuedThisTick[room.name]?.[role] ?? 0;
}

function getRoomSpawningCount(room: Room, role: string): number {
  if (spawningCacheTick !== Game.time) {
    spawningCacheTick = Game.time;
    for (const k of Object.keys(spawningCache)) delete spawningCache[k];
  }
  if (!spawningCache[room.name]) {
    const counts: Record<string, number> = {};
    const spawns = room.find(FIND_MY_SPAWNS) as StructureSpawn[];
    for (const s of spawns) {
      if (!s.spawning) continue;
      const mem = Memory.creeps[s.spawning.name];
      if (!mem?.role) continue;
      const r = mem.role;
      counts[r] = (counts[r] ?? 0) + 1;
    }
    spawningCache[room.name] = counts;
  }
  return (spawningCache[room.name][role] ?? 0) + getIssuedCount(room, role);
}

// At most one order per role per room per tick: roles matched by memory (remote
// source, scout target, squad slot) cannot see a same-tick order, so a second idle
// spawn would duplicate it. Names are `${role}${Game.time}`-style, so a per-tick
// suffix keeps two rooms spawning the same role from hitting ERR_NAME_EXISTS.
function trackedSpawn(
  room: Room,
  spawn: StructureSpawn,
  body: BodyPartConstant[],
  name: string,
  opts: SpawnOptions & { memory: CreepMemory }
): ScreepsReturnCode {
  const role = opts.memory.role;
  if (getIssuedCount(room, role) > 0) return ERR_BUSY;
  const uniqueName = issuedTotal > 0 ? `${name}_${issuedTotal}` : name;
  const res = spawn.spawnCreep(body, uniqueName, opts);
  if (res === OK) {
    issuedTotal++;
    const byRole = issuedThisTick[room.name] ?? (issuedThisTick[room.name] = {});
    byRole[role] = (byRole[role] ?? 0) + 1;
  }
  return res;
}

function countByRoleInRoom(role: string, room: Room): number {
  const present = getCreepsByRoleInRoom(role, room).filter((c) => !c.spawning).length;
  return present + getRoomSpawningCount(room, role);
}

// A role that is saving up for a full-size body blocks the spawn tick so the
// roles below it cannot spend the savings on a runt. That hold has to be able
// to expire: while it is held nothing else in the room spawns, so a target the
// room never reaches costs it every upgrader, builder, repairer and defender.
const SPAWN_HOLD_LIMIT = 100;

function holdSpawnFor(room: Room, role: string): boolean {
  const memory = getRoomMemory(room);
  const hold = memory.spawnHold;
  // A room with two idle spawns asks twice in the same tick, so treat both the
  // current tick and the previous one as the same unbroken hold.
  const continuing =
    hold !== undefined && hold.role === role && Game.time - hold.lastTick <= 1;
  const since = continuing ? hold!.since : Game.time;
  memory.spawnHold = { role, since, lastTick: Game.time };
  return Game.time - since < SPAWN_HOLD_LIMIT;
}

// How much a body may cost, and it depends on which number the caller is
// working from.
//
// An "available" budget is energy already sitting in the spawn and extensions
// this tick. Nothing else draws on it - towers hold their own store, and every
// other consumer takes from storage or a container - so it is all spendable,
// and the 10% that used to be shaved off it bought nothing. It just made every
// creep in the empire a tenth smaller for its whole life.
//
// A "capacity" budget is different: it is a target the room still has to climb
// to, and the callers that use it hold the spawn while they wait. Aiming at the
// last few energy of capacity means waiting for a number a working room rarely
// lands on exactly, so that one keeps a margin.
const CAPACITY_TARGET_MARGIN = 0.1;

function bodyBudget(room: Room, basis: "available" | "capacity"): number {
  return basis === "available"
    ? room.energyAvailable
    : Math.floor(room.energyCapacityAvailable * (1 - CAPACITY_TARGET_MARGIN));
}

// A replacement takes CREEP_SPAWN_TIME ticks per body part to build and then has
// to walk to its post. Ordering it only once the creep it replaces is already
// gone leaves that post - and the source worked from it - idle for the whole
// lead time, every life cycle.
function spawnLeadTicks(bodyParts: number, travelTicks: number): number {
  return bodyParts * CREEP_SPAWN_TIME + travelTicks;
}

function isRetiring(creep: Creep, lead: number): boolean {
  const ttl = creep.ticksToLive;
  return ttl !== undefined && ttl <= lead;
}

// A remote post is a long walk from the spawn, so its replacement has to be
// ordered that much earlier. The outgoing creep's own body is a good stand-in
// for the size of the one that relieves it.
function isRemoteCreepRetiring(home: Room, creep: Creep): boolean {
  const target = creep.memory.targetRoom;
  if (!target) return false;
  const lead = spawnLeadTicks(creep.body.length, estimateRemoteDistance(home, target));
  return isRetiring(creep, lead);
}

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

// Bodies are sized from room.energyAvailable, so one spawned during a dip in the
// core commits the room to an undersized creep for its whole 1500-tick life.
// Wait for the extensions to refill first. Unlike holdSpawnFor this does not
// block the roles below it in the chain, and it gives up so that a room that
// simply never reaches the ratio still gets its creep, just a smaller one.
const FULL_BODY_ENERGY_RATIO = 0.9;
const FULL_BODY_MAX_WAIT = 40;

// The wait only runs while the role is actually short. Timing it on ticks when
// nothing was needed would use up the wait before the real need arrived.
function waitForFullBody(room: Room, role: string, needed: boolean): boolean {
  const memory = getRoomMemory(room);
  if (!needed || room.energyAvailable >= room.energyCapacityAvailable * FULL_BODY_ENERGY_RATIO) {
    if (memory.bodyWait) delete memory.bodyWait[role];
    return false;
  }
  if (!memory.bodyWait) memory.bodyWait = {};
  const since = memory.bodyWait[role];
  if (since === undefined) {
    memory.bodyWait[role] = Game.time;
    return true;
  }
  return Game.time - since < FULL_BODY_MAX_WAIT;
}

function getMinerPopulationTarget(room: Room): number {
  return (room.memory.minerContainerIds ?? []).length;
}

function getMinerReplacementLead(room: Room): number {
  const allowed = bodyBudget(room, "capacity");
  return spawnLeadTicks(buildMinerBody(allowed).length, getMinerTravelTicks(room));
}

type RoomPhase = "bootstrap" | "developing" | "established" | "powerhouse";

function getRoomPhase(room: Room): RoomPhase {
  const rcl = room.controller?.level ?? 0;
  if (rcl <= 2) return "bootstrap";
  if (rcl <= 4) return "developing";
  if (rcl <= 6) return "established";
  return "powerhouse";
}

function hasEnergyGatherers(room: Room): boolean {
  const harvesters = getCreepsByRoleInRoom(ROLE_HARVESTER, room);
  const miners = getCreepsByRoleInRoom(ROLE_MINER, room);
  return harvesters.length + miners.length > 0;
}

function countHomeHaulers(room: Room): number {
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

// WORK counts: nobody can harvest in a room we own, so a WORK creep here is a
// dismantler or a builder of something hostile.
function hasArmedHostiles(room: Room): boolean {
  return getThreatInfo(room).hostiles.some((c) =>
    c.body.some(
      (p) => p.hits > 0 && (p.type === ATTACK || p.type === RANGED_ATTACK || p.type === WORK)
    )
  );
}

const ECONOMY_CRITICAL_STORAGE = 25_000;
function isEconomyCritical(room: Room): boolean {
  if (!room.storage) return isEnergyEmergency(room);
  return room.storage.store[RESOURCE_ENERGY] < ECONOMY_CRITICAL_STORAGE;
}

function getHarvesterPopulationTarget(room: Room): number {
  const minerCount = getCreepsByRoleInRoom(ROLE_MINER, room).length;
  const phase = getRoomPhase(room);
  if (phase === "bootstrap") {
    if (minerCount === 0) return 2;
    return Math.max(0, getSources(room).length - minerCount);
  }
  if (isEnergyEmergency(room)) return minerCount > 0 ? Math.min(1, 2 - minerCount) : 2;
  if (room.storage && room.storage.store[RESOURCE_ENERGY] > 10000) return 0;
  return Math.max(0, 2 - minerCount);
}

const CONTROLLER_DOWNGRADE_SAFETY = 5000;

function getUpgraderPopulationTarget(room: Room): number {
  const controller = room.controller;
  if (controller?.my && controller.ticksToDowngrade < CONTROLLER_DOWNGRADE_SAFETY) return 1;

  if (isEnergyEmergency(room)) return 0;

  const phase = getRoomPhase(room);
  const rcl = room.controller?.level ?? 0;

  // An RCL 8 controller takes at most CONTROLLER_MAX_UPGRADE_PER_TICK (15)
  // energy a tick, which one 15-WORK upgrader already spends.
  if (rcl >= 8) return 1;

  const storage = room.storage;
  if (!storage) return phase === "bootstrap" ? 1 : 2;

  const cap = phase === "powerhouse" ? 4 : 3;
  return Math.min(cap, 1 + Math.floor(storage.store[RESOURCE_ENERGY] / 50000));
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

export function processRoomSpawning(room: Room, spawn: StructureSpawn) {
  if (!hasEnergyGatherers(room)) {
    if (shouldSpawnDefender(room) && spawnNextDefender(room, spawn)) return;
    spawnEmergencyHarvester(room, spawn);
    return;
  }

  const { score: threatScore } = getThreatInfo(room);
  const threatSeverity = getThreatSeverity(room);
  const phase = getRoomPhase(room);

  const blockaded = isBlockaded(room);

  if (shouldSpawnHarvester(room) && spawnHarvester(room, spawn)) return;

  if (shouldSpawnDefender(room) && spawnNextDefender(room, spawn)) return;

  const hasEconomyFloor =
    countByRoleInRoom(ROLE_MINER, room) >= 1 && countByRoleInRoom(ROLE_HAULER, room) >= 1;
  if (threatSeverity === "high" && phase !== "bootstrap" && hasEconomyFloor) {
    if (shouldSpawnKnight(room, threatScore) && spawnKnight(room, spawn)) return;
    if (shouldSpawnWizard(room, threatScore) && spawnWizard(room, spawn)) return;
    if (shouldSpawnCleric(room, threatScore) && spawnCleric(room, spawn)) return;
  }

  // The filler is what moves stored energy into spawn and extensions, so it is
  // the only reason room.energyAvailable ever climbs once storage exists. Miner
  // and hauler both hold the spawn while they save up for a full-size body; if
  // the filler sat behind that hold it could never be replaced, and the energy
  // the hold is waiting for would never arrive.
  if (shouldSpawnFiller(room) && spawnFiller(room, spawn)) return;
  // A miner with no hauler behind it fills its container and nothing reaches
  // the core, so the first hauler goes ahead of any further miner.
  const needsFirstHauler =
    countHomeHaulers(room) === 0 && countByRoleInRoom(ROLE_MINER, room) >= 1;
  if (needsFirstHauler && shouldSpawnHauler(room) && spawnHauler(room, spawn)) return;
  if (shouldSpawnMiner(room) && spawnMiner(room, spawn)) return;
  if (shouldSpawnHauler(room) && spawnHauler(room, spawn)) return;

  if (
    room.controller?.my &&
    room.controller.ticksToDowngrade < CONTROLLER_DOWNGRADE_SAFETY &&
    shouldSpawnUpgrader(room) &&
    spawnUpgrader(room, spawn)
  )
    return;

  if (isEnergyEmergency(room)) {
    if (!blockaded) {
      if (shouldSpawnRemoteDefender(room) && spawnRemoteDefender(room, spawn)) return;
      if (shouldSpawnRemoteMiner(room) && spawnRemoteMiner(room, spawn)) return;
      if (shouldSpawnRemoteHauler(room) && spawnRemoteHauler(room, spawn)) return;
      if (shouldSpawnReserver(room) && spawnReserver(room, spawn)) return;
    }
    return;
  }

  // Towers only arrive at RCL 3, so a bootstrap room has nothing else to fight
  // with. Only hostiles that can actually hit something justify a defender.
  if (hasArmedHostiles(room)) {
    if (shouldSpawnKnight(room, threatScore) && spawnKnight(room, spawn)) return;
    if (shouldSpawnWizard(room, threatScore) && spawnWizard(room, spawn)) return;
    if (shouldSpawnCleric(room, threatScore) && spawnCleric(room, spawn)) return;
  }

  if (shouldSpawnRepairer(room) && spawnRepairer(room, spawn)) return;
  if (shouldSpawnBuilder(room) && spawnBuilder(room, spawn)) return;
  if (shouldSpawnUpgrader(room) && spawnUpgrader(room, spawn)) return;

  if (!blockaded && shouldSpawnScoreHunter(room) && spawnScoreHunter(room, spawn)) return;

  const economyCritical = isEconomyCritical(room);

  if (!blockaded && !economyCritical && Memory.expansion?.homeRoom === room.name) {
    if (shouldSpawnConqueror() && spawnConqueror(room, spawn)) return;
    if (shouldSpawnSettler(room) && spawnSettler(room, spawn)) return;
  }

  if (!blockaded && !economyCritical && shouldSpawnOffensiveCreep(room) && spawnNextOffensiveCreep(room, spawn)) return;
  if (!blockaded && !economyCritical && shouldSpawnDrainLeech(room) && spawnDrainLeech(room, spawn)) return;
  if (!blockaded && !economyCritical && spawnUnclaimer(room, spawn)) return;
  if (!blockaded && shouldSpawnScout(room) && spawnScout(room, spawn)) return;
  if (!blockaded && shouldSpawnRemoteDefender(room) && spawnRemoteDefender(room, spawn)) return;
  if (!blockaded && shouldSpawnRemoteMiner(room) && spawnRemoteMiner(room, spawn)) return;
  if (!blockaded && shouldSpawnRemoteHauler(room) && spawnRemoteHauler(room, spawn)) return;
  if (!blockaded && shouldSpawnReserver(room) && spawnReserver(room, spawn)) return;

  if (!blockaded && shouldSpawnPowerCreep(room) && spawnNextPowerCreep(room, spawn)) return;
  if (!blockaded && shouldSpawnDepositCreep(room) && spawnNextDepositCreep(room, spawn)) return;
  if (!blockaded && spawnSkCreeps(room, spawn)) return;
  if (shouldSpawnApothecary(room) && spawnApothecary(room, spawn)) return;
  if (shouldSpawnMineralMiner(room) && spawnMineralMiner(room, spawn)) return;
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

function shouldSpawnHauler(room: Room): boolean {
  const containerIds = room.memory.containerIds ?? [];
  if (containerIds.length === 0) return false;
  const containers = containerIds
    .map((id) => Game.getObjectById(id))
    .filter(Boolean) as StructureContainer[];

  if (containers.length === 0) return false;

  const haulers = getCreepsByRole(ROLE_HAULER).filter(
    (c) => !c.spawning && (c.memory.homeRoom ?? c.room.name) === room.name
  );

  const minerContainerIds = new Set(room.memory.minerContainerIds ?? []);
  const minerContainers = containers.filter((c) =>
    minerContainerIds.has(c.id as Id<StructureContainer>)
  );
  const minerContainerCount = minerContainers.length;

  const spawn = getSpawnForRoom(room);
  let requiredCarry = 0;
  if (spawn) {
    const distances = getContainerDistances(room, spawn, minerContainers);
    for (const c of minerContainers) {
      const dist = distances[c.id] ?? 0;
      const roundTrip = dist * 2;
      requiredCarry +=
        (HAULER_SPAWN.SOURCE_OUTPUT * roundTrip) / HAULER_SPAWN.CARRY_CAPACITY;
    }
  }

  const idealRepeats = Math.min(
    Math.floor(MAX_BODY_PART_COUNT / 3),
    Math.floor(bodyBudget(room, "capacity") / 150)
  );
  const carryPerIdealHauler = Math.max(1, idealRepeats * 2);

  const targetFromThroughput = Math.ceil(requiredCarry / carryPerIdealHauler);

  const desired = Math.min(
    HAULER_SPAWN.MAX_HAULERS,
    Math.max(minerContainerCount, targetFromThroughput)
  );

  const lead = spawnLeadTicks(idealRepeats * 3, getMinerTravelTicks(room));
  const haulerCount =
    haulers.filter((h) => !isRetiring(h, lead)).length +
    getRoomSpawningCount(room, ROLE_HAULER);
  if (haulerCount < desired) return true;

  if (haulers.length >= HAULER_SPAWN.MAX_HAULERS) return false;
  const carryPerIdealHaulerUnits = carryPerIdealHauler * HAULER_SPAWN.CARRY_CAPACITY;
  const totalCurrentCarry = haulers.reduce(
    (sum, h) => sum + h.body.filter((p) => p.type === CARRY).length * HAULER_SPAWN.CARRY_CAPACITY,
    0
  );
  return totalCurrentCarry < desired * carryPerIdealHaulerUnits * 0.5;
}

function spawnHauler(room: Room, spawn: StructureSpawn): boolean {
  const newName = `${ROLE_HAULER}${Game.time}`;
  const existingHaulers = getCreepsByRole(ROLE_HAULER).filter(
    (c) => (c.memory.homeRoom ?? c.room.name) === room.name
  );

  const allowedEnergy = bodyBudget(
    room,
    existingHaulers.length === 0 ? "available" : "capacity"
  );
  const body = buildScaledBody(ROLE_HAULER, allowedEnergy);
  const bodyCost = calculateBodyPartCost(body);

  if (room.energyAvailable < bodyCost) {
    // Only the first hauler may downgrade to whatever is in the bank right now.
    // Past that, wait for a full-size body: a runt hauler costs the energy the
    // miner is saving up for, and the miner never gets to spawn. Give up on the
    // wait once it has starved the rest of the room for SPAWN_HOLD_LIMIT ticks.
    if (existingHaulers.length > 0 && holdSpawnFor(room, ROLE_HAULER)) return true;
    const affordableEnergy = bodyBudget(room, "available");
    const affordableBody = buildScaledBody(ROLE_HAULER, affordableEnergy);
    if (room.energyAvailable < calculateBodyPartCost(affordableBody)) {
      // Below the cost of the smallest hauler there is nothing to save up for,
      // so let the chain move on rather than holding the spawn again.
      return false;
    }
    return trackedSpawn(room, spawn, affordableBody, newName, {
      memory: { role: ROLE_HAULER, homeRoom: room.name },
    }) === OK;
  }

  return trackedSpawn(room, spawn, body, newName, {
    memory: { role: ROLE_HAULER, homeRoom: room.name },
  }) === OK;
}

function getMinerWorkTarget(room: Room): number {
  const allowed = bodyBudget(room, "capacity");
  return buildMinerBody(allowed).filter((p) => p === WORK).length;
}

function shouldSpawnMiner(room: Room): boolean {
  // Count only miners big enough for the room's current capacity. A miner born
  // during an energy crunch is undersized for its whole life and caps income at
  // a fraction of the source; it needs replacing once we can afford better.
  const workTarget = getMinerWorkTarget(room);
  const lead = getMinerReplacementLead(room);
  const adequate =
    getCreepsByRoleInRoom(ROLE_MINER, room).filter(
      (c) =>
        !c.spawning &&
        c.body.filter((p) => p.type === WORK).length >= workTarget &&
        !isRetiring(c, lead)
    ).length + getRoomSpawningCount(room, ROLE_MINER);
  return adequate < getMinerPopulationTarget(room);
}

function shouldSpawnHarvester(room: Room): boolean {
  return countByRoleInRoom(ROLE_HARVESTER, room) < getHarvesterPopulationTarget(room);
}

function shouldSpawnUpgrader(room: Room): boolean {
  const needed = countByRoleInRoom(ROLE_UPGRADER, room) < getUpgraderPopulationTarget(room);
  if (waitForFullBody(room, ROLE_UPGRADER, needed)) return false;
  return needed;
}

function shouldSpawnBuilder(room: Room): boolean {
  const needed = countByRoleInRoom(ROLE_BUILDER, room) < getBuilderPopulationTarget(room);
  if (waitForFullBody(room, ROLE_BUILDER, needed)) return false;
  return needed;
}

const repairerTargetCache: Record<string, { value: number; tick: number }> = {};

function getRepairerPopulationTarget(room: Room): number {
  if (isEnergyEmergency(room)) return 0;
  const cached = repairerTargetCache[room.name];
  if (cached && Game.time - cached.tick < 50) return cached.value;

  // 0.8 matches where the repair target picker starts caring about a structure.
  const worn = room.find(FIND_STRUCTURES, {
    filter: (s) => {
      if (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) return false;
      const st = s as AnyStructure;
      return "hits" in st && "hitsMax" in st && st.hits < st.hitsMax * 0.8;
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

function shouldSpawnRepairer(room: Room): boolean {
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
function shouldSpawnFiller(room: Room): boolean {
  const fillers = getCreepsByRoleInRoom(ROLE_FILLER, room).filter(
    (c) => !c.spawning && !isRetiring(c, spawnLeadTicks(c.body.length, 0))
  ).length;
  return fillers + getRoomSpawningCount(room, ROLE_FILLER) < getFillerPopulationTarget(room);
}

function spawnFiller(room: Room, spawn: StructureSpawn): boolean {
  const allowedEnergy = bodyBudget(
    room,
    countByRoleInRoom(ROLE_FILLER, room) === 0 ? "available" : "capacity"
  );
  const body = buildScaledBody(ROLE_FILLER, allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const res = trackedSpawn(room, spawn, body, `${ROLE_FILLER}${Game.time}`, {
    memory: { role: ROLE_FILLER, homeRoom: room.name },
  });
  return res === OK;
}

function spawnEmergencyHarvester(room: Room, spawn: StructureSpawn): boolean {
  if (room.energyAvailable < 200) return false;
  const sets = Math.min(3, Math.floor(room.energyAvailable / 200));
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) body.push(WORK, CARRY, MOVE);
  const res = trackedSpawn(room, spawn, body, `${ROLE_HARVESTER}_emrg${Game.time}`, {
    memory: { role: ROLE_HARVESTER },
  });
  return res === OK;
}

function shouldSpawnMineralMiner(room: Room): boolean {
  if (!room.memory.mineralContainerId) return false;
  const container = Game.getObjectById(room.memory.mineralContainerId) as StructureContainer | null;
  if (!container) return false;

  const mineralId = room.memory.mineralId;
  if (!mineralId) return false;

  const mineral = Game.getObjectById(mineralId) as Mineral | null;
  if (!mineral || mineral.mineralAmount === 0) return false;

  const extractorId = room.memory.extractorId;
  if (!extractorId) return false;

  const extractor = Game.getObjectById(extractorId) as StructureExtractor | null;
  if (!extractor) return false;

  return countByRoleInRoom(ROLE_MINERAL_MINER, room) === 0;
}

function spawnRepairer(room: Room, spawn: StructureSpawn): boolean {
  const newName = `${ROLE_REPAIRER}${Game.time}`;
  const allowedEnergy = bodyBudget(room, "available");
  const body = buildScaledBody(ROLE_REPAIRER, allowedEnergy);
  const res = trackedSpawn(room, spawn, body, newName, {
    memory: { role: ROLE_REPAIRER },
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

function spawnMineralMiner(room: Room, spawn: StructureSpawn): boolean {
  const newName = `${ROLE_MINERAL_MINER}${Game.time}`;
  const allowedEnergy = bodyBudget(room, "available");
  const body = buildMineralMinerBody(allowedEnergy);
  const res = trackedSpawn(room, spawn, body, newName, {
    memory: { role: ROLE_MINERAL_MINER },
  });
  return res === OK;
}

function spawnHarvester(room: Room, spawn: StructureSpawn): boolean {
  const newName = `${ROLE_HARVESTER}${Game.time}`;
  const allowedEnergy = bodyBudget(room, "available");
  const body = buildScaledBody(ROLE_HARVESTER, allowedEnergy);
  const res = trackedSpawn(room, spawn, body, newName, {
    memory: { role: ROLE_HARVESTER },
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

function spawnUpgrader(room: Room, spawn: StructureSpawn): boolean {
  const newName = `${ROLE_UPGRADER}${Game.time}`;
  const rcl = room.controller?.level ?? 0;

  const allowedEnergy = bodyBudget(room, rcl >= 8 ? "capacity" : "available");
  const body =
    rcl >= 8
      ? buildRcl8UpgraderBody(allowedEnergy)
      : buildScaledBody(ROLE_UPGRADER, allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;

  let queue: string[] = [];
  if (rcl >= 7) {
    const workParts = body.filter((p) => p === WORK).length;
    queue = buildBoostQueue(room, "upgrader", workParts, 0);
  }

  const res = trackedSpawn(room, spawn, body, newName, {
    memory: { role: ROLE_UPGRADER, ...boostMemory(queue) },
  });
  return res === OK;
}

function spawnBuilder(room: Room, spawn: StructureSpawn): boolean {
  const newName = `${ROLE_BUILDER}${Game.time}`;
  const allowedEnergy = bodyBudget(room, "available");
  const body = buildScaledBody(ROLE_BUILDER, allowedEnergy);
  const res = trackedSpawn(room, spawn, body, newName, {
    memory: { role: ROLE_BUILDER },
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

function spawnMiner(room: Room, spawn: StructureSpawn): boolean {
  const newName = `${ROLE_MINER}${Game.time}`;
  const existingMiners = getCreepsByRoleInRoom(ROLE_MINER, room).length;

  const allowedEnergy = bodyBudget(room, existingMiners === 0 ? "available" : "capacity");
  const body = buildMinerBody(allowedEnergy);

  if (room.energyAvailable < calculateBodyPartCost(body)) {
    // Once a miner exists, wait for a full-size body rather than falling through
    // to lower-priority roles (repairer/builder/upgrader) that would spend the
    // energy we're saving up on a runt. Block the spawn tick like spawnHauler
    // does, and give up on the wait on the same bounded terms.
    // With nothing refilling the core the hold can only run out the clock.
    if (existingMiners > 0 && hasCoreRefiller(room) && holdSpawnFor(room, ROLE_MINER)) return true;
    const affordable = buildMinerBody(bodyBudget(room, "available"));
    return trackedSpawn(room, spawn, affordable, newName, {
      memory: { role: ROLE_MINER, ...inheritMinerPost(room) },
    }) === OK;
  }

  return trackedSpawn(room, spawn, body, newName, {
    memory: { role: ROLE_MINER, ...inheritMinerPost(room) },
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

// Remotes worth sending creeps to. A room we have since claimed, one someone
// else owns or reserves, and one with invaders currently in it are all left out.
// An Invader reservation stops harvesting too, but a reserver can take it back,
// so the "reserve" view keeps those rooms. Remote defenders read the raw list.
function getActiveRemoteRooms(
  room: Room,
  purpose: "harvest" | "reserve" = "harvest"
): RemoteRoomData[] {
  const me = room.controller?.owner?.username;
  return (room.memory.remoteRooms ?? []).filter((r) => {
    if (r.hostile || r.sources.length === 0) return false;
    if (r.invaderUntil !== undefined && r.invaderUntil > Game.time) return false;
    const ctrl = Game.rooms[r.roomName]?.controller;
    const intel = Memory.intel?.[r.roomName];
    const owner = ctrl ? ctrl.owner?.username : intel?.owner;
    if (ctrl?.my || owner) return false;
    const reservedBy = ctrl ? ctrl.reservation?.username : intel?.reservedBy;
    if (!reservedBy || reservedBy === me) return true;
    return reservedBy === "Invader" && purpose === "reserve";
  });
}

function getScoutsForRoom(room: Room): Creep[] {
  return getCreepsByRole(ROLE_SCOUT).filter((c) => c.memory.homeRoom === room.name);
}

function shouldSpawnScout(room: Room): boolean {
  const pending = room.memory.pendingScoutRooms ?? [];
  if (pending.length === 0) return false;
  const assignedRooms = new Set(getScoutsForRoom(room).map((c) => c.memory.targetRoom));
  return pending.some((r) => !assignedRooms.has(r));
}

function spawnScout(room: Room, spawn: StructureSpawn): boolean {
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

function shouldSpawnScoreHunter(room: Room): boolean {
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

function spawnScoreHunter(room: Room, spawn: StructureSpawn): boolean {
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

function shouldSpawnRemoteMiner(room: Room): boolean {
  if ((room.controller?.level ?? 0) < 3) return false;
  const needed = findUnassignedRemoteSource(room) !== null;
  if (waitForFullBody(room, ROLE_REMOTE_MINER, needed)) return false;
  return needed;
}

function spawnRemoteMiner(room: Room, spawn: StructureSpawn): boolean {
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

function getRemoteHaulerTarget(room: Room): number {
  const activeRooms = getActiveRemoteRooms(room);
  if (activeRooms.length === 0) return 0;

  // Ask the body builder how much CARRY a hauler actually gets rather than
  // re-deriving it here. The copy this replaces divided by 200 while the body
  // pattern costs 150, so every remote was credited a quarter less carry than it
  // has and over-hauled to match.
  const carryPerHauler = Math.max(
    1,
    buildRemoteHaulerBody(bodyBudget(room, "capacity")).filter((p) => p === CARRY).length
  );

  let total = 0;
  for (const remote of activeRooms) {
    const sourceCount = remote.sources.length;
    const dist = estimateRemoteDistance(room, remote.roomName);
    const requiredCarry =
      (HAULER_SPAWN.SOURCE_OUTPUT * 2 * dist * sourceCount) / HAULER_SPAWN.CARRY_CAPACITY;
    total += Math.min(
      MAX_REMOTE_HAULERS_PER_ROOM,
      Math.max(1, Math.ceil(requiredCarry / carryPerHauler))
    );
  }
  return total;
}


function shouldSpawnRemoteHauler(room: Room): boolean {
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

function spawnRemoteHauler(room: Room, spawn: StructureSpawn): boolean {
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

  let targetRoomName = activeRooms[0].roomName;
  let minHaulers = Infinity;
  for (const remote of activeRooms) {
    const count = haulersByRoom[remote.roomName] ?? 0;
    if (count < minHaulers) {
      minHaulers = count;
      targetRoomName = remote.roomName;
    }
  }

  // Remotes have no roads, so a 2:1 CARRY:MOVE body crawls at half speed.
  const allowedEnergy = bodyBudget(room, "available");
  const body = buildRemoteHaulerBody(allowedEnergy);
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

function buildRemoteHaulerBody(availableEnergy: number): BodyPartConstant[] {
  const pattern: BodyPartConstant[] = [CARRY, MOVE];
  const patternCost = calculateBodyPartCost(pattern);
  const maxByParts = Math.floor(MAX_BODY_PART_COUNT / pattern.length);
  const maxByEnergy = Math.floor(availableEnergy / patternCost);
  const repeats = Math.max(2, Math.min(maxByParts, maxByEnergy));
  const body: BodyPartConstant[] = [];
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

function shouldSpawnReserver(room: Room): boolean {
  return findReserverTarget(room) !== null;
}

// One CLAIM only holds a reservation steady; each extra CLAIM builds it by a
// tick per tick. MOVE matches CLAIM because remotes have no roads.
export function buildReserverBody(capacity: number): BodyPartConstant[] {
  const pairCost = BODYPART_COST[CLAIM] + BODYPART_COST[MOVE];
  const pairs = Math.max(1, Math.min(MAX_RESERVER_CLAIM, Math.floor(capacity / pairCost)));
  return [...Array(pairs).fill(CLAIM), ...Array(pairs).fill(MOVE)] as BodyPartConstant[];
}

function spawnReserver(room: Room, spawn: StructureSpawn): boolean {
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

const BOOST_CANDIDATES: Record<string, string[]> = {
  melee:   ['XUH2O', 'UH2O', 'UH'],
  ranged:  ['XKHO2', 'KHO2', 'KO'],
  healer:  ['XLHO2', 'LHO2', 'LO'],
  drainer: ['XLHO2', 'LHO2', 'LO'],
  siege:   ['XZH2O', 'ZH2O', 'ZH'],
  tough:   ['XGHO2', 'GHO2', 'GO'],
  move:    ['XZHO2', 'ZHO2', 'ZO'],
  upgrader: ['XGH2O', 'GH2O', 'GH'],
};

function pickBoostCompound(room: Room, roleKey: string, boostParts: number): string | undefined {
  const candidates = BOOST_CANDIDATES[roleKey];
  if (!candidates) return undefined;
  const minRequired = boostParts * 30 + 300;
  for (const compound of candidates) {
    if (getStockForCompound(compound, room) >= minRequired) return compound;
  }
  return undefined;
}

function buildBoostQueue(
  room: Room,
  roleKey: string,
  primaryParts: number,
  toughParts: number,
  moveParts = 0
): string[] {
  const queue: string[] = [];
  const primary = pickBoostCompound(room, roleKey, primaryParts);
  if (primary) queue.push(primary);
  if (toughParts > 0) {
    const tough = pickBoostCompound(room, "tough", toughParts);
    if (tough) queue.push(tough);
  }
  if (moveParts > 0) {
    const move = pickBoostCompound(room, "move", moveParts);
    if (move) queue.push(move);
  }
  return queue;
}

function boostMemory(queue: string[]): { boostCompound?: string; boostQueue?: string[] } {
  if (queue.length === 0) return {};
  return {
    boostCompound: queue[0],
    ...(queue.length > 1 ? { boostQueue: queue.slice(1) } : {}),
  };
}

// Damage eats body parts left to right. TOUGH soaks first, then the damage
// parts (ATTACK / RANGED_ATTACK / WORK), then MOVE, then HEAL. Losing MOVE
// early leaves a hurt creep unable to chase, kite or fall back to its healers,
// and a stranded creep is lost with every part it has left; keeping MOVE and
// HEAL to the end lets it limp home and heal.
// One MOVE per other part so a knight keeps full speed off-road: remote
// defence and offensive squads rarely have roads under them.
export function buildKnightBody(availableEnergy: number): BodyPartConstant[] {
  const groupCost = BODYPART_COST[TOUGH] + BODYPART_COST[ATTACK] + 2 * BODYPART_COST[MOVE];
  const maxGroups = Math.min(
    Math.floor(MAX_BODY_PART_COUNT / 4),
    Math.floor(availableEnergy / groupCost)
  );
  const groups = Math.max(1, maxGroups);
  return [
    ...Array(groups).fill(TOUGH),
    ...Array(groups).fill(ATTACK),
    ...Array(groups * 2).fill(MOVE),
  ] as BodyPartConstant[];
}

export function buildWizardBody(availableEnergy: number): BodyPartConstant[] {
  const pairCost = BODYPART_COST[MOVE] + BODYPART_COST[RANGED_ATTACK];
  const maxPairs = Math.min(
    Math.floor(MAX_BODY_PART_COUNT / 2),
    Math.floor(availableEnergy / pairCost)
  );
  const pairs = Math.max(1, maxPairs);
  return [
    ...Array(pairs).fill(RANGED_ATTACK),
    ...Array(pairs).fill(MOVE),
  ] as BodyPartConstant[];
}

export function buildClericBody(availableEnergy: number): BodyPartConstant[] {
  const pairCost = BODYPART_COST[HEAL] + BODYPART_COST[MOVE];
  const maxPairs = Math.min(
    Math.floor(MAX_BODY_PART_COUNT / 2),
    Math.floor(availableEnergy / pairCost)
  );
  const pairs = Math.max(1, maxPairs);
  return [
    ...Array(pairs).fill(MOVE),
    ...Array(pairs).fill(HEAL),
  ] as BodyPartConstant[];
}

export function buildDrainerBody(availableEnergy: number): BodyPartConstant[] {
  const groupCost = BODYPART_COST[TOUGH] + BODYPART_COST[HEAL] + 2 * BODYPART_COST[MOVE];
  const maxGroups = Math.min(
    Math.floor(MAX_BODY_PART_COUNT / 4),
    Math.floor(availableEnergy / groupCost)
  );
  const groups = Math.max(1, maxGroups);
  return [
    ...Array(groups).fill(TOUGH),
    ...Array(groups * 2).fill(MOVE),
    ...Array(groups).fill(HEAL),
  ] as BodyPartConstant[];
}

export function buildSiegerBody(availableEnergy: number): BodyPartConstant[] {
  const groupCost = BODYPART_COST[TOUGH] + 2 * BODYPART_COST[WORK] + 3 * BODYPART_COST[MOVE];
  const maxGroups = Math.min(
    Math.floor(MAX_BODY_PART_COUNT / 6),
    Math.floor(availableEnergy / groupCost)
  );
  const groups = Math.max(1, maxGroups);
  return [
    ...Array(groups).fill(TOUGH),
    ...Array(groups * 2).fill(WORK),
    ...Array(groups * 3).fill(MOVE),
  ] as BodyPartConstant[];
}

function countDefendersInRoom(role: string, room: Room): number {
  const present = getCreepsByRoleInRoom(role, room).filter(
    (c) => !c.spawning && !c.memory.offensiveTarget
  ).length;
  return present + getRoomSpawningCount(room, role);
}

// The hostiles are through when nothing can shoot them (no tower with energy)
// or a spawn or tower is already taking hits. Until then the towers and
// ramparts are buying time for a full-size defender.
function isBreached(room: Room): boolean {
  const core = room.find(FIND_MY_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_TOWER,
  }) as (StructureSpawn | StructureTower)[];
  const armed = core.some(
    (s) => s.structureType === STRUCTURE_TOWER && s.store[RESOURCE_ENERGY] >= TOWER_ENERGY_COST
  );
  return !armed || core.some((s) => s.hits < s.hitsMax);
}

// Towers that will kill the hostiles on their own need no creeps beside them.
function homeNeedsDefenders(room: Room): boolean {
  return !towersCanHold(room, getThreatInfo(room).hostiles);
}

// Full-size knights it takes to beat the hostiles here, towers aside.
function homeKnightsNeeded(room: Room, cap: number): number {
  const body = buildKnightBody(bodyBudget(room, "capacity"));
  return meleeDefendersToWin(summarizeHostiles(getThreatInfo(room).hostiles), body, cap);
}

// Wait for a full-energy body while the towers and ramparts hold; a breached
// room takes whatever the spawn can build right now.
function waitForDefenderBody(room: Room, key: string, needed: boolean): boolean {
  return waitForFullBody(room, key, needed && !isBreached(room));
}

const HOME_KNIGHT_CAP = 3;

function shouldSpawnKnight(room: Room, threatScore: number): boolean {
  const target = Math.max(Math.ceil(threatScore / 40), homeKnightsNeeded(room, HOME_KNIGHT_CAP));
  const needed =
    homeNeedsDefenders(room) &&
    countDefendersInRoom(ROLE_KNIGHT, room) < Math.min(HOME_KNIGHT_CAP, target);
  if (waitForDefenderBody(room, ROLE_KNIGHT, needed)) return false;
  return needed;
}

function spawnKnight(room: Room, spawn: StructureSpawn): boolean {
  const allowedEnergy = bodyBudget(room, "available");
  const body = buildKnightBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const attackParts = body.filter((p) => p === ATTACK).length;
  const toughParts = body.filter((p) => p === TOUGH).length;
  const moveParts = body.filter((p) => p === MOVE).length;
  const queue = buildBoostQueue(room, 'melee', attackParts, toughParts, moveParts);
  const res = trackedSpawn(room, spawn, body, `${ROLE_KNIGHT}${Game.time}`, {
    memory: { role: ROLE_KNIGHT, ...boostMemory(queue) },
  });
  return res === OK;
}

function shouldSpawnWizard(room: Room, threatScore: number): boolean {
  const needed =
    homeNeedsDefenders(room) &&
    countDefendersInRoom(ROLE_WIZARD, room) < Math.min(2, Math.ceil(threatScore / 60));
  if (waitForDefenderBody(room, ROLE_WIZARD, needed)) return false;
  return needed;
}

function spawnWizard(room: Room, spawn: StructureSpawn): boolean {
  const allowedEnergy = bodyBudget(room, "available");
  const body = buildWizardBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const rangedParts = body.filter((p) => p === RANGED_ATTACK).length;
  const queue = buildBoostQueue(room, 'ranged', rangedParts, 0);
  const res = trackedSpawn(room, spawn, body, `${ROLE_WIZARD}${Game.time}`, {
    memory: { role: ROLE_WIZARD, ...boostMemory(queue) },
  });
  return res === OK;
}

function shouldSpawnCleric(room: Room, threatScore: number): boolean {
  if (threatScore < 100) return false;
  const fighters =
    countDefendersInRoom(ROLE_KNIGHT, room) + countDefendersInRoom(ROLE_WIZARD, room);
  if (fighters === 0) return false;
  const needed = homeNeedsDefenders(room) && countDefendersInRoom(ROLE_CLERIC, room) < 1;
  if (waitForDefenderBody(room, ROLE_CLERIC, needed)) return false;
  return needed;
}

function spawnCleric(room: Room, spawn: StructureSpawn): boolean {
  const allowedEnergy = bodyBudget(room, "available");
  const body = buildClericBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const healParts = body.filter((p) => p === HEAL).length;
  const queue = buildBoostQueue(room, 'healer', healParts, 0);
  const res = trackedSpawn(room, spawn, body, `${ROLE_CLERIC}${Game.time}`, {
    memory: { role: ROLE_CLERIC, ...boostMemory(queue) },
  });
  return res === OK;
}

function shouldSpawnConqueror(): boolean {
  const exp = Memory.expansion;
  if (!exp || exp.phase !== "claiming") return false;
  return !getCreepsByRole(ROLE_CONQUEROR).some(
    (c) => c.memory.targetRoom === exp.roomName
  );
}

function spawnConqueror(room: Room, spawn: StructureSpawn): boolean {
  const exp = Memory.expansion;
  if (!exp) return false;
  const body: BodyPartConstant[] = [CLAIM, MOVE, MOVE, MOVE, MOVE];
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const res = trackedSpawn(room, spawn, body, `${ROLE_CONQUEROR}${Game.time}`, {
    memory: {
      role: ROLE_CONQUEROR,
      homeRoom: room.name,
      targetRoom: exp.roomName,
    },
  });
  return res === OK;
}

// Spawn the next unclaimer this long before the controller accepts another
// attack, to cover spawning and the walk over.
const UNCLAIMER_LEAD = 400;

export function findUnclaimTarget(room: Room): string | null {
  const targets = Memory.unclaimTargets;
  if (!targets) return null;
  for (const name in targets) {
    const t = targets[name];
    if (t.until <= Game.time) {
      delete targets[name];
      continue;
    }
    if (t.homeRoom !== room.name) continue;
    if ((t.blockedUntil ?? 0) - UNCLAIMER_LEAD > Game.time) continue;
    if (getCreepsByRole(ROLE_UNCLAIMER).some((c) => c.memory.targetRoom === name)) continue;
    return name;
  }
  return null;
}

export function buildUnclaimerBody(capacity: number): BodyPartConstant[] {
  const pairCost = BODYPART_COST[CLAIM] + BODYPART_COST[MOVE];
  const pairs = Math.max(1, Math.min(Math.floor(MAX_BODY_PART_COUNT / 2), Math.floor(capacity / pairCost)));
  return [...Array(pairs).fill(CLAIM), ...Array(pairs).fill(MOVE)] as BodyPartConstant[];
}

function spawnUnclaimer(room: Room, spawn: StructureSpawn): boolean {
  const target = findUnclaimTarget(room);
  if (!target) return false;
  const body = buildUnclaimerBody(room.energyCapacityAvailable);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const res = trackedSpawn(room, spawn, body, `${ROLE_UNCLAIMER}${Game.time}`, {
    memory: { role: ROLE_UNCLAIMER, homeRoom: room.name, targetRoom: target },
  });
  return res === OK;
}

const MAX_SETTLERS = 3;

function shouldSpawnSettler(room: Room): boolean {
  const exp = Memory.expansion;
  if (!exp || exp.phase !== "bootstrapping" || exp.homeRoom !== room.name) return false;

  if (exp.pausedUntil && exp.pausedUntil > Game.time) return false;

  const settlers = getCreepsByRole(ROLE_SETTLER).filter(
    (c) => c.memory.targetRoom === exp.roomName
  );
  return settlers.length < MAX_SETTLERS;
}

function spawnSettler(room: Room, spawn: StructureSpawn): boolean {
  const exp = Memory.expansion;
  if (!exp) return false;
  const allowedEnergy = bodyBudget(room, "available");
  const body = buildScaledBody(ROLE_SETTLER, allowedEnergy);
  const res = trackedSpawn(room, spawn, body, `${ROLE_SETTLER}${Game.time}`, {
    memory: {
      role: ROLE_SETTLER,
      homeRoom: room.name,
      targetRoom: exp.roomName,
    },
  });
  return res === OK;
}

function getOffensiveSquadMembers(op: MilitaryOp): Creep[] {
  return Object.values(Game.creeps).filter(
    (c) => c.memory.offensiveTarget === op.targetRoom && c.memory.homeRoom === op.homeRoom
  );
}

function getOffensiveOpForRoom(room: Room): MilitaryOp | undefined {
  return Memory.militaryOps?.[room.name];
}

function shouldSpawnOffensiveCreep(room: Room): boolean {
  const op = getOffensiveOpForRoom(room);
  if (!op || op.phase !== "forming") return false;
  const members = getOffensiveSquadMembers(op);
  return (
    members.filter((c) => c.memory.role === ROLE_KNIGHT).length < op.requiredMelee ||
    members.filter((c) => c.memory.role === ROLE_WIZARD).length < op.requiredRanged ||
    members.filter((c) => c.memory.role === ROLE_CLERIC).length < op.requiredHealers ||
    members.filter((c) => c.memory.role === ROLE_SIEGER).length < (op.requiredSiege ?? 0) ||
    members.filter((c) => c.memory.role === ROLE_DRAINER).length < (op.requiredDrainers ?? 0)
  );
}

function countDrainLeeches(targetRoom: string, homeRoom: string): number {
  return Object.values(Game.creeps).filter(
    (c) =>
      c.memory.role === ROLE_DRAINER &&
      c.memory.offensiveTarget === targetRoom &&
      c.memory.homeRoom === homeRoom
  ).length;
}

function firstUnderStrengthDrain(room: Room): DrainOp | null {
  for (const op of getDrainOpsForHome(room.name)) {
    if (countDrainLeeches(op.targetRoom, op.homeRoom) < op.drainers) return op;
  }
  return null;
}

function shouldSpawnDrainLeech(room: Room): boolean {
  return firstUnderStrengthDrain(room) !== null;
}

function spawnDrainLeech(room: Room, spawn: StructureSpawn): boolean {
  const op = firstUnderStrengthDrain(room);
  if (!op) return false;

  const body = buildDrainerBody(room.energyCapacityAvailable);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;

  const healParts = body.filter((p) => p === HEAL).length;
  const toughParts = body.filter((p) => p === TOUGH).length;
  const queue = buildBoostQueue(room, "drainer", healParts, toughParts);

  const res = trackedSpawn(room, spawn, body, `${ROLE_DRAINER}_drain${Game.time}`, {
    memory: {
      role: ROLE_DRAINER,
      homeRoom: room.name,
      offensiveTarget: op.targetRoom,
      ...boostMemory(queue),
    },
  });
  if (res === OK) console.log(`[Drain] Spawning ${ROLE_DRAINER}: ${room.name} -> ${op.targetRoom}`);
  return res === OK;
}

function spawnNextOffensiveCreep(room: Room, spawn: StructureSpawn): boolean {
  const op = getOffensiveOpForRoom(room);
  if (!op) return false;

  const members = getOffensiveSquadMembers(op);
  const melee = members.filter((c) => c.memory.role === ROLE_KNIGHT).length;
  const ranged = members.filter((c) => c.memory.role === ROLE_WIZARD).length;
  const healers = members.filter((c) => c.memory.role === ROLE_CLERIC).length;
  const siege = members.filter((c) => c.memory.role === ROLE_SIEGER).length;
  const drainers = members.filter((c) => c.memory.role === ROLE_DRAINER).length;

  let roleToSpawn: string | null = null;
  if (melee < op.requiredMelee) roleToSpawn = ROLE_KNIGHT;
  else if (drainers < (op.requiredDrainers ?? 0)) roleToSpawn = ROLE_DRAINER;
  else if (siege < (op.requiredSiege ?? 0)) roleToSpawn = ROLE_SIEGER;
  else if (ranged < op.requiredRanged) roleToSpawn = ROLE_WIZARD;
  else if (healers < op.requiredHealers) roleToSpawn = ROLE_CLERIC;
  if (!roleToSpawn) return false;

  const energy = room.energyCapacityAvailable;
  let body: BodyPartConstant[];
  let boostKey: string;
  let combatPartType: BodyPartConstant;

  if (roleToSpawn === ROLE_KNIGHT) {
    body = buildKnightBody(energy);
    boostKey = "melee";
    combatPartType = ATTACK;
  } else if (roleToSpawn === ROLE_SIEGER) {
    body = buildSiegerBody(energy);
    boostKey = "siege";
    combatPartType = WORK;
  } else if (roleToSpawn === ROLE_WIZARD) {
    body = buildWizardBody(energy);
    boostKey = "ranged";
    combatPartType = RANGED_ATTACK;
  } else if (roleToSpawn === ROLE_DRAINER) {
    body = buildDrainerBody(energy);
    boostKey = "drainer";
    combatPartType = HEAL;
  } else {
    body = buildClericBody(energy);
    boostKey = "healer";
    combatPartType = HEAL;
  }

  if (room.energyAvailable < calculateBodyPartCost(body)) return false;

  const combatParts = body.filter((p) => p === combatPartType).length;
  const toughParts = body.filter((p) => p === TOUGH).length;
  const moveParts =
    boostKey === "melee" || boostKey === "siege"
      ? body.filter((p) => p === MOVE).length
      : 0;
  const queue = buildBoostQueue(room, boostKey, combatParts, toughParts, moveParts);

  const res = trackedSpawn(room, spawn, body, `${roleToSpawn}_off${Game.time}`, {
    memory: {
      role: roleToSpawn,
      homeRoom: room.name,
      offensiveTarget: op.targetRoom,
      ...boostMemory(queue),
    },
  });
  if (res === OK) {
    console.log(`[Military] Spawning offensive ${roleToSpawn} for ${op.targetRoom}`);
  }
  return res === OK;
}

function countDefendersByRole(targetRoom: string, role: string, homeRoom: Room): number {
  const live = getDefenders(targetRoom).filter(
    (c) => !c.spawning && c.memory.role === role
  ).length;
  return live + getRoomSpawningCount(homeRoom, role);
}

function needsChildRoomDefender(room: Room): boolean {
  const exp = Memory.expansion;
  if (!exp?.needsDefender || exp.homeRoom !== room.name) return false;
  const existing = getCreepsByRole(ROLE_KNIGHT).filter(
    (c) => c.memory.targetRoom === exp.roomName && c.memory.homeRoom === room.name
  );
  return existing.length === 0;
}

const DEFENSE_OP_KNIGHT_CAP = 6;

// The op's score-based count, raised to what it takes to beat the hostiles'
// healing and hit points.
function requiredOpMelee(room: Room, op: DefenseOp): number {
  return Math.max(op.requiredMelee, homeKnightsNeeded(room, DEFENSE_OP_KNIGHT_CAP));
}

const DEFENSE_OP_BODY_WAIT = "defenseOp";

function shouldSpawnDefender(room: Room): boolean {
  if (needsChildRoomDefender(room)) return true;

  const op = getDefenseOp(room.name);
  if (!op) return false;
  const short =
    countDefendersByRole(room.name, ROLE_KNIGHT, room) < requiredOpMelee(room, op) ||
    countDefendersByRole(room.name, ROLE_WIZARD, room) < op.requiredRanged ||
    countDefendersByRole(room.name, ROLE_CLERIC, room) < op.requiredHealers;
  if (waitForDefenderBody(room, DEFENSE_OP_BODY_WAIT, short)) return false;
  return short;
}

function spawnNextDefender(room: Room, spawn: StructureSpawn): boolean {
  if (needsChildRoomDefender(room)) {
    return spawnChildRoomDefender(room, spawn);
  }

  const op = getDefenseOp(room.name);
  if (!op) return false;

  let roleToSpawn: string | null = null;
  let combatPartType: BodyPartConstant = ATTACK;
  let boostKey = "melee";
  let body: BodyPartConstant[];

  // shouldSpawnDefender already waited for a full body unless the room is breached.
  const allowedEnergy = bodyBudget(room, "available");

  if (countDefendersByRole(room.name, ROLE_KNIGHT, room) < requiredOpMelee(room, op)) {
    roleToSpawn = ROLE_KNIGHT;
    combatPartType = ATTACK;
    boostKey = "melee";
    body = buildKnightBody(allowedEnergy);
  } else if (countDefendersByRole(room.name, ROLE_WIZARD, room) < op.requiredRanged) {
    roleToSpawn = ROLE_WIZARD;
    combatPartType = RANGED_ATTACK;
    boostKey = "ranged";
    body = buildWizardBody(allowedEnergy);
  } else if (countDefendersByRole(room.name, ROLE_CLERIC, room) < op.requiredHealers) {
    roleToSpawn = ROLE_CLERIC;
    combatPartType = HEAL;
    boostKey = "healer";
    body = buildClericBody(allowedEnergy);
  } else {
    return false;
  }

  if (room.energyAvailable < calculateBodyPartCost(body)) return false;

  const combatParts = body.filter((p) => p === combatPartType).length;
  const toughParts = body.filter((p) => p === TOUGH).length;
  const moveParts = boostKey === "melee" ? body.filter((p) => p === MOVE).length : 0;
  const queue = buildBoostQueue(room, boostKey, combatParts, toughParts, moveParts);
  const res = trackedSpawn(room, spawn, body, `${roleToSpawn}_def${Game.time}`, {
    memory: {
      role: roleToSpawn,
      homeRoom: room.name,
      defensiveTarget: room.name,
      ...boostMemory(queue),
    },
  });
  if (res === OK) {
    console.log(`[Defense] Spawning defensive ${roleToSpawn} for ${room.name}`);
  }
  return res === OK;
}

function spawnChildRoomDefender(room: Room, spawn: StructureSpawn): boolean {
  const exp = Memory.expansion;
  if (!exp) return false;
  const allowedEnergy = bodyBudget(room, "available");
  const body = buildKnightBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const attackParts = body.filter((p) => p === ATTACK).length;
  const toughParts = body.filter((p) => p === TOUGH).length;
  const moveParts = body.filter((p) => p === MOVE).length;
  const queue = buildBoostQueue(room, "melee", attackParts, toughParts, moveParts);
  const res = trackedSpawn(room, spawn, body, `${ROLE_KNIGHT}_child${Game.time}`, {
    memory: {
      role: ROLE_KNIGHT,
      homeRoom: room.name,
      targetRoom: exp.roomName,
      ...boostMemory(queue),
    },
  });
  if (res === OK) {
    console.log(`[Defense] Spawning child-room defender for ${exp.roomName}`);
  }
  return res === OK;
}

const REMOTE_KNIGHT_CAP = 2;

// One knight unless the last look at the remote showed a force (healers, a
// group, a 100k-hit core) that one full-size knight cannot beat in good time.
function remoteKnightsNeeded(room: Room, remote: RemoteRoomData): number {
  if (!remote.invaderStrength) return 1;
  const body = buildKnightBody(bodyBudget(room, "capacity"));
  return meleeDefendersToWin(remote.invaderStrength, body, REMOTE_KNIGHT_CAP);
}

function findRemoteInvaderTarget(room: Room): string | null {
  const remotes = room.memory.remoteRooms;
  if (!remotes) return null;
  for (const r of remotes) {
    if (r.invaderUntil === undefined || r.invaderUntil <= Game.time) continue;
    const defending = getCreepsByRole(ROLE_KNIGHT).filter(
      (c) => c.memory.homeRoom === room.name && c.memory.targetRoom === r.roomName
    ).length;
    if (defending < remoteKnightsNeeded(room, r)) return r.roomName;
  }
  return null;
}

const REMOTE_DEFENDER_BODY_WAIT = "remoteDefender";

// Nothing at home is at stake, so the defender always waits for a full body.
function shouldSpawnRemoteDefender(room: Room): boolean {
  const needed = findRemoteInvaderTarget(room) !== null;
  if (waitForFullBody(room, REMOTE_DEFENDER_BODY_WAIT, needed)) return false;
  return needed;
}

function spawnRemoteDefender(room: Room, spawn: StructureSpawn): boolean {
  const target = findRemoteInvaderTarget(room);
  if (!target) return false;
  const allowedEnergy = bodyBudget(room, "available");
  const body = buildKnightBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const attackParts = body.filter((p) => p === ATTACK).length;
  const toughParts = body.filter((p) => p === TOUGH).length;
  const moveParts = body.filter((p) => p === MOVE).length;
  const queue = buildBoostQueue(room, "melee", attackParts, toughParts, moveParts);
  const res = trackedSpawn(room, spawn, body, `${ROLE_KNIGHT}_remote${Game.time}`, {
    memory: {
      role: ROLE_KNIGHT,
      homeRoom: room.name,
      targetRoom: target,
      ...boostMemory(queue),
    },
  });
  if (res === OK) console.log(`[Defense] Spawning remote defender for ${target}`);
  return res === OK;
}

// Cracking ops are included so a member lost mid-fight gets replaced. A home
// that cannot build the full healer body cannot field a squad at all.
function getPowerSquadForRoom(room: Room): PowerBankOp | undefined {
  if (room.energyCapacityAvailable < calculateBodyPartCost(buildPowerHealerBody())) return undefined;
  return Memory.powerOps?.find(
    (o) => o.homeRoom === room.name && (o.phase === "forming" || o.phase === "cracking")
  );
}

function getPowerSquadMembersById(opId: number): Creep[] {
  const result: Creep[] = [];
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.memory.powerOpId === opId) result.push(c);
  }
  return result;
}

function shouldSpawnPowerCreep(room: Room): boolean {
  const op = getPowerSquadForRoom(room);
  if (!op) return false;
  const members = getPowerSquadMembersById(op.id);
  return (
    members.filter((c) => c.memory.role === ROLE_POWER_ATTACKER).length < op.requiredAttackers ||
    members.filter((c) => c.memory.role === ROLE_POWER_HEALER).length < op.requiredHealers ||
    members.filter((c) => c.memory.role === ROLE_POWER_CARRIER).length < op.requiredCarriers
  );
}

function spawnNextPowerCreep(room: Room, spawn: StructureSpawn): boolean {
  const op = getPowerSquadForRoom(room);
  if (!op) return false;

  const members = getPowerSquadMembersById(op.id);
  const attackers = members.filter((c) => c.memory.role === ROLE_POWER_ATTACKER).length;
  const healers = members.filter((c) => c.memory.role === ROLE_POWER_HEALER).length;
  const carriers = members.filter((c) => c.memory.role === ROLE_POWER_CARRIER).length;

  let roleToSpawn: string | null = null;
  if (attackers < op.requiredAttackers) roleToSpawn = ROLE_POWER_ATTACKER;
  else if (healers < op.requiredHealers) roleToSpawn = ROLE_POWER_HEALER;
  else if (carriers < op.requiredCarriers) roleToSpawn = ROLE_POWER_CARRIER;
  if (!roleToSpawn) return false;

  let body: BodyPartConstant[];
  if (roleToSpawn === ROLE_POWER_ATTACKER) {
    body = buildPowerAttackerBody();
  } else if (roleToSpawn === ROLE_POWER_HEALER) {
    body = buildPowerHealerBody();
  } else {
    body = buildPowerCarrierBody();
  }

  if (room.energyAvailable < calculateBodyPartCost(body)) return false;

  const res = trackedSpawn(room, spawn, body, `${roleToSpawn}${Game.time}`, {
    memory: {
      role: roleToSpawn,
      homeRoom: room.name,
      powerOpId: op.id,
    },
  });
  if (res === OK) {
    console.log(`[Power] Spawning ${roleToSpawn} for op #${op.id} -> ${op.roomName}`);
  }
  return res === OK;
}

// Unboosted TOUGH is only hit points the healers already cover, while ATTACK is
// what cracks the bank; a 2:1 body also crawls there off-road. So: all ATTACK,
// one MOVE each.
export function buildPowerAttackerBody(): BodyPartConstant[] {
  return [
    ...Array(25).fill(ATTACK),
    ...Array(25).fill(MOVE),
  ] as BodyPartConstant[];
}

function buildPowerHealerBody(): BodyPartConstant[] {
  return [
    ...Array(25).fill(MOVE),
    ...Array(25).fill(HEAL),
  ] as BodyPartConstant[];
}

function buildPowerCarrierBody(): BodyPartConstant[] {
  return [
    ...Array(25).fill(CARRY),
    ...Array(25).fill(MOVE),
  ] as BodyPartConstant[];
}

function getDepositOpForRoom(room: Room): DepositOp | undefined {
  return Memory.depositOps?.find((o) => o.homeRoom === room.name && o.phase === "mining");
}

function getDepositMembersById(opId: number): Creep[] {
  const result: Creep[] = [];
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.memory.depositOpId === opId) result.push(c);
  }
  return result;
}

function shouldSpawnDepositCreep(room: Room): boolean {
  const op = getDepositOpForRoom(room);
  if (!op) return false;
  const members = getDepositMembersById(op.id);
  return (
    members.filter((c) => c.memory.role === ROLE_DEPOSIT_MINER).length < op.requiredMiners ||
    members.filter((c) => c.memory.role === ROLE_DEPOSIT_HAULER).length < op.requiredHaulers
  );
}

function spawnNextDepositCreep(room: Room, spawn: StructureSpawn): boolean {
  const op = getDepositOpForRoom(room);
  if (!op) return false;

  const members = getDepositMembersById(op.id);
  const miners = members.filter((c) => c.memory.role === ROLE_DEPOSIT_MINER).length;
  const haulers = members.filter((c) => c.memory.role === ROLE_DEPOSIT_HAULER).length;

  let roleToSpawn: string;
  let body: BodyPartConstant[];
  const energy = room.energyCapacityAvailable;
  if (miners < op.requiredMiners) {
    roleToSpawn = ROLE_DEPOSIT_MINER;
    body = buildDepositMinerBody(energy);
  } else if (haulers < op.requiredHaulers) {
    roleToSpawn = ROLE_DEPOSIT_HAULER;
    body = buildRemoteHaulerBody(bodyBudget(room, "capacity"));
  } else {
    return false;
  }

  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const res = trackedSpawn(room, spawn, body, `${roleToSpawn}${Game.time}`, {
    memory: { role: roleToSpawn, homeRoom: room.name, depositOpId: op.id },
  });
  if (res === OK) {
    console.log(`[Deposit] Spawning ${roleToSpawn} for op #${op.id} -> ${op.roomName}`);
  }
  return res === OK;
}

function buildDepositMinerBody(availableEnergy: number): BodyPartConstant[] {
  const group: BodyPartConstant[] = [WORK, WORK, CARRY, MOVE, MOVE];
  const groupCost = calculateBodyPartCost(group);
  const maxGroups = Math.min(
    Math.floor(MAX_BODY_PART_COUNT / group.length),
    Math.floor(availableEnergy / groupCost)
  );
  const groups = Math.max(1, maxGroups);
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < groups; i++) body.push(...group);
  return body;
}

function spawnSkCreeps(room: Room, spawn: StructureSpawn): boolean {
  const ops = (Memory.skOps ?? []).filter(
    (o) => o.homeRoom === room.name && !isOpPaused(o)
  );
  for (const op of ops) {
    const members = getSkMembers(op.id);
    const guardians = members.filter((c) => c.memory.role === ROLE_SK_GUARDIAN).length;
    if (guardians < 1) return spawnSkGuardian(room, spawn, op);

    if (!op.discovered || op.sourceIds.length === 0) continue;

    const need = op.sourceIds.length;
    const miners = members.filter((c) => c.memory.role === ROLE_SK_MINER);
    const taken = new Set(miners.map((m) => m.memory.skSourceId));
    const freeSource = op.sourceIds.find((id) => !taken.has(id));
    if (miners.length < need && freeSource) return spawnSkMiner(room, spawn, op, freeSource);

    const haulers = members.filter((c) => c.memory.role === ROLE_SK_HAULER).length;
    if (haulers < need) return spawnSkHauler(room, spawn, op);
  }
  return false;
}

export function buildSkGuardianBody(availableEnergy: number): BodyPartConstant[] {
  const groupCost = BODYPART_COST[RANGED_ATTACK] + BODYPART_COST[HEAL] + 2 * BODYPART_COST[MOVE];
  const maxGroups = Math.min(
    Math.floor(MAX_BODY_PART_COUNT / 4),
    Math.floor(availableEnergy / groupCost)
  );
  const groups = Math.max(5, maxGroups);
  return [
    ...Array(groups).fill(RANGED_ATTACK),
    ...Array(groups * 2).fill(MOVE),
    ...Array(groups).fill(HEAL),
  ] as BodyPartConstant[];
}

function spawnSkGuardian(room: Room, spawn: StructureSpawn, op: SourceKeeperOp): boolean {
  const body = buildSkGuardianBody(room.energyCapacityAvailable);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const healParts = body.filter((p) => p === HEAL).length;
  const queue = buildBoostQueue(room, "healer", healParts, 0);
  const res = trackedSpawn(room, spawn, body, `${ROLE_SK_GUARDIAN}${Game.time}`, {
    memory: { role: ROLE_SK_GUARDIAN, homeRoom: room.name, skOpId: op.id, ...boostMemory(queue) },
  });
  if (res === OK) console.log(`[SK] Spawning guardian for ${op.roomName}`);
  return res === OK;
}

function buildSkMinerBody(availableEnergy: number): BodyPartConstant[] {
  const maxWork = 7;
  const workCost = BODYPART_COST[WORK];
  const moveCost = BODYPART_COST[MOVE];
  let work = Math.min(maxWork, Math.floor(availableEnergy / (workCost + moveCost / 2)));
  work = Math.max(3, work);
  const move = Math.max(2, Math.ceil(work / 2));
  return [...Array(work).fill(WORK), ...Array(move).fill(MOVE)] as BodyPartConstant[];
}

function spawnSkMiner(
  room: Room,
  spawn: StructureSpawn,
  op: SourceKeeperOp,
  sourceId: Id<Source>
): boolean {
  const body = buildSkMinerBody(room.energyCapacityAvailable);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const res = trackedSpawn(room, spawn, body, `${ROLE_SK_MINER}${Game.time}`, {
    memory: { role: ROLE_SK_MINER, homeRoom: room.name, skOpId: op.id, skSourceId: sourceId },
  });
  if (res === OK) console.log(`[SK] Spawning ${ROLE_SK_MINER} for ${op.roomName}`);
  return res === OK;
}

function spawnSkHauler(room: Room, spawn: StructureSpawn, op: SourceKeeperOp): boolean {
  const allowedEnergy = bodyBudget(room, "capacity");
  const body = buildRemoteHaulerBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const res = trackedSpawn(room, spawn, body, `${ROLE_SK_HAULER}${Game.time}`, {
    memory: { role: ROLE_SK_HAULER, homeRoom: room.name, skOpId: op.id },
  });
  if (res === OK) console.log(`[SK] Spawning packer for ${op.roomName}`);
  return res === OK;
}

function shouldSpawnApothecary(room: Room): boolean {
  if ((room.controller?.level ?? 0) < 6) return false;
  if (!room.memory.labSystem?.inputLabIds?.length) return false;
  return countByRoleInRoom(ROLE_APOTHECARY, room) < 1;
}

function spawnApothecary(room: Room, spawn: StructureSpawn): boolean {
  const allowedEnergy = bodyBudget(room, "available");
  const body = buildScaledBody(ROLE_APOTHECARY, allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const res = trackedSpawn(room, spawn, body, `${ROLE_APOTHECARY}${Game.time}`, {
    memory: { role: ROLE_APOTHECARY },
  });
  return res === OK;
}
