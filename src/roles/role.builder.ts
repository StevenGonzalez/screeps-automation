import {
  getSources,
  acquireEnergy,
  isCreepEmpty,
  isCreepFull,
  getRoomBuildTarget,
  findClosestConstructionSite,
  findClosestRepairTarget,
  findCriticalDefenseTarget,
  findCoreFillTarget,
  transferEnergyTo,
  upgradeController,
  buildAtConstructionSite,
  repairStructure,
  isEnergyEmergency,
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
    const acquired = acquireEnergy(creep, { bufferOnly: !!creep.room.storage });
    if (acquired || isCreepEmpty(creep)) return;
    creep.memory.working = true;
  }

  if (creep.room.storage && isEnergyEmergency(creep.room)) {
    const fill = findCoreFillTarget(creep);
    if (fill) transferEnergyTo(creep, fill);
    return;
  }

  const critical = findCriticalDefenseTarget(creep);
  if (critical) {
    const r = repairStructure(creep, critical);
    if (r === ERR_NOT_ENOUGH_RESOURCES) creep.memory.working = false;
    if (r !== ERR_NO_PATH) return;
  }

  const site = getRoomBuildTarget(creep.room);
  if (site) {
    const res = buildAtConstructionSite(creep, site);
    if (res === ERR_NOT_ENOUGH_RESOURCES) {
      creep.memory.working = false;
      return;
    }
    if (res !== ERR_NO_PATH) return;
    const reachable = findClosestConstructionSite(creep);
    if (reachable && reachable.id !== site.id) {
      const r2 = buildAtConstructionSite(creep, reachable);
      if (r2 === ERR_NOT_ENOUGH_RESOURCES) creep.memory.working = false;
      if (r2 !== ERR_NO_PATH) return;
    }
  }

  const repairTarget = findClosestRepairTarget(creep);
  if (repairTarget) {
    const r = repairStructure(creep, repairTarget);
    if (r === ERR_NOT_ENOUGH_RESOURCES) creep.memory.working = false;
    if (r !== ERR_NO_PATH) return;
  }

  upgradeController(creep);
}
