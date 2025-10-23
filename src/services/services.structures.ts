import {
  STRUCTURE_PLANNER,
  PLANNER_KEYS,
  TOWER_COUNT_PER_RCL,
  TOWER_DISTRIBUTION_MODE,
  TOWER_PRIMARY_SPAWN_MEMORY_KEY,
} from "../config/config.structures";

function isWalkable(room: Room, x: number, y: number): boolean {
  const look = room.getTerrain().get(x, y);
  return look !== TERRAIN_MASK_WALL;
}

function isBuildableTile(room: Room, x: number, y: number): boolean {
  if (x < 0 || x >= 50 || y < 0 || y >= 50) return false;
  if (!isWalkable(room, x, y)) return false;
  const structures = room.lookForAt(LOOK_STRUCTURES, x, y);
  if (structures.length > 0) return false;
  const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y);
  if (sites.length > 0) return false;
  return true;
}

export function planSourceContainer(
  room: Room,
  source: Source
): RoomPosition | null {
  const offset = STRUCTURE_PLANNER.containerOffset;
  const existing = source.pos.findInRange(FIND_STRUCTURES, offset, {
    filter: (s) => s.structureType === STRUCTURE_CONTAINER,
  });
  if (existing.length > 0) return null;

  const spawns = room.find(FIND_MY_SPAWNS) as StructureSpawn[];
  if (spawns.length > 0) {
    let bestResult: { path: PathStep[] } | null = null;
    for (const s of spawns) {
      const res = PathFinder.search(
        s.pos,
        { pos: source.pos, range: 0 },
        {
          plainCost: 2,
          swampCost: 10,
          maxOps: 2000,
        }
      );
      if (
        !bestResult ||
        (res.path && res.path.length < bestResult.path.length)
      ) {
        bestResult = res as any;
      }
    }

    if (bestResult && bestResult.path && bestResult.path.length > 0) {
      for (let i = bestResult.path.length - 1; i >= 0; i--) {
        const step = bestResult.path[i];
        for (let dx = -offset; dx <= offset; dx++) {
          for (let dy = -offset; dy <= offset; dy++) {
            if (dx === 0 && dy === 0) continue;
            const x = step.x + dx;
            const y = step.y + dy;
            const distX = Math.abs(x - source.pos.x);
            const distY = Math.abs(y - source.pos.y);
            if (distX > offset || distY > offset) continue;
            if (isBuildableTile(room, x, y))
              return new RoomPosition(x, y, room.name);
          }
        }
      }
    }
  }

  for (let dx = -offset; dx <= offset; dx++) {
    for (let dy = -offset; dy <= offset; dy++) {
      if (dx === 0 && dy === 0) continue;
      const x = source.pos.x + dx;
      const y = source.pos.y + dy;
      if (isBuildableTile(room, x, y)) return new RoomPosition(x, y, room.name);
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
        // ensure no container exists or is planned nearby to avoid duplicates
        const structures = room.lookForAt(LOOK_STRUCTURES, x, y) as Structure[];
        const sites = room.lookForAt(
          LOOK_CONSTRUCTION_SITES,
          x,
          y
        ) as ConstructionSite[];
        const hasContainer = structures.some(
          (s) => s.structureType === STRUCTURE_CONTAINER
        );
        const hasContainerSite = sites.some(
          (s) => s.structureType === STRUCTURE_CONTAINER
        );
        if (!hasContainer && !hasContainerSite)
          return new RoomPosition(x, y, room.name);
      }
    }
  }
  return null;
}

