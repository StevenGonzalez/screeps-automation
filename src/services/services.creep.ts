import {
  ENERGY_DEPOSIT_PRIORITY,
  ROLE_HAULER,
  ROLE_MINER,
  normalizeRole,
} from "../config/config.roles";

let assignmentCacheTick = -1;
const assignedContainerIdsByRoomAndRole: Record<string, Set<string>> = {};

let roomContainersCacheTick = -1;
const roomContainersCache: Record<string, StructureContainer[]> = {};

function getAssignedContainerIdsByRole(room: Room, role: string): Set<string> {
  if (assignmentCacheTick !== Game.time) {
    assignmentCacheTick = Game.time;
    for (const key of Object.keys(assignedContainerIdsByRoomAndRole)) {
      delete assignedContainerIdsByRoomAndRole[key];
    }
  }

  const cacheKey = `${room.name}:${role}`;
  if (!assignedContainerIdsByRoomAndRole[cacheKey]) {
    const taken = new Set<string>();
    for (const creepName in Game.creeps) {
      const creep = Game.creeps[creepName];
      if (creep.room.name !== room.name) continue;
      if (normalizeRole(creep.memory.role) !== role) continue;
      const assigned = creep.memory.assignedContainerId;
      if (assigned) taken.add(assigned.toString());
    }
    assignedContainerIdsByRoomAndRole[cacheKey] = taken;
  }

  return assignedContainerIdsByRoomAndRole[cacheKey];
}

function getRoomContainers(room: Room): StructureContainer[] {
  if (roomContainersCacheTick !== Game.time) {
    roomContainersCacheTick = Game.time;
    for (const key of Object.keys(roomContainersCache)) {
      delete roomContainersCache[key];
    }
  }

  if (!roomContainersCache[room.name]) {
    roomContainersCache[room.name] = room.find(FIND_STRUCTURES, {
      filter: (s): s is StructureContainer =>
        s.structureType === STRUCTURE_CONTAINER,
    });
  }

  return roomContainersCache[room.name];
}

export function findClosestSource(creep: Creep): Source | null {
  return creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
}

export function findBalancedSource(creep: Creep): Source | null {
  const sources = getSources(creep.room);
  if (sources.length === 0) return null;

  const harvestersPerSource: Record<string, number> = {};
  for (const s of sources) harvestersPerSource[s.id] = 0;

  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.name === creep.name) continue;
    if (c.room.name !== creep.room.name) continue;
    const assignedId = c.memory.assignedSourceId as Id<Source> | undefined;
    if (assignedId && harvestersPerSource[assignedId] !== undefined) {
      harvestersPerSource[assignedId]++;
    }
  }

  // Pick the source with fewest assigned creeps; break ties by proximity
  let best: Source | null = null;
  let bestCount = Infinity;
  for (const source of sources) {
    const count = harvestersPerSource[source.id] ?? 0;
    if (count < bestCount || (count === bestCount && best && creep.pos.getRangeTo(source) < creep.pos.getRangeTo(best))) {
      best = source;
      bestCount = count;
    }
  }
  return best;
}

export function findEnergyDepositTarget(
  creep: Creep,
  role: string
): Structure | null {
  const canonicalRole = normalizeRole(role) || role;
  const priorityList = ENERGY_DEPOSIT_PRIORITY[canonicalRole] || [];
  if (priorityList.length === 0) return null;

  const typeSet = new Set<StructureConstant>(priorityList);

  // Single room.find instead of one call per priority type
  const all = creep.room.find(FIND_STRUCTURES, {
    filter: (s): s is AnyStoreStructure =>
      typeSet.has(s.structureType) &&
      "store" in s &&
      (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  }) as AnyStoreStructure[];

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
      return creep.pos.findClosestByPath(bucket) as Structure | null;
    }
  }

  return null;
}

