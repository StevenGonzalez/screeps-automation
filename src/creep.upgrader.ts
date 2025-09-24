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
    // Acquire energy: prefer controller link -> controller container -> storage -> other non-source containers -> dropped -> harvest
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

    // Controller container first
    const ctrlContainer = getControllerContainer(creep.room);
    if (
      ctrlContainer &&
      ctrlContainer.store.getUsedCapacity(RESOURCE_ENERGY) >=
        Math.min(150, creep.store.getFreeCapacity(RESOURCE_ENERGY))
    ) {
      const w = creep.withdraw(ctrlContainer, RESOURCE_ENERGY);
      if (w === ERR_NOT_IN_RANGE) {
        creep.moveTo(ctrlContainer);
        CreepPersonality.speak(creep, "move");
      } else if (w === OK) {
        CreepPersonality.speak(creep, "withdraw");
      }
      return;
    }

    // Storage next
    const storage = creep.room.storage;
    if (
      storage &&
      storage.store.getUsedCapacity(RESOURCE_ENERGY) >=
        Math.min(200, creep.store.getFreeCapacity(RESOURCE_ENERGY))
    ) {
      const w = creep.withdraw(storage, RESOURCE_ENERGY);
      if (w === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage);
        CreepPersonality.speak(creep, "move");
      } else if (w === OK) {
        CreepPersonality.speak(creep, "withdraw");
      }
      return;
    }

    // Other containers that are NOT source-adjacent
    const containers = creep.room.find(FIND_STRUCTURES, {
      filter: (s: AnyStructure) =>
        s.structureType === STRUCTURE_CONTAINER &&
        !isSourceContainer(s as StructureContainer) &&
        (s as AnyStoreStructure).store.getUsedCapacity(RESOURCE_ENERGY) >=
          Math.min(150, creep.store.getFreeCapacity(RESOURCE_ENERGY)),
    }) as StructureContainer[];
    if (containers.length) {
      const tgt = creep.pos.findClosestByPath(containers);
      if (tgt) {
        const w = creep.withdraw(tgt, RESOURCE_ENERGY);
        if (w === ERR_NOT_IN_RANGE) {
          creep.moveTo(tgt);
          CreepPersonality.speak(creep, "move");
        } else if (w === OK) {
          CreepPersonality.speak(creep, "withdraw");
        }
        return;
      }
    }

    // Dropped energy near controller (cheap pickup when available)
    const ctrl = creep.room.controller;
    if (ctrl) {
      const dropped = ctrl.pos.findInRange(FIND_DROPPED_RESOURCES, 3, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount >= 50,
      })[0];
      if (dropped) {
        const p = creep.pickup(dropped);
        if (p === ERR_NOT_IN_RANGE) {
          creep.moveTo(dropped);
          CreepPersonality.speak(creep, "move");
        } else if (p === OK) {
          CreepPersonality.speak(creep, "withdraw");
        }
        return;
      }
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

function getControllerContainer(room: Room): StructureContainer | null {
  const controller = room.controller;
  if (!controller) return null;
  const mem = getRoomMem(room.name);
  const id = mem.controllerContainerId as Id<StructureContainer> | undefined;
  let cached = id ? Game.getObjectById<StructureContainer>(id) : null;
  if (
    cached &&
    cached.pos.roomName === room.name &&
    cached.pos.inRangeTo(controller.pos, 2)
  ) {
    return cached;
  }
  // Refresh: find containers near controller and cache
  const found = room.find(FIND_STRUCTURES, {
    filter: (s: AnyStructure) =>
      s.structureType === STRUCTURE_CONTAINER &&
      (s as Structure).pos.inRangeTo(controller.pos, 2),
  }) as StructureContainer[];
  const best = found[0] || null;
  if (best) mem.controllerContainerId = best.id as string;
  return best;
}

function isSourceContainer(container: StructureContainer): boolean {
  const room = container.room;
  const near = room.find(FIND_SOURCES, {
    filter: (s) => container.pos.isNearTo(s.pos),
  });
  return near.length > 0;
}

function getRoomMem(roomName: string): any {
  if (!Memory.rooms) Memory.rooms = {} as any;
  if (!Memory.rooms[roomName]) (Memory.rooms as any)[roomName] = {};
  return (Memory.rooms as any)[roomName];
}