export function planMineralContainer(
  room: Room,
  mineral: Mineral
): RoomPosition | null {
  const offset = STRUCTURE_PLANNER.containerOffset;
  // if any container exists within offset of mineral, don't plan
  const existing = mineral.pos.findInRange(FIND_STRUCTURES, offset, {
    filter: (s) => s.structureType === STRUCTURE_CONTAINER,
  });
  if (existing.length > 0) return null;

  // try to find a tile adjacent to the mineral that is buildable
  for (let dx = -offset; dx <= offset; dx++) {
    for (let dy = -offset; dy <= offset; dy++) {
      if (dx === 0 && dy === 0) continue;
      const x = mineral.pos.x + dx;
      const y = mineral.pos.y + dy;
      if (isBuildableTile(room, x, y)) return new RoomPosition(x, y, room.name);
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
  positions.forEach((pos) => {
    const structs = pos.lookFor(LOOK_STRUCTURES) as Structure[];
    const onTopAllowed = (STRUCTURE_PLANNER.rampartOnTopFor || []).some((t) =>
      structs.some((s) => s.structureType === t)
    );
    if (!onTopAllowed) return;
    const existing = room.lookForAt(
      LOOK_STRUCTURES,
      pos.x,
      pos.y
    ) as Structure[];
    const hasRampart = existing.some(
      (s) => s.structureType === STRUCTURE_RAMPART
    );
    if (!hasRampart && isWalkable(room, pos.x, pos.y)) {
      result.push(new RoomPosition(pos.x, pos.y, room.name));
    }
  });
  return result;
}

export function planExtensionPositions(room: Room, spawn: StructureSpawn) {
  const out: RoomPosition[] = [];
  const pref = (STRUCTURE_PLANNER as any).extensionOffsetsFromSpawn || [];
  let maxPerSpawn = (STRUCTURE_PLANNER as any).maxExtensionsPerSpawn || 10;
  const extensionsPerRCL: Record<number, number> = {
    0: 0,
    1: 0,
    2: 5,
    3: 10,
    4: 20,
    5: 30,
    6: 40,
    7: 50,
    8: 60,
  };
  const rcl = room.controller ? room.controller.level : 0;
  const allowed = extensionsPerRCL[rcl] || maxPerSpawn;
  const existingExtensions = room.find(FIND_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_EXTENSION,
  }).length;
  maxPerSpawn = Math.max(
    0,
    Math.min(maxPerSpawn, allowed - existingExtensions)
  );

  const minDist = (STRUCTURE_PLANNER as any).extensionMinDistanceFromSpawn || 0;

  for (const off of pref) {
    if (out.length >= maxPerSpawn) break;
    const x = spawn.pos.x + off.x;
    const y = spawn.pos.y + off.y;
    const cheb = Math.max(Math.abs(x - spawn.pos.x), Math.abs(y - spawn.pos.y));
    if (cheb < minDist) continue;
    if (x < 0 || x >= 50 || y < 0 || y >= 50) continue;
    if (!isBuildableTile(room, x, y)) continue;
    if (plannedRoadOrConnectorAt(room, x, y)) continue;
    if (plannedNonRoadStructureAt(room, x, y)) continue;
    out.push(new RoomPosition(x, y, room.name));
  }

  const radius = (STRUCTURE_PLANNER as any).extensionSearchRadius || 6;

  if (out.length < maxPerSpawn && (STRUCTURE_PLANNER as any).extensionUseRing) {
    const ringR = (STRUCTURE_PLANNER as any).extensionRingRadius || 2;
    const ringPositions: RoomPosition[] = [];
    for (let dx = -ringR; dx <= ringR; dx++) {
      for (let dy = -ringR; dy <= ringR; dy++) {
        if (Math.abs(dx) !== ringR && Math.abs(dy) !== ringR) continue;
        const x = spawn.pos.x + dx;
        const y = spawn.pos.y + dy;
        const cheb = Math.max(
          Math.abs(x - spawn.pos.x),
          Math.abs(y - spawn.pos.y)
        );
        if (cheb < minDist) continue;
        if (x < 0 || x >= 50 || y < 0 || y >= 50) continue;
        if (!isBuildableTile(room, x, y)) continue;
        if (plannedRoadOrConnectorAt(room, x, y)) continue;
        if (plannedNonRoadStructureAt(room, x, y)) continue;
        if (out.some((p) => p.x === x && p.y === y)) continue;
        ringPositions.push(new RoomPosition(x, y, room.name));
      }
    }
    let ringIndex = 0;
    while (out.length < maxPerSpawn && ringIndex < ringPositions.length) {
      out.push(ringPositions[ringIndex++]);
    }
    if (out.length < maxPerSpawn) {
      for (let r = ringR + 1; r <= radius; r++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            if (out.length >= maxPerSpawn) break;
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            const x = spawn.pos.x + dx;
            const y = spawn.pos.y + dy;
            const cheb = Math.max(
              Math.abs(x - spawn.pos.x),
              Math.abs(y - spawn.pos.y)
            );
            if (cheb < minDist) continue;
            if (x < 0 || x >= 50 || y < 0 || y >= 50) continue;
            if (!isBuildableTile(room, x, y)) continue;
            if (plannedRoadOrConnectorAt(room, x, y)) continue;
            if (plannedNonRoadStructureAt(room, x, y)) continue;
            if (out.some((p) => p.x === x && p.y === y)) continue;
            out.push(new RoomPosition(x, y, room.name));
          }
          if (out.length >= maxPerSpawn) break;
        }
        if (out.length >= maxPerSpawn) break;
      }
    }
  }

  if (out.length < maxPerSpawn) {
    const candidates: RoomPosition[] = [];
    for (let r = 1; r <= radius; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const x = spawn.pos.x + dx;
          const y = spawn.pos.y + dy;
          const cheb = Math.max(
            Math.abs(x - spawn.pos.x),
            Math.abs(y - spawn.pos.y)
          );
          if (cheb < minDist) continue;
          if (x < 0 || x >= 50 || y < 0 || y >= 50) continue;
          if (!isBuildableTile(room, x, y)) continue;
          if (plannedRoadOrConnectorAt(room, x, y)) continue;
          if (out.some((p) => p.x === x && p.y === y)) continue;
          candidates.push(new RoomPosition(x, y, room.name));
        }
      }
    }
    candidates.sort(
      (a, b) =>
        Math.abs(a.x - spawn.pos.x) +
        Math.abs(a.y - spawn.pos.y) -
        (Math.abs(b.x - spawn.pos.x) + Math.abs(b.y - spawn.pos.y))
    );
    for (const c of candidates) {
      if (out.length >= maxPerSpawn) break;
      out.push(c);
    }
  }

  const entrances = (STRUCTURE_PLANNER as any).extensionRingEntrances || 2;
  if (out.length > entrances) {
    const removeCount = Math.min(entrances, out.length - 1);
    const roadTiles = getAllPlannedRoadTiles(room);
    const roadSet = new Set(roadTiles.map((p) => `${p.x},${p.y}`));
    const candidates: number[] = [];
    for (let i = 0; i < out.length; i++) {
      const p = out[i];
      const neigh = [
        `${p.x + 1},${p.y}`,
        `${p.x - 1},${p.y}`,
        `${p.x},${p.y + 1}`,
        `${p.x},${p.y - 1}`,
      ];
      if (neigh.some((n) => roadSet.has(n))) candidates.push(i);
    }
    const removeIndices = new Set<number>();
    for (
      let i = 0;
      i < candidates.length && removeIndices.size < removeCount;
      i++
    )
      removeIndices.add(candidates[i]);
    if (removeIndices.size < removeCount) {
      const need = removeCount - removeIndices.size;
      for (let k = 0; k < need; k++) {
        const idx = Math.floor(((k + 0.5) * out.length) / need);
        let chosen = idx;
        let attempts = 0;
        while (removeIndices.has(chosen) && attempts < out.length) {
          chosen = (chosen + 1) % out.length;
          attempts++;
        }
        if (!removeIndices.has(chosen)) removeIndices.add(chosen);
      }
    }
    if (removeIndices.size > 0) {
      const pruned: RoomPosition[] = [];
      for (let i = 0; i < out.length; i++)
        if (!removeIndices.has(i)) pruned.push(out[i]);
      if (pruned.length > 0) out.splice(0, out.length, ...pruned);
    }
  }

  return out;
}

