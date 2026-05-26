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
  normalizeRole,
} from "../config/config.roles";

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
  const sources = getSources(room);
  let count = 0;
  for (const source of sources) {
    const containers = room.find(FIND_STRUCTURES, {
      filter: (s) =>
        s.structureType === STRUCTURE_CONTAINER &&
        s.pos.getRangeTo(source.pos) <= 1,
    });
    if (containers.length > 0) count++;
  }
  return count;
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

// Energy is critically low when spawn energy is below 15% capacity AND storage has little energy.
// During this state we suppress non-essential spawns to let the economy recover.
function isEnergyEmergency(room: Room): boolean {
  const stored = room.storage?.store[RESOURCE_ENERGY] ?? 0;
  const cap = room.energyCapacityAvailable;
  return cap > 0 && room.energyAvailable / cap < 0.15 && stored < 5000;
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

  // Extra upgraders when energy is overflowing
  const storage = room.storage;
  if (storage && storage.store[RESOURCE_ENERGY] > 50000) {
    base += Math.floor(storage.store[RESOURCE_ENERGY] / 50000);
  } else if (room.energyAvailable > 1500) {
    base++;
  }

  const cap = phase === "powerhouse" ? 6 : 4;
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

  if (shouldSpawnMineralMiner(room) && spawnMineralMiner(room, spawn)) return;
  // Remote roles after local economy is stable
  if (shouldSpawnScout(room) && spawnScout(room, spawn)) return;
  if (shouldSpawnRemoteMiner(room) && spawnRemoteMiner(room, spawn)) return;
  if (shouldSpawnRemoteHauler(room) && spawnRemoteHauler(room, spawn)) return;
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
  const containers = room.find(FIND_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_CONTAINER,
  }) as StructureContainer[];

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

  const desired = Math.min(
    HAULER_SPAWN.MAX_HAULERS,
    Math.max(containers.length, targetFromWork + extraLong)
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

function getRepairerPopulationTarget(room: Room): number {
  if (isEnergyEmergency(room)) return 0;
  const critical = room.find(FIND_STRUCTURES, {
    filter: (s): s is AnyOwnedStructure | AnyStructure =>
      "hits" in s && "hitsMax" in s && s.hits < s.hitsMax * 0.5,
  });
  return Math.min(3, Math.ceil(critical.length / 3));
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
