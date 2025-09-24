/// <reference types="@types/screeps" />
import { style } from "./path.styles";
import { CreepPersonality } from "./creep.personality";

export function runDefender(creep: Creep, defensePlan: any, intel: any): void {
  const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
  if (hostiles.length > 0) {
    const target = creep.pos.findClosestByRange(hostiles);
    if (target) {
      const res = creep.attack(target);
      if (res === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { visualizePathStyle: style("attack") });
        CreepPersonality.speak(creep, "move");
      } else if (res === OK) {
        CreepPersonality.speak(creep, "attack");
      }
    }
    return;
  }

  if (!creep.memory.patrolTarget) {
    const exits = creep.room.find(FIND_EXIT);
    if (exits.length > 0)
      creep.memory.patrolTarget =
        exits[Math.floor(Math.random() * exits.length)];
  }

  if (creep.memory.patrolTarget) {
    creep.moveTo(creep.memory.patrolTarget.x, creep.memory.patrolTarget.y);
    CreepPersonality.speak(creep, "move");
    if (
      creep.pos.getRangeTo(
        creep.memory.patrolTarget.x,
        creep.memory.patrolTarget.y
      ) < 2
    ) {
      delete creep.memory.patrolTarget;
    }
  }
  if (!hostiles.length) {
    CreepPersonality.speak(creep, "idle");
  }
}
