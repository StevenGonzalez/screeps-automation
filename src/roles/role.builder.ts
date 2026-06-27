import {
  getSources,
  acquireEnergy,
  isCreepEmpty,
  isCreepFull,
  getRoomBuildTarget,
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
    acquireEnergy(creep);
    return;
  }

  // While the room is starving for energy, stop spending it on construction, repair and
  // upgrading — those drain the very buffer the colony needs to keep spawning haulers/miners
  // back. Spawning already declines to replace builders during an emergency; this stops the
  // ones already alive from bleeding the room dry in the meantime. Instead, the carried energy
  // is poured into the starved core (spawn/extensions/towers) to help end the emergency faster.
  if (isEnergyEmergency(creep.room)) {
    const fill = findCoreFillTarget(creep);
    if (fill) transferEnergyTo(creep, fill);
    return;
  }

  // Rescue a freshly-built (critically low) rampart/wall before laying or building anything
  // else. A rampart completes at 1 hit and decays away within ~100 ticks if it isn't lifted
  // past the decay amount — and the builder's generic repair fallback excludes ramparts — so
  // without this a mason that just built a rampart abandons it at 1 hit and it dies, looping
  // build→decay→rebuild forever. Once it's past the floor, towers/repairers maintain it.
  const critical = findCriticalDefenseTarget(creep);
  if (critical) {
    const r = repairStructure(creep, critical);
    if (r === ERR_NOT_ENOUGH_RESOURCES) creep.memory.working = false;
    return;
  }

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
