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
import { ROLE_HAULER } from "../config/config.roles";

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

    const minerContainer = findClosestMinerContainerWithEnergy(creep);
    if (minerContainer) {
      if (withdrawFromContainer(creep, minerContainer)) return;
      return;
    }

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

  const depositTarget = findDepositTargetExcludingMiner(creep, ROLE_HAULER);
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
