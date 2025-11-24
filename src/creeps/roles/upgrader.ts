// src/creeps/roles/upgrader.ts
import { acquireEnergy } from '../behaviors/energy';

export function run(creep: Creep) {
  const free = creep.store.getFreeCapacity(RESOURCE_ENERGY) || 0;

  // keep acquiring until full (not only when empty)
  if (free > 0) {
    const res = acquireEnergy(creep, { preferHarvest: false });
    if (res !== 'none') return;
  }

  const controller = creep.room.controller;
  if (controller) {
    if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) creep.moveTo(controller, { visualizePathStyle: { stroke: '#ffffff' } });
  }
}

export default { run };
