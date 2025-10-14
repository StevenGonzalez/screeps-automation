import {
  ROLE_BUILDER,
  ROLE_HARVESTER,
  ROLE_UPGRADER,
} from "../config/config.roles";

import { BODY_PATTERNS, MAX_BODY_PART_COUNT } from "../config/config.spawning";
import { getRoomMemory } from "../services/services.memory";

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
  if (shouldSpawnHarvester(room)) {
    spawnHarvester(room, spawn);
  }
  if (shouldSpawnUpgrader(room)) {
    spawnUpgrader(room, spawn);
  }
  if (shouldSpawnBuilder(room)) {
    spawnBuilder(room, spawn);
  }
}

function shouldSpawnHarvester(room: Room): boolean {
  const harvesters = getCreepsByRole(ROLE_HARVESTER);
  const targetPopulation = getPopulationTarget(ROLE_HARVESTER, room);
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

function spawnHarvester(room: Room, spawn: StructureSpawn): void {
  const newName = `${ROLE_HARVESTER}${Game.time}`;
  const body = buildScaledBody(ROLE_HARVESTER, room.energyAvailable);
  spawn.spawnCreep(body, newName, {
    memory: { role: ROLE_HARVESTER },
  });
}

function spawnUpgrader(room: Room, spawn: StructureSpawn): void {
  const newName = `${ROLE_UPGRADER}${Game.time}`;
  const body = buildScaledBody(ROLE_UPGRADER, room.energyAvailable);
  spawn.spawnCreep(body, newName, {
    memory: { role: ROLE_UPGRADER },
  });
}

function spawnBuilder(room: Room, spawn: StructureSpawn): void {
  const newName = `${ROLE_BUILDER}${Game.time}`;
  const body = buildScaledBody(ROLE_BUILDER, room.energyAvailable);
  spawn.spawnCreep(body, newName, {
    memory: { role: ROLE_BUILDER },
  });
}
