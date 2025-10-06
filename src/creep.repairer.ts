/// <reference types="@types/screeps" />
import { style } from "./path.styles";
import { CreepPersonality } from "./creep.personality";
import { getTowersInRoom } from "./structure.tower";
import { RoomCache } from "./room.cache";

export function runRepairer(creep: Creep, intel: any): void {
  // If towers are well-stocked, let them handle most emergency repairs.
  const towers = getTowersInRoom(creep.room);
  const towerHighEnergy = towers.some(
    (t) => t.store.getUsedCapacity(RESOURCE_ENERGY) >= 700
  );

  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
    const stores = creep.room.find(FIND_STRUCTURES, {
      filter: (s: AnyStructure) =>
        (s.structureType === STRUCTURE_CONTAINER ||
          s.structureType === STRUCTURE_STORAGE) &&
        (s as AnyStoreStructure).store.getUsedCapacity(RESOURCE_ENERGY) > 0,
    }) as AnyStoreStructure[];
    const target = creep.pos.findClosestByPath(stores);
    if (target) {
      const res = creep.withdraw(target, RESOURCE_ENERGY);
      if (res === ERR_NOT_IN_RANGE) {
        creep.moveTo(target);
        CreepPersonality.speak(creep, "move");
      } else if (res === OK) {
        CreepPersonality.speak(creep, "withdraw");
      }
    } else {
      CreepPersonality.speak(creep, "frustrated");
    }
  } else {
    // 1) Prioritize truly critical non-fortification structures
    // If towers are high on energy, tighten threshold so towers take most of this load
    const criticalThreshold = towerHighEnergy ? 0.2 : 0.3;
    const critical = creep.room.find(FIND_STRUCTURES, {
      filter: (s) =>
        s.hits < s.hitsMax * criticalThreshold &&
        s.structureType !== STRUCTURE_WALL &&
        s.structureType !== STRUCTURE_RAMPART,
    });
    const pickMostDamaged = (arr: Structure[]) =>
      arr.reduce((a, b) => (a.hits / a.hitsMax < b.hits / b.hitsMax ? a : b));

    let target: Structure | null = null;
    if (critical.length) target = pickMostDamaged(critical);

    // 2) Low ramparts (seed to minimum), but keep it cheap
    if (!target) {
      const lowRamparts = creep.room.find(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_RAMPART && s.hits < 5000,
      });
      if (lowRamparts.length) target = pickMostDamaged(lowRamparts);
    }

    // 3) Containers medium damage (prioritize over roads)
    if (!target) {
      const containers = creep.room.find(FIND_STRUCTURES, {
        filter: (s) =>
          s.structureType === STRUCTURE_CONTAINER && s.hits < s.hitsMax * 0.6,
      });
      if (containers.length) target = pickMostDamaged(containers);
    }

    // 4) Roads - only if significantly damaged (40% or less)
    // Roads decay constantly so we only repair when really needed
    if (!target) {
      const roads = creep.room.find(FIND_STRUCTURES, {
        filter: (s) =>
          s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax * 0.4,
      });
      if (roads.length) target = pickMostDamaged(roads);
    }

    // 5) Any other structure needing repair (excluding thick walls)
    // If towers are well-stocked, skip small top-offs and let towers handle emergencies
    if (!target && !towerHighEnergy) {
      const any = creep.room.find(FIND_STRUCTURES, {
        filter: (s) => s.hits < s.hitsMax && s.structureType !== STRUCTURE_WALL,
      });
      if (any.length) target = pickMostDamaged(any);
    }

    if (target) {
      const res = creep.repair(target);
      if (res === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { visualizePathStyle: style("repair") });
        CreepPersonality.speak(creep, "move");
      } else if (res === OK) {
        CreepPersonality.speak(creep, "repair");
      }
    } else {
      // Fallback: help with building or upgrading
      const site = creep.pos.findClosestByPath(
        RoomCache.constructionSites(creep.room)
      );
      if (site) {
        const res = creep.build(site);
        if (res === ERR_NOT_IN_RANGE)
          creep.moveTo(site, { visualizePathStyle: style("build") });
      } else if (creep.room.controller) {
        const res = creep.upgradeController(creep.room.controller);
        if (res === ERR_NOT_IN_RANGE)
          creep.moveTo(creep.room.controller, {
            visualizePathStyle: style("upgrade"),
          });
      }
    }
  }
}
