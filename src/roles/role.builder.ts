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
    creep.memory.constructionSiteId = undefined;
  }

  if (!creep.memory.working && isCreepFull(creep)) {
    creep.memory.working = true;
  }
  if (!creep.memory.working) {
    acquireEnergy(creep);
    return;
  }

  // Try cached site before calling the expensive findClosestByPath search.
  if (creep.memory.constructionSiteId) {
    const cached = Game.getObjectById(creep.memory.constructionSiteId);
    if (cached) {
      const res = buildAtConstructionSite(creep, cached);
      if (res === ERR_NOT_ENOUGH_RESOURCES) creep.memory.working = false;
      return;
    }
    creep.memory.constructionSiteId = undefined;
  }

  const site = findClosestConstructionSite(creep);
  if (site) {
    creep.memory.constructionSiteId = site.id;
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
