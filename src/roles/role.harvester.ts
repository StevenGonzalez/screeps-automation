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
      upgradeController(creep);
    }
    return;
  }

  // Resolve which source to harvest, persisting the assignment to avoid thrashing.
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

  // A stationary miner already works this source, so this harvester is redundant —
  // it would only camp the container's access tile and block haulers from withdrawing
  // (and can't be shoved aside, since harvesting at a source counts as a working post).
  // Retire it; its carried load was already delivered in the working branch above.
  const minerOnSource =
    source.pos.findInRange(FIND_MY_CREEPS, 1, {
      filter: (c) => c.memory.role === ROLE_MINER,
    }).length > 0;
  if (minerOnSource) {
    creep.suicide();
    return;
  }

  harvestFromSource(creep, source);
}
