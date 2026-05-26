/**
 * Scout (pathfinder): explores an assigned adjacent room, records its sources and
 * threat status in the home room's memory, then returns home and expires.
 *
 * Assignment: creep.memory.targetRoom = room to scout
 *             creep.memory.homeRoom   = owning room name
 */

const SCOUT_HOSTILE_DURATION = 2000; // ticks a hostile room is avoided before re-scouting

export function runScout(creep: Creep) {
  const targetRoom = creep.memory.targetRoom;
  const homeRoom = creep.memory.homeRoom;

  if (!targetRoom || !homeRoom) {
    creep.suicide();
    return;
  }

  // If we're not in the target room yet, travel there
  if (creep.room.name !== targetRoom) {
    const exit = creep.room.findExitTo(targetRoom);
    if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS) {
      markRoomUnreachable(homeRoom, targetRoom);
      creep.suicide();
      return;
    }
    const exitPos = creep.pos.findClosestByRange(exit);
    if (exitPos) creep.moveTo(exitPos, { reusePath: 50, visualizePathStyle: {} });
    return;
  }

  // We're in the target room — gather intelligence
  surveyRoom(creep, homeRoom, targetRoom);

  // Job done — return home to free up spawn capacity (creep will die eventually anyway)
  const home = Game.rooms[homeRoom];
  if (home) {
    const spawn = home.find(FIND_MY_SPAWNS)[0];
    if (spawn) {
      creep.moveTo(spawn, { reusePath: 50 });
      return;
    }
  }
  // No path home; suicide to free memory
  creep.suicide();
}

function surveyRoom(creep: Creep, homeRoomName: string, targetRoomName: string) {
  const homeRoomMemory = Memory.rooms[homeRoomName];
  if (!homeRoomMemory) return;

  if (!homeRoomMemory.remoteRooms) homeRoomMemory.remoteRooms = [];

  const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
  const sourceKeepers = hostiles.filter(
    (c) => c.owner.username === "Source Keeper"
  );
  const isHostile = sourceKeepers.length > 0 || hostiles.some(isPlayerCreep);

  let entry = homeRoomMemory.remoteRooms.find((r) => r.roomName === targetRoomName);
  if (!entry) {
    entry = { roomName: targetRoomName, sources: [], lastSeen: Game.time, hostile: false };
    homeRoomMemory.remoteRooms.push(entry);
  }

  entry.lastSeen = Game.time;
  entry.hostile = isHostile;
  if (isHostile) {
    entry.hostileUntil = Game.time + SCOUT_HOSTILE_DURATION;
  }

  if (!isHostile) {
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
