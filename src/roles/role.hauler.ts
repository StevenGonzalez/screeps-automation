import {
  getClosestContainerOrStorage,
  isCreepEmpty,
  acquireEnergy,
  transferEnergyTo,
  findUnclaimedHaulerAssignment,
  pickupDroppedResource,
  withdrawFromContainer,
  findClosestContainerWithFreeCapacity,
  findClosestMinerContainerWithEnergy,
  findDepositTargetExcludingMiner,
} from "../services/services.creep";

export function runHauler(creep: Creep) {
  if (!creep.memory.assignedContainerId) {
    const assignment = findUnclaimedHaulerAssignment(creep.room);
    if (assignment) {
      creep.memory.assignedContainerId = assignment.id;
    }
  }
  if (isCreepEmpty(creep)) {
    const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
      filter: (d) => d.resourceType === RESOURCE_ENERGY && d.amount > 50,
    }) as Resource | null;
    if (dropped) {
      if (pickupDroppedResource(creep, dropped)) return;
      return;
    }
    // Withdraw only from miner containers
    const minerContainer = findClosestMinerContainerWithEnergy(creep);
    if (minerContainer) {
      if (withdrawFromContainer(creep, minerContainer)) return;
      return;
    }

    // fall back to other acquisition methods
    acquireEnergy(creep);
    return;
  }
  const targets = creep.room.find(FIND_STRUCTURES, {
    filter: (s) =>
      (s.structureType === STRUCTURE_SPAWN ||
        s.structureType === STRUCTURE_EXTENSION ||
        s.structureType === STRUCTURE_TOWER) &&
      "store" in s &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  });
  if (targets.length > 0) {
    const target = creep.pos.findClosestByPath(targets);
    if (target) {
      transferEnergyTo(creep, target);
      return;
    }
  }
  // Prefer deposit targets excluding miner containers
  const depositTarget = findDepositTargetExcludingMiner(creep, "hauler");
  if (depositTarget) {
    transferEnergyTo(creep, depositTarget);
    return;
  }

  const idle =
    getClosestContainerOrStorage(creep) || creep.room.find(FIND_MY_SPAWNS)[0];
  if (idle && !creep.pos.isNearTo(idle)) {
    creep.moveTo(idle);
  }
}
