import { seekBoost, findInvaderCore } from "../services/services.combat";
import { isAlly } from "../services/services.allies";
import { clearRemoteInvader, isAssignedRemoteInvaded } from "../services/services.creep";
import { ROLE_CLERIC } from "../config/config.roles";
import { parkIdle } from "../services/services.town";
import { crySortie } from "../services/services.herald";
import { getDefenseOp, getOffensiveOp, runDefensiveKnight, runOffensiveKnight } from "../orchestrators/orchestrator.military";

const RETREAT_THRESHOLD = 0.2;

export function runKnight(creep: Creep) {
  const underImmediateThreat = creep.pos
    .findInRange(FIND_HOSTILE_CREEPS, 8)
    .some((c) => !isAlly(c.owner?.username));
  if (
    !underImmediateThreat &&
    (creep.memory.boostCompound || creep.memory.boostQueue?.length) &&
    seekBoost(creep)
  ) {
    return;
  }

  if (creep.memory.offensiveTarget) {
    const op = getOffensiveOp(creep.memory.offensiveTarget, creep.memory.homeRoom);
    if (op) {
      runOffensiveKnight(creep, op);
      return;
    }
    delete creep.memory.offensiveTarget;
  }

  if (creep.memory.defensiveTarget) {
    if (getDefenseOp(creep.memory.defensiveTarget)) {
      runDefensiveKnight(creep, creep.memory.defensiveTarget);
      return;
    }
    delete creep.memory.defensiveTarget;
  }

  // A remote defender rides out while invaders hold its remote and stands
  // watch at home otherwise, still counted as that remote's defender. Left in
  // a cleared remote it stood on the exit tile it arrived by, and was carried
  // back and forth across the border for the rest of its life.
  const target = creep.memory.targetRoom;
  const home = creep.memory.homeRoom;
  const invaded = isAssignedRemoteInvaded(creep);
  if (!invaded) delete creep.memory.sortie;
  if (target && creep.room.name !== target && invaded) {
    crySortie(creep, target);
    creep.moveTo(new RoomPosition(25, 25, target), { reusePath: 20 });
    return;
  }
  if (target && home && creep.room.name !== home && creep.room.name !== target) {
    creep.moveTo(new RoomPosition(25, 25, home), { reusePath: 20 });
    return;
  }

  // Fall back to a cleric when one is in the room, since it heals and the
  // spawn does not; the cleric comes toward us too.
  if (creep.hits < creep.hitsMax * RETREAT_THRESHOLD) {
    const cleric = creep.pos.findClosestByRange(FIND_MY_CREEPS, {
      filter: (c) => c.memory.role === ROLE_CLERIC && !c.spawning,
    });
    const refuge = cleric ?? creep.room.find(FIND_MY_SPAWNS)[0];
    if (refuge) {
      if (!creep.pos.isNearTo(refuge)) creep.moveTo(refuge, { reusePath: 5 });
      return;
    }
  }

  const hostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
    filter: (c) => !isAlly(c.owner?.username),
  });
  if (hostile) {
    if (creep.attack(hostile) === ERR_NOT_IN_RANGE) {
      creep.moveTo(hostile, { reusePath: 3 });
    }
    return;
  }

  const core = findInvaderCore(creep.room);
  if (core) {
    if (creep.attack(core) === ERR_NOT_IN_RANGE) {
      creep.moveTo(core, { reusePath: 3 });
    }
    return;
  }

  if (target && target === creep.room.name) {
    clearRemoteInvader(creep);
    if (home && home !== target) {
      creep.moveTo(new RoomPosition(25, 25, home), { reusePath: 20 });
      return;
    }
  }
  // Idle at home: stand watch behind the walls rather than crowd the spawn.
  if (parkIdle(creep, "watch")) return;
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn && !creep.pos.isNearTo(spawn)) {
    creep.moveTo(spawn, { reusePath: 20 });
  }
}
