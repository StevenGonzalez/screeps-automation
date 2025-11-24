// src/creeps/roles/builder.ts
import { SpawnConfig } from '../../config';
import { handleAcquireWork } from '../roleState';

export function run(creep: Creep) {
  const shouldPause = handleAcquireWork(creep, SpawnConfig.builder.minToWorkFraction || 0.5, false);
  if (shouldPause) return;

  const carrying = creep.store.getUsedCapacity(RESOURCE_ENERGY) || 0;

  // try to build nearest construction site
  const site = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES) as ConstructionSite | null;
  if (site && carrying > 0) {
    if (creep.build(site) === ERR_NOT_IN_RANGE) creep.moveTo(site, { visualizePathStyle: { stroke: '#ffffff' } });
    return;
  }

  // no construction: help upgrade
  const controller = creep.room.controller;
  if (controller) {
    if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) creep.moveTo(controller, { visualizePathStyle: { stroke: '#00ff00' } });
  }
}

export default { run };
