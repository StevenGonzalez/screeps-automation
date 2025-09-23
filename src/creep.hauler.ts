/// <reference types="@types/screeps" />
import { CreepPersonality } from "./creep.personality";

export function runHauler(creep: Creep, intel: any): void {
  if (creep.store.getUsedCapacity() === 0) {
    // Acquire
    const containers = creep.room.find(FIND_STRUCTURES, {
      filter: (s: AnyStructure) =>
        (s.structureType === STRUCTURE_CONTAINER ||
          s.structureType === STRUCTURE_STORAGE) &&
        (s as AnyStoreStructure).store.getUsedCapacity(RESOURCE_ENERGY) > 100,
    });
    const dropped = creep.room.find(FIND_DROPPED_RESOURCES, {
      filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
    });
    const tombs = creep.room.find(FIND_TOMBSTONES, {
      filter: (t) => t.store.getUsedCapacity(RESOURCE_ENERGY) > 50,
    });
    const ruins = creep.room.find(FIND_RUINS, {
      filter: (r) => r.store.getUsedCapacity(RESOURCE_ENERGY) > 50,
    });

    let target: any =
      creep.pos.findClosestByPath(containers) ||
      creep.pos.findClosestByPath(dropped) ||
      creep.pos.findClosestByPath(tombs) ||
      creep.pos.findClosestByPath(ruins);

    if (target) {
      if (target instanceof Resource) {
        if (creep.pickup(target) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target);
          CreepPersonality.speak(creep, "move");
        } else {
          CreepPersonality.speak(creep, "withdraw");
        }
      } else {
        const res = creep.withdraw(target, RESOURCE_ENERGY);
        if (res === ERR_NOT_IN_RANGE) {
          creep.moveTo(target);
          CreepPersonality.speak(creep, "move");
        } else if (res === OK) CreepPersonality.speak(creep, "withdraw");
      }
    } else {
      const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
      if (source && creep.pos.getRangeTo(source) > 3) {
        creep.moveTo(source, { visualizePathStyle: { stroke: "#ffaa00" } });
        CreepPersonality.speak(creep, "move");
      } else {
        CreepPersonality.speak(creep, "idle");
      }
    }
  } else {
    // Deliver
    const fillTargets = creep.room.find(FIND_STRUCTURES, {
      filter: (s: AnyStructure) =>
        (s.structureType === STRUCTURE_SPAWN ||
          s.structureType === STRUCTURE_EXTENSION ||
          s.structureType === STRUCTURE_TOWER) &&
        (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    }) as AnyStoreStructure[];
    let target = creep.pos.findClosestByPath(fillTargets);
    if (!target) {
      const storeTargets = creep.room.find(FIND_STRUCTURES, {
        filter: (s: AnyStructure) =>
          (s.structureType === STRUCTURE_CONTAINER ||
            s.structureType === STRUCTURE_STORAGE) &&
          (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      }) as AnyStoreStructure[];
      target = creep.pos.findClosestByPath(storeTargets) || null;
    }
    if (target) {
      const res = creep.transfer(target, RESOURCE_ENERGY);
      if (res === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { visualizePathStyle: { stroke: "#ffffff" } });
        CreepPersonality.speak(creep, "move");
      } else if (res === OK) CreepPersonality.speak(creep, "transfer");
    } else {
      CreepPersonality.speak(creep, "frustrated");
    }
  }
}
