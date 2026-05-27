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
    creep.memory.fillTargetId = undefined;

    // findInRange is O(local area) vs findClosestByPath which scans the whole room.
    const nearbyDropped = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 10, {
      filter: (d) => d.resourceType === RESOURCE_ENERGY && d.amount > 50,
    }) as Resource[];
    if (nearbyDropped.length > 0) {
      const best = nearbyDropped.reduce((a, b) => (a.amount > b.amount ? a : b));
      pickupDroppedResource(creep, best);
      return;
    }

    // Prefer the assigned container; fall back to closest if it's empty.
    let minerContainer: StructureContainer | null = null;
    if (creep.memory.assignedContainerId) {
      const assigned = Game.getObjectById(creep.memory.assignedContainerId as Id<StructureContainer>) as StructureContainer | null;
      if (assigned && assigned.store[RESOURCE_ENERGY] > 0) {
        minerContainer = assigned;
      }
    }
    if (!minerContainer) {
      minerContainer = findClosestMinerContainerWithEnergy(creep);
    }
    if (minerContainer) {
      if (withdrawFromContainer(creep, minerContainer)) return;
      return;
    }

    acquireEnergy(creep);
    return;
  }

  // Re-use any cached deposit target (spawn, extension, tower, storage, container).
  if (creep.memory.fillTargetId) {
    const cached = Game.getObjectById(creep.memory.fillTargetId as Id<AnyStoreStructure>) as AnyStoreStructure | null;
    if (cached && "store" in cached && cached.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
      transferEnergyTo(creep, cached as Structure);
      return;
    }
    creep.memory.fillTargetId = undefined;
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
      creep.memory.fillTargetId = target.id;
      transferEnergyTo(creep, target);
      return;
    }
  }

  const depositTarget = findDepositTargetExcludingMiner(creep, ROLE_HAULER);
  if (depositTarget) {
    creep.memory.fillTargetId = depositTarget.id;
    transferEnergyTo(creep, depositTarget);
    return;
  }

  const idle =
    getClosestContainerOrStorage(creep) || creep.room.find(FIND_MY_SPAWNS)[0];
  if (idle && !creep.pos.isNearTo(idle)) {
    creep.moveTo(idle, { reusePath: 50 });
  }
}
