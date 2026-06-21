/**
 * Scout (pathfinder): a MOVE-only explorer. It walks to its assigned room, records full
 * intel on arrival (sources + threat for remote mining, plus persistent attack-planning
 * intel in Memory.intel), then picks the NEXT queued room and continues — surveying many
 * rooms over its lifetime rather than dying after one. When the home queue is empty it
 * returns home; if it can't reach a room within a budget it gives up on that room.
 *
 * Assignment: creep.memory.targetRoom = room to scout next
 *             creep.memory.homeRoom   = owning room name
 */

import {
  markRemotePlayerHostile,
  clearRemotePlayerHostile,
} from "../services/services.creep";
import { recordRoomIntel } from "../orchestrators/orchestrator.military";

const SCOUT_HOSTILE_DURATION = 2000; // ticks a hostile room is avoided before re-scouting
// Give up routing to a target after this many ticks of trying (sealed border / no path).
const SCOUT_TRAVEL_BUDGET = 150;

export function runScout(creep: Creep) {
  const homeRoom = creep.memory.homeRoom;
  if (!homeRoom) {
    creep.suicide();
    return;
  }

  // No current assignment — pull the next room from the home queue, or head home.
  if (!creep.memory.targetRoom) {
    if (!assignNextRoom(creep, homeRoom)) {
      returnHome(creep, homeRoom);
      return;
    }
  }

  const targetRoom = creep.memory.targetRoom!;

  // If we're not in the target room yet, travel there (bounded by a travel budget).
  if (creep.room.name !== targetRoom) {
    const exit = creep.room.findExitTo(targetRoom);
    if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS) {
      giveUpOnRoom(creep, homeRoom, targetRoom);
      return;
    }
    // Bound transit so a scout can't burn its whole life pushing against a sealed border.
    creep.memory.scoutTravelTicks = (creep.memory.scoutTravelTicks ?? 0) + 1;
    if (creep.memory.scoutTravelTicks > SCOUT_TRAVEL_BUDGET) {
      giveUpOnRoom(creep, homeRoom, targetRoom);
      return;
    }
    const exitPos = creep.pos.findClosestByRange(exit);
    if (exitPos) creep.moveTo(exitPos, { reusePath: 50, visualizePathStyle: {} });
    return;
  }

  // Arrived — gather intelligence, then look for the next room next tick.
  surveyRoom(creep, homeRoom, targetRoom);
  creep.memory.scoutTravelTicks = 0;
}

// Claims the next unassigned pending room for this scout. Returns false if the queue is
// empty / fully claimed by sibling scouts (the home room may run more than one scout).
function assignNextRoom(creep: Creep, homeRoomName: string): boolean {
  const mem = Memory.rooms[homeRoomName];
  const pending = mem?.pendingScoutRooms;
  if (!pending || pending.length === 0) return false;

  // Avoid stepping on rooms a sibling scout is already heading to.
  const claimed = new Set<string>();
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.id === creep.id) continue;
    if (c.memory.role === creep.memory.role && c.memory.homeRoom === homeRoomName && c.memory.targetRoom) {
      claimed.add(c.memory.targetRoom);
    }
  }

  const next = pending.find((r) => !claimed.has(r));
  if (!next) return false;
  creep.memory.targetRoom = next;
  creep.memory.scoutTravelTicks = 0;
  return true;
}

// Stop chasing an unreachable room: drop it from the queue and clear the assignment so the
// scout picks a different room next tick.
function giveUpOnRoom(creep: Creep, homeRoomName: string, targetRoomName: string): void {
  markRoomUnreachable(homeRoomName, targetRoomName);
  creep.memory.targetRoom = undefined;
  creep.memory.scoutTravelTicks = 0;
}

function returnHome(creep: Creep, homeRoomName: string): void {
  const home = Game.rooms[homeRoomName];
  if (home) {
    const spawn = home.find(FIND_MY_SPAWNS)[0];
    if (spawn) {
      if (!creep.pos.isNearTo(spawn) || creep.room.name !== homeRoomName) {
        creep.moveTo(spawn, { reusePath: 50 });
      }
      return;
    }
  }
  // No path home; suicide to free memory.
  creep.suicide();
}

function surveyRoom(creep: Creep, homeRoomName: string, targetRoomName: string) {
  const homeRoomMemory = Memory.rooms[homeRoomName];
  if (!homeRoomMemory) return;

  if (!homeRoomMemory.remoteRooms) homeRoomMemory.remoteRooms = [];

  // Persist full attack-planning intel (positions, loot, barriers) and refresh the global
  // last-seen timestamp the deep-scout BFS keys off of. Skip owned rooms — Memory.intel is
  // for non-owned rooms only and scouts never legitimately target our own.
  if (!creep.room.controller?.my) recordRoomIntel(creep.room);

  const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
  const sourceKeepers = hostiles.filter(
    (c) => c.owner.username === "Source Keeper"
  );
  const hasPlayer = hostiles.some(isPlayerCreep);

  let entry = homeRoomMemory.remoteRooms.find((r) => r.roomName === targetRoomName);
  if (!entry) {
    entry = { roomName: targetRoomName, sources: [], lastSeen: Game.time, hostile: false };
    homeRoomMemory.remoteRooms.push(entry);
  }

  entry.lastSeen = Game.time;
  if (hasPlayer) {
    // Re-probe found the player still here — escalate the avoidance backoff.
    markRemotePlayerHostile(entry);
  } else if (sourceKeepers.length > 0) {
    entry.hostile = true;
    entry.hostileUntil = Game.time + SCOUT_HOSTILE_DURATION;
  } else {
    clearRemotePlayerHostile(entry);
    const sources = creep.room.find(FIND_SOURCES);
    entry.sources = sources.map((s) => {
      const existing = entry!.sources.find((es) => es.sourceId === s.id);
      return {
        sourceId: s.id,
        containerId: existing?.containerId,
      };
    });
  }

  // Remove this room from pending queue
  if (homeRoomMemory.pendingScoutRooms) {
    homeRoomMemory.pendingScoutRooms = homeRoomMemory.pendingScoutRooms.filter(
      (r) => r !== targetRoomName
    );
  }

  // Clear this creep's assignment — it's done
  creep.memory.targetRoom = undefined;
}

function markRoomUnreachable(homeRoomName: string, targetRoomName: string) {
  const mem = Memory.rooms[homeRoomName];
  if (!mem) return;
  if (mem.pendingScoutRooms) {
    mem.pendingScoutRooms = mem.pendingScoutRooms.filter(
      (r) => r !== targetRoomName
    );
  }
}

function isPlayerCreep(creep: Creep): boolean {
  return creep.owner.username !== "Source Keeper" && creep.owner.username !== "Invader";
}
