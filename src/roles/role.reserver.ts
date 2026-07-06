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
    creep.suicide();
    return;
  }

  const result = creep.reserveController(controller);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(controller, { reusePath: 30 });
  }
}

function moveToRoom(creep: Creep, targetRoom: string) {
  creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 30, range: 20 });
}
