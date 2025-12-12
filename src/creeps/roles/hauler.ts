// src/creeps/roles/hauler.ts
import { acquireEnergy } from '../behaviors/energy';
import { RoomCache } from '../../utils/roomCache';

interface HaulerMemory {
  state?: 'acquire' | 'work';
  sourceId?: Id<Source | StructureContainer | StructureStorage | Resource>;
  destinationId?: Id<StructureExtension | StructureSpawn | StructureTower | StructureContainer | StructureStorage>;
  _move?: any;
}

// Static reservation tracking
const sourceReservations = new Map<string, number>();
const destinationReservations = new Map<string, number>();

export function run(creep: Creep) {
  const memory = creep.memory as HaulerMemory;

  // Initialize state
  if (!memory.state) memory.state = 'acquire';

  // Clear reservations if creep is dying
  if (creep.ticksToLive && creep.ticksToLive < 50) {
    clearReservations(creep);
  }

  const used = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  const capacity = creep.store.getCapacity(RESOURCE_ENERGY);

  // State transitions
  if (used === 0) {
    memory.state = 'acquire';
    memory.destinationId = undefined;
    delete memory._move;
  } else if (used >= capacity) {
    memory.state = 'work';
    memory.sourceId = undefined;
    delete memory._move;
  }

  if (memory.state === 'acquire') {
    collectEnergy(creep);
  } else {
    deliverEnergy(creep);
  }
}

function collectEnergy(creep: Creep): void {
  const memory = creep.memory as HaulerMemory;
  
  // Validate existing target
  if (memory.sourceId) {
    const target = Game.getObjectById(memory.sourceId);
    if (!target || !isValidSource(target)) {
      clearSourceReservation(creep);
      memory.sourceId = undefined;
    }
  }

  // Find new target if needed
  if (!memory.sourceId) {
    const target = findBestSource(creep);
    if (target) {
      memory.sourceId = target.id as any;
      reserveSource(target.id, creep.store.getFreeCapacity(RESOURCE_ENERGY));
    }
  }

  // Collect from target
  if (memory.sourceId) {
    const target = Game.getObjectById(memory.sourceId);
    if (target) {
      let result: ScreepsReturnCode;
      
      if (target instanceof Resource) {
        result = creep.pickup(target);
      } else if (target instanceof Source) {
        result = creep.harvest(target);
      } else {
        result = creep.withdraw(target, RESOURCE_ENERGY);
      }

      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { visualizePathStyle: { stroke: '#ffaa00' }, reusePath: 20 });
      } else if (result === OK || result === ERR_FULL) {
        // Clear target when successful or full
        clearSourceReservation(creep);
        memory.sourceId = undefined;
      }
    }
  }
}

function deliverEnergy(creep: Creep): void {
  const memory = creep.memory as HaulerMemory;
  
  // Validate existing target
  if (memory.destinationId) {
    const target = Game.getObjectById(memory.destinationId);
    if (!target || !isValidDestination(target)) {
      clearDestinationReservation(creep);
      memory.destinationId = undefined;
    }
  }

  // Find new target if needed
  if (!memory.destinationId) {
    const target = findBestDestination(creep);
    if (target) {
      memory.destinationId = target.id as any;
      reserveDestination(target.id, creep.store.getUsedCapacity(RESOURCE_ENERGY));
    }
  }

  // Deliver to target
  if (memory.destinationId) {
    const target = Game.getObjectById(memory.destinationId);
    if (target) {
      const result = creep.transfer(target, RESOURCE_ENERGY);
      
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { visualizePathStyle: { stroke: '#ffffff' }, reusePath: 20 });
      } else if (result === OK || result === ERR_FULL) {
        // Clear target when successful or full
        clearDestinationReservation(creep);
        memory.destinationId = undefined;
      }
    }
  } else {
    // No valid targets, upgrade controller as fallback
    const controller = creep.room.controller;
    if (controller && controller.my) {
      if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
        creep.moveTo(controller, { visualizePathStyle: { stroke: '#ffffff' }, reusePath: 20 });
      }
    }
  }
}

