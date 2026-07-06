import { getThreatInfo } from "../services/services.combat";
import { pickSignature } from "../config/signatures";

export function runConqueror(creep: Creep) {
  const targetRoom = creep.memory.targetRoom;
  if (!targetRoom) { creep.suicide(); return; }

  if (creep.room.name !== targetRoom) {
    const exit = creep.room.findExitTo(targetRoom);
    if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS) {
      creep.suicide();
      return;
    }
    creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 50, range: 20 });
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

  if (controller.owner) {
    console.log(
      `[Expansion] Aborting claim of ${targetRoom} - owned by ${controller.owner.username}.`
    );
    if (Memory.expansion?.roomName === targetRoom) delete Memory.expansion;
    creep.suicide();
    return;
  }

  if (getThreatInfo(creep.room).score > 0) {
    const exits = creep.room.find(FIND_EXIT);
    const exit = creep.pos.findClosestByRange(exits);
    if (exit) creep.moveTo(exit, { reusePath: 5 });
    return;
  }

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
    try {
      const sig = pickSignature(creep.room.name);
      const sres = creep.signController(controller, sig);
      if (sres === OK) {
        if (!Memory.rooms) Memory.rooms = {} as any;
        if (!Memory.rooms[creep.room.name]) Memory.rooms[creep.room.name] = {} as any;
        Memory.rooms[creep.room.name].lastSigned = Game.time;
      }
    } catch (e) {
    }
  }
}
