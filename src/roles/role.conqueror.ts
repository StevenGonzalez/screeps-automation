export function runConqueror(creep: Creep) {
  const targetRoom = creep.memory.targetRoom;
  if (!targetRoom) { creep.suicide(); return; }

  if (creep.room.name !== targetRoom) {
    const exit = creep.room.findExitTo(targetRoom);
    if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS) {
      creep.suicide();
      return;
    }
    const exitPos = creep.pos.findClosestByRange(exit);
    if (exitPos) creep.moveTo(exitPos, { reusePath: 50 });
    return;
  }

  const controller = creep.room.controller;
  if (!controller) { creep.suicide(); return; }

  if (controller.my) {
    if (Memory.expansion?.roomName === targetRoom) {
      Memory.expansion.phase = "bootstrapping";
    }
    creep.suicide();
    return;
  }

  // Clear enemy reservation before claiming
  if (
    controller.reservation &&
    controller.reservation.username !== creep.owner.username
  ) {
    if (creep.attackController(controller) === ERR_NOT_IN_RANGE) {
      creep.moveTo(controller, { reusePath: 10 });
    }
    return;
  }

  const result = creep.claimController(controller);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(controller, { reusePath: 10 });
  } else if (result === OK) {
    if (Memory.expansion?.roomName === targetRoom) {
      Memory.expansion.phase = "bootstrapping";
    }
    console.log(`[Expansion] Claimed ${targetRoom}!`);
  }
}
