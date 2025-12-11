// src/creeps/roles/builder.ts
import { SpawnConfig } from '../../config';
import { handleAcquireWork } from '../roleState';

interface BuilderMemory {
  targetId?: Id<ConstructionSite>;
  _move?: any;
}

export function run(creep: Creep) {
  const shouldPause = handleAcquireWork(creep, SpawnConfig.builder.minToWorkFraction || 0.5, false);
  if (shouldPause) return;

  const memory = creep.memory as BuilderMemory;
  const carrying = creep.store.getUsedCapacity(RESOURCE_ENERGY) || 0;

  if (carrying === 0) {
    memory.targetId = undefined;
    delete memory._move;
    return;
  }

  // Validate existing target
  let target: ConstructionSite | null = null;
  if (memory.targetId) {
    target = Game.getObjectById(memory.targetId);
    if (!target) {
      memory.targetId = undefined;
    }
  }

  // Find new target if needed (expensive - only when necessary)
  if (!target) {
    const sites = creep.room.find(FIND_CONSTRUCTION_SITES);
    
    if (sites.length > 0) {
      // Prioritize non-road structures
      target = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES, {
        filter: (s) => s.structureType !== STRUCTURE_ROAD
      });
      
      // If no non-road sites, build roads
      if (!target) {
        target = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES, {
          filter: (s) => s.structureType === STRUCTURE_ROAD
        });
      }
      
      if (target) {
        memory.targetId = target.id;
      }
    }
  }

  if (target) {
    const result = creep.build(target);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(target, { visualizePathStyle: { stroke: '#ffffff' }, reusePath: 15 });
    } else if (result === OK && target.progress + 5 >= target.progressTotal) {
      // Clear target if almost done
      memory.targetId = undefined;
    }
    return;
  }

  // no construction: help upgrade
  const controller = creep.room.controller;
  if (controller) {
    if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
      creep.moveTo(controller, { visualizePathStyle: { stroke: '#00ff00' }, reusePath: 20 });
    }
  }
}

export default { run };
