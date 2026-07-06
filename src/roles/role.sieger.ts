import { seekBoost } from "../services/services.combat";
import { getOffensiveOp, runOffensiveSieger } from "../orchestrators/orchestrator.military";

export function runSieger(creep: Creep) {
  if ((creep.memory.boostCompound || creep.memory.boostQueue?.length) && seekBoost(creep)) return;

  if (creep.memory.offensiveTarget) {
    const op = getOffensiveOp(creep.memory.offensiveTarget, creep.memory.homeRoom);
    if (op) {
      runOffensiveSieger(creep, op);
      return;
    }
    delete creep.memory.offensiveTarget;
  }

  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn && !creep.pos.isNearTo(spawn)) {
    creep.moveTo(spawn, { reusePath: 20 });
  }
}
