import {
  isCreepFull,
  isCreepEmpty,
  findEnergyDepositTarget,
  transferEnergyTo,
  upgradeController,
  findBalancedSource,
  harvestFromSource,
  isSourceSafe,
} from "../services/services.creep";
import { ROLE_HARVESTER } from "../config/config.roles";

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
      upgradeController(creep);
    }
    return;
  }

  // Persist source assignment across ticks to avoid thrashing
  if (creep.memory.assignedSourceId) {
    const source = Game.getObjectById(creep.memory.assignedSourceId) as Source | null;
    if (source && isSourceSafe(source)) {
      harvestFromSource(creep, source);
      return;
    }
    creep.memory.assignedSourceId = undefined;
  }

  const source = findBalancedSource(creep);
  if (source) {
    creep.memory.assignedSourceId = source.id;
    harvestFromSource(creep, source);
  }
}
