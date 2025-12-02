// src/creeps/behaviors/energy.ts
import { assignSourceToCreep } from '../sourceManager';

export type AcquireResult = 'harvesting' | 'withdrawing' | 'picking' | 'none';

export function acquireEnergy(creep: Creep, opts?: { preferHarvest?: boolean }): AcquireResult {
  const preferHarvest = !!opts?.preferHarvest;

  // pickup dropped energy first
  const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, { filter: (r: Resource) => r.resourceType === RESOURCE_ENERGY && r.amount > 20 });
  if (dropped) {
    if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) creep.moveTo(dropped, { visualizePathStyle: { stroke: '#ffaa00' } });
    return 'picking';
  }

  // withdraw from tombstones and ruins
  const tombstone = creep.pos.findClosestByPath(FIND_TOMBSTONES, { filter: (t: Tombstone) => (t.store[RESOURCE_ENERGY] || 0) > 0 });
  if (tombstone) {
    if (creep.withdraw(tombstone, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(tombstone, { visualizePathStyle: { stroke: '#ffaa00' } });
    return 'withdrawing';
  }

  const ruin = creep.pos.findClosestByPath(FIND_RUINS, { filter: (r: Ruin) => (r.store[RESOURCE_ENERGY] || 0) > 0 });
  if (ruin) {
    if (creep.withdraw(ruin, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(ruin, { visualizePathStyle: { stroke: '#ffaa00' } });
    return 'withdrawing';
  }

  // withdraw from container/storage/terminal - prefer sources that can meaningfully fill the creep
  const freeCap = creep.store.getFreeCapacity(RESOURCE_ENERGY) || 0;
  
  // Upgraders should prioritize nearby containers/storage (controller area)
  if (creep.memory.role === 'upgrader' || creep.memory.role === 'spawn_upgrader') {
    const nearbyStorage = creep.pos.findInRange(FIND_STRUCTURES, 4, {
      filter: (s: Structure) => {
        if (s.structureType === STRUCTURE_CONTAINER || 
            s.structureType === STRUCTURE_STORAGE ||
            s.structureType === STRUCTURE_LINK) {
          const energy = ((s as any).store && ((s as any).store[RESOURCE_ENERGY])) || 0;
          return energy > 0;
        }
        return false;
      }
    }) as (StructureContainer | StructureStorage | StructureLink)[];
    
    if (nearbyStorage.length > 0) {
      // Prefer containers first, then storage, then links - within each type prefer closest
      const containers = nearbyStorage.filter(s => s.structureType === STRUCTURE_CONTAINER);
      const storage = nearbyStorage.filter(s => s.structureType === STRUCTURE_STORAGE);
      const links = nearbyStorage.filter(s => s.structureType === STRUCTURE_LINK);
      
      const target = (containers.length > 0 ? creep.pos.findClosestByRange(containers) : null) ||
                     (storage.length > 0 ? creep.pos.findClosestByRange(storage) : null) ||
                     (links.length > 0 ? creep.pos.findClosestByRange(links) : null);
      
      if (target) {
        if (creep.withdraw(target as any, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, { visualizePathStyle: { stroke: '#ffff00' } });
        }
        return 'withdrawing';
      }
    }
  }
  
  // Check for miner containers first (high priority for all creeps)
  // Only use containers that have at least 50 energy (avoid empty/low containers)
  const minerContainers = creep.room.find(FIND_STRUCTURES, {
    filter: (s: Structure) => {
      if (s.structureType !== STRUCTURE_CONTAINER) return false;
      const energy = ((s as any).store && ((s as any).store[RESOURCE_ENERGY])) || 0;
      if (energy < 50) return false;
      const crepsOnContainer = s.pos.lookFor(LOOK_CREEPS);
      const hasMiner = crepsOnContainer.some(c => c.my && c.memory.role === 'miner');
      return hasMiner;
    }
  }) as StructureContainer[];

  if (minerContainers.length > 0) {
    // Sort by energy amount (highest first) to prioritize full containers
    minerContainers.sort((a, b) => {
      const aEnergy = (a.store[RESOURCE_ENERGY] || 0);
      const bEnergy = (b.store[RESOURCE_ENERGY] || 0);
      return bEnergy - aEnergy;
    });

    // Pick the container with the most energy that we can path to
    let target: StructureContainer | null = null;
    for (const container of minerContainers) {
      const path = creep.pos.findPathTo(container, { ignoreCreeps: true });
      if (path.length > 0) {
        target = container;
        break;
      }
    }

    if (target) {
      if (creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(target, { visualizePathStyle: { stroke: '#ffff00' } });
      return 'withdrawing';
    }
  }

  // Then check other storage structures
  const structureCandidates = creep.room.find(FIND_STRUCTURES, {
    filter: (s: Structure) => {
      if (s.structureType === STRUCTURE_STORAGE || s.structureType === STRUCTURE_TERMINAL) {
        return ((s as any).store && ((s as any).store[RESOURCE_ENERGY] || 0) > 0);
      }
      if (s.structureType === STRUCTURE_CONTAINER) {
        const hasEnergy = ((s as any).store && ((s as any).store[RESOURCE_ENERGY] || 0) > 0);
        if (!hasEnergy) return false;
        const crepsOnContainer = s.pos.lookFor(LOOK_CREEPS);
        const hasMiner = crepsOnContainer.some(c => c.my && c.memory.role === 'miner');
        return !hasMiner;
      }
      return false;
    },
  }) as Structure[];

  let storeTarget: Structure | undefined;
  if (structureCandidates.length > 0) {
    const halfNeed = Math.max(50, Math.floor(freeCap / 2));
    storeTarget = structureCandidates.find(s => ((s as any).store[RESOURCE_ENERGY] || 0) >= halfNeed);
    if (!storeTarget) {
      storeTarget = structureCandidates.reduce((best, s) => {
        const amt = (s as any).store[RESOURCE_ENERGY] || 0;
        const bestAmt = best ? ((best as any).store[RESOURCE_ENERGY] || 0) : 0;
        return amt > bestAmt ? s : best;
      }, undefined as Structure | undefined);
    }
  }

  if (storeTarget) {
    if (creep.withdraw(storeTarget as AnyStructure, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(storeTarget as any, { visualizePathStyle: { stroke: '#ffff00' } });
    return 'withdrawing';
  }

  // prefer harvest if requested
  if (preferHarvest) {
    const sid = (creep.memory as any).sourceId as string | undefined;
    let source: Source | null = null;
    if (sid) source = Game.getObjectById(sid) as Source | null;
    if (!source) {
      const assigned = assignSourceToCreep(creep);
      if (assigned) {
        (creep.memory as any).sourceId = assigned;
        source = Game.getObjectById(assigned) as Source | null;
      }
    }
    if (!source) {
      // Only look for sources in safe rooms (our rooms or neutral)
      source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE, {
        filter: (s: Source) => {
          const room = Game.rooms[s.pos.roomName];
          if (!room) return false;
          if (room.controller && room.controller.owner && !room.controller.my) return false;
          const hostiles = s.pos.findInRange(FIND_HOSTILE_CREEPS, 5);
          return hostiles.length === 0;
        }
      }) as Source | null;
    }
    if (source) {
      if (creep.harvest(source) === ERR_NOT_IN_RANGE) creep.moveTo(source, { visualizePathStyle: { stroke: '#ffaa00' } });
      return 'harvesting';
    }
  }

  // if not preferHarvest or no harvest target, try assigned source as fallback
  const sid = (creep.memory as any).sourceId as string | undefined;
  let source: Source | null = null;
  if (sid) source = Game.getObjectById(sid) as Source | null;
  if (!source) {
    const assigned = assignSourceToCreep(creep);
    if (assigned) {
      (creep.memory as any).sourceId = assigned;
      source = Game.getObjectById(assigned) as Source | null;
    }
  }
  if (!source) {
    // Only look for safe sources
    source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE, {
      filter: (s: Source) => {
        const room = Game.rooms[s.pos.roomName];
        if (!room) return false;
        if (room.controller && room.controller.owner && !room.controller.my) return false;
        const hostiles = s.pos.findInRange(FIND_HOSTILE_CREEPS, 5);
        return hostiles.length === 0;
      }
    }) as Source | null;
  }
  if (source) {
    if (creep.harvest(source) === ERR_NOT_IN_RANGE) creep.moveTo(source, { visualizePathStyle: { stroke: '#ffaa00' } });
    return 'harvesting';
  }

  return 'none';
}
