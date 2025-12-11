// src/creeps/roles/repairer.ts
import { SpawnConfig } from '../../config';
import { handleAcquireWork } from '../roleState';
import { repairStructures } from '../behaviors/repair';

interface RepairerMemory {
  buildTargetId?: Id<ConstructionSite>;
  _move?: any;
}

/**
 * Repairer role: specializes in maintaining and repairing structures.
 * 
 * Behavior:
 * 1. Acquires energy when empty (prefers withdrawal over harvesting for efficiency)
 * 2. Repairs damaged structures with intelligent prioritization
 * 3. Falls back to building construction sites if no repairs needed
 * 4. Falls back to upgrading controller if no construction sites
 * 
 * Uses memory-backed state management via handleAcquireWork for efficient
 * energy collection and work phase switching.
 */
export function run(creep: Creep) {
  const shouldPause = handleAcquireWork(
    creep, 
    SpawnConfig.repairer.minToWorkFraction || 0.5, 
    false
  );
  
  if (shouldPause) return;

  const memory = creep.memory as RepairerMemory;
  const carrying = creep.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
  
  // Check if we're blocking a container position and move off if so
  if (isBlockingContainer(creep)) {
    moveOffContainer(creep);
    return;
  }
  
  if (carrying === 0) {
    memory.buildTargetId = undefined;
    return;
  }

  const repairResult = repairStructures(creep, {
    criticalThreshold: SpawnConfig.repairer.criticalThreshold,
    generalThreshold: SpawnConfig.repairer.generalThreshold,
    minRampartHits: SpawnConfig.repairer.minRampartHits,
    maxRampartHits: SpawnConfig.repairer.maxRampartHits,
    repairRoads: SpawnConfig.repairer.repairRoads,
    repairContainers: SpawnConfig.repairer.repairContainers,
  });

  if (repairResult === 'repairing') return;

  // Validate cached build target
  let target: ConstructionSite | null = null;
  if (memory.buildTargetId) {
    target = Game.getObjectById(memory.buildTargetId);
    if (!target) {
      memory.buildTargetId = undefined;
    }
  }
  
  // Find new target only if needed
  if (!target) {
    target = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES, {
      filter: (s) => s.structureType !== STRUCTURE_ROAD
    });
    
    if (!target) {
      target = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES, {
        filter: (s) => s.structureType === STRUCTURE_ROAD
      });
    }
    
    if (target) {
      memory.buildTargetId = target.id;
    }
  }
  
  if (target) {
    const buildResult = creep.build(target);
    
    if (buildResult === ERR_NOT_IN_RANGE) {
      creep.moveTo(target, { 
        visualizePathStyle: { stroke: '#ffaa00' },
        reusePath: 15
      });
    } else if (buildResult === OK && target.progress + 5 >= target.progressTotal) {
      // Clear target if almost done
      memory.buildTargetId = undefined;
    }
    
    return;
  }

  const controller = creep.room.controller;
  
  if (controller && controller.my) {
    const upgradeResult = creep.upgradeController(controller);
    
    if (upgradeResult === ERR_NOT_IN_RANGE) {
      creep.moveTo(controller, { 
        visualizePathStyle: { stroke: '#0000ff' },
        reusePath: 20
      });
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
