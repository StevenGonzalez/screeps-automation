import {
  getSources,
  harvestFromSource,
  isCreepFull,
  isCreepEmpty,
  findEnergyDepositTarget,
  transferEnergyTo,
  upgradeController,
} from "../services/services.creep";
import { ROLE_HARVESTER } from "../config/config.roles";

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
      upgradeController(creep);
    }
  } else {
    const sources = getSources(creep.room);
    if (sources.length > 0) {
      harvestFromSource(creep, sources[0]);
    }
  }
}
