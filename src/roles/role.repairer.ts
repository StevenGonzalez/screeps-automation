import {
  getSources,
  harvestFromSource,
  isCreepEmpty,
  isCreepFull,
  getClosestContainerOrStorage,
  findMostCriticalRepairTarget,
  repairStructure,
  acquireEnergy,
  putSurplusEnergyToWork,
  getRoomBuildTarget,
} from "../services/services.creep";
import { meetIncomingHandoff } from "../services/services.coordination";
import { upgradingFunded } from "../services/services.treasury";
import { parkIdle } from "../services/services.town";

export function runRepairer(creep: Creep) {
  if (creep.memory.working === undefined) creep.memory.working = false;

  if (creep.memory.working && isCreepEmpty(creep)) {
    creep.memory.working = false;
  }

  if (!creep.memory.working && isCreepFull(creep)) {
    creep.memory.working = true;
  }

  if (!creep.memory.working) {
    if (meetIncomingHandoff(creep)) return;
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
    if (res === ERR_NOT_IN_RANGE) return;
    if (res === ERR_NOT_ENOUGH_RESOURCES) creep.memory.working = false;
    return;
  }

  // Nothing to mend. With the treasury at its floor the throne waits too, so
  // the blacksmith keeps its load and waits on the square rather than handing
  // the controller gold the enchanters are holding back.
  if (!upgradingFunded(creep.room) && !getRoomBuildTarget(creep.room)) {
    parkIdle(creep, "square");
    return;
  }
  putSurplusEnergyToWork(creep);
}