export function planTowerPositions(
  room: Room,
  spawn: StructureSpawn
): RoomPosition[] {
  const out: RoomPosition[] = [];
  const pref = STRUCTURE_PLANNER.towerOffsetsFromSpawn;
  const level = room.controller ? room.controller.level : 0;
  const totalAllowed = TOWER_COUNT_PER_RCL[level] || 0;

  if (totalAllowed <= 0) return out;

  const spawns = room.find(FIND_MY_SPAWNS) as StructureSpawn[];
  let allowedForThisSpawn = totalAllowed;
  if (spawns.length > 0) {
    if (TOWER_DISTRIBUTION_MODE === "even") {
      const sorted = spawns.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
      const idx = sorted.findIndex((s) => s.id === spawn.id);
      const base = Math.floor(totalAllowed / spawns.length);
      const rem = totalAllowed % spawns.length;
      allowedForThisSpawn = base + (idx >= 0 && idx < rem ? 1 : 0);
    } else if (TOWER_DISTRIBUTION_MODE === "primary") {
      const primaryId = (room as any).memory?.[TOWER_PRIMARY_SPAWN_MEMORY_KEY];
      if (primaryId && primaryId === spawn.id) {
        allowedForThisSpawn = totalAllowed;
      } else {
        allowedForThisSpawn = 0;
      }
    }
  }

  for (const off of pref) {
    if (out.length >= allowedForThisSpawn) break;
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
  if (!mem[type]) {
    mem[type] = [];
    const meta =
      (room as any).memory.plannedStructuresMeta ||
      ((room as any).memory.plannedStructuresMeta = {});
    if (!meta[type]) meta[type] = { createdAt: Game.time } as any;
  }
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

export function planRoadsAroundStructures(room: Room) {
  const roadKey = `${PLANNER_KEYS.ROAD_PREFIX}around`;
  if (!room.memory.plannedStructures) return;
  const mem = room.memory.plannedStructures as Record<string, string[]>;
  for (const key of Object.keys(mem)) {
    if (key.startsWith(PLANNER_KEYS.ROAD_PREFIX)) continue;
    if (key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX)) continue;
    if (key.startsWith(PLANNER_KEYS.EXTENSIONS_PREFIX)) continue;

    const positions = plannedPositionsFromMemory(room, key);
    for (const s of positions) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const x = s.x + dx;
          const y = s.y + dy;
          if (x < 0 || x >= 50 || y < 0 || y >= 50) continue;
          if (!isBuildableTile(room, x, y)) continue;
          if (plannedRoadOrConnectorAt(room, x, y)) continue;
          let neighborHasRoad = false;
          for (let nx = -1; nx <= 1 && !neighborHasRoad; nx++) {
            for (let ny = -1; ny <= 1; ny++) {
              if (nx === 0 && ny === 0) continue;
              const checkX = x + nx;
              const checkY = y + ny;
              if (checkX < 0 || checkX >= 50 || checkY < 0 || checkY >= 50)
                continue;
              if (plannedRoadOrConnectorAt(room, checkX, checkY)) {
                neighborHasRoad = true;
                break;
              }
              const existing = room.lookForAt(
                LOOK_STRUCTURES,
                checkX,
                checkY
              ) as Structure[];
              if (existing.some((es) => es.structureType === STRUCTURE_ROAD)) {
                neighborHasRoad = true;
                break;
              }
            }
          }
          if (neighborHasRoad) continue;
          if (plannedNonRoadStructureAt(room, x, y)) continue;
          addPlannedStructureToMemory(
            room,
            roadKey,
            new RoomPosition(x, y, room.name)
          );
        }
      }
    }
  }
}

