// src/creeps/roles/hauler.ts
import { acquireEnergy } from '../behaviors/energy';

export function run(creep: Creep) {
  if (!(creep.memory as any).state) (creep.memory as any).state = 'acquire';
  const state = (creep.memory as any).state as 'acquire' | 'work';

  const used = creep.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
  const capacity = creep.store.getCapacity(RESOURCE_ENERGY) || 0;

  if (state === 'acquire') {
    const res = acquireEnergy(creep, { preferHarvest: false });
    
    if (used >= capacity * 0.8 || (res === 'none' && used > 0)) {
      (creep.memory as any).state = 'work';
    } else {
      return;
    }
  }

  if (used === 0) {
    (creep.memory as any).state = 'acquire';
    return;
  }

  const targets = creep.room.find(FIND_STRUCTURES, {
    filter: (s: Structure) => {
      if (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) {
        const energy = (s as any).energy || 0;
        const energyCap = (s as any).energyCapacity || 0;
        return energy < energyCap;
      }
      if (s.structureType === STRUCTURE_TOWER) {
        const energy = (s as any).energy || 0;
        const energyCap = (s as any).energyCapacity || 0;
        return energy < energyCap;
      }
      if (s.structureType === STRUCTURE_STORAGE) {
        const store = (s as any).store || {};
        const cap = (s as any).storeCapacity || 0;
        const used = Object.values(store as Record<string, number>).reduce((a, b) => a + b, 0);
        return used < cap;
      }
      return false;
    },
  }) as Structure[];

  if (targets.length > 0) {
    targets.sort((a, b) => {
      const aPriority = getTargetPriority(a);
      const bPriority = getTargetPriority(b);
      if (aPriority !== bPriority) return bPriority - aPriority;
      return creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
    });

    const target = targets[0];
    if (creep.transfer(target as AnyStructure, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(target as any, { visualizePathStyle: { stroke: '#ffffff' } });
    }
  } else {
    const controller = creep.room.controller;
    if (controller && controller.my) {
      if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
        creep.moveTo(controller, { visualizePathStyle: { stroke: '#ffffff' } });
      }
    }
  }
}

function getTargetPriority(structure: Structure): number {
  if (structure.structureType === STRUCTURE_SPAWN) return 100;
  if (structure.structureType === STRUCTURE_EXTENSION) return 90;
  if (structure.structureType === STRUCTURE_TOWER) return 80;
  if (structure.structureType === STRUCTURE_STORAGE) return 10;
  return 0;
}

export default { run };
