import { STRUCTURE_PLANNER, PLANNER_KEYS } from "../config/config.structures";

function isWalkable(room: Room, x: number, y: number): boolean {
  const look = room.getTerrain().get(x, y);
  return look !== TERRAIN_MASK_WALL;
}

export function planSourceContainer(
  room: Room,
  source: Source
): RoomPosition | null {
  const offset = STRUCTURE_PLANNER.containerOffset;

  for (let dx = -offset; dx <= offset; dx++) {
    for (let dy = -offset; dy <= offset; dy++) {
      if (dx === 0 && dy === 0) continue;
      const x = source.pos.x + dx;
      const y = source.pos.y + dy;
      if (x < 0 || x >= 50 || y < 0 || y >= 50) continue;
      if (!isWalkable(room, x, y)) continue;
      const structures = room.lookForAt(LOOK_STRUCTURES, x, y);
      if (structures.length === 0) return new RoomPosition(x, y, room.name);
    }
  }
  return null;
}

export function planControllerContainer(
  room: Room,
  controller: StructureController
): RoomPosition | null {
  const offset = STRUCTURE_PLANNER.upgradeContainerOffset;
  for (let r = 1; r <= offset + 1; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = controller.pos.x + dx;
        const y = controller.pos.y + dy;
        if (x < 0 || x >= 50 || y < 0 || y >= 50) continue;
        if (!isWalkable(room, x, y)) continue;
        const structures = room.lookForAt(LOOK_STRUCTURES, x, y);
        if (structures.length === 0) return new RoomPosition(x, y, room.name);
      }
    }
  }
  return null;
}

export function planRoadsBetween(
  room: Room,
  fromPos: RoomPosition,
  toPos: RoomPosition
): RoomPosition[] {
  const ret: RoomPosition[] = [];
  const callback = (roomName: string): boolean | CostMatrix => {
    if (roomName !== room.name) return false;
    const costMatrix = new PathFinder.CostMatrix();
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        const terrain = room.getTerrain().get(x, y);
        if (terrain === TERRAIN_MASK_WALL) costMatrix.set(x, y, 255);
      }
    }
    const structures = room.find(FIND_STRUCTURES) as Structure[];
    for (const s of structures) {
      if (s.structureType === STRUCTURE_ROAD) {
        costMatrix.set(s.pos.x, s.pos.y, 1);
        continue;
      }
      costMatrix.set(s.pos.x, s.pos.y, 255);
    }
    if (room.memory.plannedStructures) {
      const mem = room.memory.plannedStructures as Record<string, string[]>;
      for (const key of Object.keys(mem)) {
        if (
          !(
            key.startsWith(PLANNER_KEYS.ROAD_PREFIX) ||
            key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX)
          )
        )
          continue;
        for (const p of mem[key]) {
          const [px, py] = p.split(",").map(Number);
          if (px >= 0 && px < 50 && py >= 0 && py < 50)
            costMatrix.set(px, py, 1);
        }
      }
    }
    return costMatrix;
  };

  const result = PathFinder.search(
    fromPos,
    { pos: toPos, range: 0 },
    {
      roomCallback: callback,
      plainCost: 2,
      swampCost: 10,
      maxOps: 2000,
    }
  );

  for (const step of result.path) {
    ret.push(new RoomPosition(step.x, step.y, room.name));
  }
  return ret;
}

export function planRampartsForStructures(
  room: Room,
  positions: RoomPosition[]
): RoomPosition[] {
  const result: RoomPosition[] = [];
  const pad = STRUCTURE_PLANNER.rampartPadding;
  positions.forEach((pos) => {
    for (let dx = -pad; dx <= pad; dx++) {
      for (let dy = -pad; dy <= pad; dy++) {
        const nx = pos.x + dx;
        const ny = pos.y + dy;
        if (nx < 0 || nx >= 50 || ny < 0 || ny >= 50) continue;
        if (!isWalkable(room, nx, ny)) continue;
        if (!result.find((p) => p.x === nx && p.y === ny)) {
          result.push(new RoomPosition(nx, ny, room.name));
        }
      }
    }
  });
  return result;
}

