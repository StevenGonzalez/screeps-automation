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
      // Nowhere to deposit (spawn/extension/container/storage all full) — put the carried
      // energy to work instead of idling: build, else repair, else upgrade.
      putSurplusEnergyToWork(creep);
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

  const current = source; // narrowed non-null above; stable ref for the closures below
  const hasMiner = (s: Source) =>
    s.pos.findInRange(FIND_MY_CREEPS, 1, {
      filter: (c) => c.memory.role === ROLE_MINER,
    }).length > 0;

  // A stationary miner already works this source, so this harvester is redundant here — it would
  // only camp the container's access tile and block haulers from withdrawing. But don't blindly
  // suicide: if ANOTHER source still has no miner, cover that one instead. Suiciding while the
  // harvester population target is still > 0 (because a different source is uncovered) makes the
  // spawner rebuild us next tick — a spawn-energy churn loop that bleeds the economy. Only retire
  // when EVERY source is already miner-covered (genuinely redundant; the target is then 0, so we
  // won't respawn).
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
