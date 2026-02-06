/**
 * CreepActions - Shared creep action utilities
 * Centralized, reusable functions for common creep behaviors to follow DRY principle
 */

/**
 * Harvest energy from the closest active energy source
 * @param creep The creep performing the action
 * @param pathColor Optional color for movement visualization
 * @returns The result of the harvest operation
 */
export function harvestEnergy(creep: Creep, pathColor: string = '#ffaa00'): number {
  const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
  if (source) {
    const result = creep.harvest(source);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { visualizePathStyle: { stroke: pathColor } });
    }
    return result;
  }
  return ERR_NOT_FOUND;
}

/**
 * Harvest minerals from the closest mineral deposit
 * @param creep The creep performing the action
 * @param pathColor Optional color for movement visualization
 * @returns The result of the harvest operation
 */
export function harvestMineral(creep: Creep, pathColor: string = '#8b4513'): number {
  const mineral = creep.pos.findClosestByPath(FIND_MINERALS);
  if (mineral) {
    const result = creep.harvest(mineral);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(mineral, { visualizePathStyle: { stroke: pathColor } });
    }
    return result;
  }
  return ERR_NOT_FOUND;
}

/**
 * Transfer energy to target structures in priority order
 * Priority: Spawn → Extensions → Controller Container
 * @param creep The creep performing the transfer
 * @param includeStructures Array of structure types to include (default: SPAWN and EXTENSION)
 * @param pathColor Optional color for movement visualization
 * @returns The result of the transfer operation
 */
export function transferEnergy(
  creep: Creep,
  includeStructures: string[] = [STRUCTURE_SPAWN, STRUCTURE_EXTENSION],
  pathColor: string = '#ffffff'
): number {
  // Find all structures with free capacity
  const structures = creep.room.find(FIND_STRUCTURES, {
    filter: (structure) => {
      return includeStructures.includes(structure.structureType) &&
             (structure as any).store?.getFreeCapacity(RESOURCE_ENERGY) > 0;
    }
  });

  if (structures.length === 0) {
    return ERR_NOT_FOUND;
  }

  // Priority 1: Spawn
  let target: AnyStructure | null = structures.find(s => s.structureType === STRUCTURE_SPAWN) || null;
  
  // Priority 2: Extensions
  if (!target) {
    target = structures.find(s => s.structureType === STRUCTURE_EXTENSION) || null;
  }

  // Priority 3: Controller container
  if (!target && includeStructures.includes(STRUCTURE_CONTAINER)) {
    target = structures.find(s => 
      s.structureType === STRUCTURE_CONTAINER &&
      creep.room.controller &&
      s.pos.inRangeTo(creep.room.controller.pos, 1)
    ) || null;
  }

  // If still no target, use closest of remaining
  if (!target) {
    target = creep.pos.findClosestByPath(structures) as AnyStructure | null;
  }

  if (target) {
    const result = creep.transfer(target as any, RESOURCE_ENERGY);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(target, { visualizePathStyle: { stroke: pathColor } });
    }
    return result;
  }
  return ERR_NOT_FOUND;
}

/**
 * Pick up dropped energy resources
 * @param creep The creep performing the pickup
 * @param pathColor Optional color for movement visualization
 * @returns The result of the pickup operation
 */
export function pickupEnergy(creep: Creep, pathColor: string = '#ffaa00'): number {
  const droppedEnergy = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
    filter: (resource) => resource.resourceType === RESOURCE_ENERGY
  });

  if (droppedEnergy) {
    const result = creep.pickup(droppedEnergy);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(droppedEnergy, { visualizePathStyle: { stroke: pathColor } });
    }
    return result;
  }
  return ERR_NOT_FOUND;
}

/**
 * Collect energy from containers (harvest secondary source)
 * Excludes the controller-adjacent container reserved for upgraders
 * @param creep The creep performing the collection
 * @param pathColor Optional color for movement visualization
 * @returns The result of the withdraw operation
 */
export function collectFromContainers(creep: Creep, pathColor: string = '#ffa500'): number {
  const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
    filter: (structure) => {
      // Skip containers next to the controller (reserved for upgraders)
      if (creep.room.controller && 
          structure.pos.inRangeTo(creep.room.controller.pos, 1)) {
        return false;
      }

      return (structure.structureType === STRUCTURE_CONTAINER ||
              structure.structureType === STRUCTURE_STORAGE) &&
             (structure as any).store.getUsedCapacity(RESOURCE_ENERGY) > 0;
    }
  }) as StructureContainer | StructureStorage | null;

  if (container) {
    const result = creep.withdraw(container, RESOURCE_ENERGY);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(container, { visualizePathStyle: { stroke: pathColor } });
    }
    return result;
  }
  return ERR_NOT_FOUND;
}

/**
 * Repair the closest damaged structure
 * @param creep The creep performing the repair
 * @param excludeTypes Optional array of structure types to exclude (default: walls and ramparts)
 * @param pathColor Optional color for movement visualization
 * @returns The result of the repair operation
 */