export function planTowerPositions(
  room: Room,
  spawn: StructureSpawn
): RoomPosition[] {
  const out: RoomPosition[] = [];
  const pref = STRUCTURE_PLANNER.towerOffsetsFromSpawn;
  for (const off of pref) {
    const x = spawn.pos.x + off.x;
    const y = spawn.pos.y + off.y;
    if (x < 0 || x >= 50 || y < 0 || y >= 50) continue;
    if (!isWalkable(room, x, y)) continue;
    out.push(new RoomPosition(x, y, room.name));
  }
  return out;
}

export function ensureMemoryRoomStructures(room: Room) {
  if (!room.memory.plannedStructures) room.memory.plannedStructures = {} as any;
}

export function addPlannedStructureToMemory(
  room: Room,
  type: string,
  pos: RoomPosition
) {
  ensureMemoryRoomStructures(room);
  const mem = room.memory.plannedStructures as Record<string, string[]>;
  if (!mem[type]) mem[type] = [];
  const key = `${pos.x},${pos.y}`;
  if (!mem[type].includes(key)) mem[type].push(key);
}

export function plannedPositionsFromMemory(
  room: Room,
  type: string
): RoomPosition[] {
  if (!room.memory.plannedStructures) return [];
  const mem = room.memory.plannedStructures as Record<string, string[]>;
  const arr = mem[type] || [];
  return arr.map((s) => {
    const [x, y] = s.split(",").map(Number);
    return new RoomPosition(x, y, room.name);
  });
}

function serializePositions(positions: RoomPosition[]): string[] {
  return positions.map((p) => `${p.x},${p.y}`);
}

function deserializePositions(room: Room, data: string[]): RoomPosition[] {
  return data.map((s) => {
    const [x, y] = s.split(",").map(Number);
    return new RoomPosition(x, y, room.name);
  });
}

export function getOrPlanRoad(
  room: Room,
  key: string,
  fromPos: RoomPosition,
  toPos: RoomPosition
): RoomPosition[] {
  ensureMemoryRoomStructures(room);
  const mem = room.memory.plannedStructures as Record<string, string[]>;
  if (mem[key] && mem[key].length > 0) {
    return deserializePositions(room, mem[key]);
  }
  const path = planRoadsBetween(room, fromPos, toPos);
  mem[key] = serializePositions(path);
  return path;
}

function getAllPlannedRoadTiles(room: Room): RoomPosition[] {
  if (!room.memory.plannedStructures) return [];
  const mem = room.memory.plannedStructures as Record<string, string[]>;
  const out: RoomPosition[] = [];
  for (const key of Object.keys(mem)) {
    if (
      !(
        key.startsWith(PLANNER_KEYS.ROAD_PREFIX) ||
        key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX)
      )
    )
      continue;
    out.push(...deserializePositions(room, mem[key]));
  }
  return out;
}

