import {
  getSources,
  harvestFromSource,
  isCreepEmpty,
  isCreepFull,
  getClosestContainerOrStorage,
  findMostCriticalRepairTarget,
  repairStructure,
  upgradeController,
  acquireEnergy,
} from "../services/services.creep";

export function runRepairer(creep: Creep) {
  if (creep.memory.working === undefined) creep.memory.working = false;

  if (creep.memory.working && isCreepEmpty(creep)) {
    creep.memory.working = false;
  }

  if (!creep.memory.working && isCreepFull(creep)) {
    creep.memory.working = true;
  }

  if (!creep.memory.working) {
    // In a storage room, leave the miner containers + dropped piles for the porters (they feed the
    // tower/core); the repairer draws from the storage buffer instead and backs off when it's empty
    // rather than competing for the producer supply. Pre-storage rooms have no buffer, so there the
    // repairer still uses any container, then self-harvests as a last resort.
    if (creep.room.storage) {
      acquireEnergy(creep, { bufferOnly: true });
      return;
    }
    const container = getClosestContainerOrStorage(creep);
    if (container) {
      if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(container, { reusePath: 50 });
      }
      return;
    }
    const sources = getSources(creep.room);
    if (sources.length > 0) harvestFromSource(creep, sources[0]);
    return;
  }

  const target = findMostCriticalRepairTarget(creep);
  if (target) {
    const res = repairStructure(creep, target);
    if (res === ERR_NOT_ENOUGH_RESOURCES) creep.memory.working = false;
    return;
  }

  upgradeController(creep);
}
