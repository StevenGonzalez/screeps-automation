/**
 * Scout Creep Behavior
 *
 * Explores adjacent rooms to provide vision for remote mining analysis.
 * - Travels to target rooms
 * - Ensures full vision coverage
 * - Returns home after scouting
 */

/// <reference types="@types/screeps" />

import { style } from "../path.styles";
import { CreepPersonality } from "./personality";

/**
 * Run scout creep behavior
 */
export function runScout(creep: Creep): void {
  // Get target room from memory
  const targetRoom = creep.memory.targetRoom as string | undefined;
  const homeRoom = creep.memory.homeRoom as string;

  if (!targetRoom) {
    // No assignment yet, return home or idle
    if (creep.room.name !== homeRoom) {
      const exitDir = creep.room.findExitTo(homeRoom);
      if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByPath(exitDir);
        if (exit) {
          creep.moveTo(exit, { visualizePathStyle: style("scout") });
          CreepPersonality.speak(creep, "move");
        }
      }
    } else {
      CreepPersonality.speak(creep, "idle");
    }
    return;
  }

  // If we're not in the target room, move there
  if (creep.room.name !== targetRoom) {
    const exitDir = creep.room.findExitTo(targetRoom);
    if (exitDir === ERR_NO_PATH || exitDir === ERR_INVALID_ARGS) {
      console.log(`🚫 [Scout] ${creep.name}: Cannot path to ${targetRoom}`);
      creep.memory.targetRoom = undefined; // Clear target - room unreachable
      return;
    }

    const exit = creep.pos.findClosestByPath(exitDir);
    if (exit) {
      creep.moveTo(exit, { visualizePathStyle: style("scout") });
      CreepPersonality.speak(creep, "move");
    }
    return;
  }

  // We're in the target room! Stay for a bit to ensure full vision
  if (!creep.memory.scoutTimer) {
    creep.memory.scoutTimer = 0;
  }

  creep.memory.scoutTimer = (creep.memory.scoutTimer as number) + 1;

  // Stay for 10 ticks to ensure room is fully scanned
  if ((creep.memory.scoutTimer as number) < 10) {
    // Move to center of room for better vision
    const center = new RoomPosition(25, 25, creep.room.name);
    if (!creep.pos.inRangeTo(center, 10)) {
      creep.moveTo(center, { visualizePathStyle: style("scout") });
      CreepPersonality.speak(creep, "move");
    } else {
      CreepPersonality.speak(creep, "idle");
    }
    return;
  }

  // Done scouting, mark as complete and return home
  console.log(`✅ [Scout] ${creep.name}: Completed scouting ${targetRoom}`);
  creep.memory.targetRoom = undefined;
  creep.memory.scoutTimer = 0;

  // Mark room as recently scouted in memory
  if (!Memory.rooms) Memory.rooms = {};
  if (!Memory.rooms[targetRoom]) {
    Memory.rooms[targetRoom] = {} as any;
  }
  Memory.rooms[targetRoom].lastScanned = Game.time;

  // Return to home room
  if (creep.room.name !== homeRoom) {
    const exitDir = creep.room.findExitTo(homeRoom);
    if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
      const exit = creep.pos.findClosestByPath(exitDir);
      if (exit) {
        creep.moveTo(exit, { visualizePathStyle: style("scout") });
        CreepPersonality.speak(creep, "move");
      }
    }
  }
}