function clusterTiles(tiles: RoomPosition[]): RoomPosition[][] {
  const idxMap = new Map<string, number>();
  tiles.forEach((t, i) => idxMap.set(`${t.x},${t.y}`, i));
  const visited = new Array(tiles.length).fill(false);
  const clusters: RoomPosition[][] = [];
  for (let i = 0; i < tiles.length; i++) {
    if (visited[i]) continue;
    const stack = [i];
    const cluster: RoomPosition[] = [];
    visited[i] = true;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const p = tiles[cur];
      cluster.push(p);
      const neigh = [
        `${p.x + 1},${p.y}`,
        `${p.x - 1},${p.y}`,
        `${p.x},${p.y + 1}`,
        `${p.x},${p.y - 1}`,
      ];
      for (const n of neigh) {
        const j = idxMap.get(n);
        if (j !== undefined && !visited[j]) {
          visited[j] = true;
          stack.push(j);
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

export function connectRoadClusters(
  room: Room,
  maxConnectorLength = 32,
  maxConnectorsPerTick = 3,
  maxPassesPerTick = 1
) {
  if (!room.memory.plannedStructures) return;
  const mem = room.memory.plannedStructures as Record<string, string[]>;

  let createdThisTick = 0;
  let passes = 0;

  // Iteratively attempt to connect clusters but bound work per tick so we don't stall the runtime
  while (true) {
    if (createdThisTick >= maxConnectorsPerTick) return;
    if (passes >= maxPassesPerTick) return;
    passes++;

    const tiles = getAllPlannedRoadTiles(room);
    if (tiles.length === 0) return;
    const clusters = clusterTiles(tiles);
    if (clusters.length <= 1) return;

    let addedThisPass = false;
    for (let a = 0; a < clusters.length; a++) {
      for (let b = a + 1; b < clusters.length; b++) {
        // If we've reached the per-tick cap, stop now and resume next tick
        if (createdThisTick >= maxConnectorsPerTick) return;

        const ca = clusters[a];
        const cb = clusters[b];
        let best: { da: RoomPosition; db: RoomPosition; dist: number } | null =
          null;
        for (const pa of ca) {
          for (const pb of cb) {
            const d = Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y);
            if (best === null || d < best.dist)
              best = { da: pa, db: pb, dist: d };
          }
        }
        if (!best) continue;
        if (best.dist > maxConnectorLength) continue;
        const key = `${PLANNER_KEYS.CONNECTOR_PREFIX}${a}_${b}`;
        if (mem[key] && mem[key].length > 0) continue;
        getOrPlanRoad(room, key, best.da, best.db);
        createdThisTick++;
        addedThisPass = true;
      }
    }

    if (!addedThisPass) return;
  }
}

export function removePlannedStructureFromMemory(
  room: Room,
  type: string,
  pos: RoomPosition
) {
  if (!room.memory.plannedStructures) return;
  const mem = room.memory.plannedStructures as Record<string, string[]>;
  const arr = mem[type] || [];
  const key = `${pos.x},${pos.y}`;
  mem[type] = arr.filter((s) => s !== key);
}

function structureTypeForKey(key: string): StructureConstant | null {
  if (key.startsWith(PLANNER_KEYS.CONTAINER_PREFIX)) return STRUCTURE_CONTAINER;
  if (key.startsWith(PLANNER_KEYS.ROAD_PREFIX)) return STRUCTURE_ROAD;
  if (key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX)) return STRUCTURE_ROAD;
  if (key.startsWith(PLANNER_KEYS.TOWERS_PREFIX)) return STRUCTURE_TOWER;
  if (key === PLANNER_KEYS.RAMPARTS_KEY) return STRUCTURE_RAMPART;
  if (key === PLANNER_KEYS.CONTAINER_CONTROLLER) return STRUCTURE_CONTAINER;
  return null;
}

export function applyPlannedConstruction(room: Room) {
  if (!room.memory.plannedStructures) return;
  const mem = room.memory.plannedStructures as Record<string, string[]>;
  for (const key of Object.keys(mem)) {
    const type = structureTypeForKey(key);
    if (!type) continue;
    const positions = plannedPositionsFromMemory(room, key);
    for (const pos of positions) {
      const structs = room.lookForAt(
        LOOK_STRUCTURES,
        pos.x,
        pos.y
      ) as Structure[];
      if (structs.some((s) => s.structureType === type)) {
        removePlannedStructureFromMemory(room, key, pos);
        continue;
      }
      const sites = room.lookForAt(
        LOOK_CONSTRUCTION_SITES,
        pos.x,
        pos.y
      ) as ConstructionSite[];
      if (sites.some((s) => s.structureType === type)) continue;
      const res = room.createConstructionSite(
        pos.x,
        pos.y,
        type as BuildableStructureConstant
      );
      if (res === OK) {
      } else if (
        res === ERR_INVALID_TARGET ||
        res === ERR_FULL ||
        res === ERR_RCL_NOT_ENOUGH
      ) {
      }
    }
  }
}
