import {
  isCreepEmpty,
  acquireEnergy,
  transferEnergyTo,
  findUnclaimedHaulerAssignment,
  pickupDroppedResource,
  withdrawFromContainer,
  findClosestContainerWithFreeCapacity,
  findClosestMinerContainerWithEnergy,
  findDepositTargetExcludingMiner,
  putSurplusEnergyToWork,
  getRoomStructures,
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

    // When storage is well-stocked, prefer it over miner containers — the link network
    // keeps storage replenished and it's usually closer to the spawn/extension cluster.
    // Only drain miner containers when storage is low or the containers are overflowing.
    const storage = creep.room.storage;
    const hasLinks = (creep.room.memory.linkIds?.length ?? 0) >= 2;
    const minerContainerIds = creep.room.memory.minerContainerIds ?? [];
    const anyContainerOverflowing = minerContainerIds.some((id) => {
      const c = Game.getObjectById(id) as StructureContainer | null;
      return c && c.store[RESOURCE_ENERGY] > 1200;
    });
    if (storage && hasLinks && !anyContainerOverflowing && storage.store[RESOURCE_ENERGY] > 5000) {
      const res = creep.withdraw(storage, RESOURCE_ENERGY);
      if (res === ERR_NOT_IN_RANGE) creep.moveTo(storage, { reusePath: 20 });
      return;
    }

    // Prefer the assigned container; skip it if nearly empty to avoid wasted movement.
    let minerContainer: StructureContainer | null = null;
    if (creep.memory.assignedContainerId) {
      const assigned = Game.getObjectById(creep.memory.assignedContainerId as Id<StructureContainer>) as StructureContainer | null;
      if (assigned && assigned.store[RESOURCE_ENERGY] > 200) {
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

  const targets = getRoomStructures(creep.room).filter(
    (s) =>
      (s.structureType === STRUCTURE_SPAWN ||
        s.structureType === STRUCTURE_EXTENSION ||
        s.structureType === STRUCTURE_TOWER) &&
      "store" in s &&
      (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > 0
  );
  if (targets.length > 0) {
    const target = creep.pos.findClosestByPath(targets);
    if (target) {
      creep.memory.fillTargetId = target.id;
      transferEnergyTo(creep, target);
      return;
    }
  }

  // Pre-load terminal with energy when a cross-room energy transfer is queued
  const pending = creep.room.memory.pendingSend;
  if (pending && pending.resource === RESOURCE_ENERGY) {
    const termId = creep.room.memory.terminalId;
    const terminal = termId ? (Game.getObjectById(termId) as StructureTerminal | null) : null;
    if (terminal && (terminal.store[RESOURCE_ENERGY] ?? 0) < pending.loadTarget) {
      creep.memory.fillTargetId = terminal.id;
      transferEnergyTo(creep, terminal);
      return;
    }
  }

  const depositTarget = findDepositTargetExcludingMiner(creep, ROLE_HAULER);
  if (depositTarget) {
    creep.memory.fillTargetId = depositTarget.id;
    transferEnergyTo(creep, depositTarget);
    return;
  }

  // Nowhere to deliver (colony full) — put the carried energy to work
  // (build, then repair, then upgrade) rather than idling.
  putSurplusEnergyToWork(creep);
}
