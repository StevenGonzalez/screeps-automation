import {
  isCreepEmpty,
  acquireEnergy,
  transferEnergyTo,
  findUnclaimedHaulerAssignment,
  pickupDroppedResource,
  withdrawFromContainer,
  findClosestMinerContainerWithEnergy,
  findDepositTargetExcludingMiner,
  findEmptiestTower,
  findCoreFillTarget,
  putSurplusEnergyToWork,
} from "../services/services.creep";
import { getThreatInfo } from "../services/services.combat";
import { ROLE_FILLER } from "../config/config.roles";

// Cheap per-tick, per-room check: is a steward (filler) alive to own core distribution? When
// one is, haulers restock storage instead of filling spawn/extensions/towers directly. One
// FIND_MY_CREEPS per room per tick, shared across every hauler in that room.
let fillerCheckTick = -1;
const roomHasFiller: Record<string, boolean> = {};
function hasActiveFiller(room: Room): boolean {
  if (fillerCheckTick !== Game.time) {
    fillerCheckTick = Game.time;
    for (const k in roomHasFiller) delete roomHasFiller[k];
  }
  if (!(room.name in roomHasFiller)) {
    // Only count a filler that is actually working — a still-spawning one can't distribute yet,
    // and switching haulers off direct-fill too early would drain the core during its spawn.
    roomHasFiller[room.name] = room
      .find(FIND_MY_CREEPS)
      .some((c) => c.memory.role === ROLE_FILLER && !c.spawning);
  }
  return roomHasFiller[room.name];
}

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

  // Defense override (both logistics models): under attack, top the emptiest tower first —
  // towers drain ~10 energy/shot and must not run dry mid-fight. In peacetime towers don't
  // fire or decay, so this never triggers.
  if (getThreatInfo(creep.room).hostiles.length > 0) {
    const tower = findEmptiestTower(creep.room);
    if (tower) {
      creep.memory.fillTargetId = tower.id;
      transferEnergyTo(creep, tower);
      return;
    }
  }

  // Once a room has storage AND a living steward (filler), fillers own core distribution and
  // haulers just restock the storage buffer below. Until then — no storage yet, or the filler
  // just died — haulers fill the core directly so spawning is never starved.
  const storageModel = !!creep.room.storage && hasActiveFiller(creep.room);
  if (!storageModel) {
    // Re-use the cached core target while it still has room (skips a findClosestByPath/tick).
    if (creep.memory.fillTargetId) {
      const cached = Game.getObjectById(creep.memory.fillTargetId as Id<AnyStoreStructure>) as AnyStoreStructure | null;
      if (cached && "store" in cached && cached.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        transferEnergyTo(creep, cached as Structure);
        return;
      }
      creep.memory.fillTargetId = undefined;
    }

    const coreTarget = findCoreFillTarget(creep);
    if (coreTarget) {
      creep.memory.fillTargetId = coreTarget.id;
      transferEnergyTo(creep, coreTarget);
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
