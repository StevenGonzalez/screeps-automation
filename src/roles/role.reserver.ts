import { noteWalk, signControllerIfNeeded } from "../services/services.creep";

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
  // Nothing to reserve in an owned room: another player's, or a remote we
  // have since claimed as a keep.
  if (!controller || controller.owner) {
    creep.suicide();
    return;
  }

  // reserveController fails on someone else's reservation (Invader cores
  // included); attacking it wears the reservation down so ours can start.
  const reservedBy = controller.reservation?.username;
  const result =
    reservedBy && reservedBy !== creep.owner.username
      ? creep.attackController(controller)
      : creep.reserveController(controller);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(controller, { reusePath: 30 });
    return;
  }
  noteWalk(creep, CREEP_CLAIM_LIFE_TIME);
  // Already beside the controller, so the proclamation costs nothing extra.
  signControllerIfNeeded(creep, controller);
}

function moveToRoom(creep: Creep, targetRoom: string) {
  creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 30, range: 20 });
}
