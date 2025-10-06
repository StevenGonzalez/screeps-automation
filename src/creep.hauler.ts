/// <reference types="@types/screeps" />
import { style } from "./path.styles";
import { CreepPersonality } from "./creep.personality";
import { RoomCache } from "./room.cache";

export function runHauler(creep: Creep, intel: any): void {
  if (creep.store.getUsedCapacity() === 0) {
    // New acquire cycle: clear last withdraw memory to avoid over-filtering
    if (creep.memory.lastWithdrawId) delete creep.memory.lastWithdrawId;

    // Check if energy needs are urgent (low spawn/extension energy or critical towers)
    const energyRatio =
      creep.room.energyAvailable /
      Math.max(1, creep.room.energyCapacityAvailable);
    const energyUrgent = energyRatio < 0.7;

    // Urgent: drain near-full source containers first to unblock miners
    const urgentSource = RoomCache.containers(creep.room).filter(
      (s) =>
        isSourceContainer(s as StructureContainer) &&
        (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) <= 100
    ) as StructureContainer[];

    // Prefer non-storage, non-controller containers for pickup; storage as last resort
    const pickupContainers = RoomCache.containers(creep.room).filter((s) => {
      const hasEnergy =
        (s as AnyStoreStructure).store?.getUsedCapacity?.(RESOURCE_ENERGY) >
        100;
      if (!hasEnergy) return false;
      // Avoid controller container on pickup; let upgraders use it
      return !isControllerContainer(s as StructureContainer);
    });
    const storagesWithEnergy = creep.room.find(FIND_STRUCTURES, {
      filter: (s: AnyStructure) =>
        s.structureType === STRUCTURE_STORAGE &&
        (s as AnyStoreStructure).store.getUsedCapacity(RESOURCE_ENERGY) > 200,
    });
    const dropped = RoomCache.droppedResources(creep.room).filter(
      (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50
    );
    const tombs = creep.room.find(FIND_TOMBSTONES, {
      filter: (t) => t.store.getUsedCapacity(RESOURCE_ENERGY) > 50,
    });
    const ruins = creep.room.find(FIND_RUINS, {
      filter: (r) => r.store.getUsedCapacity(RESOURCE_ENERGY) > 50,
    });

    // Check for mineral-filled containers if energy needs are not urgent
    let mineralContainers: StructureContainer[] = [];
    if (!energyUrgent) {
      mineralContainers = RoomCache.containers(creep.room).filter((c) => {
        // Look for containers near minerals (not sources or controller)
        if (isSourceContainer(c) || isControllerContainer(c)) return false;
        // Check if container has minerals and is getting full
        for (const resourceType in c.store) {
          if (resourceType === RESOURCE_ENERGY) continue;
          const amount = c.store[resourceType as ResourceConstant] || 0;
          if (amount > 1000 || c.store.getFreeCapacity() < 500) {
            return true;
          }
        }
        return false;
      });
    }

    let target: any =
      creep.pos.findClosestByPath(urgentSource) ||
      creep.pos.findClosestByPath(pickupContainers) ||
      creep.pos.findClosestByPath(dropped) ||
      creep.pos.findClosestByPath(tombs) ||
      creep.pos.findClosestByPath(ruins) ||
      creep.pos.findClosestByPath(mineralContainers) ||
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
        // Withdraw from structure - handle both energy and minerals
        let resourceType: ResourceConstant = RESOURCE_ENERGY;

        // If target is a mineral container, find the mineral type to withdraw
        if (
          (target as AnyStoreStructure).structureType === STRUCTURE_CONTAINER
        ) {
          for (const res in (target as AnyStoreStructure).store) {
            if (
              res !== RESOURCE_ENERGY &&
              (target as AnyStoreStructure).store[res as ResourceConstant] > 0
            ) {
              resourceType = res as ResourceConstant;
              break;
            }
          }
        }

        const res = creep.withdraw(target, resourceType);
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
    // Deliver - check if carrying minerals or energy
    const carryingMinerals = Object.keys(creep.store).some(
      (res) =>
        res !== RESOURCE_ENERGY && creep.store[res as ResourceConstant] > 0
    );

    if (carryingMinerals) {
      // Deliver minerals to terminal first, then storage
      let target: AnyStoreStructure | null = null;

      const terminal = creep.room.terminal;
      if (terminal && terminal.store.getFreeCapacity() > 0) {
        target = terminal;
      } else if (
        creep.room.storage &&
        creep.room.storage.store.getFreeCapacity() > 0
      ) {
        target = creep.room.storage;
      }

      if (target) {
        // Transfer all mineral types
        for (const resourceType in creep.store) {
          if (resourceType === RESOURCE_ENERGY) continue;
          const amount = creep.store[resourceType as ResourceConstant];
          if (amount > 0) {
            const res = creep.transfer(
              target,
              resourceType as ResourceConstant
            );
            if (res === ERR_NOT_IN_RANGE) {
              creep.moveTo(target, { visualizePathStyle: style("transfer") });
              CreepPersonality.speak(creep, "move");
            } else if (res === OK) {
              CreepPersonality.speak(creep, "transfer");
            }
            return; // Only transfer one resource type per tick
          }
        }
      } else {
        CreepPersonality.speak(creep, "frustrated");
      }
      return;
    }

    // Deliver energy (existing logic)
    // First, if we just withdrew from a source container and it's still nearly full,
    // feed a nearby source link before heading back. This helps prevent container overflow.
    if (creep.memory.lastWithdrawId) {
      const srcStruct = Game.getObjectById<Structure>(
        creep.memory.lastWithdrawId as Id<Structure>
      );
      if (srcStruct && srcStruct.structureType === STRUCTURE_CONTAINER) {
        const cont = srcStruct as StructureContainer;
        if (isSourceContainer(cont)) {
          const nearLink = cont.pos.findInRange(FIND_MY_STRUCTURES, 2, {
            filter: (s) =>
              s.structureType === STRUCTURE_LINK &&
              (s as StructureLink).store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
              !(s as StructureLink).cooldown,
          })[0] as StructureLink | undefined;
          const containerNearlyFull =
            cont.store.getFreeCapacity(RESOURCE_ENERGY) <= 400;
          if (nearLink && containerNearlyFull) {
            if (!creep.pos.isNearTo(nearLink)) {
              creep.moveTo(nearLink, { visualizePathStyle: style("transfer") });
              CreepPersonality.speak(creep, "move");
              return;
            } else if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
              const t = creep.transfer(nearLink, RESOURCE_ENERGY);
              if (t === OK) {
                CreepPersonality.speak(creep, "transfer");
                // After seeding the link, proceed with normal delivery next tick
                return;
              }
            }
          }
        }
      }
    }

    // Prioritize towers to a safety floor before general filling
    const threatActive =
      (intel?.military?.hostiles?.length || 0) > 0 ||
      (intel?.military?.safetyScore ?? 100) < 60;
    const towerFloor = threatActive ? 800 : 400; // keep towers at this minimum
    const lowTowers = RoomCache.towers(creep.room).filter(
      (s) =>
        (s as AnyStoreStructure).store.getUsedCapacity(RESOURCE_ENERGY) <
          towerFloor &&
        (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > 0
    ) as AnyStoreStructure[];

    let target: AnyStoreStructure | null = null;
    if (lowTowers.length > 0) {
      target = creep.pos.findClosestByPath(lowTowers) || null;
    }

    // If towers are at/above floor (or none exist), fill spawns/extensions/towers normally
    if (!target) {
      const fillTargets = creep.room.find(FIND_STRUCTURES, {
        filter: (s: AnyStructure) =>
          (s.structureType === STRUCTURE_SPAWN ||
            s.structureType === STRUCTURE_EXTENSION ||
            s.structureType === STRUCTURE_TOWER) &&
          (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      }) as AnyStoreStructure[];
      target = creep.pos.findClosestByPath(fillTargets) || null;
    }

    // Build up storage reserves first - strong economy before trading
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

    // Keep the controller container buffered for steady upgrading
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

    // Terminal gets filled last - only when we have surplus economy
    if (!target) {
      const terminal = creep.room.terminal;
      const TERMINAL_ENERGY_TARGET = 10000; // Keep 10k energy for market transactions
      if (
        terminal &&
        terminal.store.getUsedCapacity(RESOURCE_ENERGY) <
          TERMINAL_ENERGY_TARGET &&
        terminal.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      ) {
        target = terminal;
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

function isMineralContainer(container: StructureContainer): boolean {
  const room = container.room;
  const near = room.find(FIND_MINERALS, {
    filter: (m) => container.pos.inRangeTo(m.pos, 2),
  });
  return near.length > 0;
}
