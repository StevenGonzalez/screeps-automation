import {
  getSources,
  acquireEnergy,
  isCreepEmpty,
  isCreepFull,
  getRoomBuildTarget,
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

  // Every builder in the room focuses the same site (highest priority, most
  // progressed) so sites get completed instead of each builder dribbling energy
  // into whatever is nearest and leaving everything half-built.
  const site = getRoomBuildTarget(creep.room);
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
