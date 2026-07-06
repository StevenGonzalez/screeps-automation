import {
  isCreepFull,
  isCreepEmpty,
  findEnergyDepositTarget,
  transferEnergyTo,
  putSurplusEnergyToWork,
  findBalancedSource,
  getSafeSources,
  harvestFromSource,
  isSourceSafe,
} from "../services/services.creep";
import { ROLE_HARVESTER, ROLE_MINER } from "../config/config.roles";

export function runHarvester(creep: Creep) {
  if (creep.memory.working === undefined) creep.memory.working = false;

  if (creep.memory.working && isCreepEmpty(creep)) {
    creep.memory.working = false;
  }
  if (!creep.memory.working && isCreepFull(creep)) {
    creep.memory.working = true;
  }

  if (creep.memory.working) {
    const depositTarget = findEnergyDepositTarget(creep, ROLE_HARVESTER);
    if (depositTarget) {
      transferEnergyTo(creep, depositTarget);
    } else {
      putSurplusEnergyToWork(creep);
    }
    return;
  }

  let source: Source | null = null;
  if (creep.memory.assignedSourceId) {
    source = Game.getObjectById(creep.memory.assignedSourceId) as Source | null;
    if (!source || !isSourceSafe(source)) {
      creep.memory.assignedSourceId = undefined;
      source = null;
    }
  }
  if (!source) {
    source = findBalancedSource(creep);
    if (source) creep.memory.assignedSourceId = source.id;
  }
  if (!source) return;

  const current = source;
  const hasMiner = (s: Source) =>
    s.pos.findInRange(FIND_MY_CREEPS, 1, {
      filter: (c) => c.memory.role === ROLE_MINER,
    }).length > 0;

  if (hasMiner(current)) {
    const uncovered = getSafeSources(creep.room).find((s) => s.id !== current.id && !hasMiner(s));
    if (uncovered) {
      creep.memory.assignedSourceId = uncovered.id;
      harvestFromSource(creep, uncovered);
      return;
    }
    creep.suicide();
    return;
  }

  harvestFromSource(creep, current);
}
