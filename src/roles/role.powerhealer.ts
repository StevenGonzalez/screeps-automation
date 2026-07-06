import { ROLE_POWER_ATTACKER } from "../config/config.roles";

export function runPowerHealer(creep: Creep) {
  const opId = creep.memory.powerOpId;
  if (opId === undefined) { creep.suicide(); return; }

  const op = (Memory.powerOps ?? []).find((o) => o.id === opId);
  if (!op || op.phase === "done") { creep.suicide(); return; }

  if (op.phase === "forming") {
    parkNearHomeSpawn(creep, op.homeRoom);
    return;
  }

  if (op.phase === "cracking") {
    const attackers = Object.values(Game.creeps).filter(
      (c) => c.memory.powerOpId === opId && c.memory.role === ROLE_POWER_ATTACKER
    );

    // Heal most-injured attacker within range, otherwise move toward lead attacker
    let healTarget: Creep | null = null;
    let lowestRatio = 1;
    for (const a of attackers) {
      const ratio = a.hits / a.hitsMax;
      if (ratio < lowestRatio) { lowestRatio = ratio; healTarget = a; }
    }

    if (healTarget) {
      const result = creep.heal(healTarget);
      if (result === ERR_NOT_IN_RANGE) {
        creep.rangedHeal(healTarget);
        creep.moveTo(healTarget, { reusePath: 3, visualizePathStyle: {} });
      }
    } else if (attackers.length > 0) {
      // Lead attacker — stay adjacent
      creep.moveTo(attackers[0], { reusePath: 3, visualizePathStyle: {} });
    } else if (creep.room.name !== op.roomName) {
      travelToRoom(creep, op.roomName);
    }

    // Heal self if injured and no one else needs it
    if (!healTarget && creep.hits < creep.hitsMax) {
      creep.heal(creep);
    }
    return;
  }

  if (op.phase === "collecting") {
    // Heal self if needed on the way home
    if (creep.hits < creep.hitsMax) creep.heal(creep);
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
