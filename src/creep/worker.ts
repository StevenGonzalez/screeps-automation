/// <reference types="@types/screeps" />
import { CreepPersonality } from "./personality";

export function runWorker(creep: Creep, intel: any): void {
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
    const sources = creep.room.find(FIND_SOURCES);
    const source = creep.pos.findClosestByPath(sources);
    if (source) {
      const res = creep.harvest(source);
      if (res === ERR_NOT_IN_RANGE) {
        creep.moveTo(source);
        CreepPersonality.speak(creep, "move");
      } else if (res === OK) {
        CreepPersonality.speak(creep, "harvest");
      }
    }
  } else {
    const sites = creep.room.find(FIND_CONSTRUCTION_SITES);
    const target = creep.pos.findClosestByPath(sites);
    if (target) {
      const res = creep.build(target);
      if (res === ERR_NOT_IN_RANGE) {
        creep.moveTo(target);
        CreepPersonality.speak(creep, "move");
      } else if (res === OK) {
        CreepPersonality.speak(creep, "build");
      }
    } else if (creep.room.controller) {
      const res = creep.upgradeController(creep.room.controller);
      if (res === ERR_NOT_IN_RANGE) {
        creep.moveTo(creep.room.controller);
        CreepPersonality.speak(creep, "move");
      } else if (res === OK) {
        CreepPersonality.speak(creep, "upgrade");
      }
    }
  }
}
