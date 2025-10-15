import {
  getSources,
  harvestFromSource,
  isCreepEmpty,
  isCreepFull,
  getClosestContainerOrStorage,
  findMostCriticalRepairTarget,
  repairStructure,
  upgradeController,
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
    const container = getClosestContainerOrStorage(creep);
    if (container) {
      if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(container);
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
