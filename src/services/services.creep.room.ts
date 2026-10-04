import { ROLE_HAULER, ROLE_MINER } from "../config/config.roles";

let assignmentCacheTick = -1;

const assignedContainerIdsByRoomAndRole: Record<string, Set<string>> = {};

let roomStructuresCacheTick = -1;

const roomStructuresCache: Record<string, AnyStructure[]> = {};

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
      if (creep.memory.role !== role) continue;
      const assigned = creep.memory.assignedContainerId;
      if (assigned) taken.add(assigned.toString());
    }
    assignedContainerIdsByRoomAndRole[cacheKey] = taken;
  }

  return assignedContainerIdsByRoomAndRole[cacheKey];
}

export function closestByPath<T extends RoomObject>(
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

export function getRoomContainers(room: Room): StructureContainer[] {
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

export function getClosestSpawn(
  room: Room,
  pos: RoomPosition
): StructureSpawn | null {
  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return null;
  return closestByPath(pos, spawns);
}

export function getSources(room: Room): Source[] {
  // room.find is already cached per tick by the engine; the old Memory copy
  // only duplicated room.memory.sourceIds and kept a key for every room ever
  // visited. Drop it from existing saves.
  if (Memory.sources) delete Memory.sources;
  if (Memory.sourcesLastScan) delete Memory.sourcesLastScan;
  return room.find(FIND_SOURCES);
}

export function harvestFromSource(creep: Creep, source: Source): void {
  if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
    creep.moveTo(source, { reusePath: 50 });
  }
}

const SOURCE_DANGER_RANGE = 5;

let dangerTick = -1;

const dangerByRoom: Record<string, RoomPosition[]> = {};

export function getDangerPositions(room: Room): RoomPosition[] {
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

export function findContainersForSource(
  room: Room,
  source: Source
): StructureContainer[] {
  const containers = getRoomContainers(room);
  return containers.filter((container) => container.pos.getRangeTo(source.pos) <= 1);
}

export function countOpenTilesAround(room: Room, pos: RoomPosition): number {
  const terrain = room.getTerrain();
  let open = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const x = pos.x + dx;
      const y = pos.y + dy;
      if (x < 0 || x > 49 || y < 0 || y > 49) continue;
      if (terrain.get(x, y) !== TERRAIN_MASK_WALL) open++;
    }
  }
  return open;
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
  return findSharedMinerPost(room, sources);
}

// With every post taken, a miner joins the one whose miners dig least, so long
// as they dig less than its source gives and leave it a tile to dig from. A
// young keep's first miners are small, and one raised to help them found every
// post taken and stood idle behind them.
function findSharedMinerPost(
  room: Room,
  sources: Source[]
): { source: Source; container: StructureContainer } | null {
  const workAt: Record<string, number> = {};
  const minersAt: Record<string, number> = {};
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== room.name || creep.memory.role !== ROLE_MINER) continue;
    const post = creep.memory.assignedContainerId;
    if (!post) continue;
    workAt[post] = (workAt[post] ?? 0) + creep.body.filter((p) => p.type === WORK).length;
    minersAt[post] = (minersAt[post] ?? 0) + 1;
  }
  let best: { source: Source; container: StructureContainer } | null = null;
  let least = Infinity;
  for (const source of sources) {
    const full = Math.ceil(source.energyCapacity / ENERGY_REGEN_TIME / HARVEST_POWER);
    const seats = countOpenTilesAround(room, source.pos);
    for (const container of findContainersForSource(room, source)) {
      const work = workAt[container.id] ?? 0;
      if (work >= full || (minersAt[container.id] ?? 0) >= seats || work >= least) continue;
      least = work;
      best = { source, container };
    }
  }
  return best;
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
