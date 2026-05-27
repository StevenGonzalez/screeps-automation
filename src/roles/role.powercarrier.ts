export function runPowerCarrier(creep: Creep) {
  // Always deposit power first, regardless of op state
  if ((creep.store.getUsedCapacity(RESOURCE_POWER) ?? 0) > 0) {
    if (creep.room.name !== creep.memory.homeRoom) {
      travelToRoom(creep, creep.memory.homeRoom!);
      return;
    }
    const target = creep.room.storage ?? creep.room.terminal;
    if (target) {
      if (creep.transfer(target, RESOURCE_POWER) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { reusePath: 5, visualizePathStyle: {} });
      }
      return;
    }
  }

  const opId = creep.memory.powerOpId;
  if (opId === undefined) { creep.suicide(); return; }

  const op = (Memory.powerOps ?? []).find((o) => o.id === opId);
  if (!op || op.phase === "done") { creep.suicide(); return; }

  if (op.phase === "forming") {
    parkNearHomeSpawn(creep, op.homeRoom);
    return;
  }

  if (op.phase === "cracking") {
    // Pre-position near the bank room while attackers crack it
    if (creep.room.name !== op.roomName) {
      travelToRoom(creep, op.roomName);
      return;
    }
    // Stay near room center, out of the way
    const center = new RoomPosition(25, 25, op.roomName);
    if (creep.pos.getRangeTo(center) > 5) {
      creep.moveTo(center, { reusePath: 10, visualizePathStyle: {} });
    }
    return;
  }

  if (op.phase === "collecting") {
    if (creep.store.getFreeCapacity() === 0) {
      travelToRoom(creep, op.homeRoom);
      return;
    }

    if (creep.room.name !== op.roomName) {
      travelToRoom(creep, op.roomName);
      return;
    }

    // Grab dropped power
    const dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
      filter: (r) => r.resourceType === RESOURCE_POWER,
    });
    if (dropped) {
      if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
        creep.moveTo(dropped, { reusePath: 3, visualizePathStyle: {} });
      }
      return;
    }

    // Power in ruins (fallback)
    const ruins = creep.room.find(FIND_RUINS);
    for (const ruin of ruins) {
      if ((ruin.store.getUsedCapacity(RESOURCE_POWER) ?? 0) > 0) {
        if (creep.withdraw(ruin, RESOURCE_POWER) === ERR_NOT_IN_RANGE) {
          creep.moveTo(ruin, { reusePath: 3, visualizePathStyle: {} });
        }
        return;
      }
    }

    // Nothing left to collect — head home
    travelToRoom(creep, op.homeRoom);
  }
}

function parkNearHomeSpawn(creep: Creep, homeRoomName: string) {
  if (creep.room.name !== homeRoomName) {
    travelToRoom(creep, homeRoomName);
    return;
  }
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn && creep.pos.getRangeTo(spawn) > 3) {
    creep.moveTo(spawn, { reusePath: 20, visualizePathStyle: {} });
  }
}

function travelToRoom(creep: Creep, roomName: string | undefined) {
  if (!roomName || creep.room.name === roomName) return;
  const exit = creep.room.findExitTo(roomName);
  if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS) return;
  const pos = creep.pos.findClosestByRange(exit);
  if (pos) creep.moveTo(pos, { reusePath: 10, visualizePathStyle: {} });
}
