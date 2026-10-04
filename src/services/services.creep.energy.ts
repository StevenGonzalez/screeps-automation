import { ENERGY_DEPOSIT_PRIORITY, ROLE_HAULER, ROLE_UPGRADER } from "../config/config.roles";
import {
  closestByPath,
  getRoomStructures,
  getRoomContainers,
  getSafeSources,
  getMinerContainerIds,
} from "./services.creep.room";
import { energyClaimedByOthers } from "./services.coordination";
import { upgradingFunded } from "./services.treasury";

export function findEnergyDepositTarget(
  creep: Creep,
  role: string
): Structure | null {
  const priorityList = ENERGY_DEPOSIT_PRIORITY[role] || [];
  if (priorityList.length === 0) return null;

  const typeSet = new Set<StructureConstant>(priorityList);
  // The mineral container is the mineral miner's standing tile, not an energy
  // buffer; energy dumped there sits far from every consumer.
  const mineralContainerId = creep.room.memory.mineralContainerId;

  const all = getRoomStructures(creep.room).filter(
    (s): s is AnyStoreStructure =>
      typeSet.has(s.structureType) &&
      s.id !== mineralContainerId &&
      "store" in s &&
      (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > 0
  );

  if (all.length === 0) return null;

  const byType = new Map<StructureConstant, AnyStoreStructure[]>();
  for (const s of all) {
    let bucket = byType.get(s.structureType);
    if (!bucket) { bucket = []; byType.set(s.structureType, bucket); }
    bucket.push(s);
  }

  for (const structureType of priorityList) {
    const bucket = byType.get(structureType);
    if (bucket && bucket.length > 0) {
      return closestByPath(creep.pos, bucket) as Structure | null;
    }
  }

  return null;
}

export function acquireEnergy(
  creep: Creep,
  opts?: { bufferOnly?: boolean }
): boolean {
  const bufferOnly = !!opts?.bufferOnly;
  const minerIds = bufferOnly
    ? new Set(getMinerContainerIds(creep.room).map((id) => id as string))
    : null;

  if (creep.memory.energySourceId) {
    const cached = Game.getObjectById(creep.memory.energySourceId) as AnyStoreStructure | null;
    if (
      cached &&
      cached.store[RESOURCE_ENERGY] > 0 &&
      !(minerIds && minerIds.has(cached.id as string))
    ) {
      const res = creep.withdraw(cached, RESOURCE_ENERGY);
      if (res === ERR_NOT_IN_RANGE) {
        creep.moveTo(cached, { reusePath: 50 });
        return true;
      }
      if (res === OK) return true;
    }
    creep.memory.energySourceId = undefined;
  }

  const droppedInRange = bufferOnly
    ? []
    : (creep.pos.findInRange(FIND_DROPPED_RESOURCES, 8, {
        filter: (d) => d.resourceType === RESOURCE_ENERGY && d.amount > 0,
      }) as Resource[]);
  if (droppedInRange.length > 0) {
    const dropped = droppedInRange.reduce((a, b) => (a.amount > b.amount ? a : b));
    const res = creep.pickup(dropped);
    if (res === ERR_NOT_IN_RANGE) {
      creep.moveTo(dropped, { reusePath: 5 });
      return true;
    }
    return res === OK;
  }

  const upgradeId = creep.room.memory.upgradeContainerId;
  const storeTargets = getRoomStructures(creep.room).filter(
    (s): s is AnyStoreStructure =>
      (s.structureType === STRUCTURE_CONTAINER ||
        s.structureType === STRUCTURE_STORAGE) &&
      "store" in s &&
      s.store[RESOURCE_ENERGY] > 0 &&
      !(minerIds && minerIds.has(s.id as string))
  );

  const nonUpgrade = upgradeId
    ? storeTargets.filter((s) => s.id !== upgradeId)
    : storeTargets;

  const storeTarget = nonUpgrade.length > 0
    ? closestByPath(creep.pos, nonUpgrade) as AnyStoreStructure | null
    : storeTargets.length > 0
      ? closestByPath(creep.pos, storeTargets) as AnyStoreStructure | null
      : null;

  if (storeTarget) {
    creep.memory.energySourceId = storeTarget.id;
    const res = creep.withdraw(storeTarget, RESOURCE_ENERGY);
    if (res === ERR_NOT_IN_RANGE) {
      creep.moveTo(storeTarget, { reusePath: 50 });
      return true;
    }
    return res === OK;
  }

  // Controller links hold upgrader energy, often relayed from storage; any
  // other role pulling from them just ships it back.
  const controllerLinks =
    creep.memory.role === ROLE_UPGRADER ? undefined : creep.room.memory.controllerLinkIds;
  const links = getRoomStructures(creep.room).filter(
    (s): s is StructureLink =>
      s.structureType === STRUCTURE_LINK &&
      (s as StructureLink).store[RESOURCE_ENERGY] > 0 &&
      !controllerLinks?.includes(s.id as Id<StructureLink>)
  );
  if (links.length > 0) {
    const link = closestByPath(creep.pos, links) as StructureLink | null;
    if (link) {
      creep.memory.energySourceId = link.id as unknown as Id<AnyStoreStructure>;
      const res = creep.withdraw(link, RESOURCE_ENERGY);
      if (res === ERR_NOT_IN_RANGE) {
        creep.moveTo(link, { reusePath: 50 });
        return true;
      }
      return res === OK;
    }
  }

  const tomb = creep.pos.findClosestByPath(FIND_TOMBSTONES, {
    ignoreCreeps: true,
    filter: (t) => t.store && t.store[RESOURCE_ENERGY] > 0,
  }) as Tombstone | null;
  if (tomb) {
    const res = creep.withdraw(tomb, RESOURCE_ENERGY);
    if (res === ERR_NOT_IN_RANGE) {
      creep.moveTo(tomb, { reusePath: 50 });
      return true;
    }
    return res === OK;
  }

  const activeSafe = getSafeSources(creep.room).filter((s) => s.energy > 0);
  const source = closestByPath(creep.pos, activeSafe) as Source | null;
  if (source) {
    const res = creep.harvest(source);
    if (res === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { reusePath: 50 });
      return true;
    }
    return res === OK;
  }

  return false;
}

