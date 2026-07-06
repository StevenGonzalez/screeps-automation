import {
  ENERGY_DEPOSIT_PRIORITY,
  ROLE_HAULER,
  ROLE_MINER,
} from "../config/config.roles";
import { pickSignature } from "../config/signatures";

let assignmentCacheTick = -1;
const assignedContainerIdsByRoomAndRole: Record<string, Set<string>> = {};

let roomStructuresCacheTick = -1;
const roomStructuresCache: Record<string, AnyStructure[]> = {};

let roomContainersCacheTick = -1;
const roomContainersCache: Record<string, StructureContainer[]> = {};

let criticalRepairCacheTick = -1;
const criticalRepairByRoom: Record<string, AnyStructure | null> = {};

let towerRepairCacheTick = -1;
const towerRepairByRoom: Record<string, AnyStructure | null> = {};

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
      if (creep.memory.role !== role) continue;
      const assigned = creep.memory.assignedContainerId;
      if (assigned) taken.add(assigned.toString());
    }
    assignedContainerIdsByRoomAndRole[cacheKey] = taken;
  }

  return assignedContainerIdsByRoomAndRole[cacheKey];
}

function closestByPath<T extends RoomObject>(
  pos: RoomPosition,
  targets: T[]
): T | null {
  return (pos.findClosestByPath(targets, { ignoreCreeps: true }) as T | null) ?? null;
}

export function getRoomStructures(room: Room): AnyStructure[] {
  if (roomStructuresCacheTick !== Game.time) {
    roomStructuresCacheTick = Game.time;
    for (const key of Object.keys(roomStructuresCache)) {
      delete roomStructuresCache[key];
    }
  }

  if (!roomStructuresCache[room.name]) {
    roomStructuresCache[room.name] = room.find(FIND_STRUCTURES);
  }

  return roomStructuresCache[room.name];
}

function getRoomContainers(room: Room): StructureContainer[] {
  if (roomContainersCacheTick !== Game.time) {
    roomContainersCacheTick = Game.time;
    for (const key of Object.keys(roomContainersCache)) {
      delete roomContainersCache[key];
    }
  }

  if (!roomContainersCache[room.name]) {
    roomContainersCache[room.name] = getRoomStructures(room).filter(
      (s): s is StructureContainer => s.structureType === STRUCTURE_CONTAINER
    );
  }

  return roomContainersCache[room.name];
}

export function findClosestSource(creep: Creep): Source | null {
  return creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE, { ignoreCreeps: true });
}