export function repairStructure(
  creep: Creep,
  excludeTypes: string[] = [STRUCTURE_WALL, STRUCTURE_RAMPART],
  pathColor: string = '#ffff00'
): number {
  const target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
    filter: (structure) => {
      return structure.hits < structure.hitsMax &&
             !excludeTypes.includes(structure.structureType);
    }
  });

  if (target) {
    const result = creep.repair(target);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(target, { visualizePathStyle: { stroke: pathColor } });
    }
    return result;
  }
  return ERR_NOT_FOUND;
}

/**
 * Repair walls or ramparts at a minimum threshold health
 * @param creep The creep performing the repair
 * @param minHealth Minimum health threshold (default: 10000)
 * @param pathColor Optional color for movement visualization
 * @returns The result of the repair operation
 */
export function repairWalls(
  creep: Creep,
  minHealth: number = 10000,
  pathColor: string = '#ffff00'
): number {
  const wall = creep.pos.findClosestByPath(FIND_STRUCTURES, {
    filter: (structure) => {
      return (structure.structureType === STRUCTURE_WALL ||
              structure.structureType === STRUCTURE_RAMPART) &&
             structure.hits < minHealth;
    }
  });

  if (wall) {
    const result = creep.repair(wall);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(wall, { visualizePathStyle: { stroke: pathColor } });
    }
    return result;
  }
  return ERR_NOT_FOUND;
}

/**
 * Build the closest construction site
 * @param creep The creep performing the build
 * @param pathColor Optional color for movement visualization
 * @returns The result of the build operation
 */
export function buildStructure(creep: Creep, pathColor: string = '#00ff00'): number {
  const constructionSite = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);

  if (constructionSite) {
    const result = creep.build(constructionSite);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(constructionSite, { visualizePathStyle: { stroke: pathColor } });
    }
    return result;
  }
  return ERR_NOT_FOUND;
}

/**
 * Upgrade the room controller
 * @param creep The creep performing the upgrade
 * @param pathColor Optional color for movement visualization
 * @returns The result of the upgrade operation
 */
export function upgradeController(creep: Creep, pathColor: string = '#00ffff'): number {
  if (creep.room.controller) {
    const result = creep.upgradeController(creep.room.controller);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(creep.room.controller, { visualizePathStyle: { stroke: pathColor } });
    }
    return result;
  }
  return ERR_NOT_FOUND;
}

/**
 * Toggle the working state based on creep's energy level
 * @param creep The creep to toggle state for
 * @returns true if now in working state, false if in harvesting state
 */
export function toggleWorkingState(creep: Creep): boolean {
  if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
    creep.memory.working = false;
    return false;
  }
  if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
    creep.memory.working = true;
    return true;
  }
  return creep.memory.working || false;
}

/**
 * Check if creep is in harvest mode (not working)
 * @param creep The creep to check
 * @returns true if creep should harvest, false if creep should work
 */
export function isHarvestMode(creep: Creep): boolean {
  return !creep.memory.working;
}

/**
 * Check if creep is in working mode
 * @param creep The creep to check
 * @returns true if creep should work, false if creep should harvest
 */
export function isWorkingMode(creep: Creep): boolean {
  return creep.memory.working || false;
}

/**
 * Assign a miner to an energy source, ensuring only one miner per source
 * @param creep The miner creep
 * @returns The assigned source or null if none available
 */
export function assignToSource(creep: Creep): Source | null {
  // Check if already assigned to a valid source
  if (creep.memory.sourceId) {
    const source = Game.getObjectById(creep.memory.sourceId) as Source | null;
    if (source && source.energy > 0) {
      return source;
    }
  }

  // Find all sources in the room
  const sources = creep.room.find(FIND_SOURCES_ACTIVE);
  
  // Find sources not already assigned to another miner
  for (const source of sources) {
    // Check if any other miner is assigned to this source
    const isClaimed = Object.values(Game.creeps).some(
      (otherCreep) => 
        otherCreep.memory.sourceId === source.id && 
        otherCreep.name !== creep.name
    );

    if (!isClaimed) {
      // Assign this source to the miner
      creep.memory.sourceId = source.id;
      return source;
    }
  }

  return null;
}

/**
 * Mine at an assigned source location
 * Miner stays in place and extracts from the source
 * @param creep The miner creep
 * @param pathColor Optional color for movement visualization
 * @returns The result of the harvest operation
 */
export function mineSource(creep: Creep, pathColor: string = '#8b4513'): number {
  const source = assignToSource(creep);
  
  if (!source) {
    return ERR_NOT_FOUND;
  }

  // If not adjacent to the source, move closer
  if (creep.pos.inRangeTo(source.pos, 1)) {
    // Adjacent to the source, harvest it
    return creep.harvest(source);
  } else {
    // Move adjacent to the source
    creep.moveTo(source, { visualizePathStyle: { stroke: pathColor } });
    return ERR_NOT_IN_RANGE;
  }
}
