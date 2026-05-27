import { seekBoost } from "../services/services.combat";
import { runOffensivePaladin } from "../orchestrators/orchestrator.military";

const SELF_HEAL_THRESHOLD = 0.5;

export function runPaladin(creep: Creep) {
  if (creep.memory.boostCompound && seekBoost(creep)) return;

  if (creep.memory.offensiveTarget) {
    const op = Memory.militaryOp;
    if (op && op.targetRoom === creep.memory.offensiveTarget) {
      runOffensivePaladin(creep, op);
      return;
    }
    delete creep.memory.offensiveTarget;
  }

  // Defensive: self-preservation when critically injured
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
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn && !creep.pos.isNearTo(spawn)) {
      creep.moveTo(spawn, { reusePath: 20 });
    }
    return;
  }

  const target = wounded.reduce((a, b) =>
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
