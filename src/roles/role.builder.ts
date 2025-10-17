import {
  getSources,
  acquireEnergy,
  isCreepEmpty,
  isCreepFull,
  findClosestConstructionSite,
  findClosestRepairTarget,
  upgradeController,
  buildAtConstructionSite,
  repairStructure,
} from "../services/services.creep";

export function runBuilder(creep: Creep) {
  if (creep.memory.working === undefined) creep.memory.working = false;

  if (creep.memory.working && isCreepEmpty(creep)) {
    creep.memory.working = false;
  }

  if (!creep.memory.working && isCreepFull(creep)) {
    creep.memory.working = true;
  }
  if (!creep.memory.working) {
    acquireEnergy(creep);
    return;
  }

  const site = findClosestConstructionSite(creep);
  if (site) {
    const res = buildAtConstructionSite(creep, site);
    if (res === ERR_NOT_ENOUGH_RESOURCES) creep.memory.working = false;
    return;
  }

  const repairTarget = findClosestRepairTarget(creep);
  if (repairTarget) {
    const r = repairStructure(creep, repairTarget);
    if (r === ERR_NOT_ENOUGH_RESOURCES) creep.memory.working = false;
    return;
  }

  upgradeController(creep);
}
