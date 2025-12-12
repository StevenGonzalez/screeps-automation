// src/creeps/roles/repairer.ts
import { SpawnConfig } from '../../config';
import { handleAcquireWork } from '../roleState';
import { repairStructures } from '../behaviors/repair';

interface RepairerMemory {
  buildTargetId?: Id<ConstructionSite>;
  _move?: any;
}

/**
 * Repairer role: specializes in maintaining and repairing structures.
 * 
 * Behavior:
 * 1. Acquires energy when empty (prefers withdrawal over harvesting for efficiency)
 * 2. Repairs damaged structures with intelligent prioritization
 * 3. Falls back to building construction sites if no repairs needed
 * 4. Falls back to upgrading controller if no construction sites
 * 
 * Uses memory-backed state management via handleAcquireWork for efficient
 * energy collection and work phase switching.
 */
export function run(creep: Creep) {
  const shouldPause = handleAcquireWork(
    creep, 
    SpawnConfig.repairer.minToWorkFraction || 0.5, 
    false
  );
  
  if (shouldPause) return;

  const memory = creep.memory as RepairerMemory;
  const carrying = creep.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
  
  if (carrying === 0) {
    memory.buildTargetId = undefined;
    return;
  }

  const repairResult = repairStructures(creep, {
    criticalThreshold: SpawnConfig.repairer.criticalThreshold,
    generalThreshold: SpawnConfig.repairer.generalThreshold,
    minRampartHits: SpawnConfig.repairer.minRampartHits,
    maxRampartHits: SpawnConfig.repairer.maxRampartHits,
    repairRoads: SpawnConfig.repairer.repairRoads,
    repairContainers: SpawnConfig.repairer.repairContainers,
  });

  if (repairResult === 'repairing') return;

  // Validate cached build target
  let target: ConstructionSite | null = null;
  if (memory.buildTargetId) {
    target = Game.getObjectById(memory.buildTargetId);
    if (!target) {
      memory.buildTargetId = undefined;
    }
  }
  
  // Find new target only if needed
  if (!target) {
    target = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES, {
      filter: (s) => s.structureType !== STRUCTURE_ROAD
    });
    
    if (!target) {
      target = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES, {
        filter: (s) => s.structureType === STRUCTURE_ROAD
      });
    }
    
    if (target) {
      memory.buildTargetId = target.id;
    }
  }
  
  if (target) {
    const buildResult = creep.build(target);
    
    if (buildResult === ERR_NOT_IN_RANGE) {
      creep.moveTo(target, { 
        visualizePathStyle: { stroke: '#ffaa00' },
        reusePath: 15
      });
    } else if (buildResult === OK && target.progress + 5 >= target.progressTotal) {
      // Clear target if almost done
      memory.buildTargetId = undefined;
    }
    
    return;
  }

  const controller = creep.room.controller;
  
  if (controller && controller.my) {
    const upgradeResult = creep.upgradeController(controller);
    
    if (upgradeResult === ERR_NOT_IN_RANGE) {
      creep.moveTo(controller, { 
        visualizePathStyle: { stroke: '#0000ff' },
        reusePath: 20
      });
    }
  }
}

export default { run };
