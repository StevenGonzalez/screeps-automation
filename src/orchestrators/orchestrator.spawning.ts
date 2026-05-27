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
  ROLE_PALADIN,
  ROLE_CLAIMER,
  ROLE_PIONEER,
  ROLE_CHEMIST,
  normalizeRole,
} from "../config/config.roles";
import { getThreatInfo } from "../services/services.combat";
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
    processRoomSpawning(room);
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
    const role = normalizeRole(creep.memory.role) ?? "";
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
  return room.energyAvailable / cap < 0.25 && room.storage.store[RESOURCE_ENERGY] < 20000;
}

function getHarvesterPopulationTarget(room: Room): number {
  const minerCount = getCreepsByRoleInRoom(ROLE_MINER, room).length;
  const phase = getRoomPhase(room);
  // Bootstrap rooms need harvesters until miners exist; established rooms phase them out.
  // During an energy emergency keep at least 2 harvesters to help the room recover.
  if (phase === "bootstrap" || isEnergyEmergency(room)) return Math.max(2, 2 - minerCount);
  return Math.max(0, 2 - minerCount);
}

function getUpgraderPopulationTarget(room: Room): number {
  // Don't respawn upgraders while the economy is struggling — let them die off naturally.
  if (isEnergyEmergency(room)) return 0;

  const phase = getRoomPhase(room);
  const rcl = room.controller?.level ?? 0;

  // RCL 8 is max — one upgrader is enough (diminishing returns)
  if (rcl >= 8) return 1;

  let base = phase === "bootstrap" ? 1 : 2;

  // Extra upgraders only when storage is comfortably stocked — don't drain the room
  const storage = room.storage;
  if (storage && storage.store[RESOURCE_ENERGY] > 100000) {
    base += Math.floor(storage.store[RESOURCE_ENERGY] / 100000);
  }

  const cap = phase === "powerhouse" ? 4 : 3;
  return Math.min(base, cap);
}

function getBuilderPopulationTarget(room: Room): number {
  if (isEnergyEmergency(room)) return 0;
  const sites = room.find(FIND_CONSTRUCTION_SITES);
  if (sites.length === 0) return 0;
  const phase = getRoomPhase(room);
  if (phase === "bootstrap") return 1;
  return sites.length > 5 ? 2 : 1;
}

function getSpawnForRoom(room: Room): StructureSpawn | null {
  const roomMemory = getRoomMemory(room);
  if (!roomMemory.spawnId) return null;
  return Game.getObjectById(roomMemory.spawnId) as StructureSpawn | null;
}

function processRoomSpawning(room: Room) {
  const spawn = getSpawnForRoom(room);
  if (!spawn) return;
  if (spawn.spawning) return;

  // Emergency recovery: if no energy gatherers exist, bypass energy reserve
  if (!hasEnergyGatherers(room)) {
    spawnEmergencyHarvester(room, spawn);
    return;
  }

  // Core economy — always spawn these first regardless of energy level.
  // Harvesters come before miners: a harvester is cheaper and lets the room
  // recover faster when spawn energy is critically low.
  if (shouldSpawnHarvester(room) && spawnHarvester(room, spawn)) return;
  if (shouldSpawnMiner(room) && spawnMiner(room, spawn)) return;
  if (shouldSpawnHauler(room) && spawnHauler(room, spawn)) return;

  // Non-essential spawns are suppressed during an energy emergency so that
  // every spare joule goes back into harvesters and miners.
  if (isEnergyEmergency(room)) return;

  // Defenders get priority over economy improvements when threats are active.
  // Only spawn in developing+ rooms — bootstrap can't afford the body cost.
  const { score: threatScore } = getThreatInfo(room);
  if (threatScore > 0 && getRoomPhase(room) !== "bootstrap") {
    if (shouldSpawnKnight(room, threatScore) && spawnKnight(room, spawn)) return;
    if (shouldSpawnWizard(room, threatScore) && spawnWizard(room, spawn)) return;
    if (shouldSpawnPaladin(room, threatScore) && spawnPaladin(room, spawn)) return;
  }

  // Expansion: claimer and pioneers are spawned by the home room only
  if (Memory.expansion?.homeRoom === room.name) {
    if (shouldSpawnClaimer() && spawnClaimer(room, spawn)) return;
    if (shouldSpawnPioneer(room) && spawnPioneer(room, spawn)) return;
  }

  if (shouldSpawnChemist(room) && spawnChemist(room, spawn)) return;
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
  WORKS_PER_HAULER: 5,
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

  const totalMinerWork = Object.values(Game.creeps)
    .filter(
      (c) => normalizeRole(c.memory.role) === ROLE_MINER && c.room?.name === room.name
    )
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

  return haulers.length < desired;
}

