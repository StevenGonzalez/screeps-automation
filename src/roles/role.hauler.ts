import {
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
  if (creep.memory.working === undefined) creep.memory.working = false;
  // Collect-until-full / deliver-until-empty, on a flag (like the builder). The flag is what
  // makes a porter top off before delivering: it keeps collecting while it has room rather than
  // running a 97-energy ground scrap to the spawn while the full container it was standing on
  // keeps overflowing. It also stops a porter flipping back to collecting just because depositing
  // into one extension freed a little capacity — it delivers its whole load first.
  if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) creep.memory.working = false;
  if (!creep.memory.working && creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
    creep.memory.working = true;
  }

  if (!creep.memory.working) {
    creep.memory.fillTargetId = undefined;
    if (collectEnergy(creep)) return;
    // Nothing left worth collecting: deliver a partial load if we have one, else idle.
    if (creep.store[RESOURCE_ENERGY] === 0) return;
    creep.memory.working = true;
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

// A loaded porter tops off only from sources within this range — it won't trek across the room
// for a scrap when it already has a worthwhile load to deliver.
const DIVERT_RANGE = 10;

// Fill the porter, returning true while it is still actively collecting (so the caller holds off
// delivering). Keeps the original priority — decaying ground piles first, then the bulk miner
// container, then the storage buffer — but because the caller only flips to delivering once the
// porter is full (or nothing's left worth fetching), grabbing a small pile no longer ends the
// trip with most of the capacity unused while a full container overflows behind it.
function collectEnergy(creep: Creep): boolean {
  const carried = creep.store[RESOURCE_ENERGY];
  const nearbyOnly = carried > 0; // an empty porter fetches from anywhere; a loaded one tops off close by

  // Dropped energy decays every tick — grab worthwhile piles first. findClosestByRange (not
  // ByPath) keeps this cheap.
  const dropped = creep.room.find(FIND_DROPPED_RESOURCES, {
    filter: (d) => d.resourceType === RESOURCE_ENERGY && d.amount > 50,
  }) as Resource[];
  if (dropped.length > 0) {
    const pile = creep.pos.findClosestByRange(dropped) as Resource;
    if (!nearbyOnly || creep.pos.getRangeTo(pile) <= DIVERT_RANGE) {
      pickupDroppedResource(creep, pile);
      return true;
    }
  }

  // The bulk producer: a miner container holding a worthwhile load. Draining it is what actually
  // fills the porter (and stops the container overflowing onto the ground). Prefer the assigned one.
  let container: StructureContainer | null = null;
  const assignedId = creep.memory.assignedContainerId;
  if (assignedId) {
    const assigned = Game.getObjectById(assignedId as Id<StructureContainer>) as StructureContainer | null;
    if (assigned && assigned.store[RESOURCE_ENERGY] >= 100) container = assigned;
  }
  if (!container) container = findClosestMinerContainerWithEnergy(creep);
  if (
    container &&
    container.store[RESOURCE_ENERGY] >= 100 &&
    (!nearbyOnly || creep.pos.getRangeTo(container) <= DIVERT_RANGE)
  ) {
    withdrawFromContainer(creep, container);
    return true;
  }

  // Storage buffer: only an empty porter taps it, and only when the base needs filling — a loaded
  // porter pulling from storage just to top off would be a pointless storage→core round trip.
  if (carried === 0) {
    const storage = creep.room.storage;
    const baseNeedsEnergy = creep.room.energyAvailable < creep.room.energyCapacityAvailable;
    if (storage && baseNeedsEnergy && storage.store[RESOURCE_ENERGY] > 0) {
      if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage, { reusePath: 20 });
      }
      return true;
    }
    if (baseNeedsEnergy) {
      acquireEnergy(creep);
      return true;
    }
  }

  return false;
}
