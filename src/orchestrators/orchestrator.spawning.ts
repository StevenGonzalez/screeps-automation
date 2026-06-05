import {
  ROLE_BUILDER,
  ROLE_HARVESTER,
  ROLE_UPGRADER,
  ROLE_REPAIRER,
  ROLE_MINER,
  ROLE_HAULER,
  ROLE_MINERAL_MINER,
  ROLE_SCOUT,
  ROLE_REMOTE_MINER,
  ROLE_REMOTE_HAULER,
  ROLE_RESERVER,
  ROLE_KNIGHT,
  ROLE_WIZARD,
  ROLE_CLERIC,
  ROLE_SIEGER,
  ROLE_CONQUEROR,
  ROLE_SETTLER,
  ROLE_APOTHECARY,
  ROLE_POWER_ATTACKER,
  ROLE_POWER_HEALER,
  ROLE_POWER_CARRIER,
  ROLE_SK_GUARDIAN,
  ROLE_SK_MINER,
  ROLE_SK_HAULER,
} from "../config/config.roles";
import { getThreatInfo, getThreatSeverity } from "../services/services.combat";
import { getDefenseOp, getDefenders } from "./orchestrator.military";
import { getSkMembers, isOpPaused } from "./orchestrator.sourcekeeper";
import { getStockForCompound } from "../services/services.labs";
import { getRampartTargetHP } from "../services/services.creep";

import {
  BODY_PATTERNS,
  MAX_BODY_PART_COUNT,
  SPAWN_ENERGY_RESERVE,
} from "../config/config.spawning";
import { getRoomMemory } from "../services/services.memory";
import { getSources } from "../services/services.creep";

export function loop() {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my) continue;
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

// Per-tick cache: room name → role → count of creeps currently being spawned.
// Lets multiple idle spawns in the same room avoid double-spawning the same role.
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

// Counts creeps in a room by role, including any currently being spawned
// (which aren't in Game.creeps yet but are in Memory.creeps).
function countByRoleInRoom(role: string, room: Room): number {
  return getCreepsByRoleInRoom(role, room).length + getRoomSpawningCount(room, role);
}

function getMinerPopulationTarget(room: Room): number {
  // Use the cached list from the memory orchestrator (refreshed every 100 ticks).
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

// Energy is critically low when spawn energy is below 25% capacity AND storage has little buffer.
// Pre-storage rooms use only the spawn energy fraction (no stored energy to fall back on).
function isEnergyEmergency(room: Room): boolean {
  const cap = room.energyCapacityAvailable;
  if (cap === 0) return false;
  if (!room.storage) return room.energyAvailable / cap < 0.25;
  return room.energyAvailable / cap < 0.25 && room.storage.store[RESOURCE_ENERGY] < 50000;
}

function getHarvesterPopulationTarget(room: Room): number {
  const minerCount = getCreepsByRoleInRoom(ROLE_MINER, room).length;
  const phase = getRoomPhase(room);
  if (phase === "bootstrap") return Math.max(2, 2 - minerCount);
  // During an energy emergency with no miners, keep 2 harvesters for direct source coverage.
  // With miners present the distribution problem (containers full, extensions empty) is
  // better solved by haulers — one harvester bridge is enough, not two.
  if (isEnergyEmergency(room)) return minerCount > 0 ? Math.min(1, 2 - minerCount) : 2;
  return Math.max(0, 2 - minerCount);
}

function getUpgraderPopulationTarget(room: Room): number {
  if (isEnergyEmergency(room)) return 0;

  const phase = getRoomPhase(room);
  const rcl = room.controller?.level ?? 0;

  if (rcl >= 8) return 1;

  const storage = room.storage;
  if (!storage) return phase === "bootstrap" ? 1 : 2;

  // Start at 1 and add one upgrader per 50k stored — smooth ramp instead of rigid steps.
  const cap = phase === "powerhouse" ? 4 : 3;
  return Math.min(cap, 1 + Math.floor(storage.store[RESOURCE_ENERGY] / 50000));
}

// Per-tick cache: room name → construction-site count. Multiple idle spawns in
// the same room would otherwise each run FIND_CONSTRUCTION_SITES.
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
  // Scale with workload: 1 builder per 10 sites.
  // Cap lower for developing rooms to avoid starving essential roles.
  const cap = phase === "developing" ? 2 : 5;
  return Math.min(cap, Math.ceil(siteCount / 10));
}

