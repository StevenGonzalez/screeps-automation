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
      (creep.memory as any).targetId = undefined; // Clear any old target
    } else {
      return;
    }
  }

  if (used === 0) {
    (creep.memory as any).state = 'acquire';
    (creep.memory as any).targetId = undefined;
    return;
  }

  // Check if we have a stored target
  let target: Structure | null = null;
  const targetId = (creep.memory as any).targetId as string | undefined;
  if (targetId) {
    target = Game.getObjectById(targetId) as Structure | null;
    // Validate the target is still valid
    if (target && !canAcceptEnergy(target)) {
      target = null;
      (creep.memory as any).targetId = undefined;
    }
  }

  // If no valid target, find a new one
  if (!target) {
    const targets = creep.room.find(FIND_STRUCTURES, {
      filter: (s: Structure) => canAcceptEnergy(s)
    }) as Structure[];

    if (targets.length > 0) {
      targets.sort((a, b) => {
        const aPriority = getTargetPriority(a);
        const bPriority = getTargetPriority(b);
        if (aPriority !== bPriority) return bPriority - aPriority;
        return creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
      });

      target = targets[0];
      (creep.memory as any).targetId = target.id;
    }
  }

  if (target) {
    const transferResult = creep.transfer(target as AnyStructure, RESOURCE_ENERGY);
    if (transferResult === ERR_NOT_IN_RANGE) {
      creep.moveTo(target as any, { visualizePathStyle: { stroke: '#ffffff' } });
    } else if (transferResult === OK) {
      // Successfully transferred, clear target to find a new one next tick
      (creep.memory as any).targetId = undefined;
    } else if (transferResult === ERR_FULL) {
      // Target is full, clear it and find a new one
      (creep.memory as any).targetId = undefined;
    }
  } else {
    // No valid targets, upgrade controller as fallback
    const controller = creep.room.controller;
    if (controller && controller.my) {
      if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
        creep.moveTo(controller, { visualizePathStyle: { stroke: '#ffffff' } });
      }
    }
  }
}

function canAcceptEnergy(structure: Structure): boolean {
  if (structure.structureType === STRUCTURE_SPAWN || structure.structureType === STRUCTURE_EXTENSION) {
    const energy = (structure as any).energy || 0;
    const energyCap = (structure as any).energyCapacity || 0;
    return energy < energyCap;
  }
  if (structure.structureType === STRUCTURE_TOWER) {
    const energy = (structure as any).energy || 0;
    const energyCap = (structure as any).energyCapacity || 0;
    return energy < energyCap;
  }
  if (structure.structureType === STRUCTURE_CONTAINER) {
    const container = structure as StructureContainer;
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
  if (structure.structureType === STRUCTURE_STORAGE) {
    const storage = structure as StructureStorage;
    return storage.store.getFreeCapacity() !== null && storage.store.getFreeCapacity()! > 0;
  }
  return false;
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
