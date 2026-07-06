import { seekBoost } from "../services/services.combat";
import {
  getOffensiveOp,
  runOffensiveDrainer,
  getDrainOp,
  runStandaloneDrainer,
} from "../orchestrators/orchestrator.military";

export function runDrainer(creep: Creep) {
  if ((creep.memory.boostCompound || creep.memory.boostQueue?.length) && seekBoost(creep)) return;

  if (creep.memory.offensiveTarget) {
    const op = getOffensiveOp(creep.memory.offensiveTarget, creep.memory.homeRoom);
    if (op) {
      runOffensiveDrainer(creep, op);
      return;
    }
    const drain = getDrainOp(creep.memory.offensiveTarget);
    if (drain) {
      runStandaloneDrainer(creep, drain);
      return;
    }
    delete creep.memory.offensiveTarget;
  }

  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn && !creep.pos.isNearTo(spawn)) {
    creep.moveTo(spawn, { reusePath: 20 });
  }
}