export function getClosestSpawn(
  room: Room,
  pos: RoomPosition
): StructureSpawn | null {
  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return null;
  return pos.findClosestByPath(spawns);
}

export function getSources(room: Room, ttl: number = 100): Source[] {
  if (!Memory.sources) Memory.sources = {};
  if (!Memory.sourcesLastScan) Memory.sourcesLastScan = {};
  const lastScan = Memory.sourcesLastScan[room.name] || 0;
  if (!Memory.sources[room.name] || Game.time - lastScan > ttl) {
    Memory.sources[room.name] = room.find(FIND_SOURCES).map((s) => s.id);
    Memory.sourcesLastScan[room.name] = Game.time;
  }
  const sourceIds: Id<Source>[] = Memory.sources[room.name];
  return sourceIds
    .map((id) => Game.getObjectById(id))
    .filter(Boolean) as Source[];
}

export function harvestFromSource(creep: Creep, source: Source): void {
  if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
    creep.moveTo(source, { reusePath: 20 });
  }
}

export function acquireEnergy(creep: Creep): boolean {
  // Re-use the cached container/storage/link target from the previous tick as long
  // as it still exists and still holds energy — avoids the expensive findClosestByPath
  // scan on every tick.
  if (creep.memory.energySourceId) {
    const cached = Game.getObjectById(creep.memory.energySourceId) as AnyStoreStructure | null;
    if (cached && cached.store[RESOURCE_ENERGY] > 0) {
      const res = creep.withdraw(cached, RESOURCE_ENERGY);
      if (res === ERR_NOT_IN_RANGE) {
        creep.moveTo(cached, { reusePath: 20 });
        return true;
      }
      if (res === OK) return true;
    }
    creep.memory.energySourceId = undefined;
  }

  // Pick up nearby dropped energy — findInRange is O(local area) vs room-wide pathfinding.
  const droppedInRange = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 8, {
    filter: (d) => d.resourceType === RESOURCE_ENERGY && d.amount > 0,
  }) as Resource[];
  if (droppedInRange.length > 0) {
    const dropped = droppedInRange.reduce((a, b) => (a.amount > b.amount ? a : b));
    const res = creep.pickup(dropped);
    if (res === ERR_NOT_IN_RANGE) {
      creep.moveTo(dropped, { reusePath: 5 });
      return true;
    }
    return res === OK;
  }

  // Containers and storage — cache the chosen target.
  const upgradeId = creep.room.memory.upgradeContainerId;
  const storeTargets = creep.room.find(FIND_STRUCTURES, {
    filter: (s): s is AnyStoreStructure =>
      (s.structureType === STRUCTURE_CONTAINER ||
        s.structureType === STRUCTURE_STORAGE) &&
      "store" in s &&
      s.store[RESOURCE_ENERGY] > 0,
  });

  const nonUpgrade = upgradeId
    ? storeTargets.filter((s) => s.id !== upgradeId)
    : storeTargets;

  const storeTarget = nonUpgrade.length > 0
    ? creep.pos.findClosestByPath(nonUpgrade) as AnyStoreStructure | null
    : storeTargets.length > 0
      ? creep.pos.findClosestByPath(storeTargets) as AnyStoreStructure | null
      : null;

  if (storeTarget) {
    creep.memory.energySourceId = storeTarget.id;
    const res = creep.withdraw(storeTarget, RESOURCE_ENERGY);
    if (res === ERR_NOT_IN_RANGE) {
      creep.moveTo(storeTarget, { reusePath: 20 });
      return true;
    }
    return res === OK;
  }

  // Links with energy — cache the chosen one.
  const links = creep.room.find(FIND_STRUCTURES, {
    filter: (s): s is StructureLink =>
      s.structureType === STRUCTURE_LINK &&
      (s as StructureLink).store[RESOURCE_ENERGY] > 0,
  }) as StructureLink[];
  if (links.length > 0) {
    const link = creep.pos.findClosestByPath(links) as StructureLink | null;
    if (link) {
      creep.memory.energySourceId = link.id as unknown as Id<AnyStoreStructure>;
      const res = creep.withdraw(link, RESOURCE_ENERGY);
      if (res === ERR_NOT_IN_RANGE) {
        creep.moveTo(link, { reusePath: 20 });
        return true;
      }
      return res === OK;
    }
  }

  // Tombstones — ephemeral, not cached.
  const tomb = creep.pos.findClosestByPath(FIND_TOMBSTONES, {
    filter: (t) => t.store && t.store[RESOURCE_ENERGY] > 0,
  }) as Tombstone | null;
  if (tomb) {
    const res = creep.withdraw(tomb, RESOURCE_ENERGY);
    if (res === ERR_NOT_IN_RANGE) {
      creep.moveTo(tomb, { reusePath: 20 });
      return true;
    }
    return res === OK;
  }

  // Last resort: harvest directly from a source.
  const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE) as Source | null;
  if (source) {
    const res = creep.harvest(source);
    if (res === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { reusePath: 20 });
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
  const targets = creep.room.find(FIND_STRUCTURES, {
    filter: (s): s is AnyStoreStructure =>
      (s.structureType === STRUCTURE_CONTAINER ||
        s.structureType === STRUCTURE_STORAGE) &&
      "store" in s &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  });
  if (targets.length === 0) return null;
  return creep.pos.findClosestByPath(targets) as Structure | null;
}

