import { isInvaderCreep, isPlayerCreep, remoteThreats } from "../services/services.combat";
import {
  flagRemoteInvader,
  flagRemotePlayer,
  isAssignedRemoteContested,
  noteWalk,
  outsideHome,
  signControllerIfNeeded,
} from "../services/services.creep";
import { cryFlight, settleFlight } from "../services/services.herald";

export function runReserver(creep: Creep) {
  const { targetRoom, homeRoom } = creep.memory;

  if (!targetRoom || !homeRoom) {
    creep.suicide();
    return;
  }

  // An envoy bears no arms, so it waits out a raid at home as the vendors do,
  // and the reservation runs down a tick at a time while it is gone. Envoy
  // Thorne stood reserving the Misty Thicket while raiders cut him down.
  const threats = creep.room.name === targetRoom ? remoteThreats(creep.room) : [];
  if (threats.some(isInvaderCreep)) flagRemoteInvader(creep);
  else if (threats.some(isPlayerCreep)) flagRemotePlayer(creep);
  if (threats.length > 0 || isAssignedRemoteContested(creep)) {
    cryFlight(creep);
    // A walk out broken off to wait at home is no measure of the road.
    creep.memory.walk ??= 0;
    if (outsideHome(creep, homeRoom)) moveToRoom(creep, homeRoom);
    return;
  }
  settleFlight(creep);

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
