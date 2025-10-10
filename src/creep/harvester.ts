/// <reference types="@types/screeps" />
import { visualPath } from "../path.styles";
import { CreepPersonality } from "./personality";

export function runHarvester(creep: Creep, intel: any): void {
  // State: harvesting when not full, delivering when full
  if (creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    // Assign a source if none
    if (!creep.memory.sourceId) {
      const sources = creep.room.find(FIND_SOURCES);
      const source =
        sources.find((s) => {
          const assigned = creep.room.find(FIND_MY_CREEPS, {
            filter: (c) =>
              c.memory.role === "harvester" && c.memory.sourceId === s.id,
          }).length;
          return assigned < 2;
        }) || sources[0];
      if (source) creep.memory.sourceId = source.id;
    }

    const source = Game.getObjectById<Source>(
      creep.memory.sourceId as Id<Source>
    );
    if (source) {
      const res = creep.harvest(source);
      if (res === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, { ...visualPath("harvest") });
        CreepPersonality.speak(creep, "move");
      } else if (res === OK) {
        CreepPersonality.speak(creep, "harvest");
      }
    }
  } else {
    // Deliver priority: spawn/extension/tower -> container/storage
    const primary = creep.room.find(FIND_STRUCTURES, {
      filter: (s: AnyStructure) =>
        (s.structureType === STRUCTURE_SPAWN ||
          s.structureType === STRUCTURE_EXTENSION ||
          s.structureType === STRUCTURE_TOWER) &&
        (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    }) as AnyStoreStructure[];

    const secondary = creep.room.find(FIND_STRUCTURES, {
      filter: (s: AnyStructure) =>
        (s.structureType === STRUCTURE_CONTAINER ||
          s.structureType === STRUCTURE_STORAGE) &&
        (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    }) as AnyStoreStructure[];

    let targets = primary.length > 0 ? primary : secondary;
    if (targets.length === 0) {
      // Last resort: store in storage even if nearing full
      const storage = creep.room.storage;
      if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        targets = [storage as AnyStoreStructure];
      }
    }
    if (targets.length) {
      const target = creep.pos.findClosestByPath(targets);
      if (target) {
        const res = creep.transfer(target, RESOURCE_ENERGY);
        if (res === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, { ...visualPath("transfer") });
          CreepPersonality.speak(creep, "move");
        } else if (res === OK) CreepPersonality.speak(creep, "transfer");
      }
    } else {
      // No valid dropoff: hover near spawn to await capacity
      const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS);
      if (spawn) {
        creep.moveTo(spawn, { ...visualPath("transfer") });
        CreepPersonality.speak(creep, "move");
      } else {
        CreepPersonality.speak(creep, "frustrated");
      }
    }
  }
}