export function withdrawFromControllerContainer(creep: Creep): boolean {
  const controller = creep.room.controller;
  if (!controller) return false;

  const containers = creep.room.find(FIND_STRUCTURES, {
    filter: (s): s is StructureContainer =>
      s.structureType === STRUCTURE_CONTAINER &&
      s.pos.getRangeTo(controller.pos) <= 2,
  }) as StructureContainer[];

  const containerWithEnergy = containers.find(
    (c) => c.store && c.store[RESOURCE_ENERGY] > 0
  );

  if (containerWithEnergy) {
    const res = creep.withdraw(containerWithEnergy, RESOURCE_ENERGY);
    if (res === ERR_NOT_IN_RANGE) {
      creep.moveTo(containerWithEnergy, { reusePath: 20 });
      return true;
    }
    return res === OK;
  }

  return false;
}

export function isCreepEmpty(creep: Creep): boolean {
  return creep.store[RESOURCE_ENERGY] === 0;
}

export function isCreepFull(creep: Creep): boolean {
  return creep.store.getFreeCapacity() === 0;
}

export function transferEnergyTo(creep: Creep, target: Structure): void {
  if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { reusePath: 20 });
  }
}

export function findClosestConstructionSite(
  creep: Creep
): ConstructionSite | null {
  const sites = creep.room.find(FIND_CONSTRUCTION_SITES) as ConstructionSite[];
  if (!sites || sites.length === 0) return null;

  const nonRoadSites = sites.filter((s) => s.structureType !== STRUCTURE_ROAD);
  if (nonRoadSites.length > 0) {
    return creep.pos.findClosestByPath(nonRoadSites) || null;
  }

  return creep.pos.findClosestByPath(sites) || null;
}

function isDamaged(s: AnyStructure): boolean {
  return s.hits < s.hitsMax;
}

export function findClosestRepairTarget(creep: Creep): AnyStructure | null {
  const repairTargets = creep.room.find(FIND_STRUCTURES, {
    filter: (s): s is AnyStructure =>
      s.structureType !== STRUCTURE_WALL &&
      s.structureType !== STRUCTURE_RAMPART &&
      isDamaged(s as AnyStructure),
  });
  if (repairTargets.length === 0) return null;
  return creep.pos.findClosestByPath(repairTargets) || null;
}

