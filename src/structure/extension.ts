/**
 * Extension Management
 *
 * Handles extension energy management, fill status monitoring,
 * and energy distribution optimization for spawn capacity.
 */

/// <reference types="@types/screeps" />

/**
 * Manage energy distribution to extensions and spawns
 */
export function manageEnergyDistribution(room: Room): void {
  // This is typically handled by hauler creeps, but we can add
  // logic here for structure-based energy management if needed

  const storage = room.storage;
  const terminal = room.terminal;

  if (!storage && !terminal) return;

  // Check if we need emergency energy distribution
  const spawns = room.find(FIND_MY_SPAWNS);
  const lowEnergySpawns = spawns.filter(
    (spawn) => spawn.store.getUsedCapacity(RESOURCE_ENERGY) < 100
  );

  if (lowEnergySpawns.length > 0) {
    // Look for nearby containers or dropped energy
    lowEnergySpawns.forEach((spawn) => {
      const nearbyEnergy = spawn.pos.findInRange(FIND_DROPPED_RESOURCES, 3, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
      });

      if (nearbyEnergy.length > 0) {
        console.log(
          `⚠️ Emergency: ${nearbyEnergy.length} energy drops near spawn`
        );
      }
    });
  }

  // Monitor extension fill status
  logExtensionStatus(room);
}

/**
 * Get all extensions in a room
 */
export function getExtensionsInRoom(room: Room): StructureExtension[] {
  return room.find(FIND_MY_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_EXTENSION,
  }) as StructureExtension[];
}

/**
 * Get extensions that need energy
 */
export function getExtensionsNeedingEnergy(room: Room): StructureExtension[] {
  const extensions = getExtensionsInRoom(room);
  return extensions.filter(
    (ext) => ext.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  );
}

/**
 * Get extensions that are full of energy
 */
export function getExtensionsFull(room: Room): StructureExtension[] {
  const extensions = getExtensionsInRoom(room);
  return extensions.filter(
    (ext) => ext.store.getFreeCapacity(RESOURCE_ENERGY) === 0
  );
}

/**
 * Calculate extension energy statistics
 */
export function getExtensionEnergyStats(room: Room): any {
  const extensions = getExtensionsInRoom(room);

  if (extensions.length === 0) {
    return {
      total: 0,
      filled: 0,
      empty: 0,
      fillPercent: 100,
      totalCapacity: 0,
      totalEnergy: 0,
    };
  }

  const filled = extensions.filter(
    (ext) => ext.store.getFreeCapacity(RESOURCE_ENERGY) === 0
  );

  const empty = extensions.filter(
    (ext) => ext.store.getUsedCapacity(RESOURCE_ENERGY) === 0
  );

  const totalCapacity = extensions.reduce(
    (sum, ext) => sum + ext.store.getCapacity(RESOURCE_ENERGY),
    0
  );

  const totalEnergy = extensions.reduce(
    (sum, ext) => sum + ext.store.getUsedCapacity(RESOURCE_ENERGY),
    0
  );

  return {
    total: extensions.length,
    filled: filled.length,
    empty: empty.length,
    fillPercent: Math.round((filled.length / extensions.length) * 100),
    totalCapacity,
    totalEnergy,
    energyPercent:
      totalCapacity > 0 ? Math.round((totalEnergy / totalCapacity) * 100) : 0,
  };
}

/**
 * Log extension fill status occasionally
 */
function logExtensionStatus(room: Room): void {
  if (Game.time % 50 !== 0) return;

  const stats = getExtensionEnergyStats(room);

  if (stats.total > 0) {
    console.log(
      `⚡ ${room.name}: Extensions ${stats.fillPercent}% filled (${stats.filled}/${stats.total})`
    );

    // Warning if extensions are consistently empty
    if (stats.fillPercent < 20 && Game.time % 200 === 0) {
      console.log(
        `⚠️ ${room.name}: Low extension fill rate - check hauler efficiency`
      );
    }
  }
}

/**
 * Find the closest extensions needing energy to a given position
 */
export function findClosestExtensionsNeedingEnergy(
  pos: RoomPosition,
  maxRange: number = 50
): StructureExtension[] {
  return pos.findInRange(FIND_MY_STRUCTURES, maxRange, {
    filter: (s) =>
      s.structureType === STRUCTURE_EXTENSION &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  }) as StructureExtension[];
}

/**
 * Check if all extensions in room are full
 */
export function areAllExtensionsFull(room: Room): boolean {
  const extensions = getExtensionsInRoom(room);
  if (extensions.length === 0) return true;

  return extensions.every(
    (ext) => ext.store.getFreeCapacity(RESOURCE_ENERGY) === 0
  );
}

/**
 * Get extension priority fill targets (closest to spawns first)
 */
export function getExtensionFillPriorities(room: Room): StructureExtension[] {
  const extensions = getExtensionsNeedingEnergy(room);
  const spawns = room.find(FIND_MY_SPAWNS);

  if (spawns.length === 0 || extensions.length === 0) return extensions;

  // Sort by distance to closest spawn
  return extensions.sort((a, b) => {
    const distA = Math.min(...spawns.map((spawn) => a.pos.getRangeTo(spawn)));
    const distB = Math.min(...spawns.map((spawn) => b.pos.getRangeTo(spawn)));
    return distA - distB;
  });
}
