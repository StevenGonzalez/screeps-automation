import {
  getSources,
  isCreepEmpty,
  isCreepFull,
  harvestFromSource,
  upgradeController,
  withdrawFromControllerContainer,
  withdrawFromContainer,
  findClosestMinerContainerWithEnergy,
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
    const upgradeId = (creep.room.memory as any).upgradeContainerId as
      | Id<StructureContainer>
      | undefined;
    if (upgradeId) {
      const upgradeCont = Game.getObjectById(
        upgradeId
      ) as StructureContainer | null;
      if (
        upgradeCont &&
        upgradeCont.store &&
        upgradeCont.store[RESOURCE_ENERGY] > 0
      ) {
        if (withdrawFromContainer(creep, upgradeCont)) return;
      }
    }

    if (withdrawFromControllerContainer(creep)) return;

    const closestMinerContainer = findClosestMinerContainerWithEnergy(creep);
    if (closestMinerContainer) {
      if (withdrawFromContainer(creep, closestMinerContainer)) return;
    }

    const storage = creep.room.storage;
    if (storage && storage.store && storage.store[RESOURCE_ENERGY] > 0) {
      const res = creep.withdraw(storage, RESOURCE_ENERGY);
      if (res === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage);
        return;
      }
      if (res === OK) return;
    }

    const sources = getSources(creep.room);
    if (sources.length > 0) {
      harvestFromSource(creep, sources[0]);
    }
  }
}
