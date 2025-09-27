/// <reference types="@types/screeps" />
import { style } from "./path.styles";
import { CreepPersonality } from "./creep.personality";

export function runHauler(creep: Creep, intel: any): void {
  if (creep.store.getUsedCapacity() === 0) {
    // New acquire cycle: clear last withdraw memory to avoid over-filtering
    if (creep.memory.lastWithdrawId) delete creep.memory.lastWithdrawId;

    // Urgent: drain near-full source containers first to unblock miners
    const urgentSource = creep.room.find(FIND_STRUCTURES, {
      filter: (s: AnyStructure) =>
        s.structureType === STRUCTURE_CONTAINER &&
        isSourceContainer(s as StructureContainer) &&
        (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) <= 100,
    }) as StructureContainer[];

    // Prefer non-storage, non-controller containers for pickup; storage as last resort
    const pickupContainers = creep.room.find(FIND_STRUCTURES, {
      filter: (s: AnyStructure) => {
        const hasEnergy =
          (s as AnyStoreStructure).store?.getUsedCapacity?.(RESOURCE_ENERGY) >
          100;
        if (!hasEnergy) return false;
        if (s.structureType === STRUCTURE_CONTAINER) {
          // Avoid controller container on pickup; let upgraders use it
          return !isControllerContainer(s as StructureContainer);
        }
        return false;
      },
    });
    const storagesWithEnergy = creep.room.find(FIND_STRUCTURES, {
      filter: (s: AnyStructure) =>
        s.structureType === STRUCTURE_STORAGE &&
        (s as AnyStoreStructure).store.getUsedCapacity(RESOURCE_ENERGY) > 200,
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
      creep.pos.findClosestByPath(urgentSource) ||
      creep.pos.findClosestByPath(pickupContainers) ||
      creep.pos.findClosestByPath(dropped) ||
      creep.pos.findClosestByPath(tombs) ||
      creep.pos.findClosestByPath(ruins) ||
      creep.pos.findClosestByPath(storagesWithEnergy);

    if (target) {
      if (target instanceof Resource) {
        if (creep.pickup(target) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, { visualizePathStyle: style("withdraw") });
          CreepPersonality.speak(creep, "move");
        } else {
          CreepPersonality.speak(creep, "withdraw");
        }
      } else {
        const res = creep.withdraw(target, RESOURCE_ENERGY);
        if (res === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, { visualizePathStyle: style("withdraw") });
          CreepPersonality.speak(creep, "move");
        } else if (res === OK) {
          // Remember source to avoid depositing back into the same structure
          creep.memory.lastWithdrawId = (target as Structure).id;
          CreepPersonality.speak(creep, "withdraw");

          // Opportunistic: if we just withdrew from a source container and there's an adjacent link, feed it immediately
          if (
            (target as AnyStructure).structureType === STRUCTURE_CONTAINER &&
            isSourceContainer(target as StructureContainer)
          ) {
            const nearLink = creep.pos.findInRange(FIND_MY_STRUCTURES, 1, {
              filter: (s) =>
                s.structureType === STRUCTURE_LINK &&
                (s as StructureLink).store.getFreeCapacity(RESOURCE_ENERGY) >
                  0 &&
                !(s as StructureLink).cooldown,
            })[0] as StructureLink | undefined;
            if (nearLink && creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
              creep.transfer(nearLink, RESOURCE_ENERGY);
            }
          }
        }
      }
    } else {
      const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
      if (source && creep.pos.getRangeTo(source) > 3) {
        creep.moveTo(source, { visualizePathStyle: style("harvest") });
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

    // Next: keep the controller container buffered before touching storage
    if (!target) {
      const CONTROLLER_BUFFER_TARGET = 1000; // desired energy in controller container
      const ctrlContainers = creep.room.find(FIND_STRUCTURES, {
        filter: (s: AnyStructure) =>
          s.structureType === STRUCTURE_CONTAINER &&
          isControllerContainer(s as StructureContainer) &&
          (s as AnyStoreStructure).store.getUsedCapacity(RESOURCE_ENERGY) <
            CONTROLLER_BUFFER_TARGET &&
          (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
          s.id !== creep.memory.lastWithdrawId,
      }) as AnyStoreStructure[];
      target = creep.pos.findClosestByPath(ctrlContainers) || null;
    }

    // After controller buffer, deposit excess into storage
    if (!target) {
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
        creep.moveTo(target, { visualizePathStyle: style("transfer") });
        CreepPersonality.speak(creep, "move");
      } else if (res === OK) {
        // Successful drop-off; allow future deposits anywhere again
        if (creep.memory.lastWithdrawId) delete creep.memory.lastWithdrawId;
        CreepPersonality.speak(creep, "transfer");
      }
    } else {
      CreepPersonality.speak(creep, "frustrated");
    }
  }
}

function isControllerContainer(container: StructureContainer): boolean {
  const ctrl = container.room.controller;
  return !!ctrl && container.pos.inRangeTo(ctrl.pos, 3);
}

function isSourceContainer(container: StructureContainer): boolean {
  const room = container.room;
  const near = room.find(FIND_SOURCES, {
    filter: (s) => container.pos.isNearTo(s.pos),
  });
  return near.length > 0;
}
