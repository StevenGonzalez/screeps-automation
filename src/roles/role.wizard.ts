import { allyInMassAttackRange, preferMassAttack, seekBoost } from "../services/services.combat";
import { isAlly } from "../services/services.allies";
import { parkIdle } from "../services/services.town";
import { getDefenseOp, getOffensiveOp, runDefensiveWizard, runOffensiveWizard } from "../orchestrators/orchestrator.military";

const KITE_RANGE = 3;

export function runWizard(creep: Creep) {
  if ((creep.memory.boostCompound || creep.memory.boostQueue?.length) && seekBoost(creep)) return;

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

  const notAlly = (c: Creep) => !isAlly(c.owner?.username);
  const hostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS, { filter: notAlly });
  if (!hostile) {
    if (parkIdle(creep, "watch")) return;
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn && !creep.pos.isNearTo(spawn)) {
      creep.moveTo(spawn, { reusePath: 20 });
    }
    return;
  }

  const range = creep.pos.getRangeTo(hostile);
  const inRangeHostiles = creep.pos.findInRange(FIND_HOSTILE_CREEPS, KITE_RANGE, { filter: notAlly });

  if (preferMassAttack(creep.pos, inRangeHostiles) && !allyInMassAttackRange(creep.pos)) {
    creep.rangedMassAttack();
  } else if (range <= KITE_RANGE) {
    creep.rangedAttack(hostile);
  }

  if (range < KITE_RANGE) {
    creep.move(hostile.pos.getDirectionTo(creep.pos));
  } else if (range > KITE_RANGE) {
    creep.moveTo(hostile, { range: KITE_RANGE, reusePath: 5 });
  }
}
