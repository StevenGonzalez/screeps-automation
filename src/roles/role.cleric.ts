import { seekBoost } from "../services/services.combat";
import { isAlly } from "../services/services.allies";
import { parkIdle } from "../services/services.town";
import { ROLE_KNIGHT, ROLE_WIZARD } from "../config/config.roles";
import { getDefenseOp, getOffensiveOp, runDefensiveCleric, runOffensiveCleric } from "../orchestrators/orchestrator.military";

const SELF_HEAL_THRESHOLD = 0.5;
const FRONTLINE_ROLES = new Set<string>([ROLE_KNIGHT, ROLE_WIZARD]);

export function runCleric(creep: Creep) {
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
      runOffensiveCleric(creep, op);
      return;
    }
    delete creep.memory.offensiveTarget;
  }

  if (creep.memory.defensiveTarget) {
    if (getDefenseOp(creep.memory.defensiveTarget)) {
      runDefensiveCleric(creep, creep.memory.defensiveTarget);
      return;
    }
    delete creep.memory.defensiveTarget;
  }

  if (creep.hits < creep.hitsMax * SELF_HEAL_THRESHOLD) {
    creep.heal(creep);
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn && !creep.pos.isNearTo(spawn)) {
      creep.moveTo(spawn, { reusePath: 5 });
    }
    return;
  }

  const wounded = creep.room.find(FIND_MY_CREEPS, {
    filter: (c) => c.hits < c.hitsMax,
  });

  if (wounded.length === 0) {
    if (parkIdle(creep, "watch")) return;
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn && !creep.pos.isNearTo(spawn)) {
      creep.moveTo(spawn, { reusePath: 20 });
    }
    return;
  }

  // Fighters come first: they are the ones holding the hostiles off.
  const fighters = wounded.filter((c) => FRONTLINE_ROLES.has(c.memory.role));
  const target = (fighters.length > 0 ? fighters : wounded).reduce((a, b) =>
    a.hits / a.hitsMax < b.hits / b.hitsMax ? a : b
  );

  const range = creep.pos.getRangeTo(target);
  if (range <= 1) {
    creep.heal(target);
  } else {
    if (range <= 3) creep.rangedHeal(target);
    creep.moveTo(target, { reusePath: 5 });
  }
}
