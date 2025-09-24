/// <reference types="@types/screeps" />
import { style } from "./path.styles";
import { CreepPersonality } from "./creep.personality";

export function runBuilder(
  creep: Creep,
  constructionPlan: any,
  intel: any
): void {
  // Toggle
  if (
    creep.memory.working &&
    creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0
  )
    creep.memory.working = false;
  if (
    !creep.memory.working &&
    creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0
  )
    creep.memory.working = true;

  if (creep.memory.working) {
    // From plan
    if (constructionPlan?.recommendations?.immediate?.length) {
      const siteId = constructionPlan.recommendations.immediate[0];
      const target = Game.getObjectById<ConstructionSite>(
        siteId as Id<ConstructionSite>
      );
      if (target) {
        if (creep.build(target) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, { visualizePathStyle: style("build") });
          CreepPersonality.speak(creep, "move");
        } else {
          CreepPersonality.speak(creep, "build");
        }
        return;
      }
    }
    const sites = creep.room.find(FIND_CONSTRUCTION_SITES);
    const target = creep.pos.findClosestByPath(sites);
    if (target) {
      if (creep.build(target) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target);
        CreepPersonality.speak(creep, "move");
      } else {
        CreepPersonality.speak(creep, "build");
      }
    } else if (creep.room.controller) {
      // Fallback: upgrade controller so builders don't idle
      const res = creep.upgradeController(creep.room.controller);
      if (res === ERR_NOT_IN_RANGE) {
        creep.moveTo(creep.room.controller, {
          visualizePathStyle: style("build"),
        });
        CreepPersonality.speak(creep, "move");
      } else if (res === OK) {
        CreepPersonality.speak(creep, "upgrade");
      }
    }
  } else {
    // Refill like hauler
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
      const dropped = creep.room.find(FIND_DROPPED_RESOURCES, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
      });
      const d = creep.pos.findClosestByPath(dropped);
      if (d) {
        if (creep.pickup(d) === ERR_NOT_IN_RANGE) {
          creep.moveTo(d);
          CreepPersonality.speak(creep, "move");
        } else {
          CreepPersonality.speak(creep, "withdraw");
        }
      } else {
        const src = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
        if (src) {
          const res = creep.harvest(src);
          if (res === ERR_NOT_IN_RANGE) {
            creep.moveTo(src, { visualizePathStyle: style("harvest") });
            CreepPersonality.speak(creep, "move");
          } else if (res === OK) {
            CreepPersonality.speak(creep, "harvest");
          }
        } else {
          CreepPersonality.speak(creep, "frustrated");
        }
      }
    }
  }
}
