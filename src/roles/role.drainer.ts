import { seekBoost } from "../services/services.combat";
import {
  getOffensiveOp,
  runOffensiveDrainer,
  getDrainOp,
  runStandaloneDrainer,
} from "../orchestrators/orchestrator.military";

/**
 * Drainer (decoy): a solo tower-baiter that deploys ahead of a siege. It slips into the
 * target room, parks just inside tower range, and soaks fire to bleed the towers' energy
 * — every shot costs the defender 10 energy regardless of how little it does at long
 * range. It self-heals to outlast that trickle and retreats over the border to recover
 * when worn down. All the in-room behavior lives in runOffensiveDrainer alongside the
 * rest of the military doctrine; this wrapper just gates boosting and op assignment.
 */
export function runDrainer(creep: Creep) {
  if ((creep.memory.boostCompound || creep.memory.boostQueue?.length) && seekBoost(creep)) return;

  if (creep.memory.offensiveTarget) {
    // Siege-attached decoy (part of a militaryOp) takes precedence; otherwise it may belong
    // to a standalone drain op against the same target room.
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
    delete creep.memory.offensiveTarget; // stale from a completed/cancelled/stopped op
  }

  // Unassigned drainers gather at the spawn until the next operation claims them.
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn && !creep.pos.isNearTo(spawn)) {
    creep.moveTo(spawn, { reusePath: 20 });
  }
}