export function pruneRoadsUnderStructures(room: Room) {
  if (!room.memory.plannedStructures) return;
  const mem = room.memory.plannedStructures as Record<string, string[]>;
  const roadKeys = Object.keys(mem).filter(
    (k) =>
      k.startsWith(PLANNER_KEYS.ROAD_PREFIX) ||
      k.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX)
  );

  for (const key of roadKeys) {
    const arr = mem[key] || [];
    const keep: string[] = [];
    for (const posStr of arr) {
      const [px, py] = posStr.split(",").map(Number);
      const structs = room.lookForAt(LOOK_STRUCTURES, px, py) as Structure[];
      const nonRoadExists = structs.some(
        (s) => s.structureType !== STRUCTURE_ROAD
      );
      if (nonRoadExists) {
        for (const s of structs) {
          if (s.structureType === STRUCTURE_ROAD) {
            try {
              (s as any).destroy();
            } catch (e) {}
          }
        }
        continue;
      }
      keep.push(posStr);
    }
    mem[key] = keep;
  }
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

function plannedRoadOrConnectorAt(room: Room, x: number, y: number): boolean {
  if (!room.memory.plannedStructures) return false;
  const mem = room.memory.plannedStructures as Record<string, string[]>;
  for (const key of Object.keys(mem)) {
    if (
      !key.startsWith(PLANNER_KEYS.ROAD_PREFIX) &&
      !key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX)
    )
      continue;
    for (const p of mem[key]) {
      const [px, py] = p.split(",").map(Number);
      if (px === x && py === y) return true;
    }
  }
  return false;
}

function plannedNonRoadStructureAt(room: Room, x: number, y: number): boolean {
  if (!room.memory.plannedStructures) return false;
  const mem = room.memory.plannedStructures as Record<string, string[]>;
  for (const key of Object.keys(mem)) {
    if (
      key.startsWith(PLANNER_KEYS.ROAD_PREFIX) ||
      key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX)
    )
      continue;
    for (const p of mem[key]) {
      const [px, py] = p.split(",").map(Number);
      if (px === x && py === y) return true;
    }
  }
  return false;
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

/**
 * Cleanup duplicate or stale planned entries for a single room.
 * - If multiple positions exist for container/controller/source/mineral keys,
 *   keep any position that already has a structure there, otherwise keep the first.
 * - Remove planned road/connector tiles that sit under non-road structures (already handled elsewhere),
 *   and trim any entries that reference invalid coords.
 */

/**
 * Global cleanup run invoked from orchestrator. It will:
 * - cleanup the visible room's plannedStructures (dedupe/prune)
 * - optionally prune plannedStructures for unseen rooms older than configured age
 */

function structureTypeForKey(key: string): StructureConstant | null {
  if (key.startsWith(PLANNER_KEYS.CONTAINER_PREFIX)) return STRUCTURE_CONTAINER;
  if (key.startsWith(PLANNER_KEYS.EXTENSIONS_PREFIX))
    return STRUCTURE_EXTENSION;
  if (key.startsWith(PLANNER_KEYS.ROAD_PREFIX)) return STRUCTURE_ROAD;
  if (key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX)) return STRUCTURE_ROAD;
  if (key.startsWith(PLANNER_KEYS.TOWERS_PREFIX)) return STRUCTURE_TOWER;
  if (key === PLANNER_KEYS.RAMPARTS_KEY) return STRUCTURE_RAMPART;
  if (key === PLANNER_KEYS.CONTAINER_CONTROLLER) return STRUCTURE_CONTAINER;
  return null;
}

// orchestration-level functions moved to orchestrator
