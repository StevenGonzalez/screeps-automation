import { ROLE_POWER_HEALER } from "../config/config.roles";

export function runPowerAttacker(creep: Creep) {
  const opId = creep.memory.powerOpId;
  if (opId === undefined) { creep.suicide(); return; }

  const op = (Memory.powerOps ?? []).find((o) => o.id === opId);
  if (!op || op.phase === "done") { creep.suicide(); return; }

  if (op.phase === "forming") {
    parkNearHomeSpawn(creep, op.homeRoom);
    return;
  }

  if (op.phase === "cracking") {
    if (creep.room.name !== op.roomName) {
      travelToRoom(creep, op.roomName);
      return;
    }
    const bank = op.bankId ? Game.getObjectById(op.bankId) as StructurePowerBank | null : null;
    if (!bank) return; // bank gone, orchestrator will transition phase
    // Power banks reflect half the damage dealt back at the attacker. Don't start trading
    // hits until a squad healer is in heal range to cover it — attacking solo gets the lead
    // attacker killed before the healers arrive and cascades into a squad wipe. Stage
    // adjacent to the bank and wait.
    const healerInRange = creep.pos.findInRange(FIND_MY_CREEPS, 3, {
      filter: (c) => c.memory.role === ROLE_POWER_HEALER && c.memory.powerOpId === opId,
    }).length > 0;
    if (!healerInRange) {
      if (creep.pos.getRangeTo(bank) > 1) {
        creep.moveTo(bank, { reusePath: 5, visualizePathStyle: {} });
      }
      return;
    }
    if (creep.attack(bank) === ERR_NOT_IN_RANGE) {
      creep.moveTo(bank, { reusePath: 5, visualizePathStyle: {} });
    }
    return;
  }

  if (op.phase === "collecting") {
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

function travelToRoom(creep: Creep, roomName: string) {
  const exit = creep.room.findExitTo(roomName);
  if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS) return;
  const pos = creep.pos.findClosestByRange(exit);
  if (pos) creep.moveTo(pos, { reusePath: 10, visualizePathStyle: {} });
}
