/// <reference types="@types/screeps" />
import { CreepPersonality } from "./creep.personality";

export function runUpgrader(creep: Creep, intel: any): void {
  // Toggle state
  if (
    creep.memory.working &&
    creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0
  ) {
    creep.memory.working = false;
  }
  if (
    !creep.memory.working &&
    creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0
  ) {
    creep.memory.working = true;
  }

  if (creep.memory.working) {
    // Upgrade when full
    const res = creep.upgradeController(creep.room.controller!);
    if (res === ERR_NOT_IN_RANGE) {
      creep.moveTo(creep.room.controller!, {
        visualizePathStyle: { stroke: "#ffffff" },
      });
      CreepPersonality.speak(creep, "move");
    } else if (res === OK) {
      CreepPersonality.speak(creep, "upgrade");
    }
  } else {
    // Acquire energy: prefer link near controller -> container/storage -> harvest
    const link = creep.pos.findInRange(FIND_MY_STRUCTURES, 3, {
      filter: (s) =>
        s.structureType === STRUCTURE_LINK &&
        (s as StructureLink).store.getUsedCapacity(RESOURCE_ENERGY) > 0,
    })[0] as StructureLink | undefined;
    if (link) {
      const w = creep.withdraw(link, RESOURCE_ENERGY);
      if (w === ERR_NOT_IN_RANGE) {
        creep.moveTo(link);
        CreepPersonality.speak(creep, "move");
      } else if (w === OK) {
        CreepPersonality.speak(creep, "withdraw");
      }
      return;
    }

    const stores = creep.room.find(FIND_STRUCTURES, {
      filter: (s: AnyStructure) =>
        (s.structureType === STRUCTURE_CONTAINER ||
          s.structureType === STRUCTURE_STORAGE) &&
        (s as AnyStoreStructure).store.getUsedCapacity(RESOURCE_ENERGY) >=
          Math.min(200, creep.store.getFreeCapacity(RESOURCE_ENERGY)),
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
      return;
    }

    const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (source) {
      const h = creep.harvest(source);
      if (h === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, { visualizePathStyle: { stroke: "#ffaa00" } });
        CreepPersonality.speak(creep, "move");
      } else if (h === OK) {
        CreepPersonality.speak(creep, "harvest");
      }
    } else {
      CreepPersonality.speak(creep, "frustrated");
    }
  }
}
