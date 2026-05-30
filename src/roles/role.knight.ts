import { seekBoost } from "../services/services.combat";
import { runOffensiveKnight } from "../orchestrators/orchestrator.military";

const RETREAT_THRESHOLD = 0.2;

export function runKnight(creep: Creep) {
  if (creep.memory.boostCompound && seekBoost(creep)) return;

  // Offensive squad: tagged creep follows military orchestrator orders
  if (creep.memory.offensiveTarget) {
    const op = Memory.militaryOp;
    if (op && op.targetRoom === creep.memory.offensiveTarget) {
      runOffensiveKnight(creep, op);
      return;
    }
    delete creep.memory.offensiveTarget; // stale from a completed/cancelled op
  }

  // Defensive: retreat to spawn when critically injured so towers/clerics can heal
  if (creep.hits < creep.hitsMax * RETREAT_THRESHOLD) {
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn) {
      if (!creep.pos.isNearTo(spawn)) creep.moveTo(spawn, { reusePath: 5 });
      return;
    }
  }

  const hostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
  if (!hostile) {
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn && !creep.pos.isNearTo(spawn)) {
      creep.moveTo(spawn, { reusePath: 20 });
    }
    return;
  }
  if (creep.attack(hostile) === ERR_NOT_IN_RANGE) {
    creep.moveTo(hostile, { reusePath: 3 });
  }
}
