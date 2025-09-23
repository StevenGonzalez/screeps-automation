/// <reference types="@types/screeps" />
import { CreepPersonality } from "./creep.personality";

export function runRepairer(creep: Creep, intel: any): void {
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
    const candidates = creep.room.find(FIND_STRUCTURES, {
      filter: (s) =>
        s.hits < s.hitsMax &&
        s.structureType !== STRUCTURE_WALL &&
        s.structureType !== STRUCTURE_RAMPART,
    });
    if (candidates.length > 0) {
      const target = candidates.reduce((prev, curr) =>
        prev.hits / prev.hitsMax < curr.hits / curr.hitsMax ? prev : curr
      );
      const res = creep.repair(target);
      if (res === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { visualizePathStyle: { stroke: "#00ff00" } });
        CreepPersonality.speak(creep, "move");
      } else if (res === OK) {
        CreepPersonality.speak(creep, "repair");
      }
    }
  }
}
