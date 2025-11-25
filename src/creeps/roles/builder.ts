// src/creeps/roles/builder.ts
import { SpawnConfig } from '../../config';
import { handleAcquireWork } from '../roleState';

export function run(creep: Creep) {
  const shouldPause = handleAcquireWork(creep, SpawnConfig.builder.minToWorkFraction || 0.5, false);
  if (shouldPause) return;

  const carrying = creep.store.getUsedCapacity(RESOURCE_ENERGY) || 0;

  // try to build construction sites, prioritizing non-road structures first
  const sites = creep.room.find(FIND_CONSTRUCTION_SITES);
  
  if (sites.length > 0 && carrying > 0) {
    // Find closest non-road site
    let target = creep.pos.findClosestByPath(sites.filter(s => s.structureType !== STRUCTURE_ROAD)) as ConstructionSite | null;
    
    // If no non-road sites, build roads
    if (!target) {
      target = creep.pos.findClosestByPath(sites.filter(s => s.structureType === STRUCTURE_ROAD)) as ConstructionSite | null;
    }
    
    if (target) {
      if (creep.build(target) === ERR_NOT_IN_RANGE) creep.moveTo(target, { visualizePathStyle: { stroke: '#ffffff' } });
      return;
    }
  }

  // no construction: help upgrade
  const controller = creep.room.controller;
  if (controller) {
    if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) creep.moveTo(controller, { visualizePathStyle: { stroke: '#00ff00' } });
  }
}

export default { run };
