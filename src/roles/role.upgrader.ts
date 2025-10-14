import {
  getSources,
  isCreepEmpty,
  isCreepFull,
  harvestFromSource,
  upgradeController,
} from "../services/services.creep";

export function runUpgrader(creep: Creep) {
  if (creep.memory.working === undefined) creep.memory.working = false;

  if (creep.memory.working && isCreepEmpty(creep)) {
    creep.memory.working = false;
  }

  if (!creep.memory.working && isCreepFull(creep)) {
    creep.memory.working = true;
  }

  if (creep.memory.working) {
    upgradeController(creep);
  } else {
    const sources = getSources(creep.room);
    if (sources.length > 0) {
      harvestFromSource(creep, sources[0]);
    }
  }
}
