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
  // Use PathFinder's multi-room routing toward the target room centre rather than
  // findExitTo. findExitTo gives up silently on any ERR_NO_PATH/ERR_INVALID_ARGS hiccup,
  // which strands the reserver in an intermediate room; moveTo to a RoomPosition routes
  // across rooms robustly.
  creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 30, range: 20 });
}