export function pickupDroppedResource(
  creep: Creep,
  resource: Resource
): boolean {
  const res = creep.pickup(resource);
  if (res === ERR_NOT_IN_RANGE) {
    creep.moveTo(resource);
    return true;
  }
  return res === OK;
}

export function withdrawFromContainer(
  creep: Creep,
  container: StructureContainer
): boolean {
  const res = creep.withdraw(container, RESOURCE_ENERGY);
  if (res === ERR_NOT_IN_RANGE) {
    creep.moveTo(container);
    return true;
  }
  return res === OK;
}

export function findClosestContainerWithFreeCapacity(
  creep: Creep
): Structure | null {
  const targets = getRoomStructures(creep.room).filter(
    (s): s is AnyStoreStructure =>
      (s.structureType === STRUCTURE_CONTAINER ||
        s.structureType === STRUCTURE_STORAGE) &&
      "store" in s &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  );
  if (targets.length === 0) return null;
  return closestByPath(creep.pos, targets) as Structure | null;
}

export function withdrawFromControllerContainer(creep: Creep): boolean {
  const controller = creep.room.controller;
  if (!controller) return false;

  const containers = getRoomContainers(creep.room).filter(
    (s) => s.pos.getRangeTo(controller.pos) <= 2
  );

  const containerWithEnergy = containers.find(
    (c) => c.store && c.store[RESOURCE_ENERGY] > 0
  );

  if (containerWithEnergy) {
    const res = creep.withdraw(containerWithEnergy, RESOURCE_ENERGY);
    if (res === ERR_NOT_IN_RANGE) {
      creep.moveTo(containerWithEnergy, { reusePath: 50 });
      return true;
    }
    return res === OK;
  }

  return false;
}

// Borrowed-courier guard for the factory and nuker: they may only take a courier
// when the base doesn't need it: spawn/extensions full, no hostiles (towers
// need refills), and at least one other courier left on normal duty.
export function mayBorrowHauler(room: Room, haulers: Creep[]): boolean {
  if (haulers.length < 2) return false;
  if (room.energyAvailable < room.energyCapacityAvailable) return false;
  return room.find(FIND_HOSTILE_CREEPS).length === 0;
}

export function isCreepEmpty(creep: Creep): boolean {
  return creep.store[RESOURCE_ENERGY] === 0;
}

export function isCreepFull(creep: Creep): boolean {
  return creep.store.getFreeCapacity() === 0;
}

export function transferEnergyTo(creep: Creep, target: Structure | Creep): void {
  if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { reusePath: 5 });
  }
}

export function getClosestContainerOrStorage(creep: Creep): Structure | null {
  const allTargets = getRoomStructures(creep.room).filter(
    (s): s is AnyStoreStructure =>
      (s.structureType === STRUCTURE_CONTAINER ||
        s.structureType === STRUCTURE_STORAGE) &&
      "store" in s &&
      s.store[RESOURCE_ENERGY] > 0
  );
  if (allTargets.length === 0) return null;
  const upgradeId = creep.room.memory.upgradeContainerId;
  let nonUpgrade = allTargets;
  if (upgradeId) nonUpgrade = allTargets.filter((s) => s.id !== upgradeId);
  if (nonUpgrade.length > 0)
    return closestByPath(creep.pos, nonUpgrade) as Structure | null;
  return closestByPath(creep.pos, allTargets) as Structure | null;
}

