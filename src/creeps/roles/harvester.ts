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

  // Check if we're blocking a container position and move off if so
  if (isBlockingContainer(creep)) {
    moveOffContainer(creep);
    return;
  }

  // Validate existing target
  let target: Structure | null = null;
  if (memory.targetId) {
    target = Game.getObjectById(memory.targetId);
    if (target && !canAcceptEnergy(target)) {
      target = null;
      memory.targetId = undefined;
    }
  }

  // Find new target only when needed
  if (!target) {
    target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
      filter: (s: Structure) => canAcceptEnergy(s)
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

function isBlockingContainer(creep: Creep): boolean {
  // Check if standing on a container or container construction site
  const structures = creep.pos.lookFor(LOOK_STRUCTURES);
  const hasContainer = structures.some(s => s.structureType === STRUCTURE_CONTAINER);
  
  const sites = creep.pos.lookFor(LOOK_CONSTRUCTION_SITES);
  const hasContainerSite = sites.some(s => s.structureType === STRUCTURE_CONTAINER);
  
  // Always move off containers
  return hasContainer || hasContainerSite;
}

function moveOffContainer(creep: Creep): void {
  // Find an adjacent position that's not a container
  const terrain = creep.room.getTerrain();
  const directions = [
    TOP, TOP_RIGHT, RIGHT, BOTTOM_RIGHT,
    BOTTOM, BOTTOM_LEFT, LEFT, TOP_LEFT
  ];
  
  for (const dir of directions) {
    const pos = creep.pos;
    let newX = pos.x;
    let newY = pos.y;
    
    switch(dir) {
      case TOP: newY--; break;
      case TOP_RIGHT: newX++; newY--; break;
      case RIGHT: newX++; break;
      case BOTTOM_RIGHT: newX++; newY++; break;
      case BOTTOM: newY++; break;
      case BOTTOM_LEFT: newX--; newY++; break;
      case LEFT: newX--; break;
      case TOP_LEFT: newX--; newY--; break;
    }
    
    if (newX < 1 || newX > 48 || newY < 1 || newY > 48) continue;
    if (terrain.get(newX, newY) === TERRAIN_MASK_WALL) continue;
    
    const newPos = new RoomPosition(newX, newY, pos.roomName);
    
    // Check if this position has a container or container site
    const structures = newPos.lookFor(LOOK_STRUCTURES);
    const hasContainer = structures.some(s => s.structureType === STRUCTURE_CONTAINER);
    
    const sites = newPos.lookFor(LOOK_CONSTRUCTION_SITES);
    const hasContainerSite = sites.some(s => s.structureType === STRUCTURE_CONTAINER);
    
    // Avoid containers and blocking structures (but roads/ramparts are ok)
    const hasBlockingStructure = structures.some(s => 
      s.structureType !== STRUCTURE_ROAD && 
      s.structureType !== STRUCTURE_RAMPART &&
      s.structureType !== STRUCTURE_CONTAINER
    );
    
    if (!hasContainer && !hasContainerSite && !hasBlockingStructure) {
      creep.move(dir);
      return;
    }
  }
}