function spawnHauler(room: Room, spawn: StructureSpawn): boolean {
  const newName = `${ROLE_HAULER}${Game.time}`;
  const allowedEnergy = Math.floor(
    room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE)
  );
  const body = buildScaledBody(ROLE_HAULER, allowedEnergy);
  const res = spawn.spawnCreep(body, newName, {
    memory: { role: ROLE_HAULER, homeRoom: room.name },
  });
  return res === OK;
}

function shouldSpawnMiner(room: Room): boolean {
  const miners = getCreepsByRoleInRoom(ROLE_MINER, room);
  const target = getMinerPopulationTarget(room);
  return miners.length < target;
}

function shouldSpawnHarvester(room: Room): boolean {
  const harvesters = getCreepsByRoleInRoom(ROLE_HARVESTER, room);
  const targetPopulation = getHarvesterPopulationTarget(room);
  return harvesters.length < targetPopulation;
}

function shouldSpawnUpgrader(room: Room): boolean {
  const upgraders = getCreepsByRoleInRoom(ROLE_UPGRADER, room);
  return upgraders.length < getUpgraderPopulationTarget(room);
}

function shouldSpawnBuilder(room: Room): boolean {
  const builders = getCreepsByRoleInRoom(ROLE_BUILDER, room);
  return builders.length < getBuilderPopulationTarget(room);
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
      const wallTarget = getRampartTargetHP(rcl);
      const wallsNeedRepair = room.find(FIND_STRUCTURES, {
        filter: (s): s is AnyStructure =>
          (s.structureType === STRUCTURE_RAMPART || s.structureType === STRUCTURE_WALL) &&
          (s as AnyStructure).hits < wallTarget,
      }).length > 0;
      if (wallsNeedRepair) value = Math.min(2, value + 1);
    }
  }

  repairerTargetCache[room.name] = { value, tick: Game.time };
  return value;
}

function shouldSpawnRepairer(room: Room): boolean {
  const repairers = getCreepsByRoleInRoom(ROLE_REPAIRER, room);
  const target = getRepairerPopulationTarget(room);
  return repairers.length < target && target > 0;
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

  const mineralMiners = getCreepsByRoleInRoom(ROLE_MINERAL_MINER, room);
  return mineralMiners.length === 0;
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
  const maxWork = 5;
  const workParts = Math.min(
    maxWork,
    Math.floor((availableEnergy - moveCost) / workCost)
  );
  if (workParts <= 0) return [WORK, MOVE];
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < workParts; i++) body.push(WORK);
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
  wizard:  ['XUHO2', 'UHO2', 'UO'],   // ranged attack
  paladin: ['XLHO2', 'LHO2', 'LO'],   // heal
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

