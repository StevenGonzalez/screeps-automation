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
  acquireEnergy,
} from "../services/services.creep";
import { ROLE_HARVESTER, ROLE_MINER } from "../config/config.roles";

function hasMiner(source: Source): boolean {
  return (
    source.pos.findInRange(FIND_MY_CREEPS, 1, {
      filter: (c) => c.memory.role === ROLE_MINER,
    }).length > 0
  );
}

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
    // Once miners hold every source this energy came out of a container, and
    // putting it back into one only starts the same trip again.
    const backIntoContainer =
      depositTarget?.structureType === STRUCTURE_CONTAINER &&
      getSafeSources(creep.room).every(hasMiner);
    if (depositTarget && !backIntoContainer) {
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

  if (hasMiner(current)) {
    const uncovered = getSafeSources(creep.room).find((s) => s.id !== current.id && !hasMiner(s));
    if (uncovered) {
      creep.memory.assignedSourceId = uncovered.id;
      harvestFromSource(creep, uncovered);
      return;
    }
    // Every source has a miner. Suiciding here threw the rest of the
    // harvester's life away - the whole crew at once - just as the room was
    // leaning on its first small hauler to keep the core fed. Carry what the
    // miners leave in their containers instead, core first, for the rest of it.
    acquireEnergy(creep);
    return;
  }

  harvestFromSource(creep, current);
}