export function findClosestDamagedRampart(
  creep: Creep
): StructureRampart | null {
  return creep.pos.findClosestByPath(FIND_STRUCTURES, {
    filter: (s): s is StructureRampart =>
      s.structureType === STRUCTURE_RAMPART && isDamaged(s as AnyStructure),
  }) as StructureRampart | null;
}

export function findMostCriticalRepairTarget(
  creep: Creep
): AnyStructure | null {
  const damaged = creep.room.find(FIND_STRUCTURES, {
    filter: (s): s is AnyStructure => isDamaged(s as AnyStructure),
  });

  if (damaged.length === 0) return null;

  const nonDefensive = damaged.filter(
    (s) =>
      s.structureType !== STRUCTURE_RAMPART &&
      s.structureType !== STRUCTURE_WALL
  );
  if (nonDefensive.length > 0) {
    return nonDefensive.reduce((a, b) => (a.hits < b.hits ? a : b));
  }

  const RAMPART_CRITICAL = 1000;
  const criticalDefensive = damaged.filter(
    (s) =>
      (s.structureType === STRUCTURE_RAMPART ||
        s.structureType === STRUCTURE_WALL) &&
      s.hits < RAMPART_CRITICAL
  );
  if (criticalDefensive.length > 0) {
    return criticalDefensive.reduce((a, b) => (a.hits < b.hits ? a : b));
  }

  return damaged.reduce((a, b) => (a.hits < b.hits ? a : b));
}

export function findTowerRepairTarget(room: Room): AnyStructure | null {
  const decayThreshold = 1000;
  const candidates = room.find(FIND_STRUCTURES, {
    filter: (s): s is AnyStructure => {
      const st = s as AnyStructure;
      if (
        st.structureType === STRUCTURE_RAMPART ||
        st.structureType === STRUCTURE_WALL
      ) {
        return st.hits < decayThreshold;
      }
      return st.hits < st.hitsMax * 0.1;
    },
  });
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (a.hits < b.hits ? a : b));
}

export function getClosestContainerOrStorage(creep: Creep): Structure | null {
  const allTargets = creep.room.find(FIND_STRUCTURES, {
    filter: (s): s is AnyStoreStructure =>
      (s.structureType === STRUCTURE_CONTAINER ||
        s.structureType === STRUCTURE_STORAGE) &&
      "store" in s &&
      s.store[RESOURCE_ENERGY] > 0,
  });
  if (allTargets.length === 0) return null;
  const upgradeId = creep.room.memory.upgradeContainerId;
  let nonUpgrade = allTargets;
  if (upgradeId) nonUpgrade = allTargets.filter((s) => s.id !== upgradeId);
  if (nonUpgrade.length > 0)
    return creep.pos.findClosestByPath(nonUpgrade) as Structure | null;
  return creep.pos.findClosestByPath(allTargets) as Structure | null;
}

export function getMinerContainerIds(room: Room): Id<StructureContainer>[] {
  if (room.memory.minerContainerIds?.length) {
    return room.memory.minerContainerIds;
  }

  const sources = room.find(FIND_SOURCES) as Source[];
  const containers = room.find(FIND_STRUCTURES, {
    filter: (s): s is StructureContainer =>
      s.structureType === STRUCTURE_CONTAINER,
  }) as StructureContainer[];
  const minerIds: Id<StructureContainer>[] = [];
  for (const c of containers) {
    for (const s of sources) {
      if (c.pos.getRangeTo(s.pos) <= 1) {
        minerIds.push(c.id as Id<StructureContainer>);
        break;
      }
    }
  }
  return minerIds;
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
  return creep.pos.findClosestByPath(withEnergy) || null;
}

