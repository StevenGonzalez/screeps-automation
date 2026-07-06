import { getThreatInfo } from "../services/services.combat";
import { pickSignature } from "../config/signatures";

// Capo: travels to the expansion target and claims its controller, flipping
// Memory.expansion to "bootstrapping" on success. Aborts cleanly if the target
// turns out to be contested (claimed by another player) or invaded.

export function runConqueror(creep: Creep) {
  const targetRoom = creep.memory.targetRoom;
  if (!targetRoom) { creep.suicide(); return; }

  if (creep.room.name !== targetRoom) {
    // findExitTo gates the unreachable case (suicide rather than wander); travel itself uses
    // PathFinder's multi-room pathing to the room centre — moveTo-ing a bare exit tile bounces
    // creeps between two rooms (see role.reserver.ts / role.remote_miner.ts).
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

  // Already ours — kick off bootstrapping and retire.
  if (controller.my) {
    if (Memory.expansion?.roomName === targetRoom) {
      Memory.expansion.phase = "bootstrapping";
    }
    creep.suicide();
    return;
  }

  // Contested: another player beat us to ownership. Abort and clear the expansion
  // so the orchestrator can pick a different target (it also checks this, but
  // bailing here stops us wasting the CLAIM body on a lost cause).
  if (controller.owner) {
    console.log(
      `[Expansion] Aborting claim of ${targetRoom} — owned by ${controller.owner.username}.`
    );
    if (Memory.expansion?.roomName === targetRoom) delete Memory.expansion;
    creep.suicide();
    return;
  }

  // Invaded: don't sit on the controller getting shot. Retreat toward an exit and
  // wait for the room to clear (the orchestrator pauses the op via scout hostility).
  if (getThreatInfo(creep.room).score > 0) {
    const exits = creep.room.find(FIND_EXIT);
    const exit = creep.pos.findClosestByRange(exits);
    if (exit) creep.moveTo(exit, { reusePath: 5 });
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
    // Sign the controller with the next on-theme signature and record it.
    try {
      const sig = pickSignature(creep.room.name);
      const sres = creep.signController(controller, sig);
      if (sres === OK) {
        if (!Memory.rooms) Memory.rooms = {} as any;
        if (!Memory.rooms[creep.room.name]) Memory.rooms[creep.room.name] = {} as any;
        Memory.rooms[creep.room.name].lastSigned = Game.time;
      }
    } catch (e) {
      // Signing is best-effort; avoid throwing in-role logic.
    }
  }
}
