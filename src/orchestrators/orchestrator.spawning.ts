import {
  ROLE_BUILDER,
  ROLE_HARVESTER,
  ROLE_UPGRADER,
  ROLE_REPAIRER,
  ROLE_MINER,
  ROLE_HAULER,
} from "../config/config.roles";

import { BODY_PATTERNS, MAX_BODY_PART_COUNT } from "../config/config.spawning";
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
  if (role === "harvester") {
    const body: BodyPartConstant[] = [];
    let energyLeft = availableEnergy;
    while (energyLeft >= 200) {
      body.push(WORK, CARRY, MOVE);
      energyLeft -= 200;
    }
    return body;
  }
  const pattern = BODY_PATTERNS[role];
  if (!pattern) {
    return [WORK, CARRY, MOVE];
  }
  const patternCost = calculateBodyPartCost(pattern);
  const body: BodyPartConstant[] = [];
  let timesToRepeat = Math.floor(availableEnergy / patternCost);
  timesToRepeat = Math.min(
    timesToRepeat,
    Math.floor(MAX_BODY_PART_COUNT / pattern.length)
  );
  for (let i = 0; i < timesToRepeat; i++) {
    body.push(...pattern);
  }
  if (body.length === 0) {
    return pattern;
  }
  return body;
}

function calculateBodyPartCost(parts: BodyPartConstant[]): number {
  return parts.reduce((cost, part) => cost + BODYPART_COST[part], 0);
}

function getCreepsByRole(role: string): Creep[] {
  return Object.values(Game.creeps).filter(
    (creep) => creep.memory.role === role
  );
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

function getHarvesterPopulationTarget(room: Room): number {
  const minerCount = getCreepsByRole(ROLE_MINER).filter(
    (c) => c.room.name === room.name
  ).length;
  return Math.max(0, 2 - minerCount);
}

function getPopulationTarget(role: string, room: Room): number {
  if (role === ROLE_HARVESTER) return 2;
  if (role === ROLE_UPGRADER) return 1;
  if (role === ROLE_BUILDER) return 1;
  return 0;
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
  if (shouldSpawnMiner(room) && spawnMiner(room, spawn)) return;
  if (shouldSpawnHauler(room) && spawnHauler(room, spawn)) return;
  if (shouldSpawnHarvester(room) && spawnHarvester(room, spawn)) return;
  if (shouldSpawnUpgrader(room) && spawnUpgrader(room, spawn)) return;
  if (shouldSpawnBuilder(room) && spawnBuilder(room, spawn)) return;
  if (shouldSpawnRepairer(room) && spawnRepairer(room, spawn)) return;
}

function shouldSpawnHauler(room: Room): boolean {
  const containers = room.find(FIND_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_CONTAINER,
  });
  const haulers = getCreepsByRole(ROLE_HAULER).filter(
    (c) => c.room.name === room.name
  );
  return haulers.length < containers.length && containers.length > 0;
}

function spawnHauler(room: Room, spawn: StructureSpawn): boolean {
  const newName = `${ROLE_HAULER}${Game.time}`;
  const body = buildScaledBody(ROLE_HAULER, room.energyAvailable);
  const res = spawn.spawnCreep(body, newName, {
    memory: { role: ROLE_HAULER },
  });
  return res === OK;
}

function shouldSpawnMiner(room: Room): boolean {
  const miners = getCreepsByRole(ROLE_MINER).filter(
    (c) => c.room.name === room.name
  );
  const target = getMinerPopulationTarget(room);
  return miners.length < target;
}

function shouldSpawnHarvester(room: Room): boolean {
  const harvesters = getCreepsByRole(ROLE_HARVESTER).filter(
    (c) => c.room.name === room.name
  );
  const targetPopulation = getHarvesterPopulationTarget(room);
  return harvesters.length < targetPopulation;
}

function shouldSpawnUpgrader(room: Room): boolean {
  const upgraders = getCreepsByRole(ROLE_UPGRADER);
  const targetPopulation = getPopulationTarget(ROLE_UPGRADER, room);
  return upgraders.length < targetPopulation;
}

function shouldSpawnBuilder(room: Room): boolean {
  const builders = getCreepsByRole(ROLE_BUILDER);
  const targetPopulation = getPopulationTarget(ROLE_BUILDER, room);
  if (builders.length >= targetPopulation) return false;
  const sites = room.find(FIND_CONSTRUCTION_SITES);
  return sites.length > 0;
}
function shouldSpawnRepairer(room: Room): boolean {
  const repairers = getCreepsByRole(ROLE_REPAIRER);
  const local = repairers.filter((c) => c.room?.name === room.name);
  if (local.length > 0) return false;
  const critical = room.find(FIND_STRUCTURES, {
    filter: (s) =>
      s.structureType === STRUCTURE_RAMPART &&
      (s as StructureRampart).hits < 2000,
  });
  return critical.length > 0;
}

function spawnRepairer(room: Room, spawn: StructureSpawn): boolean {
  const newName = `${ROLE_REPAIRER}${Game.time}`;
  const body = buildScaledBody(ROLE_REPAIRER, room.energyAvailable);
  const res = spawn.spawnCreep(body, newName, {
    memory: { role: ROLE_REPAIRER },
  });
  return res === OK;
}

function spawnHarvester(room: Room, spawn: StructureSpawn): boolean {
  const newName = `${ROLE_HARVESTER}${Game.time}`;
  const body = buildScaledBody(ROLE_HARVESTER, room.energyAvailable);
  const res = spawn.spawnCreep(body, newName, {
    memory: { role: ROLE_HARVESTER },
  });
  return res === OK;
}

function spawnUpgrader(room: Room, spawn: StructureSpawn): boolean {
  const newName = `${ROLE_UPGRADER}${Game.time}`;
  const body = buildScaledBody(ROLE_UPGRADER, room.energyAvailable);
  const res = spawn.spawnCreep(body, newName, {
    memory: { role: ROLE_UPGRADER },
  });
  return res === OK;
}

function spawnBuilder(room: Room, spawn: StructureSpawn): boolean {
  const newName = `${ROLE_BUILDER}${Game.time}`;
  const body = buildScaledBody(ROLE_BUILDER, room.energyAvailable);
  const res = spawn.spawnCreep(body, newName, {
    memory: { role: ROLE_BUILDER },
  });
  return res === OK;
}

function spawnMiner(room: Room, spawn: StructureSpawn): boolean {
  const newName = `${ROLE_MINER}${Game.time}`;
  const maxWorkParts = 5;
  let availableEnergy = room.energyAvailable;
  const workCost = BODYPART_COST[WORK];
  const moveCost = BODYPART_COST[MOVE];
  let workParts = Math.min(
    Math.floor(availableEnergy / (workCost + moveCost)),
    maxWorkParts
  );
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < workParts; i++) {
    body.push(WORK, MOVE);
  }
  if (body.length === 0) body.push(WORK, MOVE);
  const res = spawn.spawnCreep(body, newName, {
    memory: { role: ROLE_MINER },
  });
  return res === OK;
}
