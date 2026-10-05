import {
  markRemotePlayerHostile,
  clearRemotePlayerHostile,
} from "../services/services.creep";
import { recordRoomIntel } from "../orchestrators/orchestrator.military";
import { applyRemoteControllerStatus } from "../orchestrators/orchestrator.memory";
import { isArmedHostile } from "../services/services.combat";

const SCOUT_HOSTILE_DURATION = 2000;
// Ticks a raven walks towards one room before giving it up. Three rooms out, a
// raven going on from its last room can have four borders to cross: at 150,
// Embercrag's raven gave up on a highway room three tiles short of it.
const SCOUT_TRAVEL_BUDGET = 300;

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

  // The nearest room next, so the raven is not sent back and forth across
  // the realm in the order the rooms were listed.
  let next: string | undefined;
  let nearest = Infinity;
  for (const r of pending) {
    if (claimed.has(r)) continue;
    const d = Game.map.getRoomLinearDistance(creep.room.name, r);
    if (d < nearest) {
      nearest = d;
      next = r;
    }
  }
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

  const controller = creep.room.controller;
  if (!controller?.my) recordRoomIntel(creep.room);

  if (homeRoomMemory.pendingScoutRooms) {
    homeRoomMemory.pendingScoutRooms = homeRoomMemory.pendingScoutRooms.filter(
      (r) => r !== targetRoomName
    );
  }
  creep.memory.targetRoom = undefined;

  // A room we own is a colony, not a remote.
  if (controller?.my) {
    homeRoomMemory.remoteRooms = homeRoomMemory.remoteRooms.filter(
      (r) => r.roomName !== targetRoomName
    );
    return;
  }

  let entry = homeRoomMemory.remoteRooms.find((r) => r.roomName === targetRoomName);
  // Deep-scouted rooms only feed intel; remotes are mined next door to home.
  if (!entry && !isAdjacent(homeRoomName, targetRoomName)) return;
  if (!entry) {
    entry = { roomName: targetRoomName, sources: [], lastSeen: Game.time, hostile: false };
    homeRoomMemory.remoteRooms.push(entry);
  }
  entry.lastSeen = Game.time;

  if (applyRemoteControllerStatus(entry, controller, creep.owner.username)) return;

  const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
  const sourceKeepers = hostiles.filter(
    (c) => c.owner.username === "Source Keeper"
  );
  // Unarmed or allied creeps (other players' scouts and workers) don't make a
  // room hostile.
  const player = hostiles.find(isArmedHostile);

  if (player) {
    markRemotePlayerHostile(entry, player.owner.username);
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
}

function isAdjacent(homeRoomName: string, roomName: string): boolean {
  return Object.values(Game.map.describeExits(homeRoomName)).includes(roomName);
}

const UNREACHABLE_RETRY_TICKS = 10000;

function markRoomUnreachable(homeRoomName: string, targetRoomName: string) {
  const mem = Memory.rooms[homeRoomName];
  if (!mem) return;
  if (mem.pendingScoutRooms) {
    mem.pendingScoutRooms = mem.pendingScoutRooms.filter(
      (r) => r !== targetRoomName
    );
  }
  if (!mem.remoteRooms) mem.remoteRooms = [];
  let entry = mem.remoteRooms.find((r) => r.roomName === targetRoomName);
  // A deep room is only remembered as "don't retry yet", not as a remote.
  if (!entry && !isAdjacent(homeRoomName, targetRoomName)) {
    if (!mem.scoutSkipUntil) mem.scoutSkipUntil = {};
    mem.scoutSkipUntil[targetRoomName] = Game.time + UNREACHABLE_RETRY_TICKS;
    return;
  }
  if (!entry) {
    entry = { roomName: targetRoomName, sources: [], lastSeen: Game.time, hostile: true };
    mem.remoteRooms.push(entry);
  }
  entry.lastSeen = Game.time;
  entry.hostile = true;
  entry.hostileUntil = Game.time + UNREACHABLE_RETRY_TICKS;
}