function getSpawnForRoom(room: Room): StructureSpawn | null {
  const roomMemory = getRoomMemory(room);
  if (!roomMemory.spawnId) return null;
  return Game.getObjectById(roomMemory.spawnId) as StructureSpawn | null;
}

function processRoomSpawning(room: Room, spawn: StructureSpawn) {
  // Emergency recovery: if no energy gatherers exist, bypass energy reserve
  if (!hasEnergyGatherers(room)) {
    spawnEmergencyHarvester(room, spawn);
    return;
  }

  // Evaluate threat before the economy queue so heavy raids can jump the line.
  const { score: threatScore } = getThreatInfo(room);
  const threatSeverity = getThreatSeverity(room);
  const phase = getRoomPhase(room);

  // Core economy — harvesters always first: cheapest path back from energy collapse.
  if (shouldSpawnHarvester(room) && spawnHarvester(room, spawn)) return;

  // Standing defense — highest non-survival priority. An auto-declared DefenseOp
  // (orchestrator.military) means a serious raid is in the room; a structured defensive
  // squad outranks miners/haulers and all economy below, because a lost spawn doesn't
  // respawn. A bootstrapping child room needing a defender is handled here too.
  if (shouldSpawnDefender(room) && spawnNextDefender(room, spawn)) return;

  // Under a serious raid (healer-backed squad), defenders take the next spawn slot
  // before stationary miners and haulers — a dead miner respawns, a dead spawn does not.
  if (threatSeverity === "high" && phase !== "bootstrap") {
    if (shouldSpawnKnight(room, threatScore) && spawnKnight(room, spawn)) return;
    if (shouldSpawnWizard(room, threatScore) && spawnWizard(room, spawn)) return;
    if (shouldSpawnCleric(room, threatScore) && spawnCleric(room, spawn)) return;
  }

  if (shouldSpawnMiner(room) && spawnMiner(room, spawn)) return;
  if (shouldSpawnHauler(room) && spawnHauler(room, spawn)) return;

  // Non-essential spawns are suppressed during an energy emergency so that
  // every spare joule goes back into harvesters and miners.
  if (isEnergyEmergency(room)) return;

  // Low/medium threat: defenders still get priority over improvements, just not miners.
  if (threatScore > 0 && phase !== "bootstrap") {
    if (shouldSpawnKnight(room, threatScore) && spawnKnight(room, spawn)) return;
    if (shouldSpawnWizard(room, threatScore) && spawnWizard(room, spawn)) return;
    if (shouldSpawnCleric(room, threatScore) && spawnCleric(room, spawn)) return;
  }

  // Expansion: conqueror and settlers are spawned by the home room only
  if (Memory.expansion?.homeRoom === room.name) {
    if (shouldSpawnConqueror() && spawnConqueror(room, spawn)) return;
    if (shouldSpawnSettler(room) && spawnSettler(room, spawn)) return;
  }

  if (shouldSpawnOffensiveCreep(room) && spawnNextOffensiveCreep(room, spawn)) return;
  if (shouldSpawnPowerCreep(room) && spawnNextPowerCreep(room, spawn)) return;
  if (spawnSkCreeps(room, spawn)) return;
  if (shouldSpawnApothecary(room) && spawnApothecary(room, spawn)) return;
  if (shouldSpawnMineralMiner(room) && spawnMineralMiner(room, spawn)) return;
  // Remote roles after local economy is stable
  if (shouldSpawnScout(room) && spawnScout(room, spawn)) return;
  if (shouldSpawnRemoteMiner(room) && spawnRemoteMiner(room, spawn)) return;
  if (shouldSpawnRemoteHauler(room) && spawnRemoteHauler(room, spawn)) return;
  if (shouldSpawnReserver(room) && spawnReserver(room, spawn)) return;
  if (shouldSpawnUpgrader(room) && spawnUpgrader(room, spawn)) return;
  if (shouldSpawnBuilder(room) && spawnBuilder(room, spawn)) return;
  if (shouldSpawnRepairer(room) && spawnRepairer(room, spawn)) return;
}

const HAULER_SPAWN = {
  WORKS_PER_HAULER: 4,
  DISTANCE_LONG: 20,
  MAX_HAULERS: 6,
  DISTANCE_CACHE_TTL: 500,
} as const;

