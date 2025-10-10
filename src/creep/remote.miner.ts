/**
 * Remote Miner
 *
 * Mines in remote rooms and builds containers
 * - Travels to assigned remote source
 * - Builds container next to source
 * - Mines into container
 * - Evacuates on threats
 */

/// <reference types="@types/screeps" />
import { style } from "../path.styles";
import { CreepPersonality } from "./personality";

export function runRemoteMiner(creep: Creep): void {
  const remoteRoom = (creep.memory as any).remoteRoom as string | undefined;
  const homeRoom = (creep.memory as any).homeRoom as string | undefined;
  const sourceId = (creep.memory as any).sourceId as Id<Source> | undefined;

  if (!remoteRoom || !homeRoom) {
    console.log(`⚠️ [RemoteMiner] ${creep.name}: No remote room assigned`);
    return;
  }

  // Check if we're in the remote room
  if (creep.room.name !== remoteRoom) {
    // Travel to remote room
    const exitDir = Game.map.findExit(creep.room.name, remoteRoom);
    if (exitDir === ERR_NO_PATH || exitDir === ERR_INVALID_ARGS) {
      console.log(
        `❌ [RemoteMiner] ${creep.name}: Cannot find path to ${remoteRoom}`
      );
      return;
    }

    const exit = creep.pos.findClosestByPath(exitDir);
    if (exit) {
      creep.moveTo(exit, { visualizePathStyle: style("move") });
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
      `🚨 [RemoteMiner] ${creep.name}: Evacuating ${remoteRoom} due to hostiles!`
    );
    const exitDir = Game.map.findExit(remoteRoom, homeRoom);
    if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
      const exit = creep.pos.findClosestByPath(exitDir);
      if (exit) {
        creep.moveTo(exit, { visualizePathStyle: style("move") });
        CreepPersonality.speak(creep, "frustrated");
      }
    }
    return;
  }

  // Find or assign source
  let source: Source | null = null;
  if (sourceId) {
    source = Game.getObjectById(sourceId);
  }

  if (!source) {
    // Find a source
    const sources = room.find(FIND_SOURCES);
    if (sources.length === 0) {
      console.log(
        `❌ [RemoteMiner] ${creep.name}: No sources in ${remoteRoom}`
      );
      return;
    }

    // Pick first source
    source = sources[0];
    (creep.memory as any).sourceId = source.id;
  }

  // Position: Try to stand directly adjacent to source for efficiency
  const adjacentPos = source.pos.findInRange(FIND_MY_CREEPS, 0)[0]?.pos;
  if (!adjacentPos || !adjacentPos.isEqualTo(creep.pos)) {
    const openSpots = [
      { x: source.pos.x - 1, y: source.pos.y },
      { x: source.pos.x + 1, y: source.pos.y },
      { x: source.pos.x, y: source.pos.y - 1 },
      { x: source.pos.x, y: source.pos.y + 1 },
      { x: source.pos.x - 1, y: source.pos.y - 1 },
      { x: source.pos.x + 1, y: source.pos.y - 1 },
      { x: source.pos.x - 1, y: source.pos.y + 1 },
      { x: source.pos.x + 1, y: source.pos.y + 1 },
    ].filter((pos) => {
      if (pos.x < 1 || pos.x > 48 || pos.y < 1 || pos.y > 48) return false;
      const terrain = room.getTerrain();
      return terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL;
    });

    // Find best spot (no creeps, no structures except ramparts)
    for (const pos of openSpots) {
      const roomPos = new RoomPosition(pos.x, pos.y, room.name);
      const creeps = roomPos.lookFor(LOOK_CREEPS);
      const structures = roomPos.lookFor(LOOK_STRUCTURES);
      const blockers = structures.filter(
        (s) =>
          s.structureType !== STRUCTURE_ROAD &&
          s.structureType !== STRUCTURE_RAMPART
      );

      if (creeps.length === 0 && blockers.length === 0) {
        if (creep.pos.getRangeTo(roomPos) > 0) {
          creep.moveTo(roomPos, { visualizePathStyle: style("harvest") });
          CreepPersonality.speak(creep, "move");
          return;
        }
        break;
      }
    }
  }

  // Mine the source - energy automatically drops when full
  const harvestResult = creep.harvest(source);
  if (harvestResult === ERR_NOT_IN_RANGE) {
    // Move to source
    creep.moveTo(source, { visualizePathStyle: style("harvest") });
    CreepPersonality.speak(creep, "move");
  } else if (harvestResult === OK) {
    CreepPersonality.speak(creep, "harvest");

    // Energy automatically drops to ground when creep inventory is full
    // Haulers will pick it up from dropped resources
  } else if (harvestResult === ERR_NOT_ENOUGH_RESOURCES) {
    // Source is regenerating
    CreepPersonality.speak(creep, "idle");
  }
}
