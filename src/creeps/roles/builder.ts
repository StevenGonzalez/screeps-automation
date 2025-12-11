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

  // Check if we're blocking a container position and move off if so
  if (isBlockingContainer(creep)) {
    moveOffContainer(creep);
    return;
  }

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

function isBlockingContainer(creep: Creep): boolean {
  // Check if standing on a container or container construction site
  const structures = creep.pos.lookFor(LOOK_STRUCTURES);
  const hasContainer = structures.some(s => s.structureType === STRUCTURE_CONTAINER);
  
  const sites = creep.pos.lookFor(LOOK_CONSTRUCTION_SITES);
  const hasContainerSite = sites.some(s => s.structureType === STRUCTURE_CONTAINER);
  
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
    const structuresAtPos = newPos.lookFor(LOOK_STRUCTURES);
    const hasContainerAtPos = structuresAtPos.some(s => 
      s.structureType === STRUCTURE_CONTAINER ||
      (s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_RAMPART)
    );
    
    if (!hasContainerAtPos) {
      creep.move(dir);
      return;
    }
  }
}

export default { run };
