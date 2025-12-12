// src/creeps/roles/harvester.ts

import { SpawnConfig } from '../../config';
import { handleAcquireWork } from '../roleState';

interface HarvesterMemory {
  targetId?: Id<Structure>;
  _move?: any;
}

export function run(creep: Creep) {
  const shouldPause = handleAcquireWork(creep, SpawnConfig.upgrader.minToWorkFraction || 0.5, true);
  if (shouldPause) return;

  const memory = creep.memory as HarvesterMemory;
  const carrying = creep.store.getUsedCapacity(RESOURCE_ENERGY);

  if (carrying === 0) {
    memory.targetId = undefined;
    delete memory._move;
    return;
  }

  // Validate existing target
  let target: Structure | null = null;
  if (memory.targetId) {
    target = Game.getObjectById(memory.targetId);
    if (target && (!canAcceptEnergy(target) || isMinerContainer(target))) {
      target = null;
      memory.targetId = undefined;
    }
  }

  // Find new target only when needed
  if (!target) {
    target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
      filter: (s: Structure) => canAcceptEnergy(s) && !isMinerContainer(s)
    }) as Structure | null;

    if (target) {
      memory.targetId = target.id;
    }
  }

  if (target) {
    const result = creep.transfer(target as AnyStructure, RESOURCE_ENERGY);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(target as any, { visualizePathStyle: { stroke: '#ffffff' }, reusePath: 15 });
    } else if (result === OK || result === ERR_FULL) {
      memory.targetId = undefined;
    }
  } else {
    const controller = creep.room.controller;
    if (controller) {
      if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
        creep.moveTo(controller, { reusePath: 20 });
      }
    }
  }
}

function canAcceptEnergy(s: Structure): boolean {
  if (s.structureType === STRUCTURE_STORAGE || s.structureType === STRUCTURE_CONTAINER || s.structureType === STRUCTURE_TERMINAL) {
    const store = (s as any).store || {};
    const cap = (s as any).storeCapacity || 0;
    const used = Object.values(store as Record<string, number>).reduce((a, b) => a + b, 0);
    return used < cap;
  }
  if (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION || s.structureType === STRUCTURE_TOWER) {
    const energy = (s as any).energy || 0;
    const energyCap = (s as any).energyCapacity || 0;
    return energy < energyCap;
  }
  return false;
}

function isMinerContainer(s: Structure): boolean {
  if (s.structureType !== STRUCTURE_CONTAINER) return false;
  // Check if there's a miner creep on this container
  const creepsOnContainer = s.pos.lookFor(LOOK_CREEPS);
  return creepsOnContainer.some(c => c.my && (c.memory as any).role === 'miner');
}

export default { run };
