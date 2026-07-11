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
} from "../config/config.roles";
import { getThreatInfo, getThreatSeverity, refreshBlockade, isBlockaded } from "../services/services.combat";
import { getDefenseOp, getDefenders, getDrainOpsForHome } from "./orchestrator.military";
import { getSkMembers, isOpPaused } from "./orchestrator.sourcekeeper";
import { getStockForCompound } from "../services/services.labs";
import { getRampartTargetHP, isEnergyEmergency } from "../services/services.creep";

import {
  BODY_PATTERNS,
  MAX_BODY_PART_COUNT,
  SPAWN_ENERGY_RESERVE,
} from "../config/config.spawning";
import { getRoomMemory } from "../services/services.memory";
import { getSources } from "../services/services.creep";
import { getUnclaimedScoreTargetCount, getScoreScanRooms, scoreHunterSupported } from "./orchestrator.score";

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
  return spawningCache[room.name][role] ?? 0;
}

function countByRoleInRoom(role: string, room: Room): number {
  const present = getCreepsByRoleInRoom(role, room).filter((c) => !c.spawning).length;
  return present + getRoomSpawningCount(room, role);
}

function getMinerPopulationTarget(room: Room): number {
  return (room.memory.minerContainerIds ?? []).length;
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

const RCL8_SURPLUS_HIGH_WATER = 400_000;
const RCL8_ENERGY_PER_SURPLUS_UPGRADER = 100_000;
const RCL8_MAX_UPGRADERS = 4;
const RCL8_SURPLUS_MIN_BUCKET = 9000;

const CONTROLLER_DOWNGRADE_SAFETY = 5000;

function getUpgraderPopulationTarget(room: Room): number {
  const controller = room.controller;
  if (controller?.my && controller.ticksToDowngrade < CONTROLLER_DOWNGRADE_SAFETY) return 1;

  if (isEnergyEmergency(room)) return 0;

  const phase = getRoomPhase(room);
  const rcl = room.controller?.level ?? 0;

  if (rcl >= 8) {
    const storedEnergy = room.storage?.store[RESOURCE_ENERGY] ?? 0;
    const bucket = typeof Game.cpu.bucket === "number" ? Game.cpu.bucket : 0;
    if (storedEnergy <= RCL8_SURPLUS_HIGH_WATER || bucket < RCL8_SURPLUS_MIN_BUCKET) return 1;
    const surplus = storedEnergy - RCL8_SURPLUS_HIGH_WATER;
    return Math.min(
      RCL8_MAX_UPGRADERS,
      1 + Math.floor(surplus / RCL8_ENERGY_PER_SURPLUS_UPGRADER)
    );
  }

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

function processRoomSpawning(room: Room, spawn: StructureSpawn) {
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

  if (shouldSpawnMiner(room) && spawnMiner(room, spawn)) return;
  if (shouldSpawnHauler(room) && spawnHauler(room, spawn)) return;
  if (shouldSpawnFiller(room) && spawnFiller(room, spawn)) return;

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

  if (threatScore > 0 && phase !== "bootstrap") {
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
  const cache = containerDistanceCache[room.name];
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
  containerDistanceCache[room.name] = { distances, cachedAt: Game.time };
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
    Math.floor((room.energyCapacityAvailable * (1 - SPAWN_ENERGY_RESERVE)) / 150)
  );
  const carryPerIdealHauler = Math.max(1, idealRepeats * 2);

  const targetFromThroughput = Math.ceil(requiredCarry / carryPerIdealHauler);

  const desired = Math.min(
    HAULER_SPAWN.MAX_HAULERS,
    Math.max(minerContainerCount, targetFromThroughput)
  );

  const haulerCount = haulers.length + getRoomSpawningCount(room, ROLE_HAULER);
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

  const energyBasis = existingHaulers.length === 0
    ? room.energyAvailable
    : room.energyCapacityAvailable;
  const allowedEnergy = Math.floor(energyBasis * (1 - SPAWN_ENERGY_RESERVE));
  const body = buildScaledBody(ROLE_HAULER, allowedEnergy);
  const bodyCost = calculateBodyPartCost(body);

  if (room.energyAvailable < bodyCost) {
    const affordableEnergy = Math.floor(
      room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE)
    );
    const affordableBody = buildScaledBody(ROLE_HAULER, affordableEnergy);
    if (room.energyAvailable < calculateBodyPartCost(affordableBody)) {
      return existingHaulers.length > 0;
    }
    return spawn.spawnCreep(affordableBody, newName, {
      memory: { role: ROLE_HAULER, homeRoom: room.name },
    }) === OK;
  }

  const moveParts = body.filter((p) => p === MOVE).length;
  const queue =
    (room.controller?.level ?? 0) >= 7 ? buildBoostQueue(room, "hauler", moveParts, 0) : [];

  return spawn.spawnCreep(body, newName, {
    memory: { role: ROLE_HAULER, homeRoom: room.name, ...boostMemory(queue) },
  }) === OK;
}

function shouldSpawnMiner(room: Room): boolean {
  return countByRoleInRoom(ROLE_MINER, room) < getMinerPopulationTarget(room);
}

function shouldSpawnHarvester(room: Room): boolean {
  return countByRoleInRoom(ROLE_HARVESTER, room) < getHarvesterPopulationTarget(room);
}

function shouldSpawnUpgrader(room: Room): boolean {
  return countByRoleInRoom(ROLE_UPGRADER, room) < getUpgraderPopulationTarget(room);
}

function shouldSpawnBuilder(room: Room): boolean {
  return countByRoleInRoom(ROLE_BUILDER, room) < getBuilderPopulationTarget(room);
}

const repairerTargetCache: Record<string, { value: number; tick: number }> = {};

function getRepairerPopulationTarget(room: Room): number {
  if (isEnergyEmergency(room)) return 0;
  const cached = repairerTargetCache[room.name];
  if (cached && Game.time - cached.tick < 50) return cached.value;

  const critical = room.find(FIND_STRUCTURES, {
    filter: (s) => {
      if (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) return false;
      const st = s as AnyStructure;
      return "hits" in st && "hitsMax" in st && st.hits < st.hitsMax * 0.5;
    },
  });
  let value = Math.min(2, Math.ceil(critical.length / 5));

  const rcl = room.controller?.level ?? 0;
  if (rcl >= 2) {
    const hasEnergyBuffer =
      !room.storage || room.storage.store[RESOURCE_ENERGY] > 20_000;
    if (hasEnergyBuffer) {
      if (rcl >= 3) value = Math.max(value, 1);
      const wallTarget = getRampartTargetHP(rcl);
      const wallsNeedRepair = room.find(FIND_STRUCTURES, {
        filter: (s): s is AnyStructure =>
          (s.structureType === STRUCTURE_RAMPART || s.structureType === STRUCTURE_WALL) &&
          (s as AnyStructure).hits < wallTarget,
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
  return target > 0 && countByRoleInRoom(ROLE_REPAIRER, room) < target;
}

function getFillerPopulationTarget(room: Room): number {
  if (!room.storage) return 0;
  if (isEnergyEmergency(room)) return 0;
  return (room.controller?.level ?? 0) >= 7 ? 2 : 1;
}

function shouldSpawnFiller(room: Room): boolean {
  return countByRoleInRoom(ROLE_FILLER, room) < getFillerPopulationTarget(room);
}

function spawnFiller(room: Room, spawn: StructureSpawn): boolean {
  const energyBasis =
    countByRoleInRoom(ROLE_FILLER, room) === 0
      ? room.energyAvailable
      : room.energyCapacityAvailable;
  const allowedEnergy = Math.floor(energyBasis * (1 - SPAWN_ENERGY_RESERVE));
  const body = buildScaledBody(ROLE_FILLER, allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const res = spawn.spawnCreep(body, `${ROLE_FILLER}${Game.time}`, {
    memory: { role: ROLE_FILLER, homeRoom: room.name },
  });
  return res === OK;
}

function spawnEmergencyHarvester(room: Room, spawn: StructureSpawn): boolean {
  if (room.energyAvailable < 200) return false;
  const sets = Math.min(3, Math.floor(room.energyAvailable / 200));
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) body.push(WORK, CARRY, MOVE);
  const res = spawn.spawnCreep(body, `${ROLE_HARVESTER}_emrg${Game.time}`, {
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
  const allowedEnergy = Math.floor(
    room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE)
  );
  const body = buildScaledBody(ROLE_REPAIRER, allowedEnergy);
  const res = spawn.spawnCreep(body, newName, {
    memory: { role: ROLE_REPAIRER },
  });
  return res === OK;
}

function spawnMineralMiner(room: Room, spawn: StructureSpawn): boolean {
  const newName = `${ROLE_MINERAL_MINER}${Game.time}`;
  const allowedEnergy = Math.floor(
    room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE)
  );
  const body = buildMinerBody(allowedEnergy);
  const res = spawn.spawnCreep(body, newName, {
    memory: { role: ROLE_MINERAL_MINER },
  });
  return res === OK;
}

function spawnHarvester(room: Room, spawn: StructureSpawn): boolean {
  const newName = `${ROLE_HARVESTER}${Game.time}`;
  const allowedEnergy = Math.floor(
    room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE)
  );
  const body = buildScaledBody(ROLE_HARVESTER, allowedEnergy);
  const res = spawn.spawnCreep(body, newName, {
    memory: { role: ROLE_HARVESTER },
  });
  return res === OK;
}

function buildRcl8UpgraderBody(availableEnergy: number): BodyPartConstant[] {
  const group: BodyPartConstant[] = [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE];
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

function spawnUpgrader(room: Room, spawn: StructureSpawn): boolean {
  const newName = `${ROLE_UPGRADER}${Game.time}`;
  const rcl = room.controller?.level ?? 0;

  const allowedEnergy =
    rcl >= 8
      ? Math.floor(room.energyCapacityAvailable * (1 - SPAWN_ENERGY_RESERVE))
      : Math.floor(room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE));
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

  const res = spawn.spawnCreep(body, newName, {
    memory: { role: ROLE_UPGRADER, ...boostMemory(queue) },
  });
  return res === OK;
}

function spawnBuilder(room: Room, spawn: StructureSpawn): boolean {
  const newName = `${ROLE_BUILDER}${Game.time}`;
  const allowedEnergy = Math.floor(
    room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE)
  );
  const body = buildScaledBody(ROLE_BUILDER, allowedEnergy);
  const res = spawn.spawnCreep(body, newName, {
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

  const energyBasis =
    existingMiners === 0 ? room.energyAvailable : room.energyCapacityAvailable;
  const allowedEnergy = Math.floor(energyBasis * (1 - SPAWN_ENERGY_RESERVE));
  const body = buildMinerBody(allowedEnergy);

  if (room.energyAvailable < calculateBodyPartCost(body)) {
    if (existingMiners > 0) return false;
    const affordable = buildMinerBody(
      Math.floor(room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE))
    );
    return spawn.spawnCreep(affordable, newName, { memory: { role: ROLE_MINER } }) === OK;
  }

  return spawn.spawnCreep(body, newName, { memory: { role: ROLE_MINER } }) === OK;
}

function getActiveRemoteRooms(room: Room): RemoteRoomData[] {
  return (room.memory.remoteRooms ?? []).filter(
    (r) => !r.hostile && r.sources.length > 0
  );
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

  const res = spawn.spawnCreep([MOVE], `${ROLE_SCOUT}${Game.time}`, {
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
const SCORE_PATROL_RADIUS = 2;

function shouldSpawnScoreHunter(room: Room): boolean {
  if (!scoreHunterSupported()) return false;
  if (getThreatInfo(room).score > 0) return false;
  if (room.energyAvailable < room.energyCapacityAvailable * (1 - SPAWN_ENERGY_RESERVE)) return false;
  // Spawn if there is a known unclaimed score target or a safe region to patrol for one.
  // (Don't gate on pickPatrolRoom here: it only resolves a destination for a creep already
  // in the live fleet, so a not-yet-spawned hunter would deadlock at zero.)
  const unclaimed = getUnclaimedScoreTargetCount();
  const scanRooms = getScoreScanRooms(room.name, SCORE_PATROL_RADIUS).length;
  if (unclaimed === 0 && scanRooms === 0) return false;
  const coverageNeed = Math.ceil(scanRooms / ROOMS_PER_HUNTER);
  const target = Math.min(
    MAX_SCORE_HUNTERS_PER_ROOM,
    Math.max(BASELINE_SCORE_PATROLLERS, unclaimed, coverageNeed)
  );
  const owned = getCreepsByRole(ROLE_SCORE_HUNTER).filter(
    (c) => !c.spawning && c.memory.homeRoom === room.name
  );
  return owned.length + getRoomSpawningCount(room, ROLE_SCORE_HUNTER) < target;
}

function spawnScoreHunter(room: Room, spawn: StructureSpawn): boolean {
  const res = spawn.spawnCreep([MOVE], `${ROLE_SCORE_HUNTER}${Game.time}`, {
    memory: { role: ROLE_SCORE_HUNTER, homeRoom: room.name },
  });
  return res === OK;
}

function shouldSpawnRemoteMiner(room: Room): boolean {
  if ((room.controller?.level ?? 0) < 3) return false;
  const activeRooms = getActiveRemoteRooms(room);
  const miners = getCreepsByRole(ROLE_REMOTE_MINER).filter(
    (c) => c.memory.homeRoom === room.name
  );
  const assignedSources = new Set(miners.map((c) => c.memory.remoteSourceId));
  for (const remote of activeRooms) {
    for (const src of remote.sources) {
      if (!assignedSources.has(src.sourceId)) return true;
    }
  }
  return false;
}

function spawnRemoteMiner(room: Room, spawn: StructureSpawn): boolean {
  const activeRooms = getActiveRemoteRooms(room);
  const miners = getCreepsByRole(ROLE_REMOTE_MINER).filter(
    (c) => c.memory.homeRoom === room.name
  );
  const assignedSources = new Set(miners.map((c) => c.memory.remoteSourceId));

  for (const remote of activeRooms) {
    for (const src of remote.sources) {
      if (assignedSources.has(src.sourceId)) continue;

      const allowedEnergy = Math.floor(
        room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE)
      );
      const body = buildRemoteMinerBody(allowedEnergy);
      if (room.energyAvailable < calculateBodyPartCost(body)) return false;

      const res = spawn.spawnCreep(body, `${ROLE_REMOTE_MINER}${Game.time}`, {
        memory: {
          role: ROLE_REMOTE_MINER,
          homeRoom: room.name,
          targetRoom: remote.roomName,
          remoteSourceId: src.sourceId,
        },
      });
      return res === OK;
    }
  }
  return false;
}

function estimateRemoteDistance(homeRoom: Room, remoteRoomName: string): number {
  const rooms = Game.map.getRoomLinearDistance(homeRoom.name, remoteRoomName);
  return rooms * 50 + 25;
}

function getRemoteHaulerTarget(room: Room): number {
  const activeRooms = getActiveRemoteRooms(room);
  if (activeRooms.length === 0) return 0;

  const carryPerHauler = Math.max(
    1,
    Math.min(
      Math.floor(MAX_BODY_PART_COUNT / 3),
      Math.floor((room.energyCapacityAvailable * (1 - SPAWN_ENERGY_RESERVE)) / 200)
    ) * 2
  );

  let total = 0;
  for (const remote of activeRooms) {
    const sourceCount = remote.sources.length;
    const dist = estimateRemoteDistance(room, remote.roomName);
    const requiredCarry =
      (HAULER_SPAWN.SOURCE_OUTPUT * 2 * dist * sourceCount) / HAULER_SPAWN.CARRY_CAPACITY;
    total += Math.max(1, Math.ceil(requiredCarry / carryPerHauler));
  }
  return Math.min(total, activeRooms.length * 3);
}

function shouldSpawnRemoteHauler(room: Room): boolean {
  if ((room.controller?.level ?? 0) < 3) return false;
  const activeRooms = getActiveRemoteRooms(room);
  if (activeRooms.length === 0) return false;

  const haulers = getCreepsByRole(ROLE_REMOTE_HAULER).filter(
    (c) => c.memory.homeRoom === room.name
  );

  return haulers.length < getRemoteHaulerTarget(room);
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

  const allowedEnergy = Math.floor(
    room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE)
  );
  const body = buildRemoteHaulerRoadBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;

  const res = spawn.spawnCreep(body, `${ROLE_REMOTE_HAULER}${Game.time}`, {
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

function buildRemoteHaulerRoadBody(availableEnergy: number): BodyPartConstant[] {
  const pattern: BodyPartConstant[] = [CARRY, CARRY, MOVE];
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

function shouldSpawnReserver(room: Room): boolean {
  if ((room.controller?.level ?? 0) < 3) return false;
  const activeRooms = getActiveRemoteRooms(room);
  if (activeRooms.length === 0) return false;

  const reservers = getReserversForRoom(room);
  const assignedTargets = new Set(reservers.map((c) => c.memory.targetRoom));

  return activeRooms.some((r) => !assignedTargets.has(r.roomName));
}

function spawnReserver(room: Room, spawn: StructureSpawn): boolean {
  const activeRooms = getActiveRemoteRooms(room);
  const reservers = getReserversForRoom(room);
  const assignedTargets = new Set(reservers.map((c) => c.memory.targetRoom));

  const target = activeRooms.find((r) => !assignedTargets.has(r.roomName));
  if (!target) return false;

  const bigBody: BodyPartConstant[] = [CLAIM, CLAIM, MOVE, MOVE, MOVE, MOVE];
  const smallBody: BodyPartConstant[] = [CLAIM, MOVE, MOVE, MOVE, MOVE];
  const body =
    room.energyCapacityAvailable >= calculateBodyPartCost(bigBody) ? bigBody : smallBody;
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;

  const res = spawn.spawnCreep(body, `${ROLE_RESERVER}${Game.time}`, {
    memory: {
      role: ROLE_RESERVER,
      homeRoom: room.name,
      targetRoom: target.roomName,
    },
  });
  return res === OK;
}

const BOOST_CANDIDATES: Record<string, string[]> = {
  biter:   ['XUH2O', 'UH2O', 'UH'],
  spitter: ['XKHO2', 'KHO2', 'KO'],
  licker:      ['XLHO2', 'LHO2', 'LO'],
  wiggler:      ['XLHO2', 'LHO2', 'LO'],
  chewer:    ['XZH2O', 'ZH2O', 'ZH'],
  tough:   ['XGHO2', 'GHO2', 'GO'],
  move:    ['XZHO2', 'ZHO2', 'ZO'],
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

function buildKnightBody(availableEnergy: number): BodyPartConstant[] {
  const trioCost = BODYPART_COST[TOUGH] + BODYPART_COST[MOVE] + BODYPART_COST[ATTACK];
  const maxTrios = Math.min(
    Math.floor(MAX_BODY_PART_COUNT / 3),
    Math.floor(availableEnergy / trioCost)
  );
  const trios = Math.max(1, maxTrios);
  return [
    ...Array(trios).fill(TOUGH),
    ...Array(trios).fill(MOVE),
    ...Array(trios).fill(ATTACK),
  ] as BodyPartConstant[];
}

function buildWizardBody(availableEnergy: number): BodyPartConstant[] {
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

function buildClericBody(availableEnergy: number): BodyPartConstant[] {
  const pairCost = BODYPART_COST[HEAL] + BODYPART_COST[MOVE];
  const maxPairs = Math.min(
    Math.floor(MAX_BODY_PART_COUNT / 2),
    Math.floor(availableEnergy / pairCost)
  );
  const pairs = Math.max(1, maxPairs);
  return [
    ...Array(pairs).fill(HEAL),
    ...Array(pairs).fill(MOVE),
  ] as BodyPartConstant[];
}

function buildDrainerBody(availableEnergy: number): BodyPartConstant[] {
  const groupCost = BODYPART_COST[TOUGH] + BODYPART_COST[HEAL] + 2 * BODYPART_COST[MOVE];
  const maxGroups = Math.min(
    Math.floor(MAX_BODY_PART_COUNT / 4),
    Math.floor(availableEnergy / groupCost)
  );
  const groups = Math.max(1, maxGroups);
  return [
    ...Array(groups).fill(TOUGH),
    ...Array(groups).fill(HEAL),
    ...Array(groups * 2).fill(MOVE),
  ] as BodyPartConstant[];
}

function buildSiegerBody(availableEnergy: number): BodyPartConstant[] {
  const groupCost = BODYPART_COST[TOUGH] + 2 * BODYPART_COST[WORK] + BODYPART_COST[MOVE];
  const maxGroups = Math.min(
    Math.floor(MAX_BODY_PART_COUNT / 4),
    Math.floor(availableEnergy / groupCost)
  );
  const groups = Math.max(1, maxGroups);
  return [
    ...Array(groups).fill(TOUGH),
    ...Array(groups * 2).fill(WORK),
    ...Array(groups).fill(MOVE),
  ] as BodyPartConstant[];
}

function countDefendersInRoom(role: string, room: Room): number {
  const present = getCreepsByRoleInRoom(role, room).filter(
    (c) => !c.spawning && !c.memory.offensiveTarget
  ).length;
  return present + getRoomSpawningCount(room, role);
}

function shouldSpawnKnight(room: Room, threatScore: number): boolean {
  return countDefendersInRoom(ROLE_KNIGHT, room) < Math.min(3, Math.ceil(threatScore / 40));
}

function spawnKnight(room: Room, spawn: StructureSpawn): boolean {
  const allowedEnergy = Math.floor(room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE));
  const body = buildKnightBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const attackParts = body.filter((p) => p === ATTACK).length;
  const toughParts = body.filter((p) => p === TOUGH).length;
  const moveParts = body.filter((p) => p === MOVE).length;
  const queue = buildBoostQueue(room, 'biter', attackParts, toughParts, moveParts);
  const res = spawn.spawnCreep(body, `${ROLE_KNIGHT}${Game.time}`, {
    memory: { role: ROLE_KNIGHT, ...boostMemory(queue) },
  });
  return res === OK;
}

function shouldSpawnWizard(room: Room, threatScore: number): boolean {
  return countDefendersInRoom(ROLE_WIZARD, room) < Math.min(2, Math.ceil(threatScore / 60));
}

function spawnWizard(room: Room, spawn: StructureSpawn): boolean {
  const allowedEnergy = Math.floor(room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE));
  const body = buildWizardBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const rangedParts = body.filter((p) => p === RANGED_ATTACK).length;
  const queue = buildBoostQueue(room, 'spitter', rangedParts, 0);
  const res = spawn.spawnCreep(body, `${ROLE_WIZARD}${Game.time}`, {
    memory: { role: ROLE_WIZARD, ...boostMemory(queue) },
  });
  return res === OK;
}

function shouldSpawnCleric(room: Room, threatScore: number): boolean {
  if (threatScore < 100) return false;
  const fighters =
    countDefendersInRoom(ROLE_KNIGHT, room) + countDefendersInRoom(ROLE_WIZARD, room);
  if (fighters === 0) return false;
  return countDefendersInRoom(ROLE_CLERIC, room) < 1;
}

function spawnCleric(room: Room, spawn: StructureSpawn): boolean {
  const allowedEnergy = Math.floor(room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE));
  const body = buildClericBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const healParts = body.filter((p) => p === HEAL).length;
  const queue = buildBoostQueue(room, 'licker', healParts, 0);
  const res = spawn.spawnCreep(body, `${ROLE_CLERIC}${Game.time}`, {
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
  const res = spawn.spawnCreep(body, `${ROLE_CONQUEROR}${Game.time}`, {
    memory: {
      role: ROLE_CONQUEROR,
      homeRoom: room.name,
      targetRoom: exp.roomName,
    },
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
  const allowedEnergy = Math.floor(room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE));
  const body = buildScaledBody(ROLE_SETTLER, allowedEnergy);
  const res = spawn.spawnCreep(body, `${ROLE_SETTLER}${Game.time}`, {
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
    members.filter((c) => c.memory.role === ROLE_KNIGHT).length < op.requiredBiters ||
    members.filter((c) => c.memory.role === ROLE_WIZARD).length < op.requiredSpitters ||
    members.filter((c) => c.memory.role === ROLE_CLERIC).length < op.requiredLickers ||
    members.filter((c) => c.memory.role === ROLE_SIEGER).length < (op.requiredChewers ?? 0) ||
    members.filter((c) => c.memory.role === ROLE_DRAINER).length < (op.requiredWigglers ?? 0)
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
  const queue = buildBoostQueue(room, "wiggler", healParts, toughParts);

  const res = spawn.spawnCreep(body, `${ROLE_DRAINER}_drain${Game.time}`, {
    memory: {
      role: ROLE_DRAINER,
      homeRoom: room.name,
      offensiveTarget: op.targetRoom,
      ...boostMemory(queue),
    },
  });
  if (res === OK) console.log(`[Drain] Spawning wiggler: ${room.name} -> ${op.targetRoom}`);
  return res === OK;
}

function spawnNextOffensiveCreep(room: Room, spawn: StructureSpawn): boolean {
  const op = getOffensiveOpForRoom(room);
  if (!op) return false;

  const members = getOffensiveSquadMembers(op);
  const biters = members.filter((c) => c.memory.role === ROLE_KNIGHT).length;
  const spitters = members.filter((c) => c.memory.role === ROLE_WIZARD).length;
  const lickers = members.filter((c) => c.memory.role === ROLE_CLERIC).length;
  const chewers = members.filter((c) => c.memory.role === ROLE_SIEGER).length;
  const wigglers = members.filter((c) => c.memory.role === ROLE_DRAINER).length;

  let roleToSpawn: string | null = null;
  if (biters < op.requiredBiters) roleToSpawn = ROLE_KNIGHT;
  else if (wigglers < (op.requiredWigglers ?? 0)) roleToSpawn = ROLE_DRAINER;
  else if (chewers < (op.requiredChewers ?? 0)) roleToSpawn = ROLE_SIEGER;
  else if (spitters < op.requiredSpitters) roleToSpawn = ROLE_WIZARD;
  else if (lickers < op.requiredLickers) roleToSpawn = ROLE_CLERIC;
  if (!roleToSpawn) return false;

  const energy = room.energyCapacityAvailable;
  let body: BodyPartConstant[];
  let boostKey: string;
  let combatPartType: BodyPartConstant;

  if (roleToSpawn === ROLE_KNIGHT) {
    body = buildKnightBody(energy);
    boostKey = "biter";
    combatPartType = ATTACK;
  } else if (roleToSpawn === ROLE_SIEGER) {
    body = buildSiegerBody(energy);
    boostKey = "chewer";
    combatPartType = WORK;
  } else if (roleToSpawn === ROLE_WIZARD) {
    body = buildWizardBody(energy);
    boostKey = "spitter";
    combatPartType = RANGED_ATTACK;
  } else if (roleToSpawn === ROLE_DRAINER) {
    body = buildDrainerBody(energy);
    boostKey = "wiggler";
    combatPartType = HEAL;
  } else {
    body = buildClericBody(energy);
    boostKey = "licker";
    combatPartType = HEAL;
  }

  if (room.energyAvailable < calculateBodyPartCost(body)) return false;

  const combatParts = body.filter((p) => p === combatPartType).length;
  const toughParts = body.filter((p) => p === TOUGH).length;
  const moveParts =
    boostKey === "biter" || boostKey === "chewer"
      ? body.filter((p) => p === MOVE).length
      : 0;
  const queue = buildBoostQueue(room, boostKey, combatParts, toughParts, moveParts);

  const res = spawn.spawnCreep(body, `${roleToSpawn}_off${Game.time}`, {
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

function shouldSpawnDefender(room: Room): boolean {
  if (needsChildRoomDefender(room)) return true;

  const op = getDefenseOp(room.name);
  if (!op) return false;
  return (
    countDefendersByRole(room.name, ROLE_KNIGHT, room) < op.requiredBiters ||
    countDefendersByRole(room.name, ROLE_WIZARD, room) < op.requiredSpitters ||
    countDefendersByRole(room.name, ROLE_CLERIC, room) < op.requiredLickers
  );
}

function spawnNextDefender(room: Room, spawn: StructureSpawn): boolean {
  if (needsChildRoomDefender(room)) {
    return spawnChildRoomDefender(room, spawn);
  }

  const op = getDefenseOp(room.name);
  if (!op) return false;

  let roleToSpawn: string | null = null;
  let combatPartType: BodyPartConstant = ATTACK;
  let boostKey = "biter";
  let body: BodyPartConstant[];

  const haveDefender = getDefenders(room.name).some((c) => !c.spawning);
  const energyBudget = haveDefender ? room.energyCapacityAvailable : room.energyAvailable;
  const allowedEnergy = Math.floor(energyBudget * (1 - SPAWN_ENERGY_RESERVE));

  if (countDefendersByRole(room.name, ROLE_KNIGHT, room) < op.requiredBiters) {
    roleToSpawn = ROLE_KNIGHT;
    combatPartType = ATTACK;
    boostKey = "biter";
    body = buildKnightBody(allowedEnergy);
  } else if (countDefendersByRole(room.name, ROLE_WIZARD, room) < op.requiredSpitters) {
    roleToSpawn = ROLE_WIZARD;
    combatPartType = RANGED_ATTACK;
    boostKey = "spitter";
    body = buildWizardBody(allowedEnergy);
  } else if (countDefendersByRole(room.name, ROLE_CLERIC, room) < op.requiredLickers) {
    roleToSpawn = ROLE_CLERIC;
    combatPartType = HEAL;
    boostKey = "licker";
    body = buildClericBody(allowedEnergy);
  } else {
    return false;
  }

  if (room.energyAvailable < calculateBodyPartCost(body)) return false;

  const combatParts = body.filter((p) => p === combatPartType).length;
  const toughParts = body.filter((p) => p === TOUGH).length;
  const moveParts = boostKey === "biter" ? body.filter((p) => p === MOVE).length : 0;
  const queue = buildBoostQueue(room, boostKey, combatParts, toughParts, moveParts);
  const res = spawn.spawnCreep(body, `${roleToSpawn}_def${Game.time}`, {
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
  const allowedEnergy = Math.floor(room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE));
  const body = buildKnightBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const attackParts = body.filter((p) => p === ATTACK).length;
  const toughParts = body.filter((p) => p === TOUGH).length;
  const moveParts = body.filter((p) => p === MOVE).length;
  const queue = buildBoostQueue(room, "biter", attackParts, toughParts, moveParts);
  const res = spawn.spawnCreep(body, `${ROLE_KNIGHT}_child${Game.time}`, {
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

function findRemoteInvaderTarget(room: Room): string | null {
  const remotes = room.memory.remoteRooms;
  if (!remotes) return null;
  for (const r of remotes) {
    if (r.invaderUntil === undefined || r.invaderUntil <= Game.time) continue;
    const defending = getCreepsByRole(ROLE_KNIGHT).some(
      (c) => c.memory.homeRoom === room.name && c.memory.targetRoom === r.roomName
    );
    if (!defending) return r.roomName;
  }
  return null;
}

function shouldSpawnRemoteDefender(room: Room): boolean {
  return findRemoteInvaderTarget(room) !== null;
}

function spawnRemoteDefender(room: Room, spawn: StructureSpawn): boolean {
  const target = findRemoteInvaderTarget(room);
  if (!target) return false;
  const allowedEnergy = Math.floor(room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE));
  const body = buildKnightBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const attackParts = body.filter((p) => p === ATTACK).length;
  const toughParts = body.filter((p) => p === TOUGH).length;
  const moveParts = body.filter((p) => p === MOVE).length;
  const queue = buildBoostQueue(room, "biter", attackParts, toughParts, moveParts);
  const res = spawn.spawnCreep(body, `${ROLE_KNIGHT}_remote${Game.time}`, {
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

function getPowerSquadForRoom(room: Room): PowerBankOp | undefined {
  return Memory.powerOps?.find(
    (o) => o.homeRoom === room.name && o.phase === "forming"
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

  const res = spawn.spawnCreep(body, `${roleToSpawn}${Game.time}`, {
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

function buildPowerAttackerBody(): BodyPartConstant[] {
  return [
    ...Array(20).fill(TOUGH),
    ...Array(10).fill(MOVE),
    ...Array(20).fill(ATTACK),
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
    body = buildRemoteHaulerBody(Math.floor(energy * (1 - SPAWN_ENERGY_RESERVE)));
  } else {
    return false;
  }

  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const res = spawn.spawnCreep(body, `${roleToSpawn}${Game.time}`, {
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

function buildSkGuardianBody(availableEnergy: number): BodyPartConstant[] {
  const groupCost = BODYPART_COST[RANGED_ATTACK] + BODYPART_COST[HEAL] + 2 * BODYPART_COST[MOVE];
  const maxGroups = Math.min(
    Math.floor(MAX_BODY_PART_COUNT / 4),
    Math.floor(availableEnergy / groupCost)
  );
  const groups = Math.max(5, maxGroups);
  return [
    ...Array(groups).fill(RANGED_ATTACK),
    ...Array(groups).fill(HEAL),
    ...Array(groups * 2).fill(MOVE),
  ] as BodyPartConstant[];
}

function spawnSkGuardian(room: Room, spawn: StructureSpawn, op: SourceKeeperOp): boolean {
  const body = buildSkGuardianBody(room.energyCapacityAvailable);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const healParts = body.filter((p) => p === HEAL).length;
  const queue = buildBoostQueue(room, "licker", healParts, 0);
  const res = spawn.spawnCreep(body, `${ROLE_SK_GUARDIAN}${Game.time}`, {
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
  const res = spawn.spawnCreep(body, `${ROLE_SK_MINER}${Game.time}`, {
    memory: { role: ROLE_SK_MINER, homeRoom: room.name, skOpId: op.id, skSourceId: sourceId },
  });
  if (res === OK) console.log(`[SK] Spawning burrower for ${op.roomName}`);
  return res === OK;
}

function spawnSkHauler(room: Room, spawn: StructureSpawn, op: SourceKeeperOp): boolean {
  const allowedEnergy = Math.floor(room.energyCapacityAvailable * (1 - SPAWN_ENERGY_RESERVE));
  const body = buildRemoteHaulerBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const res = spawn.spawnCreep(body, `${ROLE_SK_HAULER}${Game.time}`, {
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
  const allowedEnergy = Math.floor(room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE));
  const body = buildScaledBody(ROLE_APOTHECARY, allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const res = spawn.spawnCreep(body, `${ROLE_APOTHECARY}${Game.time}`, {
    memory: { role: ROLE_APOTHECARY },
  });
  return res === OK;
}
