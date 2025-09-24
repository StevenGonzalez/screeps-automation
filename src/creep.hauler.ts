/// <reference types="@types/screeps" />
import { CreepPersonality } from "./creep.personality";

export function runHauler(creep: Creep, intel: any): void {
  if (creep.store.getUsedCapacity() === 0) {
    // Acquire
    const containers = creep.room.find(FIND_STRUCTURES, {
      filter: (s: AnyStructure) => {
        const hasEnergy =
          (s as AnyStoreStructure).store?.getUsedCapacity?.(RESOURCE_ENERGY) >
          100;
        if (!hasEnergy) return false;
        if (s.structureType === STRUCTURE_STORAGE) return true;
        if (s.structureType === STRUCTURE_CONTAINER) {
          // Avoid controller container on pickup; let upgraders use it
          return !isControllerContainer(s as StructureContainer);
        }
        return false;
      },
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
        } else if (res === OK) {
          // Remember source to avoid depositing back into the same structure
          creep.memory.lastWithdrawId = (target as Structure).id;
          CreepPersonality.speak(creep, "withdraw");
        }
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
      // Prefer storage first
      const storage = creep.room.storage;
      if (
        storage &&
        storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
        storage.id !== creep.memory.lastWithdrawId
      ) {
        target = storage as AnyStoreStructure;
      }
    }
    if (!target) {
      // Fallback to non-controller, non-source containers; avoid putting back to where we withdrew
      const storeTargets = creep.room.find(FIND_STRUCTURES, {
        filter: (s: AnyStructure) =>
          s.structureType === STRUCTURE_CONTAINER &&
          !isControllerContainer(s as StructureContainer) &&
          !isSourceContainer(s as StructureContainer) &&
          (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
          s.id !== creep.memory.lastWithdrawId,
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

function isControllerContainer(container: StructureContainer): boolean {
  const ctrl = container.room.controller;
  return !!ctrl && container.pos.inRangeTo(ctrl.pos, 2);
}

function isSourceContainer(container: StructureContainer): boolean {
  const room = container.room;
  const near = room.find(FIND_SOURCES, {
    filter: (s) => container.pos.isNearTo(s.pos),
  });
  return near.length > 0;
}
