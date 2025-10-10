/**
 * Remote Hauler
 *
 * Hauls energy from remote rooms to home room storage
 * - Picks up energy from remote containers
 * - Travels back to home room
 * - Deposits in storage/terminal
 * - Returns to remote room
 */

/// <reference types="@types/screeps" />
import { visualPath } from "../path.styles";
import { CreepPersonality } from "./personality";

export function runRemoteHauler(creep: Creep): void {
  const remoteRoom = (creep.memory as any).remoteRoom as string | undefined;
  const homeRoom = (creep.memory as any).homeRoom as string | undefined;

  if (!remoteRoom || !homeRoom) {
    console.log(`⚠️ [RemoteHauler] ${creep.name}: No remote room assigned`);
    return;
  }

  // State machine: pickup -> deliver
  const isEmpty = creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0;
  const isFull = creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0;

  if (isEmpty) {
    // Go to remote room to pickup
    if (creep.room.name !== remoteRoom) {
      // Travel to remote room
      const exitDir = Game.map.findExit(creep.room.name, remoteRoom);
      if (exitDir === ERR_NO_PATH || exitDir === ERR_INVALID_ARGS) {
        console.log(
          `❌ [RemoteHauler] ${creep.name}: Cannot find path to ${remoteRoom}`
        );
        return;
      }

      const exit = creep.pos.findClosestByPath(exitDir);
      if (exit) {
        creep.moveTo(exit, { ...visualPath("move") });
        CreepPersonality.speak(creep, "move");
      }
      return;
    }

    // We're in remote room - pickup from containers or dropped resources
    const room = Game.rooms[remoteRoom];

    // Check for threats - evacuate if hostile creeps present
    const hostiles = room.find(FIND_HOSTILE_CREEPS, {
      filter: (c) =>
        c.getActiveBodyparts(ATTACK) > 0 ||
        c.getActiveBodyparts(RANGED_ATTACK) > 0 ||
        c.owner.username === "Invader",
    });

    if (hostiles.length > 0) {
      // Evacuate!
      console.log(
        `🚨 [RemoteHauler] ${creep.name}: Evacuating ${remoteRoom} due to hostiles!`
      );
      const exitDir = Game.map.findExit(remoteRoom, homeRoom);
      if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByPath(exitDir);
        if (exit) {
          creep.moveTo(exit, { ...visualPath("move") });
          CreepPersonality.speak(creep, "frustrated");
        }
      }
      return;
    }

    // Find energy sources (containers or dropped resources)
    const containers = room.find(FIND_STRUCTURES, {
      filter: (s) =>
        s.structureType === STRUCTURE_CONTAINER &&
        (s as StructureContainer).store.getUsedCapacity(RESOURCE_ENERGY) > 0,
    }) as StructureContainer[];

    const droppedEnergy = room.find(FIND_DROPPED_RESOURCES, {
      filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
    });

    let target: StructureContainer | Resource | null = null;

    // Prioritize containers with > 500 energy
    const fullContainers = containers.filter(
      (c) => c.store.getUsedCapacity(RESOURCE_ENERGY) > 500
    );
    if (fullContainers.length > 0) {
      target = creep.pos.findClosestByPath(fullContainers);
    }

    // Then dropped energy
    if (!target && droppedEnergy.length > 0) {
      target = creep.pos.findClosestByPath(droppedEnergy);
    }

    // Then any container
    if (!target && containers.length > 0) {
      target = creep.pos.findClosestByPath(containers);
    }

    if (target) {
      let result: ScreepsReturnCode;
      if (target instanceof Resource) {
        result = creep.pickup(target);
      } else {
        result = creep.withdraw(target, RESOURCE_ENERGY);
      }

      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { ...visualPath("withdraw") });
        CreepPersonality.speak(creep, "move");
      } else if (result === OK) {
        CreepPersonality.speak(creep, "withdraw");
      }
    } else {
      // No energy available, wait near a source
      const sources = room.find(FIND_SOURCES);
      if (sources.length > 0) {
        const source = creep.pos.findClosestByPath(sources);
        if (source && creep.pos.getRangeTo(source) > 3) {
          creep.moveTo(source, { ...visualPath("move") });
          CreepPersonality.speak(creep, "move");
        } else {
          CreepPersonality.speak(creep, "idle");
        }
      }
    }
  } else {
    // Carrying energy - return to home room
    if (creep.room.name !== homeRoom) {
      // Travel to home room
      const exitDir = Game.map.findExit(creep.room.name, homeRoom);
      if (exitDir === ERR_NO_PATH || exitDir === ERR_INVALID_ARGS) {
        console.log(
          `❌ [RemoteHauler] ${creep.name}: Cannot find path to ${homeRoom}`
        );
        return;
      }

      const exit = creep.pos.findClosestByPath(exitDir);
      if (exit) {
        creep.moveTo(exit, { ...visualPath("move") });
        CreepPersonality.speak(creep, "move");
      }
      return;
    }

    // We're in home room - deposit energy
    const room = Game.rooms[homeRoom];

    // Prioritize storage, then terminal, then spawns/extensions
    let target: AnyStoreStructure | null = null;

    if (
      room.storage &&
      room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    ) {
      target = room.storage;
    } else if (
      room.terminal &&
      room.terminal.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    ) {
      target = room.terminal;
    } else {
      // Find spawns/extensions that need energy
      const structures = room.find(FIND_MY_STRUCTURES, {
        filter: (s) =>
          (s.structureType === STRUCTURE_SPAWN ||
            s.structureType === STRUCTURE_EXTENSION) &&
          (s as StructureSpawn | StructureExtension).store.getFreeCapacity(
            RESOURCE_ENERGY
          ) > 0,
      }) as (StructureSpawn | StructureExtension)[];

      if (structures.length > 0) {
        target = creep.pos.findClosestByPath(structures);
      }
    }

    if (target) {
      const result = creep.transfer(target, RESOURCE_ENERGY);
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { ...visualPath("transfer") });
        CreepPersonality.speak(creep, "move");
      } else if (result === OK) {
        CreepPersonality.speak(creep, "transfer");
      }
    } else {
      // No place to deposit, drop it
      creep.drop(RESOURCE_ENERGY);
      CreepPersonality.speak(creep, "frustrated");
    }
  }
}
