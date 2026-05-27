/**
 * Reserver (warden): travels to an assigned remote room and keeps its controller
 * reserved. Reservation doubles source capacity (3000 vs 1500 energy) and prevents
 * other players from claiming the room.
 *
 * Assignment: creep.memory.homeRoom  = owning room name
 *             creep.memory.targetRoom = room to reserve
 */

export function runReserver(creep: Creep) {
  const { targetRoom, homeRoom } = creep.memory;

  if (!targetRoom || !homeRoom) {
    creep.suicide();
    return;
  }

  if (creep.room.name !== targetRoom) {
    moveToRoom(creep, targetRoom);
    return;
  }

  const controller = creep.room.controller;
  if (!controller) {
    // Room has no controller — nothing to do
    creep.suicide();
    return;
  }

  const result = creep.reserveController(controller);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(controller, { reusePath: 30 });
  }
}

function moveToRoom(creep: Creep, targetRoom: string) {
  const exit = creep.room.findExitTo(targetRoom);
  if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS) return;
  const exitPos = creep.pos.findClosestByRange(exit);
  if (exitPos) creep.moveTo(exitPos, { reusePath: 30 });
}
