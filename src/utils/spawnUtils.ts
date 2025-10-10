import { ROLE_HARVESTER } from "../config/roles";
import { getRoomMemory } from "./memoryUtils";

export function getSpawnForRoom(room: Room): StructureSpawn | null {
  const roomMemory = getRoomMemory(room);
  if (!roomMemory.spawnId) return null;
  return Game.getObjectById(roomMemory.spawnId) as StructureSpawn | null;
}

export function shouldSpawnHarvester(room: Room): boolean {
  const harvesters = getCreepsByRole(ROLE_HARVESTER);
  const targetPopulation = getPopulationTarget(ROLE_HARVESTER, room);
  return harvesters.length < targetPopulation;
}

export function spawnHarvester(room: Room, spawn: StructureSpawn): void {
  const newName = `Harvester${Game.time}`;
  const body = buildScaledBody(ROLE_HARVESTER, room.energyAvailable);
  spawn.spawnCreep(body, newName, {
    memory: { role: ROLE_HARVESTER },
  });
}
import { BODY_PATTERNS, MAX_BODY_PART_COUNT } from "../config/spawning";

export function buildScaledBody(
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

export function calculateBodyPartCost(parts: BodyPartConstant[]): number {
  return parts.reduce((cost, part) => cost + BODYPART_COST[part], 0);
}

export function getCreepsByRole(role: string): Creep[] {
  return Object.values(Game.creeps).filter(
    (creep) => creep.memory.role === role
  );
}

export function getPopulationTarget(role: string, room: Room): number {
  if (role === "harvester") return 2;
  if (role === "upgrader") return 1;
  if (role === "builder") return 1;
  return 0;
}