function findBestSource(creep: Creep): Source | StructureContainer | StructureStorage | Resource | null {
  const room = creep.room;
  const controller = room.controller;
  
  // Priority 1: Miner containers with energy (not controller containers, not over-reserved)
  const containers = RoomCache.getContainers(room).filter((container) => {
    const energyAmount = container.store.getUsedCapacity(RESOURCE_ENERGY);
    if (energyAmount === 0) return false;
    
    // Exclude controller containers - those are for upgraders only
    if (controller && container.pos.inRangeTo(controller.pos, 3)) return false;
    
    // Check if not over-reserved
    const reserved = sourceReservations.get(container.id) || 0;
    return energyAmount - reserved > 50;
  });

  // Priority 2: Storage
  const storage = room.storage;
  if (storage && storage.store.getUsedCapacity(RESOURCE_ENERGY) > 100) {
    const reserved = sourceReservations.get(storage.id) || 0;
    const available = storage.store.getUsedCapacity(RESOURCE_ENERGY) - reserved;
    if (available > 50) {
      containers.push(storage as any);
    }
  }

  if (containers.length > 0) {
    return creep.pos.findClosestByPath(containers, {
      filter: (c) => {
        const reserved = sourceReservations.get(c.id) || 0;
        return c.store.getUsedCapacity(RESOURCE_ENERGY) - reserved > 0;
      }
    });
  }

  // Priority 3: Dropped energy
  const droppedEnergy = RoomCache.getDroppedResources(room).filter(
    (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50
  );
  
  if (droppedEnergy.length > 0) {
    return creep.pos.findClosestByPath(droppedEnergy);
  }

  // Priority 4: Sources (last resort)
  const sources = RoomCache.getActiveSources(room);
  return creep.pos.findClosestByPath(sources);
}

function findBestDestination(creep: Creep): StructureExtension | StructureSpawn | StructureTower | StructureContainer | StructureStorage | null {
  const room = creep.room;
  const energyCarried = creep.store.getUsedCapacity(RESOURCE_ENERGY);

  // Priority 1: Spawns and extensions that need energy
  const spawns = RoomCache.getMySpawns(room).filter((structure) => {
    const reserved = destinationReservations.get(structure.id) || 0;
    const capacity = structure.store.getFreeCapacity(RESOURCE_ENERGY);
    return capacity - reserved > 0;
  });

  const extensions = RoomCache.getMyExtensions(room).filter((structure) => {
    const reserved = destinationReservations.get(structure.id) || 0;
    const capacity = structure.store.getFreeCapacity(RESOURCE_ENERGY);
    return capacity - reserved > 0;
  });

  const spawnExtensions = [...spawns, ...extensions];

  if (spawnExtensions.length > 0) {
    return creep.pos.findClosestByPath(spawnExtensions, {
      filter: (t) => {
        const reserved = destinationReservations.get(t.id) || 0;
        return t.store.getFreeCapacity(RESOURCE_ENERGY) - reserved >= Math.min(energyCarried, 50);
      }
    });
  }

  // Priority 2: Towers below 80% capacity
  const towers = RoomCache.getMyTowers(room).filter((s) => {
    const reserved = destinationReservations.get(s.id) || 0;
    return s.store.getFreeCapacity(RESOURCE_ENERGY) - reserved > 200;
  });

  if (towers.length > 0) {
    return creep.pos.findClosestByPath(towers);
  }

  // Priority 3: Controller containers (if less than 80% full)
  const controller = room.controller;
  if (controller) {
    const controllerContainers = RoomCache.getContainers(room).filter((s) => {
      if (!s.pos.inRangeTo(controller.pos, 3)) return false;
      const reserved = destinationReservations.get(s.id) || 0;
      const freeCapacity = s.store.getFreeCapacity(RESOURCE_ENERGY);
      return freeCapacity - reserved > 0 && 
             s.store.getUsedCapacity(RESOURCE_ENERGY) < s.store.getCapacity() * 0.8;
    });

    if (controllerContainers.length > 0) {
      return creep.pos.findClosestByPath(controllerContainers);
    }
  }

  // Priority 4: Storage (with reservation checking)
  const storage = room.storage;
  if (storage) {
    const reserved = destinationReservations.get(storage.id) || 0;
    const freeCapacity = storage.store.getFreeCapacity(RESOURCE_ENERGY);
    if (freeCapacity - reserved > 0) {
      return storage as any;
    }
  }

  return null;
}

function isValidSource(target: Source | StructureContainer | StructureStorage | Resource): boolean {
  if (target instanceof Source) {
    return target.energy > 0;
  }
  if (target instanceof Resource) {
    return target.amount > 0;
  }
  return target.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
}

function isValidDestination(target: StructureExtension | StructureSpawn | StructureTower | StructureContainer | StructureStorage): boolean {
  return target.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
}

// Reservation system
function reserveSource(id: string, amount: number): void {
  const current = sourceReservations.get(id) || 0;
  sourceReservations.set(id, current + amount);
}

function reserveDestination(id: string, amount: number): void {
  const current = destinationReservations.get(id) || 0;
  destinationReservations.set(id, current + amount);
}

function clearSourceReservation(creep: Creep): void {
  const memory = creep.memory as HaulerMemory;
  if (memory.sourceId) {
    const reserved = sourceReservations.get(memory.sourceId) || 0;
    const amount = creep.store.getFreeCapacity(RESOURCE_ENERGY);
    sourceReservations.set(memory.sourceId, Math.max(0, reserved - amount));
  }
}

function clearDestinationReservation(creep: Creep): void {
  const memory = creep.memory as HaulerMemory;
  if (memory.destinationId) {
    const reserved = destinationReservations.get(memory.destinationId) || 0;
    const amount = creep.store.getUsedCapacity(RESOURCE_ENERGY);
    destinationReservations.set(memory.destinationId, Math.max(0, reserved - amount));
  }
}

function clearReservations(creep: Creep): void {
  clearSourceReservation(creep);
  clearDestinationReservation(creep);
}

// Clean up reservations each tick
export function cleanupReservations(): void {
  sourceReservations.clear();
  destinationReservations.clear();
}

export default { run, cleanupReservations };
