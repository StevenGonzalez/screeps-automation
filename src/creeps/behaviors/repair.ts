// src/creeps/behaviors/repair.ts

export interface RepairOptions {
  /** Threshold for critical structures (spawns, towers, storage). Default: 0.75 */
  criticalThreshold?: number;
  /** Threshold for non-critical structures (roads, containers). Default: 0.5 */
  generalThreshold?: number;
  /** Minimum hits for ramparts/walls. Default: 10000 */
  minRampartHits?: number;
  /** Maximum hits to repair ramparts/walls to. Default: 50000 */
  maxRampartHits?: number;
  /** Whether to include roads in repair consideration. Default: true */
  repairRoads?: boolean;
  /** Whether to include containers in repair consideration. Default: true */
  repairContainers?: boolean;
}

export type RepairResult = 'repairing' | 'none';

/**
 * Intelligent repair behavior that prioritizes structures based on criticality and damage.
 * 
 * Priority order:
 * 1. Critical structures (spawns, towers, storage, terminal) below criticalThreshold
 * 2. Extensions below criticalThreshold
 * 3. Ramparts/walls below minRampartHits
 * 4. Roads below generalThreshold (if enabled)
 * 5. Containers below generalThreshold (if enabled)
 * 6. Other structures below generalThreshold
 * 7. Ramparts/walls below maxRampartHits (maintenance)
 */
export function repairStructures(creep: Creep, opts?: RepairOptions): RepairResult {
  const options = {
    criticalThreshold: opts?.criticalThreshold ?? 0.75,
    generalThreshold: opts?.generalThreshold ?? 0.5,
    minRampartHits: opts?.minRampartHits ?? 10000,
    maxRampartHits: opts?.maxRampartHits ?? 50000,
    repairRoads: opts?.repairRoads ?? true,
    repairContainers: opts?.repairContainers ?? true,
  };

  const damageRatio = (structure: Structure): number => {
    if (structure.hits === undefined || structure.hitsMax === undefined) return 1;
    return structure.hits / structure.hitsMax;
  };

  const needsRepair = (structure: Structure): boolean => {
    if (structure.hits === undefined || structure.hitsMax === undefined) return false;
    
    const type = structure.structureType;
    const ratio = damageRatio(structure);
    
    if (type === STRUCTURE_SPAWN || type === STRUCTURE_TOWER || 
        type === STRUCTURE_STORAGE || type === STRUCTURE_TERMINAL) {
      return ratio < options.criticalThreshold;
    }
    
    if (type === STRUCTURE_EXTENSION) {
      return ratio < options.criticalThreshold;
    }
    
    if (type === STRUCTURE_RAMPART || type === STRUCTURE_WALL) {
      return structure.hits < options.maxRampartHits;
    }
    
    if (type === STRUCTURE_ROAD) {
      return options.repairRoads && ratio < options.generalThreshold;
    }
    
    if (type === STRUCTURE_CONTAINER) {
      return options.repairContainers && ratio < options.generalThreshold;
    }
    
    return ratio < options.generalThreshold;
  };

  const damagedStructures = creep.room.find(FIND_STRUCTURES, {
    filter: needsRepair
  });

  if (damagedStructures.length === 0) return 'none';

  const priorityScore = (structure: Structure): number => {
    const type = structure.structureType;
    const ratio = damageRatio(structure);
    
    if (type === STRUCTURE_SPAWN || type === STRUCTURE_TOWER || 
        type === STRUCTURE_STORAGE || type === STRUCTURE_TERMINAL) {
      return (ratio * 100);
    }
    
    if (type === STRUCTURE_EXTENSION) {
      return 100 + (ratio * 100);
    }
    
    if (type === STRUCTURE_RAMPART || type === STRUCTURE_WALL) {
      if (structure.hits < options.minRampartHits) {
        return 200 + (structure.hits / options.minRampartHits * 100);
      }
      return 600 + (structure.hits / options.maxRampartHits * 100);
    }
    
    if (type === STRUCTURE_ROAD) {
      return 400 + (ratio * 100);
    }
    
    if (type === STRUCTURE_CONTAINER) {
      return 500 + (ratio * 100);
    }
    
    return 700 + (ratio * 100);
  };

  const sortedTargets = damagedStructures.sort((a, b) => {
    const scoreA = priorityScore(a);
    const scoreB = priorityScore(b);
    
    if (Math.abs(scoreA - scoreB) < 10) {
      return creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
    }
    
    return scoreA - scoreB;
  });

  const target = sortedTargets[0];
  
  if (target) {
    const repairResult = creep.repair(target);
    
    if (repairResult === ERR_NOT_IN_RANGE) {
      creep.moveTo(target, { 
        visualizePathStyle: { stroke: '#00ff00' },
        reusePath: 5
      });
    } else if (repairResult !== OK && repairResult !== ERR_NOT_ENOUGH_RESOURCES) {
      console.log(`Repairer ${creep.name} repair error ${repairResult} on ${target.structureType} at ${target.pos}`);
    }
    
    return 'repairing';
  }

  return 'none';
}

/**
 * Get repair statistics for a room (useful for spawn decisions and monitoring)
 */
export function getRoomRepairStats(room: Room): {
  criticalDamaged: number;
  extensionsDamaged: number;
  rampartsLow: number;
  roadsDamaged: number;
  containersDamaged: number;
  totalDamaged: number;
} {
  const structures = room.find(FIND_STRUCTURES);
  
  const stats = {
    criticalDamaged: 0,
    extensionsDamaged: 0,
    rampartsLow: 0,
    roadsDamaged: 0,
    containersDamaged: 0,
    totalDamaged: 0,
  };

  for (const structure of structures) {
    if (structure.hits === undefined || structure.hitsMax === undefined) continue;
    
    const ratio = structure.hits / structure.hitsMax;
    const type = structure.structureType;
    
    if (type === STRUCTURE_SPAWN || type === STRUCTURE_TOWER || 
        type === STRUCTURE_STORAGE || type === STRUCTURE_TERMINAL) {
      if (ratio < 0.75) {
        stats.criticalDamaged++;
        stats.totalDamaged++;
      }
    } else if (type === STRUCTURE_EXTENSION) {
      if (ratio < 0.75) {
        stats.extensionsDamaged++;
        stats.totalDamaged++;
      }
    } else if (type === STRUCTURE_RAMPART || type === STRUCTURE_WALL) {
      if (structure.hits < 10000) {
        stats.rampartsLow++;
        stats.totalDamaged++;
      }
    } else if (type === STRUCTURE_ROAD) {
      if (ratio < 0.5) {
        stats.roadsDamaged++;
        stats.totalDamaged++;
      }
    } else if (type === STRUCTURE_CONTAINER) {
      if (ratio < 0.5) {
        stats.containersDamaged++;
        stats.totalDamaged++;
      }
    } else if (ratio < 0.5) {
      stats.totalDamaged++;
    }
  }
  
  return stats;
}
