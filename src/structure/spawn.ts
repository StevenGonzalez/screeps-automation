/**
 * Spawn Management
 *
 * Handles spawn energy monitoring, status tracking,
 * and coordination with other energy structures.
 */

/// <reference types="@types/screeps" />

/**
 * Get all spawns in a room
 */
export function getSpawnsInRoom(room: Room): StructureSpawn[] {
  return room.find(FIND_MY_SPAWNS);
}

/**
 * Get spawns that are currently idle (not spawning)
 */
export function getIdleSpawns(room: Room): StructureSpawn[] {
  return room.find(FIND_MY_SPAWNS, {
    filter: (spawn) => !spawn.spawning,
  });
}

/**
 * Get spawns that are currently spawning
 */
export function getBusySpawns(room: Room): StructureSpawn[] {
  return room.find(FIND_MY_SPAWNS, {
    filter: (spawn) => spawn.spawning !== null,
  });
}

/**
 * Get spawns that need energy
 */
export function getSpawnsNeedingEnergy(room: Room): StructureSpawn[] {
  return room.find(FIND_MY_SPAWNS, {
    filter: (spawn) => spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  });
}

/**
 * Get spawn energy statistics
 */
export function getSpawnEnergyStats(room: Room): any {
  const spawns = getSpawnsInRoom(room);

  if (spawns.length === 0) {
    return {
      count: 0,
      totalCapacity: 0,
      totalEnergy: 0,
      energyPercent: 0,
      idleCount: 0,
      busyCount: 0,
    };
  }

  const totalCapacity = spawns.reduce(
    (sum, spawn) => sum + spawn.store.getCapacity(RESOURCE_ENERGY),
    0
  );

  const totalEnergy = spawns.reduce(
    (sum, spawn) => sum + spawn.store.getUsedCapacity(RESOURCE_ENERGY),
    0
  );

  const idleSpawns = getIdleSpawns(room);
  const busySpawns = getBusySpawns(room);

  return {
    count: spawns.length,
    totalCapacity,
    totalEnergy,
    energyPercent:
      totalCapacity > 0 ? Math.round((totalEnergy / totalCapacity) * 100) : 0,
    idleCount: idleSpawns.length,
    busyCount: busySpawns.length,
  };
}

/**
 * Check if any spawn is critically low on energy
 */
export function hasLowEnergySpawns(
  room: Room,
  threshold: number = 100
): boolean {
  const spawns = getSpawnsInRoom(room);
  return spawns.some(
    (spawn) => spawn.store.getUsedCapacity(RESOURCE_ENERGY) < threshold
  );
}

/**
 * Get the spawn with the most energy
 */
export function getSpawnWithMostEnergy(room: Room): StructureSpawn | null {
  const spawns = getSpawnsInRoom(room);
  if (spawns.length === 0) return null;

  return spawns.reduce((prev, curr) =>
    curr.store.getUsedCapacity(RESOURCE_ENERGY) >
    prev.store.getUsedCapacity(RESOURCE_ENERGY)
      ? curr
      : prev
  );
}

/**
 * Get the spawn with the least energy
 */
export function getSpawnWithLeastEnergy(room: Room): StructureSpawn | null {
  const spawns = getSpawnsInRoom(room);
  if (spawns.length === 0) return null;

  return spawns.reduce((prev, curr) =>
    curr.store.getUsedCapacity(RESOURCE_ENERGY) <
    prev.store.getUsedCapacity(RESOURCE_ENERGY)
      ? curr
      : prev
  );
}

/**
 * Log spawn status information
 */
export function logSpawnStatus(room: Room): void {
  if (Game.time % 100 !== 0) return;

  const stats = getSpawnEnergyStats(room);

  if (stats.count > 0) {
    console.log(
      `🏭 ${room.name}: ${stats.idleCount}/${stats.count} spawns idle, ` +
        `${stats.energyPercent}% energy`
    );

    // Log currently spawning creeps
    const busySpawns = getBusySpawns(room);
    busySpawns.forEach((spawn) => {
      if (spawn.spawning) {
        const progress = Math.round(
          ((spawn.spawning.needTime - spawn.spawning.remainingTime) /
            spawn.spawning.needTime) *
            100
        );
        console.log(
          `⏳ ${spawn.name}: Spawning ${spawn.spawning.name} (${progress}%)`
        );
      }
    });
  }
}

/**
 * Find closest spawn to a position
 */
export function findClosestSpawn(pos: RoomPosition): StructureSpawn | null {
  return pos.findClosestByPath(FIND_MY_SPAWNS);
}

/**
 * Check if spawns can handle emergency spawning
 */
export function canEmergencySpawn(
  room: Room,
  energyRequired: number = 200
): boolean {
  const spawns = getIdleSpawns(room);
  if (spawns.length === 0) return false;

  // Check if we have enough energy available for emergency spawn
  const totalEnergyCapacity = room.energyCapacityAvailable;
  const totalEnergyAvailable = room.energyAvailable;

  return totalEnergyAvailable >= energyRequired && spawns.length > 0;
}