export function findClosestMinerContainerWithEnergy(
  creep: Creep
): StructureContainer | null {
  const ids = getMinerContainerIds(creep.room);
  if (!ids || ids.length === 0) return null;
  const containers = ids
    .map((id) => Game.getObjectById(id))
    .filter(Boolean) as StructureContainer[];
  const withEnergy = containers.filter(
    (c) => c.store && c.store[RESOURCE_ENERGY] > 0
  );
  if (withEnergy.length === 0) return null;
  return closestByPath(creep.pos, withEnergy) || null;
}

const UPGRADE_CONTAINER_REFILL_BELOW = 1000;

const UPGRADE_CONTAINER_FILLERS = 1;

let upgradeFillerTick = -1;

const upgradeFillerIdsByRoom: Record<string, Set<string>> = {};

function getUpgradeContainerFillerIds(room: Room): Set<string> {
  if (upgradeFillerTick !== Game.time) {
    upgradeFillerTick = Game.time;
    for (const k in upgradeFillerIdsByRoom) delete upgradeFillerIdsByRoom[k];
  }
  if (!upgradeFillerIdsByRoom[room.name]) {
    const haulerIds: string[] = [];
    for (const name in Game.creeps) {
      const c = Game.creeps[name];
      if (c.room.name === room.name && c.memory.role === ROLE_HAULER) haulerIds.push(c.id);
    }
    haulerIds.sort();
    upgradeFillerIdsByRoom[room.name] = new Set(haulerIds.slice(0, UPGRADE_CONTAINER_FILLERS));
  }
  return upgradeFillerIdsByRoom[room.name];
}

export function findDepositTargetExcludingMiner(creep: Creep): Structure | null {
  const minerIds = getMinerContainerIds(creep.room).map((id) => id.toString());

  const upgradeId = creep.room.memory.upgradeContainerId;
  const upgradeCont = upgradeId
    ? (Game.getObjectById(upgradeId) as StructureContainer | null)
    : null;
  const upgradeIsDropTarget =
    !!upgradeCont &&
    upgradeCont.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
    minerIds.indexOf(upgradeCont.id as string) === -1;

  const coreFull = creep.room.energyAvailable >= creep.room.energyCapacityAvailable;
  if (
    upgradeIsDropTarget &&
    coreFull &&
    upgradingFunded(creep.room) &&
    (upgradeCont!.store[RESOURCE_ENERGY] ?? 0) < UPGRADE_CONTAINER_REFILL_BELOW &&
    getUpgradeContainerFillerIds(creep.room).has(creep.id)
  ) {
    return upgradeCont;
  }

  const storage = creep.room.storage;
  if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    return storage;
  }

  if (upgradeIsDropTarget) {
    return upgradeCont;
  }

  const nonMinerContainers = getRoomContainers(creep.room).filter(
    (container) =>
      minerIds.indexOf(container.id) === -1 &&
      container.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  );
  if (nonMinerContainers.length > 0) {
    return closestByPath(creep.pos, nonMinerContainers) || null;
  }

  return null;
}

export function findEmptiestTower(room: Room): StructureTower | null {
  const towers = getRoomStructures(room).filter(
    (s): s is StructureTower =>
      s.structureType === STRUCTURE_TOWER &&
      (s as StructureTower).store.getFreeCapacity(RESOURCE_ENERGY) > 0
  );
  if (towers.length === 0) return null;
  return towers.reduce((a, b) =>
    a.store.getUsedCapacity(RESOURCE_ENERGY) < b.store.getUsedCapacity(RESOURCE_ENERGY) ? a : b
  );
}

// Skips anything other creeps are already bringing enough energy to fill, so
// haulers, the filler and builders spread across the core instead of all
// walking to the same extension.
export function findCoreFillTarget(creep: Creep): AnyStoreStructure | null {
  const targets = getRoomStructures(creep.room).filter(
    (s): s is AnyStoreStructure =>
      (s.structureType === STRUCTURE_SPAWN ||
        s.structureType === STRUCTURE_EXTENSION ||
        s.structureType === STRUCTURE_TOWER) &&
      "store" in s &&
      (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > energyClaimedByOthers(s.id, creep)
  );
  if (targets.length === 0) return null;
  return (creep.pos.findClosestByPath(targets, { ignoreCreeps: true }) as AnyStoreStructure | null) ?? null;
}
