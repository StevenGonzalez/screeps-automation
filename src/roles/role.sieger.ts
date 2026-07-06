import { seekBoost } from "../services/services.combat";
import { getOffensiveOp, runOffensiveSieger } from "../orchestrators/orchestrator.military";

/**
 * Sieger (wrecker): the squad's siege engineer. Boosted WORK parts dismantle enemy
 * structures far faster than melee attack, breaching ramparts and razing spawns,
 * towers, and labs. Always operates as part of a military operation — it is far too
 * fragile to act alone, relying on enforcers to screen it and medics to keep it alive.
 */
export function runSieger(creep: Creep) {
  if ((creep.memory.boostCompound || creep.memory.boostQueue?.length) && seekBoost(creep)) return;

  if (creep.memory.offensiveTarget) {
    const op = getOffensiveOp(creep.memory.offensiveTarget, creep.memory.homeRoom);
    if (op) {
      runOffensiveSieger(creep, op);
      return;
    }
    delete creep.memory.offensiveTarget; // stale from a completed/cancelled op
  }

  // Unassigned wreckers have no useful peacetime job — gather at the spawn until the
  // next operation claims them.
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn && !creep.pos.isNearTo(spawn)) {
    creep.moveTo(spawn, { reusePath: 20 });
  }
}
