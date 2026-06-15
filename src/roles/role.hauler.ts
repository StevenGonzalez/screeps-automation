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
import { getThreatInfo } from "../services/services.combat";

export function runHauler(creep: Creep) {
  if (!creep.memory.assignedContainerId) {
    const assignment = findUnclaimedHaulerAssignment(creep.room);
    if (assignment) {
      creep.memory.assignedContainerId = assignment.id;
    }
  }
  if (isCreepEmpty(creep)) {
    creep.memory.fillTargetId = undefined;

    // Dropped energy decays every tick, so collect it before anything else. Search the
    // whole room — not just locally — and head for the closest worthwhile pile, or
    // overflow at a far source rots before a hauler happens to pass within range.
    // findClosestByRange (not ByPath) keeps this cheap; only empty haulers run it.
    const dropped = creep.room.find(FIND_DROPPED_RESOURCES, {
      filter: (d) => d.resourceType === RESOURCE_ENERGY && d.amount > 50,
    }) as Resource[];
    if (dropped.length > 0) {
      const target = creep.pos.findClosestByRange(dropped) as Resource;
      pickupDroppedResource(creep, target);
      return;
    }

    // Drain miner containers FIRST — they are the live producers and spill onto the
    // ground if neglected. Prefer the assigned container; skip it if nearly empty to
    // avoid wasted movement.
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

    // Source containers are dry — fall back to storage to keep spawn + extensions
    // filled when the base actually needs it. Storage is the buffer, not the primary
    // pickup, so it is only tapped once the live producers have nothing left.
    const storage = creep.room.storage;
    const baseNeedsEnergy = creep.room.energyAvailable < creep.room.energyCapacityAvailable;
    if (storage && baseNeedsEnergy && storage.store[RESOURCE_ENERGY] > 0) {
      const res = creep.withdraw(storage, RESOURCE_ENERGY);
      if (res === ERR_NOT_IN_RANGE) creep.moveTo(storage, { reusePath: 20 });
      return;
    }

    // Only tap the storage/link buffer when the base actually needs filling. If the base
    // is full and the live producers are dry there's nothing useful to haul — pulling from
    // storage just to deposit it straight back is a pointless storage→storage shuffle.
    if (baseNeedsEnergy) acquireEnergy(creep);
    return;
  }

  // Under attack, keep the towers loaded ahead of everything else — they are the room's
  // ranged defense and a sustained fight drains them ~10 energy/shot, so a far tower left to
  // the normal closest-spawn/extension/tower order can run dry mid-fight. Top up the emptiest
  // tower first (towers are clustered by the keep, so travel between them is cheap). In
  // peacetime towers don't fire or decay, so this never triggers and the normal order holds.
  if (getThreatInfo(creep.room).hostiles.length > 0) {
    const towers = getRoomStructures(creep.room).filter(
      (s): s is StructureTower =>
        s.structureType === STRUCTURE_TOWER &&
        (s as StructureTower).store.getFreeCapacity(RESOURCE_ENERGY) > 0
    );
    if (towers.length > 0) {
      const target = towers.reduce((a, b) =>
        a.store.getUsedCapacity(RESOURCE_ENERGY) < b.store.getUsedCapacity(RESOURCE_ENERGY) ? a : b
      );
      creep.memory.fillTargetId = target.id;
      transferEnergyTo(creep, target);
      return;
    }
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
    const target = creep.pos.findClosestByPath(targets, { ignoreCreeps: true });
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

  const depositTarget = findDepositTargetExcludingMiner(creep);
  if (depositTarget) {
    creep.memory.fillTargetId = depositTarget.id;
    transferEnergyTo(creep, depositTarget);
    return;
  }

  // Nowhere to deliver (colony full) — put the carried energy to work
  // (build, then repair, then upgrade) rather than idling.
  putSurplusEnergyToWork(creep);
}
