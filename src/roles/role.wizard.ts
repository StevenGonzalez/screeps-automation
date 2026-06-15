import { seekBoost } from "../services/services.combat";
import { getDefenseOp, getOffensiveOp, runDefensiveWizard, runOffensiveWizard } from "../orchestrators/orchestrator.military";

const KITE_RANGE = 3;

export function runWizard(creep: Creep) {
  if (creep.memory.boostCompound && seekBoost(creep)) return;

  if (creep.memory.offensiveTarget) {
    const op = getOffensiveOp(creep.memory.offensiveTarget, creep.memory.homeRoom);
    if (op) {
      runOffensiveWizard(creep, op);
      return;
    }
    delete creep.memory.offensiveTarget;
  }

  if (creep.memory.defensiveTarget) {
    if (getDefenseOp(creep.memory.defensiveTarget)) {
      runDefensiveWizard(creep, creep.memory.defensiveTarget);
      return;
    }
    delete creep.memory.defensiveTarget;
  }

  const hostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
  if (!hostile) {
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn && !creep.pos.isNearTo(spawn)) {
      creep.moveTo(spawn, { reusePath: 20 });
    }
    return;
  }

  const range = creep.pos.getRangeTo(hostile);
  const inRangeHostiles = creep.pos.findInRange(FIND_HOSTILE_CREEPS, KITE_RANGE);

  if (inRangeHostiles.length >= 3) {
    creep.rangedMassAttack();
  } else if (range <= KITE_RANGE) {
    creep.rangedAttack(hostile);
  }

  if (range < KITE_RANGE) {
    creep.move(hostile.pos.getDirectionTo(creep.pos));
  } else if (range > KITE_RANGE) {
    // Close to KITE_RANGE whenever we've drifted out of fire range. Using `> KITE_RANGE`
    // (not `+ 1`) avoids a dead zone at exactly range 4, where the wizard could neither
    // fire (rangedAttack maxes at range 3) nor advance, stalling against a held target.
    creep.moveTo(hostile, { range: KITE_RANGE, reusePath: 5 });
  }
}
