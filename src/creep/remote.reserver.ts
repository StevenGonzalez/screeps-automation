/**
 * Remote Reserver
 *
 * Reserves remote room controllers to prevent enemy claims
 * - Travels to remote room
 * - Reserves controller
 * - Maintains reservation
 * - Evacuates on threats
 */

/// <reference types="@types/screeps" />
import { visualPath } from "../path.styles";
import { CreepPersonality } from "./personality";

export function runRemoteReserver(creep: Creep): void {
  const remoteRoom = (creep.memory as any).remoteRoom as string | undefined;
  const homeRoom = (creep.memory as any).homeRoom as string | undefined;

  if (!remoteRoom || !homeRoom) {
    console.log(`⚠️ [RemoteReserver] ${creep.name}: No remote room assigned`);
    return;
  }

  // Travel to remote room
  if (creep.room.name !== remoteRoom) {
    const exitDir = Game.map.findExit(creep.room.name, remoteRoom);
    if (exitDir === ERR_NO_PATH || exitDir === ERR_INVALID_ARGS) {
      console.log(
        `❌ [RemoteReserver] ${creep.name}: Cannot find path to ${remoteRoom}`
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

  // We're in the remote room
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
      `🚨 [RemoteReserver] ${creep.name}: Evacuating ${remoteRoom} due to hostiles!`
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

  // Find controller
  const controller = room.controller;
  if (!controller) {
    console.log(
      `❌ [RemoteReserver] ${creep.name}: No controller in ${remoteRoom}`
    );
    return;
  }

  // Reserve the controller
  const result = creep.reserveController(controller);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(controller, { ...visualPath("upgrade") });
    CreepPersonality.speak(creep, "move");
  } else if (result === OK) {
    CreepPersonality.speak(creep, "upgrade");

    // Sign the controller with a message
    if (
      controller.sign?.username !== creep.owner.username ||
      !controller.sign?.text ||
      Game.time % 1000 === 0
    ) {
      const messages = [
        "⛏️ Remote mining operation - o7",
        "🏴 Reserved for remote mining",
        "⚡ Energy extraction in progress",
        "🤖 Automated remote harvesting",
        "🌟 This room fuels our empire",
      ];
      const randomMessage =
        messages[Math.floor(Math.random() * messages.length)];
      creep.signController(controller, randomMessage);
    }

    // Log reservation status
    if (Game.time % 100 === 0) {
      const ticksRemaining = controller.reservation?.ticksToEnd || 0;
      console.log(
        `🏴 [RemoteReserver] ${creep.name}: ${remoteRoom} reserved for ${ticksRemaining} ticks`
      );
    }
  } else if (result === ERR_INVALID_TARGET) {
    // Controller is already reserved by us or owned
    if (controller.reservation) {
      const ticksRemaining = controller.reservation.ticksToEnd;
      if (ticksRemaining > 4000) {
        // Reservation is high, go back home to recycle
        console.log(
          `✅ [RemoteReserver] ${creep.name}: ${remoteRoom} well reserved (${ticksRemaining} ticks), recycling`
        );
        const exitDir = Game.map.findExit(remoteRoom, homeRoom);
        if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
          const exit = creep.pos.findClosestByPath(exitDir);
          if (exit) {
            creep.moveTo(exit, { ...visualPath("move") });
          }
        }
      } else {
        // Wait near controller
        if (creep.pos.getRangeTo(controller) > 3) {
          creep.moveTo(controller, { ...visualPath("move") });
        }
        CreepPersonality.speak(creep, "idle");
      }
    }
  }
}