export function findBalancedSource(creep: Creep): Source | null {
  const sources = getSafeSources(creep.room);
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
  const priorityList = ENERGY_DEPOSIT_PRIORITY[role] || [];
  if (priorityList.length === 0) return null;

  const typeSet = new Set<StructureConstant>(priorityList);

  const all = getRoomStructures(creep.room).filter(
    (s): s is AnyStoreStructure =>
      typeSet.has(s.structureType) &&
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

export function getClosestSpawn(
  room: Room,
  pos: RoomPosition
): StructureSpawn | null {
  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return null;
  return closestByPath(pos, spawns);
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
    creep.moveTo(source, { reusePath: 50 });
  }
}

const SOURCE_DANGER_RANGE = 5;

let dangerTick = -1;
const dangerByRoom: Record<string, RoomPosition[]> = {};

function getDangerPositions(room: Room): RoomPosition[] {
  if (dangerTick !== Game.time) {
    dangerTick = Game.time;
    for (const k in dangerByRoom) delete dangerByRoom[k];
  }
  if (!dangerByRoom[room.name]) {
    if (room.controller?.safeMode) {
      dangerByRoom[room.name] = [];
      return dangerByRoom[room.name];
    }
    const positions: RoomPosition[] = [];
    for (const c of room.find(FIND_HOSTILE_CREEPS)) {
      if (c.getActiveBodyparts(ATTACK) > 0 || c.getActiveBodyparts(RANGED_ATTACK) > 0) {
        positions.push(c.pos);
      }
    }
    for (const s of room.find(FIND_STRUCTURES)) {
      if (s.structureType === STRUCTURE_KEEPER_LAIR) positions.push(s.pos);
    }
    dangerByRoom[room.name] = positions;
  }
  return dangerByRoom[room.name];
}

export function isPositionSafe(room: Room, pos: RoomPosition): boolean {
  const dangers = getDangerPositions(room);
  if (dangers.length === 0) return true;
  for (const d of dangers) {
    if (pos.getRangeTo(d) <= SOURCE_DANGER_RANGE) return false;
  }
  return true;
}

export function isSourceSafe(source: Source): boolean {
  return isPositionSafe(source.room, source.pos);
}

let safeSourceTick = -1;
const safeSourceCache: Record<string, Source[]> = {};

export function getSafeSources(room: Room): Source[] {
  if (safeSourceTick !== Game.time) {
    safeSourceTick = Game.time;
    for (const k in safeSourceCache) delete safeSourceCache[k];
  }
  if (!safeSourceCache[room.name]) {
    const sources = getSources(room);
    const safe = sources.filter(isSourceSafe);
    safeSourceCache[room.name] = safe.length > 0 ? safe : sources;
  }
  return safeSourceCache[room.name];
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

  const links = getRoomStructures(creep.room).filter(
    (s): s is StructureLink =>
      s.structureType === STRUCTURE_LINK &&
      (s as StructureLink).store[RESOURCE_ENERGY] > 0
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

export function isCreepEmpty(creep: Creep): boolean {
  return creep.store[RESOURCE_ENERGY] === 0;
}

export function isCreepFull(creep: Creep): boolean {
  return creep.store.getFreeCapacity() === 0;
}

export function transferEnergyTo(creep: Creep, target: Structure): void {
  if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { reusePath: 5 });
  }
}

export function findClosestConstructionSite(
  creep: Creep
): ConstructionSite | null {
  const sites = creep.room.find(FIND_CONSTRUCTION_SITES) as ConstructionSite[];
  if (!sites || sites.length === 0) return null;

  const nonRoadSites = sites.filter((s) => s.structureType !== STRUCTURE_ROAD);
  if (nonRoadSites.length > 0) {
    return closestByPath(creep.pos, nonRoadSites) || null;
  }

  return closestByPath(creep.pos, sites) || null;
}

const SITE_BUILD_PRIORITY: Partial<Record<StructureConstant, number>> = {
  [STRUCTURE_SPAWN]: 0,
  [STRUCTURE_CONTAINER]: 1,
  [STRUCTURE_EXTENSION]: 2,
  [STRUCTURE_TOWER]: 3,
  [STRUCTURE_STORAGE]: 4,
  [STRUCTURE_TERMINAL]: 5,
  [STRUCTURE_LINK]: 6,
  [STRUCTURE_LAB]: 7,
  [STRUCTURE_FACTORY]: 8,
  [STRUCTURE_NUKER]: 9,
  [STRUCTURE_POWER_SPAWN]: 9,
  [STRUCTURE_OBSERVER]: 9,
  [STRUCTURE_RAMPART]: 10,
  [STRUCTURE_ROAD]: 11,
};

const SOURCE_CONTAINER_PRIORITY = 1;
const CONTROLLER_CONTAINER_PRIORITY = 4;
const MINERAL_CONTAINER_PRIORITY = 12;

function sitePriority(s: ConstructionSite): number {
  if (s.structureType === STRUCTURE_CONTAINER) {
    if (s.pos.findInRange(FIND_SOURCES, 1).length > 0) return SOURCE_CONTAINER_PRIORITY;
    if (s.pos.findInRange(FIND_MINERALS, 1).length > 0) return MINERAL_CONTAINER_PRIORITY;
    return CONTROLLER_CONTAINER_PRIORITY;
  }
  return SITE_BUILD_PRIORITY[s.structureType] ?? 11;
}

function isHigherBuildPriority(a: ConstructionSite, b: ConstructionSite): boolean {
  const pa = sitePriority(a);
  const pb = sitePriority(b);
  if (pa !== pb) return pa < pb;
  const ra = a.progress / a.progressTotal;
  const rb = b.progress / b.progressTotal;
  if (ra !== rb) return ra > rb;
  return a.id < b.id;
}

let buildTargetTick = -1;
const buildTargetByRoom: Record<string, Id<ConstructionSite> | null> = {};

export function isEnergyEmergency(room: Room): boolean {
  const cap = room.energyCapacityAvailable;
  if (cap === 0) return false;
  if (!room.storage) return room.energyAvailable / cap < 0.25;
  return room.energyAvailable / cap < 0.25 && room.storage.store[RESOURCE_ENERGY] < 50000;
}

export function getRoomBuildTarget(room: Room): ConstructionSite | null {
  if (buildTargetTick !== Game.time) {
    buildTargetTick = Game.time;
    for (const k of Object.keys(buildTargetByRoom)) delete buildTargetByRoom[k];
  }
  if (buildTargetByRoom[room.name] === undefined) {
    let best: ConstructionSite | null = null;
    for (const s of room.find(FIND_MY_CONSTRUCTION_SITES) as ConstructionSite[]) {
      if (!isPositionSafe(room, s.pos)) continue;
      if (!best || isHigherBuildPriority(s, best)) best = s;
    }
    buildTargetByRoom[room.name] = best ? best.id : null;
  }
  const id = buildTargetByRoom[room.name];
  return id ? Game.getObjectById(id) : null;
}

const RAMPART_TARGET_HP: Record<number, number> = {
  2:        10_000,
  3:        20_000,
  4:        50_000,
  5:       100_000,
  6:       300_000,
  7:     1_000_000,
  8:    10_000_000,
};

export function getRampartTargetHP(rcl: number): number {
  return RAMPART_TARGET_HP[Math.min(8, Math.max(2, rcl))] ?? 10_000;
}

function isDamaged(s: AnyStructure): boolean {
  return s.hits < s.hitsMax;
}

function decayRescueFloor(s: AnyStructure): number {
  switch (s.structureType) {
    case STRUCTURE_RAMPART:
      return 2000;
    case STRUCTURE_ROAD:
      return s.hitsMax * 0.35;
    case STRUCTURE_CONTAINER:
      return s.hitsMax * 0.1;
    default:
      return 0;
  }
}

export function findClosestRepairTarget(creep: Creep): AnyStructure | null {
  const repairTargets = getRoomStructures(creep.room).filter(
    (s): s is AnyStructure =>
      s.structureType !== STRUCTURE_WALL &&
      s.structureType !== STRUCTURE_RAMPART &&
      isDamaged(s)
  );
  if (repairTargets.length === 0) return null;
  return closestByPath(creep.pos, repairTargets) || null;
}

export function findClosestDamagedRampart(
  creep: Creep
): StructureRampart | null {
  const ramparts = getRoomStructures(creep.room).filter(
    (s): s is StructureRampart =>
      s.structureType === STRUCTURE_RAMPART && isDamaged(s)
  );
  if (ramparts.length === 0) return null;
  return closestByPath(creep.pos, ramparts) || null;
}

const CRITICAL_DEFENSE_HITS = 1000;

const BREACH_DANGER_FLOOR = 50_000;

const TOWER_DEFENSE_REPAIR_FLOOR = 300_000;

export function findCriticalDefenseTarget(creep: Creep): AnyStructure | null {
  const critical = getRoomStructures(creep.room).filter(
    (s): s is AnyStructure =>
      (s.structureType === STRUCTURE_RAMPART || s.structureType === STRUCTURE_WALL) &&
      s.hits < CRITICAL_DEFENSE_HITS
  );
  if (critical.length === 0) return null;
  return closestByPath(creep.pos, critical) || null;
}

export function getNukeRampartTarget(room: Room): StructureRampart | null {
  const def = room.memory.nukeDefense;
  if (!def) return null;
  let worst: StructureRampart | null = null;
  let worstDeficit = 0;
  for (const key in def.tiles) {
    const required = def.tiles[key];
    const [x, y] = key.split(",").map(Number);
    const rampart = room
      .lookForAt(LOOK_STRUCTURES, x, y)
      .find((s) => s.structureType === STRUCTURE_RAMPART) as StructureRampart | undefined;
    if (!rampart) continue;
    const deficit = required - rampart.hits;
    if (deficit > worstDeficit) {
      worstDeficit = deficit;
      worst = rampart;
    }
  }
  return worst;
}

export function findMostCriticalRepairTarget(
  creep: Creep
): AnyStructure | null {
  const nukeTarget = getNukeRampartTarget(creep.room);
  if (nukeTarget) return nukeTarget;

  if (criticalRepairCacheTick !== Game.time) {
    criticalRepairCacheTick = Game.time;
    for (const k in criticalRepairByRoom) delete criticalRepairByRoom[k];
  }
  const rn = creep.room.name;
  if (rn in criticalRepairByRoom) return criticalRepairByRoom[rn];

  const rcl = creep.room.controller?.level ?? 0;
  const wallTarget = getRampartTargetHP(rcl);

  const structures = getRoomStructures(creep.room);

  const dying = structures.filter(
    (st): st is AnyStructure => {
      const floor = decayRescueFloor(st);
      return floor > 0 && st.hits < floor;
    }
  );
  if (dying.length > 0) {
    const result = dying.reduce((a, b) => (a.hits < b.hits ? a : b));
    criticalRepairByRoom[rn] = result;
    return result;
  }

  const barrierDanger = Math.min(BREACH_DANGER_FLOOR, wallTarget * 0.5);
  const criticalBarriers = structures.filter(
    (st): st is AnyStructure =>
      (st.structureType === STRUCTURE_WALL || st.structureType === STRUCTURE_RAMPART) &&
      st.hits < barrierDanger
  );
  if (criticalBarriers.length > 0) {
    const result = criticalBarriers.reduce((a, b) => (a.hits < b.hits ? a : b));
    criticalRepairByRoom[rn] = result;
    return result;
  }

  const nonDefensive = structures.filter(
    (st): st is AnyStructure =>
      st.structureType !== STRUCTURE_WALL &&
      st.structureType !== STRUCTURE_RAMPART &&
      st.hits < st.hitsMax * 0.8
  );
  if (nonDefensive.length > 0) {
    const isRoad = (st: AnyStructure) => st.structureType === STRUCTURE_ROAD;
    const lowestFraction = (a: AnyStructure, b: AnyStructure) =>
      a.hits / a.hitsMax < b.hits / b.hitsMax ? a : b;
    const nonRoad = nonDefensive.filter((st) => !isRoad(st));
    const tier = nonRoad.length > 0 ? nonRoad : nonDefensive;
    const result = tier.reduce(lowestFraction);
    criticalRepairByRoom[rn] = result;
    return result;
  }

  const belowTarget = structures.filter(
    (st): st is AnyStructure =>
      (st.structureType === STRUCTURE_WALL || st.structureType === STRUCTURE_RAMPART) &&
      st.hits < wallTarget
  );
  const result = belowTarget.length > 0
    ? belowTarget.reduce((a, b) => (a.hits < b.hits ? a : b))
    : null;

  criticalRepairByRoom[rn] = result;
  return result;
}

export function findTowerRepairTarget(room: Room): AnyStructure | null {
  const nukeTarget = getNukeRampartTarget(room);
  if (nukeTarget) return nukeTarget;

  if (towerRepairCacheTick !== Game.time) {
    towerRepairCacheTick = Game.time;
    for (const k in towerRepairByRoom) delete towerRepairByRoom[k];
  }
  if (room.name in towerRepairByRoom) return towerRepairByRoom[room.name];

  const rcl = room.controller?.level ?? 0;
  const towerWallThreshold = Math.min(50_000, Math.max(5_000, getRampartTargetHP(rcl) * 0.05));

  const candidates = getRoomStructures(room).filter((st): st is AnyStructure => {
    if (st.structureType === STRUCTURE_RAMPART || st.structureType === STRUCTURE_WALL) {
      return st.hits < towerWallThreshold;
    }
    return st.hits < st.hitsMax * 0.4;
  });
  const result = candidates.length === 0
    ? null
    : candidates.reduce((a, b) => (a.hits < b.hits ? a : b));
  towerRepairByRoom[room.name] = result;
  return result;
}

export function findTowerDefenseRepairTarget(
  room: Room
): StructureRampart | StructureWall | null {
  const rcl = room.controller?.level ?? 0;
  const floor = Math.min(TOWER_DEFENSE_REPAIR_FLOOR, getRampartTargetHP(rcl));
  let worst: StructureRampart | StructureWall | null = null;
  for (const s of getRoomStructures(room)) {
    if (s.structureType !== STRUCTURE_RAMPART && s.structureType !== STRUCTURE_WALL) continue;
    if (s.hits >= floor) continue;
    if (!worst || s.hits < worst.hits) worst = s as StructureRampart | StructureWall;
  }
  return worst;
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

export function getMinerContainerIds(room: Room): Id<StructureContainer>[] {
  if (room.memory.minerContainerIds?.length) {
    return room.memory.minerContainerIds;
  }

  const sources = getSources(room);
  const containers = getRoomContainers(room);
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

export function findCoreFillTarget(creep: Creep): AnyStoreStructure | null {
  const targets = getRoomStructures(creep.room).filter(
    (s): s is AnyStoreStructure =>
      (s.structureType === STRUCTURE_SPAWN ||
        s.structureType === STRUCTURE_EXTENSION ||
        s.structureType === STRUCTURE_TOWER) &&
      "store" in s &&
      (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > 0
  );
  if (targets.length === 0) return null;
  return (creep.pos.findClosestByPath(targets, { ignoreCreeps: true }) as AnyStoreStructure | null) ?? null;
}

export function upgradeController(creep: Creep): void {
  const controller = creep.room.controller;
  if (!controller) return;

  if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
    creep.moveTo(controller, { reusePath: 50 });
    return;
  }

  signControllerIfNeeded(creep, controller);
}

const SIGN_RECHECK_INTERVAL = 5000;

export function signControllerIfNeeded(
  creep: Creep,
  controller: StructureController
): boolean {
  const lastSigned = creep.room.memory.lastSigned;
  if (lastSigned !== undefined && Game.time - lastSigned < SIGN_RECHECK_INTERVAL) return false;

  const desiredSignature = pickSignature(creep.room.name);

  const currentSign = controller.sign;

  if (currentSign?.username === "Screeps") return false;

  const myUsername = controller.owner?.username;
  const needsSign =
    !currentSign ||
    currentSign.username !== myUsername ||
    currentSign.text !== desiredSignature;
  if (!needsSign) return false;

  if (creep.pos.getRangeTo(controller.pos) > 1) {
    creep.moveTo(controller, { range: 1, reusePath: 5 });
    return true;
  }

  creep.signController(controller, desiredSignature);
  creep.room.memory.lastSigned = Game.time;
  return true;
}

export function buildAtConstructionSite(
  creep: Creep,
  site: ConstructionSite
): number {
  const res = creep.build(site);
  if (res === ERR_NOT_IN_RANGE) return creep.moveTo(site, { reusePath: 50 });
  return res;
}

export function repairStructure(creep: Creep, target: AnyStructure): number {
  const res = creep.repair(target);
  if (res === ERR_NOT_IN_RANGE) return creep.moveTo(target, { reusePath: 50 });
  return res;
}

export function putSurplusEnergyToWork(creep: Creep): void {
  const site = getRoomBuildTarget(creep.room);
  if (site) {
    buildAtConstructionSite(creep, site);
    return;
  }

  const repairTarget = findClosestRepairTarget(creep);
  if (repairTarget) {
    repairStructure(creep, repairTarget);
    return;
  }

  upgradeController(creep);
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
  const sources = getSafeSources(room);
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
  const minerIds = new Set(getMinerContainerIds(room).map((id) => id.toString()));
  if (minerIds.size === 0) return null;
  const containers = getRoomContainers(room).filter((c) => minerIds.has(c.id.toString()));
  const takenContainerIds = getAssignedContainerIdsByRole(room, ROLE_HAULER);
  for (const container of containers) {
    if (!takenContainerIds.has(container.id)) {
      takenContainerIds.add(container.id);
      return container;
    }
  }
  return null;
}

const REMOTE_INVADER_WINDOW = 1500;
const REMOTE_PLAYER_WINDOW = 2000;
const REMOTE_PLAYER_WINDOW_MAX = 20000;

function assignedRemoteEntry(creep: Creep): RemoteRoomData | undefined {
  const home = creep.memory.homeRoom;
  const target = creep.memory.targetRoom;
  if (!home || !target) return undefined;
  return Memory.rooms[home]?.remoteRooms?.find((r) => r.roomName === target);
}

export function isAssignedRemoteContested(creep: Creep): boolean {
  const entry = assignedRemoteEntry(creep);
  if (!entry) return false;
  if (entry.hostile) return true;
  return entry.invaderUntil !== undefined && entry.invaderUntil > Game.time;
}

export function flagRemoteInvader(creep: Creep): void {
  const entry = assignedRemoteEntry(creep);
  if (entry) entry.invaderUntil = Game.time + REMOTE_INVADER_WINDOW;
}

export function flagRemotePlayer(creep: Creep): void {
  const entry = assignedRemoteEntry(creep);
  if (entry) markRemotePlayerHostile(entry);
}

export function markRemotePlayerHostile(entry: RemoteRoomData): void {
  const avoided =
    entry.hostile && entry.hostileUntil !== undefined && entry.hostileUntil > Game.time;
  if (!avoided) entry.hostileStrikes = (entry.hostileStrikes ?? 0) + 1;
  const window = Math.min(
    REMOTE_PLAYER_WINDOW * 2 ** ((entry.hostileStrikes ?? 1) - 1),
    REMOTE_PLAYER_WINDOW_MAX
  );
  entry.hostile = true;
  entry.hostileUntil = Game.time + window;
}

export function clearRemotePlayerHostile(entry: RemoteRoomData): void {
  entry.hostile = false;
  entry.hostileUntil = undefined;
  entry.hostileStrikes = 0;
}

export function clearRemoteInvader(creep: Creep): void {
  const entry = assignedRemoteEntry(creep);
  if (entry && entry.invaderUntil !== undefined) entry.invaderUntil = undefined;
}
