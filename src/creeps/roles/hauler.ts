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
      if (s.structureType === STRUCTURE_CONTAINER) {
        const container = s as StructureContainer;
        const energyAmount = container.store[RESOURCE_ENERGY] || 0;
        const cap = container.store.getCapacity() || 0;
        // Only fill controller containers if they're less than 80% full
        const controller = container.room.controller;
        if (controller && container.pos.inRangeTo(controller.pos, 3)) {
          return energyAmount < cap * 0.8;
        }
        // Don't fill miner containers (miners drop energy there)
        const crepsOnContainer = container.pos.lookFor(LOOK_CREEPS);
        const hasMiner = crepsOnContainer.some(c => c.my && c.memory.role === 'miner');
        if (hasMiner) return false;
        return energyAmount < cap;
      }
      if (s.structureType === STRUCTURE_STORAGE) {
        const storage = s as StructureStorage;
        return storage.store.getFreeCapacity() !== null && storage.store.getFreeCapacity()! > 0;
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
  
  if (structure.structureType === STRUCTURE_CONTAINER) {
    const controller = structure.room.controller;
    if (controller && structure.pos.inRangeTo(controller.pos, 3)) {
      return 70;
    }
    return 20;
  }
  
  if (structure.structureType === STRUCTURE_STORAGE) return 10;
  return 0;
}

export default { run };
