// src/creeps/roles/harvester.ts

import { SpawnConfig } from '../../config';
import { handleAcquireWork } from '../roleState';

export function run(creep: Creep) {
  const shouldPause = handleAcquireWork(creep, SpawnConfig.upgrader.minToWorkFraction || 0.5, true);
  if (shouldPause) return;

  // WORK: deliver to structures or upgrade if nothing
  const target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
    filter: (s: Structure) => {
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
    },
  }) as Structure | null;

  if (target) {
    if (creep.transfer(target as AnyStructure, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(target as any, { visualizePathStyle: { stroke: '#ffffff' } });
  } else {
    const controller = creep.room.controller;
    if (controller) {
      if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) creep.moveTo(controller);
    }
  }
}
