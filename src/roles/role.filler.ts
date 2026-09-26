import {
  findEmptiestTower,
  findCoreFillTarget,
  getRoomStructures,
} from "../services/services.creep";
import { getThreatInfo } from "../services/services.combat";
import { findRelayLink } from "../orchestrators/orchestrator.links";

// Power spawn upkeep, done only once spawns/extensions/towers are full.
const POWER_SPAWN_POWER_LOW = 50;
const POWER_SPAWN_ENERGY_STORAGE_FLOOR = 100000;

export function runFiller(creep: Creep) {
  const storage = creep.room.storage;
  const underThreat = getThreatInfo(creep.room).hostiles.length > 0;

  const coreTarget =
    (underThreat ? findEmptiestTower(creep.room) : null) ?? getCoreFillTarget(creep);

  if (carryingPower(creep)) {
    deliverPower(creep, storage);
    return;
  }

  // With the core full, feed the storage link so it can relay stored energy to
  // a controller link the source links are not keeping up with. Upgrading comes
  // before topping up the power spawn's energy.
  const relay = coreTarget ? null : findRelayLink(creep.room);
  const powerSpawn = coreTarget ? null : getPowerSpawn(creep.room);
  const target: AnyStoreStructure | null =
    coreTarget ??
    (!relay && powerSpawn && powerSpawnWantsEnergy(powerSpawn, storage) ? powerSpawn : null);

  if (creep.store[RESOURCE_ENERGY] === 0) {
    if (powerSpawn && loadPower(creep, powerSpawn, storage)) return;
    if (!target) {
      if (relay && storage && relay.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(storage, { reusePath: 20 });
        }
        return;
      }
      if (storage && !creep.pos.isNearTo(storage)) {
        creep.moveTo(storage, { range: 1, reusePath: 20 });
      }
      return;
    }
    const source = findFillerSource(creep, storage);
    if (source) {
      if (creep.withdraw(source, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, { reusePath: 10 });
      }
    } else if (storage && !creep.pos.isNearTo(storage)) {
      creep.moveTo(storage, { range: 1, reusePath: 20 });
    }
    return;
  }

  if (target) {
    if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(target, { reusePath: 10 });
    }
    return;
  }

  if (relay && relay.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    if (creep.transfer(relay, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(relay, { reusePath: 20 });
    }
    return;
  }

  if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(storage, { reusePath: 20 });
    }
  }
}

/**
 * The core fill target, cached in memory like the hauler does so the pathing
 * search only runs when the previous target is full or gone.
 */
function getCoreFillTarget(creep: Creep): AnyStoreStructure | null {
  const cachedId = creep.memory.fillTargetId;
  if (cachedId) {
    const cached = Game.getObjectById(cachedId as Id<AnyStoreStructure>) as AnyStoreStructure | null;
    if (
      cached &&
      cached.room?.name === creep.room.name &&
      cached.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    ) {
      return cached;
    }
    creep.memory.fillTargetId = undefined;
  }
  const target = findCoreFillTarget(creep);
  if (target) creep.memory.fillTargetId = target.id;
  return target;
}

function getPowerSpawn(room: Room): StructurePowerSpawn | null {
  const id = room.memory.powerSpawnId;
  return id ? (Game.getObjectById(id) as StructurePowerSpawn | null) : null;
}

function powerSpawnWantsEnergy(ps: StructurePowerSpawn, storage: StructureStorage | undefined): boolean {
  return (
    (storage?.store[RESOURCE_ENERGY] ?? 0) > POWER_SPAWN_ENERGY_STORAGE_FLOOR &&
    ps.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  );
}

function carryingPower(creep: Creep): boolean {
  return (creep.store[RESOURCE_POWER] ?? 0) > 0;
}

/** Tops the power spawn up with power from storage or terminal. */
function loadPower(
  creep: Creep,
  ps: StructurePowerSpawn,
  storage: StructureStorage | undefined
): boolean {
  const inSpawn = ps.store[RESOURCE_POWER] ?? 0;
  if (inSpawn >= POWER_SPAWN_POWER_LOW) return false;
  const source = [storage, creep.room.terminal].find(
    (s): s is StructureStorage | StructureTerminal => !!s && (s.store[RESOURCE_POWER] ?? 0) > 0
  );
  if (!source) return false;
  const amount = Math.min(
    POWER_SPAWN_POWER_CAPACITY - inSpawn,
    source.store[RESOURCE_POWER] ?? 0,
    creep.store.getFreeCapacity()
  );
  if (amount <= 0) return false;
  if (creep.withdraw(source, RESOURCE_POWER, amount) === ERR_NOT_IN_RANGE) {
    creep.moveTo(source, { range: 1, reusePath: 20 });
  }
  return true;
}

/** Carries power to the power spawn, else to storage or terminal; drops it if all are full. */
function deliverPower(creep: Creep, storage: StructureStorage | undefined): void {
  const ps = getPowerSpawn(creep.room);
  const dest = [ps, storage, creep.room.terminal].find(
    (s) => s && s.store.getFreeCapacity(RESOURCE_POWER) > 0
  );
  if (!dest) {
    // Nowhere to put it; holding it would stall the filler for good.
    creep.drop(RESOURCE_POWER);
    return;
  }
  if (creep.transfer(dest, RESOURCE_POWER) === ERR_NOT_IN_RANGE) {
    creep.moveTo(dest, { range: 1, reusePath: 20 });
  }
}

function findFillerSource(
  creep: Creep,
  storage: StructureStorage | undefined
): StructureLink | StructureStorage | StructureContainer | null {
  if (storage) {
    const link = getRoomStructures(creep.room).find(
      (s): s is StructureLink =>
        s.structureType === STRUCTURE_LINK &&
        s.pos.inRangeTo(storage.pos, 2) &&
        (s as StructureLink).store[RESOURCE_ENERGY] > 0
    ) as StructureLink | undefined;
    if (link) return link;
    if (storage.store[RESOURCE_ENERGY] > 0) return storage;
  }

  const upgradeId = creep.room.memory.upgradeContainerId;
  const containers = getRoomStructures(creep.room).filter(
    (s): s is StructureContainer =>
      s.structureType === STRUCTURE_CONTAINER &&
      s.id !== upgradeId &&
      (s as StructureContainer).store[RESOURCE_ENERGY] > 0
  );
  if (containers.length > 0) {
    return creep.pos.findClosestByPath(containers, { ignoreCreeps: true }) ?? null;
  }
  return null;
}