// Per-room cache: container id → path length from spawn, refreshed every TTL ticks.
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
  // Use IDs cached by the memory orchestrator instead of a per-tick room.find.
  const containerIds = room.memory.containerIds ?? [];
  if (containerIds.length === 0) return false;
  const containers = containerIds
    .map((id) => Game.getObjectById(id))
    .filter(Boolean) as StructureContainer[];

  if (containers.length === 0) return false;

  // Filter by homeRoom so haulers currently in a remote room are still counted.
  const haulers = getCreepsByRole(ROLE_HAULER).filter(
    (c) => (c.memory.homeRoom ?? c.room.name) === room.name
  );

  const totalMinerWork = getCreepsByRoleInRoom(ROLE_MINER, room)
    .reduce((sum, c) => sum + c.body.filter((p) => p.type === WORK).length, 0);

  const targetFromWork = Math.ceil(totalMinerWork / HAULER_SPAWN.WORKS_PER_HAULER);

  const spawn = getSpawnForRoom(room);
  let extraLong = 0;
  if (spawn) {
    const distances = getContainerDistances(room, spawn, containers);
    for (const c of containers) {
      if ((distances[c.id] ?? 0) > HAULER_SPAWN.DISTANCE_LONG) extraLong++;
    }
  }

  // Floor on miner containers only — upgrade and mineral containers don't need a dedicated hauler.
  const minerContainerIds = new Set(room.memory.minerContainerIds ?? []);
  const minerContainerCount = containers.filter((c) =>
    minerContainerIds.has(c.id as Id<StructureContainer>)
  ).length;
  const desired = Math.min(
    HAULER_SPAWN.MAX_HAULERS,
    Math.max(minerContainerCount, targetFromWork + extraLong)
  );

  const haulerCount = haulers.length + getRoomSpawningCount(room, ROLE_HAULER);
  if (haulerCount < desired) return true;

  // Allow one extra hauler if the existing ones are collectively undersized —
  // e.g. they were spawned during an energy shortage and have tiny bodies.
  // The ideal carry per hauler is based on room capacity, not current energy.
  if (haulers.length >= HAULER_SPAWN.MAX_HAULERS) return false;
  const idealRepeats = Math.min(
    Math.floor(MAX_BODY_PART_COUNT / 3),
    Math.floor((room.energyCapacityAvailable * (1 - SPAWN_ENERGY_RESERVE)) / 150)
  );
  const carryPerIdealHauler = idealRepeats * 2 * 50;
  const totalCurrentCarry = haulers.reduce(
    (sum, h) => sum + h.body.filter((p) => p.type === CARRY).length * 50,
    0
  );
  return totalCurrentCarry < desired * carryPerIdealHauler * 0.5;
}