// Paladin body: HEAL first so MOVE dies before healing parts.
// Cost per pair: HEAL(250) + MOVE(50) = 300.
function buildPaladinBody(availableEnergy: number): BodyPartConstant[] {
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

function shouldSpawnKnight(room: Room, threatScore: number): boolean {
  const target = Math.min(3, Math.ceil(threatScore / 40));
  return getCreepsByRoleInRoom(ROLE_KNIGHT, room).length < target;
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
  const target = Math.min(2, Math.ceil(threatScore / 60));
  return getCreepsByRoleInRoom(ROLE_WIZARD, room).length < target;
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

function shouldSpawnPaladin(room: Room, threatScore: number): boolean {
  if (threatScore < 100) return false;
  const fighters =
    getCreepsByRoleInRoom(ROLE_KNIGHT, room).length +
    getCreepsByRoleInRoom(ROLE_WIZARD, room).length;
  if (fighters === 0) return false;
  return getCreepsByRoleInRoom(ROLE_PALADIN, room).length < 1;
}

function spawnPaladin(room: Room, spawn: StructureSpawn): boolean {
  const allowedEnergy = Math.floor(room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE));
  const body = buildPaladinBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const healParts = body.filter((p) => p === HEAL).length;
  const boost = pickBoostCompound(room, 'paladin', healParts);
  const res = spawn.spawnCreep(body, `${ROLE_PALADIN}${Game.time}`, {
    memory: { role: ROLE_PALADIN, ...(boost ? { boostCompound: boost } : {}) },
  });
  return res === OK;
}

// ── Expansion helpers ─────────────────────────────────────────────────────────

function shouldSpawnClaimer(): boolean {
  const exp = Memory.expansion;
  if (!exp || exp.phase !== "claiming") return false;
  return !getCreepsByRole(ROLE_CLAIMER).some(
    (c) => c.memory.targetRoom === exp.roomName
  );
}

function spawnClaimer(room: Room, spawn: StructureSpawn): boolean {
  const exp = Memory.expansion;
  if (!exp) return false;
  // [CLAIM, MOVE×4] = 800 energy; moves at full speed even on swamp
  const body: BodyPartConstant[] = [CLAIM, MOVE, MOVE, MOVE, MOVE];
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const res = spawn.spawnCreep(body, `${ROLE_CLAIMER}${Game.time}`, {
    memory: {
      role: ROLE_CLAIMER,
      homeRoom: room.name,
      targetRoom: exp.roomName,
    },
  });
  return res === OK;
}

const MAX_PIONEERS = 3;

function shouldSpawnPioneer(room: Room): boolean {
  const exp = Memory.expansion;
  if (!exp || exp.phase !== "bootstrapping" || exp.homeRoom !== room.name) return false;

  // Transition to established once the new room's spawn is visible
  const target = Game.rooms[exp.roomName];
  if (target && target.find(FIND_MY_SPAWNS).length > 0) {
    Memory.expansion!.phase = "established";
    console.log(`[Expansion] ${exp.roomName} is now established!`);
    return false;
  }

  const pioneers = getCreepsByRole(ROLE_PIONEER).filter(
    (c) => c.memory.targetRoom === exp.roomName
  );
  return pioneers.length < MAX_PIONEERS;
}

function spawnPioneer(room: Room, spawn: StructureSpawn): boolean {
  const exp = Memory.expansion;
  if (!exp) return false;
  const allowedEnergy = Math.floor(room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE));
  // Falls back to [WORK, CARRY, MOVE] — enough to harvest and build
  const body = buildScaledBody(ROLE_PIONEER, allowedEnergy);
  const res = spawn.spawnCreep(body, `${ROLE_PIONEER}${Game.time}`, {
    memory: {
      role: ROLE_PIONEER,
      homeRoom: room.name,
      targetRoom: exp.roomName,
    },
  });
  return res === OK;
}

// ── Chemist helpers ───────────────────────────────────────────────────────────

function shouldSpawnChemist(room: Room): boolean {
  // Labs unlock at RCL 6; don't bother before then
  if ((room.controller?.level ?? 0) < 6) return false;
  // Only spawn when labs have been identified (inputLabIds set by orchestrator)
  if (!room.memory.labSystem?.inputLabIds?.length) return false;
  return getCreepsByRoleInRoom(ROLE_CHEMIST, room).length < 1;
}

function spawnChemist(room: Room, spawn: StructureSpawn): boolean {
  const allowedEnergy = Math.floor(room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE));
  const body = buildScaledBody(ROLE_CHEMIST, allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const res = spawn.spawnCreep(body, `${ROLE_CHEMIST}${Game.time}`, {
    memory: { role: ROLE_CHEMIST },
  });
  return res === OK;
}
