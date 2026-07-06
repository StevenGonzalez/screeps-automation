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
  if (creep.room.name === roomName) return;
  // Route to the room centre via PathFinder's multi-room pathing. Aiming moveTo at a bare exit
  // tile (findExitTo + findClosestByRange) parks creeps on the border or bounces them between
  // two rooms — see role.reserver.ts / role.remote_miner.ts.
  creep.moveTo(new RoomPosition(25, 25, roomName), {
    reusePath: 10,
    range: 20,
    visualizePathStyle: {},
  });
}