export function findDepositTargetExcludingMiner(
  creep: Creep,
  role: string
): Structure | null {
  const minerIds = getMinerContainerIds(creep.room).map((id) => id.toString());

  const canonicalRole = normalizeRole(role) || role;
  if (canonicalRole === ROLE_HAULER) {
    const upgradeId = creep.room.memory.upgradeContainerId;

    // Prioritize controller container so upgraders stay supplied.
    if (upgradeId) {
      const upgradeCont = Game.getObjectById(
        upgradeId
      ) as StructureContainer | null;
      if (
        upgradeCont &&
        upgradeCont.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
        minerIds.indexOf(upgradeCont.id as string) === -1
      ) {
        return upgradeCont;
      }
    }

    // Next priority is storage, then any non-miner containers.
    const storage = creep.room.storage;
    if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
      return storage;
    }

    const nonMinerContainers = getRoomContainers(creep.room).filter(
      (container) =>
        minerIds.indexOf(container.id) === -1 &&
        container.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    );
    if (nonMinerContainers.length > 0) {
      return creep.pos.findClosestByPath(nonMinerContainers) || null;
    }

    return null;
  }

  const priorityTarget = findEnergyDepositTarget(creep, role);
  if (priorityTarget && minerIds.indexOf(priorityTarget.id) === -1) {
    return priorityTarget;
  }

  const targets = creep.room.find(FIND_STRUCTURES, {
    filter: (s): s is AnyStoreStructure =>
      (s.structureType === STRUCTURE_CONTAINER ||
        s.structureType === STRUCTURE_STORAGE) &&
      "store" in s &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
      minerIds.indexOf(s.id as string) === -1,
  });
  if (targets.length === 0) return null;
  return creep.pos.findClosestByPath(targets) as Structure | null;
}

export function upgradeController(creep: Creep): void {
  const controller = creep.room.controller;
  if (!controller) return;

  if (signControllerIfNeeded(creep, controller)) return;

  if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
    creep.moveTo(controller, { reusePath: 20 });
  }
}

export function signControllerIfNeeded(
  creep: Creep,
  controller: StructureController
): boolean {
  const desiredSignature = "By Decree of the Iron Keep";

  const currentSign = controller.sign;
  const myUsername = controller.owner?.username;

  if (
    !currentSign ||
    currentSign.username !== myUsername ||
    currentSign.text !== desiredSignature
  ) {
    if (creep.pos.getRangeTo(controller.pos) > 1) {
      creep.moveTo(controller, { reusePath: 20 });
      return true;
    } else {
      creep.signController(controller, desiredSignature);
      creep.room.memory.lastSigned = Game.time;
      return true;
    }
  }

  return false;
}

export function buildAtConstructionSite(
  creep: Creep,
  site: ConstructionSite
): number {
  const res = creep.build(site);
  if (res === ERR_NOT_IN_RANGE) return creep.moveTo(site, { reusePath: 20 });
  return res;
}

export function repairStructure(creep: Creep, target: AnyStructure): number {
  const res = creep.repair(target);
  if (res === ERR_NOT_IN_RANGE) return creep.moveTo(target, { reusePath: 20 });
  return res;
}

export function findContainersForSource(
  room: Room,
  source: Source
): StructureContainer[] {
  const containers = getRoomContainers(room);
  return containers.filter((container) => container.pos.getRangeTo(source.pos) <= 1);
}

export function findUnclaimedMinerAssignment(
  room: Room
): { source: Source; container: StructureContainer } | null {
  const sources = getSources(room);
  const takenContainerIds = getAssignedContainerIdsByRole(room, ROLE_MINER);
  for (const source of sources) {
    const containers = findContainersForSource(room, source);
    for (const container of containers) {
      if (!takenContainerIds.has(container.id)) {
        takenContainerIds.add(container.id);
        return { source, container };
      }
    }
  }
  return null;
}

export function findUnclaimedHaulerAssignment(
  room: Room
): StructureContainer | null {
  const containers = getRoomContainers(room);
  const takenContainerIds = getAssignedContainerIdsByRole(room, ROLE_HAULER);
  for (const container of containers) {
    if (!takenContainerIds.has(container.id)) {
      takenContainerIds.add(container.id);
      return container;
    }
  }
  return null;
}