function spawnHauler(room: Room, spawn: StructureSpawn): boolean {
  const newName = `${ROLE_HAULER}${Game.time}`;
  const existingHaulers = getCreepsByRole(ROLE_HAULER).filter(
    (c) => (c.memory.homeRoom ?? c.room.name) === room.name
  );

  // Size the body against capacity so haulers are always large enough to clear
  // the container backlog. When no haulers exist at all, fall back to current
  // energy so the room isn't stuck waiting indefinitely during recovery.
  const energyBasis = existingHaulers.length === 0
    ? room.energyAvailable
    : room.energyCapacityAvailable;
  const allowedEnergy = Math.floor(energyBasis * (1 - SPAWN_ENERGY_RESERVE));
  const body = buildScaledBody(ROLE_HAULER, allowedEnergy);
  const bodyCost = calculateBodyPartCost(body);

  if (room.energyAvailable < bodyCost) {
    // Can't afford the full-sized body yet. If we have existing haulers covering
    // us, return true to hold the spawn slot and let energy accumulate rather
    // than letting lower-priority roles consume it first.
    return existingHaulers.length > 0;
  }

  return spawn.spawnCreep(body, newName, {
    memory: { role: ROLE_HAULER, homeRoom: room.name },
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

  // Urgent non-defensive repairs (structures below 50% HP)
  const critical = room.find(FIND_STRUCTURES, {
    filter: (s) => {
      if (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) return false;
      const st = s as AnyStructure;
      return "hits" in st && "hitsMax" in st && st.hits < st.hitsMax * 0.5;
    },
  });
  let value = Math.min(2, Math.ceil(critical.length / 5));

  // Wall/rampart maintenance — add 1 repairer when walls are below target and
  // the economy has enough buffer to afford sustained repair work.
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

  // Under an inbound nuke, throw extra repair throughput at the threatened ramparts.
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

function spawnEmergencyHarvester(room: Room, spawn: StructureSpawn): boolean {
  // Minimum body: one harvester that can actually work. Use available energy.
  const body = room.energyAvailable >= 300
    ? [WORK, CARRY, MOVE]
    : [WORK, CARRY, MOVE]; // cheapest working body costs 200 exactly
  if (room.energyAvailable < 200) return false;
  const res = spawn.spawnCreep(body, `${ROLE_HARVESTER}_emrg${Game.time}`, {
    memory: { role: ROLE_HARVESTER },
  });
  if (res === OK) {
    console.log(`[Spawn] Emergency harvester spawned in ${room.name}`);
  }
  return res === OK;
}

function shouldSpawnMineralMiner(room: Room): boolean {
  // A mineral miner is useless without a container to deposit into — don't waste energy on one.
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

function spawnUpgrader(room: Room, spawn: StructureSpawn): boolean {
  const newName = `${ROLE_UPGRADER}${Game.time}`;
  const allowedEnergy = Math.floor(
    room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE)
  );
  const body = buildScaledBody(ROLE_UPGRADER, allowedEnergy);
  const res = spawn.spawnCreep(body, newName, {
    memory: { role: ROLE_UPGRADER },
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
  // Stationary miner: maximize WORK parts (each WORK = 2 energy/tick from source).
  // Source regenerates 10 energy/tick → 5 WORK parts saturates it.
  // One MOVE is enough since the miner sits on a container.
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
  const allowedEnergy = Math.floor(
    room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE)
  );
  const body = buildMinerBody(allowedEnergy);
  const res = spawn.spawnCreep(body, newName, {
    memory: { role: ROLE_MINER },
  });
  return res === OK;
}

// ── Remote role helpers ───────────────────────────────────────────────────────

function getActiveRemoteRooms(room: Room): RemoteRoomData[] {
  return (room.memory.remoteRooms ?? []).filter(
    (r) => !r.hostile && r.sources.length > 0
  );
}

// Scouts travel away from home, so we track them by homeRoom memory rather
// than current room — a scout in transit would otherwise be invisible to the
// spawn check and cause duplicate scouts to be queued.
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

function shouldSpawnRemoteMiner(room: Room): boolean {
  // Only at RCL 3+ — remote mining without reserving isn't worth it early
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

function shouldSpawnRemoteHauler(room: Room): boolean {
  if ((room.controller?.level ?? 0) < 3) return false;
  const activeRooms = getActiveRemoteRooms(room);
  if (activeRooms.length === 0) return false;

  const haulers = getCreepsByRole(ROLE_REMOTE_HAULER).filter(
    (c) => c.memory.homeRoom === room.name
  );

  // 2 haulers per active remote room (one filling, one depositing)
  return haulers.length < activeRooms.length * 2;
}

function spawnRemoteHauler(room: Room, spawn: StructureSpawn): boolean {
  const activeRooms = getActiveRemoteRooms(room);
  if (activeRooms.length === 0) return false;

  // Assign to the remote room with the fewest haulers
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
  const body = buildRemoteHaulerBody(allowedEnergy);
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
  // Remote miners travel without roads: WORK:MOVE = 1:1
  const workCost = BODYPART_COST[WORK];
  const moveCost = BODYPART_COST[MOVE];
  const maxWork = 5;
  const pairCost = workCost + moveCost; // 150e per WORK+MOVE pair
  const pairs = Math.min(maxWork, Math.max(1, Math.floor(availableEnergy / pairCost)));
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < pairs; i++) body.push(WORK);
  for (let i = 0; i < pairs; i++) body.push(MOVE);
  return body;
}

function buildRemoteHaulerBody(availableEnergy: number): BodyPartConstant[] {
  // Remote haulers on plains: CARRY:MOVE = 1:1
  const pattern: BodyPartConstant[] = [CARRY, MOVE];
  const patternCost = calculateBodyPartCost(pattern);
  const maxByParts = Math.floor(MAX_BODY_PART_COUNT / pattern.length);
  const maxByEnergy = Math.floor(availableEnergy / patternCost);
  const repeats = Math.max(2, Math.min(maxByParts, maxByEnergy));
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < repeats; i++) body.push(...pattern);
  return body;
}

// ── Reserver helpers ──────────────────────────────────────────────────────────

function getReserversForRoom(homeRoom: Room): Creep[] {
  return getCreepsByRole(ROLE_RESERVER).filter(
    (c) => c.memory.homeRoom === homeRoom.name
  );
}

function shouldSpawnReserver(room: Room): boolean {
  // Reservation requires at least RCL 3 to be worth the spawn cost
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

  // 1 CLAIM + 4 MOVE: max speed on plains, reasonable on swamp (800 energy)
  const body: BodyPartConstant[] = [CLAIM, MOVE, MOVE, MOVE, MOVE];
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

// ── Military defender helpers ─────────────────────────────────────────────────

// Preferred boost compounds per role (best tier first).
const BOOST_CANDIDATES: Record<string, string[]> = {
  knight:  ['XUH2O', 'UH2O', 'UH'],   // attack
  wizard:  ['XKHO2', 'KHO2', 'KO'],   // ranged attack (K-line; U-line boosts harvest, not ranged)
  cleric:  ['XLHO2', 'LHO2', 'LO'],   // heal
  sieger:  ['XZH2O', 'ZH2O', 'ZH'],   // dismantle
};

// Returns the best available boost compound if there's enough stock in storage/terminal.
// boostParts = number of the relevant body parts being boosted (30 units each).
function pickBoostCompound(room: Room, roleKey: string, boostParts: number): string | undefined {
  const candidates = BOOST_CANDIDATES[roleKey];
  if (!candidates) return undefined;
  const minRequired = boostParts * 30 + 300; // 300-unit safety buffer
  for (const compound of candidates) {
    if (getStockForCompound(compound, room) >= minRequired) return compound;
  }
  return undefined;
}

// Knight body: front-loads TOUGH so armor absorbs hits before ATTACK parts die.
// Cost per trio: TOUGH(10) + MOVE(50) + ATTACK(80) = 140. Min body = 1 trio.
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

// Wizard body: RANGED_ATTACK first so MOVE dies before combat parts.
// Cost per pair: MOVE(50) + RANGED_ATTACK(150) = 200.
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

// Cleric body: HEAL first so MOVE dies before healing parts.
// Cost per pair: HEAL(250) + MOVE(50) = 300.
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

// Sieger body: TOUGH soaks tower fire while WORK parts dismantle. MOVE matched to
// half the parts (1 MOVE per 2 working parts) since siegers travel with the squad on
// roads/cleared ground and prioritise dismantle throughput over speed.
// Cost per group: TOUGH(10) + 2×WORK(200) + MOVE(50) = 260.
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

function shouldSpawnKnight(room: Room, threatScore: number): boolean {
  return countByRoleInRoom(ROLE_KNIGHT, room) < Math.min(3, Math.ceil(threatScore / 40));
}

function spawnKnight(room: Room, spawn: StructureSpawn): boolean {
  const allowedEnergy = Math.floor(room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE));
  const body = buildKnightBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const attackParts = body.filter((p) => p === ATTACK).length;
  const boost = pickBoostCompound(room, 'knight', attackParts);
  const res = spawn.spawnCreep(body, `${ROLE_KNIGHT}${Game.time}`, {
    memory: { role: ROLE_KNIGHT, ...(boost ? { boostCompound: boost } : {}) },
  });
  return res === OK;
}

function shouldSpawnWizard(room: Room, threatScore: number): boolean {
  return countByRoleInRoom(ROLE_WIZARD, room) < Math.min(2, Math.ceil(threatScore / 60));
}

function spawnWizard(room: Room, spawn: StructureSpawn): boolean {
  const allowedEnergy = Math.floor(room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE));
  const body = buildWizardBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const rangedParts = body.filter((p) => p === RANGED_ATTACK).length;
  const boost = pickBoostCompound(room, 'wizard', rangedParts);
  const res = spawn.spawnCreep(body, `${ROLE_WIZARD}${Game.time}`, {
    memory: { role: ROLE_WIZARD, ...(boost ? { boostCompound: boost } : {}) },
  });
  return res === OK;
}

function shouldSpawnCleric(room: Room, threatScore: number): boolean {
  if (threatScore < 100) return false;
  const fighters = countByRoleInRoom(ROLE_KNIGHT, room) + countByRoleInRoom(ROLE_WIZARD, room);
  if (fighters === 0) return false;
  return countByRoleInRoom(ROLE_CLERIC, room) < 1;
}

function spawnCleric(room: Room, spawn: StructureSpawn): boolean {
  const allowedEnergy = Math.floor(room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE));
  const body = buildClericBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const healParts = body.filter((p) => p === HEAL).length;
  const boost = pickBoostCompound(room, 'cleric', healParts);
  const res = spawn.spawnCreep(body, `${ROLE_CLERIC}${Game.time}`, {
    memory: { role: ROLE_CLERIC, ...(boost ? { boostCompound: boost } : {}) },
  });
  return res === OK;
}

// ── Expansion helpers ─────────────────────────────────────────────────────────

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
  // [CLAIM, MOVE×4] = 800 energy; moves at full speed even on swamp
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

  // orchestrator.expansion is the sole authority on the bootstrapping -> established
  // transition (it runs every tick and checks true self-sufficiency). Do not flip the
  // phase here. Pause settler production while the child room is contested.
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
  // Falls back to [WORK, CARRY, MOVE] — enough to harvest and build
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

// ── Offensive squad helpers ───────────────────────────────────────────────────

function getOffensiveSquadMembers(op: MilitaryOp): Creep[] {
  return Object.values(Game.creeps).filter(
    (c) => c.memory.offensiveTarget === op.targetRoom && c.memory.homeRoom === op.homeRoom
  );
}

// The offensive op funded by THIS room, if any (concurrency: one op per home room).
function getOffensiveOpForRoom(room: Room): MilitaryOp | undefined {
  return Memory.militaryOps?.[room.name];
}

function shouldSpawnOffensiveCreep(room: Room): boolean {
  const op = getOffensiveOpForRoom(room);
  if (!op || op.phase !== "forming") return false;
  const members = getOffensiveSquadMembers(op);
  return (
    members.filter((c) => c.memory.role === ROLE_KNIGHT).length < op.requiredKnights ||
    members.filter((c) => c.memory.role === ROLE_WIZARD).length < op.requiredWizards ||
    members.filter((c) => c.memory.role === ROLE_CLERIC).length < op.requiredClerics ||
    members.filter((c) => c.memory.role === ROLE_SIEGER).length < (op.requiredSiegers ?? 0)
  );
}

function spawnNextOffensiveCreep(room: Room, spawn: StructureSpawn): boolean {
  const op = getOffensiveOpForRoom(room);
  if (!op) return false;

  const members = getOffensiveSquadMembers(op);
  const knights = members.filter((c) => c.memory.role === ROLE_KNIGHT).length;
  const wizards = members.filter((c) => c.memory.role === ROLE_WIZARD).length;
  const clerics = members.filter((c) => c.memory.role === ROLE_CLERIC).length;
  const siegers = members.filter((c) => c.memory.role === ROLE_SIEGER).length;

  // Spawn order mirrors the formation front-to-back: tanks, then siege, then ranged,
  // then healers — so a half-formed squad already has a screen for its support.
  let roleToSpawn: string | null = null;
  if (knights < op.requiredKnights) roleToSpawn = ROLE_KNIGHT;
  else if (siegers < (op.requiredSiegers ?? 0)) roleToSpawn = ROLE_SIEGER;
  else if (wizards < op.requiredWizards) roleToSpawn = ROLE_WIZARD;
  else if (clerics < op.requiredClerics) roleToSpawn = ROLE_CLERIC;
  if (!roleToSpawn) return false;

  // Offensive creeps spawn at full capacity — wait for max-strength body
  const energy = room.energyCapacityAvailable;
  let body: BodyPartConstant[];
  let boostKey: string;
  let combatPartType: BodyPartConstant;

  if (roleToSpawn === ROLE_KNIGHT) {
    body = buildKnightBody(energy);
    boostKey = "knight";
    combatPartType = ATTACK;
  } else if (roleToSpawn === ROLE_SIEGER) {
    body = buildSiegerBody(energy);
    boostKey = "sieger";
    combatPartType = WORK;
  } else if (roleToSpawn === ROLE_WIZARD) {
    body = buildWizardBody(energy);
    boostKey = "wizard";
    combatPartType = RANGED_ATTACK;
  } else {
    body = buildClericBody(energy);
    boostKey = "cleric";
    combatPartType = HEAL;
  }

  if (room.energyAvailable < calculateBodyPartCost(body)) return false;

  const combatParts = body.filter((p) => p === combatPartType).length;
  const boost = pickBoostCompound(room, boostKey, combatParts);

  const res = spawn.spawnCreep(body, `${roleToSpawn}_off${Game.time}`, {
    memory: {
      role: roleToSpawn,
      homeRoom: room.name,
      offensiveTarget: op.targetRoom,
      ...(boost ? { boostCompound: boost } : {}),
    },
  });
  if (res === OK) {
    console.log(`[Military] Spawning offensive ${roleToSpawn} for ${op.targetRoom}`);
  }
  return res === OK;
}

// ── Standing-defense squad helpers ─────────────────────────────────────────────
//
// Driven by the auto-declared DefenseOp for this room (orchestrator.military). Mirrors
// the offensive squad spawn path — full-capacity bodies, role-ordered front-to-back,
// reusing the shared body builders and boost requests — but tags creeps with
// `defensiveTarget` so they run the in-room defensive behavior instead of an attack.
// Also covers the bootstrapping child-room defender handed down by the expansion
// feature (Memory.expansion.needsDefender).

// Counts current + spawning defenders of a role assigned to defend `targetRoom`.
function countDefendersByRole(targetRoom: string, role: string, homeRoom: Room): number {
  const live = getDefenders(targetRoom).filter((c) => c.memory.role === role).length;
  return live + getRoomSpawningCount(homeRoom, role);
}

// True when the home room (Memory.expansion.homeRoom) must raise a single bootstrap
// defender to clear a contested child room. Bounded to one in-flight defender.
function needsChildRoomDefender(room: Room): boolean {
  const exp = Memory.expansion;
  if (!exp?.needsDefender || exp.homeRoom !== room.name) return false;
  const existing = getCreepsByRole(ROLE_KNIGHT).filter(
    (c) => c.memory.targetRoom === exp.roomName && c.memory.homeRoom === room.name
  );
  return existing.length + getRoomSpawningCount(room, ROLE_KNIGHT) === 0;
}

function shouldSpawnDefender(room: Room): boolean {
  if (needsChildRoomDefender(room)) return true;

  const op = getDefenseOp(room.name);
  if (!op) return false;
  return (
    countDefendersByRole(room.name, ROLE_KNIGHT, room) < op.requiredKnights ||
    countDefendersByRole(room.name, ROLE_WIZARD, room) < op.requiredWizards ||
    countDefendersByRole(room.name, ROLE_CLERIC, room) < op.requiredClerics
  );
}

function spawnNextDefender(room: Room, spawn: StructureSpawn): boolean {
  // Child-room bootstrap defender: a single knight sent to clear the contested child
  // room (bounded to one in-flight) rather than to defend this room.
  if (needsChildRoomDefender(room)) {
    return spawnChildRoomDefender(room, spawn);
  }

  const op = getDefenseOp(room.name);
  if (!op) return false;

  // Spawn order front-to-back: knights screen first, then wizards, then clerics.
  let roleToSpawn: string | null = null;
  let combatPartType: BodyPartConstant = ATTACK;
  let boostKey = "knight";
  let body: BodyPartConstant[];

  // Defenders are urgent — size to currently-available energy so the room isn't left
  // undefended waiting for full capacity while a raid chews the spawn.
  const allowedEnergy = Math.floor(room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE));

  if (countDefendersByRole(room.name, ROLE_KNIGHT, room) < op.requiredKnights) {
    roleToSpawn = ROLE_KNIGHT;
    combatPartType = ATTACK;
    boostKey = "knight";
    body = buildKnightBody(allowedEnergy);
  } else if (countDefendersByRole(room.name, ROLE_WIZARD, room) < op.requiredWizards) {
    roleToSpawn = ROLE_WIZARD;
    combatPartType = RANGED_ATTACK;
    boostKey = "wizard";
    body = buildWizardBody(allowedEnergy);
  } else if (countDefendersByRole(room.name, ROLE_CLERIC, room) < op.requiredClerics) {
    roleToSpawn = ROLE_CLERIC;
    combatPartType = HEAL;
    boostKey = "cleric";
    body = buildClericBody(allowedEnergy);
  } else {
    return false;
  }

  if (room.energyAvailable < calculateBodyPartCost(body)) return false;

  const combatParts = body.filter((p) => p === combatPartType).length;
  const boost = pickBoostCompound(room, boostKey, combatParts);
  const res = spawn.spawnCreep(body, `${roleToSpawn}_def${Game.time}`, {
    memory: {
      role: roleToSpawn,
      homeRoom: room.name,
      defensiveTarget: room.name,
      ...(boost ? { boostCompound: boost } : {}),
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
  const boost = pickBoostCompound(room, "knight", attackParts);
  const res = spawn.spawnCreep(body, `${ROLE_KNIGHT}_child${Game.time}`, {
    memory: {
      role: ROLE_KNIGHT,
      homeRoom: room.name,
      targetRoom: exp.roomName,
      ...(boost ? { boostCompound: boost } : {}),
    },
  });
  if (res === OK) {
    console.log(`[Defense] Spawning child-room defender for ${exp.roomName}`);
  }
  return res === OK;
}

// ── Apothecary helpers ───────────────────────────────────────────────────────────

// ── Power bank squad helpers ──────────────────────────────────────────────────

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
    console.log(`[Power] Spawning ${roleToSpawn} for op #${op.id} → ${op.roomName}`);
  }
  return res === OK;
}

// Attacker: TOUGH absorbs reflected damage, ATTACK parts die last
// 20 TOUGH + 10 MOVE + 20 ATTACK = 50 parts, 2300 energy
function buildPowerAttackerBody(): BodyPartConstant[] {
  return [
    ...Array(20).fill(TOUGH),
    ...Array(10).fill(MOVE),
    ...Array(20).fill(ATTACK),
  ] as BodyPartConstant[];
}

// Healer: MOVE dies before HEAL so healing parts survive longer
// 25 MOVE + 25 HEAL = 50 parts, 7500 energy
function buildPowerHealerBody(): BodyPartConstant[] {
  return [
    ...Array(25).fill(MOVE),
    ...Array(25).fill(HEAL),
  ] as BodyPartConstant[];
}

// Carrier: full carry capacity for collection run
// 25 CARRY + 25 MOVE = 50 parts, 2500 energy
function buildPowerCarrierBody(): BodyPartConstant[] {
  return [
    ...Array(25).fill(CARRY),
    ...Array(25).fill(MOVE),
  ] as BodyPartConstant[];
}

// ── Source Keeper mining squad helpers ────────────────────────────────────────

// Spawns the next needed creep for any SK op homed here: guardian first (it clears
// keepers and reveals the sources), then one Delver per source, then one Wain per
// source. Returns true if a spawn was issued (or held for energy).
function spawnSkCreeps(room: Room, spawn: StructureSpawn): boolean {
  const ops = (Memory.skOps ?? []).filter(
    (o) => o.homeRoom === room.name && !isOpPaused(o)
  );
  for (const op of ops) {
    const members = getSkMembers(op.id);
    const guardians = members.filter((c) => c.memory.role === ROLE_SK_GUARDIAN).length;
    if (guardians < 1) return spawnSkGuardian(room, spawn, op);

    if (!op.discovered || op.sourceIds.length === 0) continue; // wait for vision

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

// Guardian: ranged + heal, MOVE matched to half speed. HEAL-boosted when stock allows
// so it can out-sustain keeper damage.
function buildSkGuardianBody(availableEnergy: number): BodyPartConstant[] {
  // group = RANGED_ATTACK(150) + HEAL(250) + 2×MOVE(100) = 500
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
  const boost = pickBoostCompound(room, "cleric", healParts);
  const res = spawn.spawnCreep(body, `${ROLE_SK_GUARDIAN}${Game.time}`, {
    memory: { role: ROLE_SK_GUARDIAN, homeRoom: room.name, skOpId: op.id, ...(boost ? { boostCompound: boost } : {}) },
  });
  if (res === OK) console.log(`[SK] Spawning guardian for ${op.roomName}`);
  return res === OK;
}

// Delver: WORK-heavy, no CARRY (drops energy for Wains). ~7 WORK saturates a 4000/300t
// SK source; MOVE at roughly half the WORK count for the long approach.
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
  if (res === OK) console.log(`[SK] Spawning delver for ${op.roomName}`);
  return res === OK;
}

function spawnSkHauler(room: Room, spawn: StructureSpawn, op: SourceKeeperOp): boolean {
  const allowedEnergy = Math.floor(room.energyCapacityAvailable * (1 - SPAWN_ENERGY_RESERVE));
  const body = buildRemoteHaulerBody(allowedEnergy); // CARRY:MOVE 1:1, sized to capacity
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const res = spawn.spawnCreep(body, `${ROLE_SK_HAULER}${Game.time}`, {
    memory: { role: ROLE_SK_HAULER, homeRoom: room.name, skOpId: op.id },
  });
  if (res === OK) console.log(`[SK] Spawning wain for ${op.roomName}`);
  return res === OK;
}

function shouldSpawnApothecary(room: Room): boolean {
  // Labs unlock at RCL 6; don't bother before then
  if ((room.controller?.level ?? 0) < 6) return false;
  // Only spawn when labs have been identified (inputLabIds set by orchestrator)
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
