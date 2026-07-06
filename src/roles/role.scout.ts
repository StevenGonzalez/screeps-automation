import {
  markRemotePlayerHostile,
  clearRemotePlayerHostile,
} from "../services/services.creep";
import { recordRoomIntel } from "../orchestrators/orchestrator.military";

const SCOUT_HOSTILE_DURATION = 2000;
const SCOUT_TRAVEL_BUDGET = 150;

export function runScout(creep: Creep) {
  const homeRoom = creep.memory.homeRoom;
  if (!homeRoom) {
    creep.suicide();
    return;
  }

  if (!creep.memory.targetRoom) {
    if (!assignNextRoom(creep, homeRoom)) {
      returnHome(creep, homeRoom);
      return;
    }
  }

  const targetRoom = creep.memory.targetRoom!;

  if (creep.room.name !== targetRoom) {
    const exit = creep.room.findExitTo(targetRoom);
    if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS) {
      giveUpOnRoom(creep, homeRoom, targetRoom);
      return;
    }
    creep.memory.scoutTravelTicks = (creep.memory.scoutTravelTicks ?? 0) + 1;
    if (creep.memory.scoutTravelTicks > SCOUT_TRAVEL_BUDGET) {
      giveUpOnRoom(creep, homeRoom, targetRoom);
      return;
    }
    creep.moveTo(new RoomPosition(25, 25, targetRoom), {
      reusePath: 50,
      range: 20,
      visualizePathStyle: {},
    });
    return;
  }

  surveyRoom(creep, homeRoom, targetRoom);
  creep.memory.scoutTravelTicks = 0;
}

function assignNextRoom(creep: Creep, homeRoomName: string): boolean {
  const mem = Memory.rooms[homeRoomName];
  const pending = mem?.pendingScoutRooms;
  if (!pending || pending.length === 0) return false;

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
      } else {
        creep.suicide();
      }
      return;
    }
  }
  creep.suicide();
}

function surveyRoom(creep: Creep, homeRoomName: string, targetRoomName: string) {
  const homeRoomMemory = Memory.rooms[homeRoomName];
  if (!homeRoomMemory) return;

  if (!homeRoomMemory.remoteRooms) homeRoomMemory.remoteRooms = [];

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

  if (homeRoomMemory.pendingScoutRooms) {
    homeRoomMemory.pendingScoutRooms = homeRoomMemory.pendingScoutRooms.filter(
      (r) => r !== targetRoomName
    );
  }

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
