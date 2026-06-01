import {
  STRUCTURE_PLANNER,
  PLANNER_KEYS,
  TOWER_COUNT_PER_RCL,
  TOWER_DISTRIBUTION_MODE,
  TOWER_PRIMARY_SPAWN_MEMORY_KEY,
  MU_TOWN_NAMES,
} from "../config/config.structures";

// Roman-numeral suffixes for the 2nd/3rd/... spawn sharing one room's town name.
const SPAWN_SUFFIXES = ["", "-II", "-III", "-IV"];

// Strip a "-II"/"-III"/... suffix to recover a room's base town name.
export function baseTownName(spawnName: string): string {
  const dash = spawnName.lastIndexOf("-");
  if (dash > 0 && /^(II|III|IV|\d+)$/.test(spawnName.slice(dash + 1))) {
    return spawnName.slice(0, dash);
  }
  return spawnName;
}

// Themed, globally-unique name for a spawn about to be built in `room`.
// A room that already has a spawn keeps its town name and the new spawn gets a
// Roman-numeral suffix; a brand-new room claims the next unused MU town name.
export function nextSpawnName(room: Room): string | undefined {
  const existing = room.find(FIND_MY_SPAWNS);
  const pendingSites = room.find(FIND_MY_CONSTRUCTION_SITES, {
    filter: (s) => s.structureType === STRUCTURE_SPAWN,
  }).length;

  if (existing.length > 0) {
    const base = baseTownName(existing[0].name);
    const slot = existing.length + pendingSites; // 0-based slot for the new spawn
    return `${base}${SPAWN_SUFFIXES[slot] ?? `-${slot + 1}`}`;
  }

  // New room: first MU town name not already used by any spawn in the empire.
  const used = new Set<string>();
  for (const name in Game.spawns) used.add(baseTownName(Game.spawns[name].name));
  return MU_TOWN_NAMES.find((t) => !used.has(t));
}

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
  const existing = mineral.pos.findInRange(FIND_STRUCTURES, offset, {
    filter: (s) => s.structureType === STRUCTURE_CONTAINER,
  });
  if (existing.length > 0) return null;

  const spawns = room.find(FIND_MY_SPAWNS) as StructureSpawn[];
  if (spawns.length > 0) {
    let bestResult: { path: PathStep[] } | null = null;
    for (const s of spawns) {
      const res = PathFinder.search(
        s.pos,
        { pos: mineral.pos, range: offset },
        {
          roomCallback: (roomName: string): boolean | CostMatrix => {
            if (roomName !== room.name) return false;
            const costMatrix = new PathFinder.CostMatrix();
            // Mark walls as impassable
            for (let x = 0; x < 50; x++) {
              for (let y = 0; y < 50; y++) {
                const terrain = room.getTerrain().get(x, y);
                if (terrain === TERRAIN_MASK_WALL) costMatrix.set(x, y, 255);
              }
            }
            // Mark structures as impassable (except roads)
            const structures = room.find(FIND_STRUCTURES) as Structure[];
            for (const struct of structures) {
              if (struct.structureType === STRUCTURE_ROAD) {
                costMatrix.set(struct.pos.x, struct.pos.y, 1);
                continue;
              }
              costMatrix.set(struct.pos.x, struct.pos.y, 255);
            }
            return costMatrix;
          },
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
            const distX = Math.abs(x - mineral.pos.x);
            const distY = Math.abs(y - mineral.pos.y);
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

  // Build coordinate sets once — O(1) lookups replace the original O(keys×positions) scans.
  // This function mutates mem during its run, so it manages its own local sets.
  const roadSet = new Set<string>();
  const nonRoadSet = new Set<string>();
  for (const key of Object.keys(mem)) {
    const isRoad =
      key.startsWith(PLANNER_KEYS.ROAD_PREFIX) ||
      key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX);
    for (const p of mem[key]) {
      if (isRoad) roadSet.add(p);
      else nonRoadSet.add(p);
    }
  }

  // Precompute occupied tiles using Screeps-cached find results — avoids lookForAt per position.
  const terrain = room.getTerrain();
  const occupiedSet = new Set<string>();
  for (const s of room.find(FIND_STRUCTURES)) {
    occupiedSet.add(`${s.pos.x},${s.pos.y}`);
  }
  for (const s of room.find(FIND_CONSTRUCTION_SITES)) {
    occupiedSet.add(`${s.pos.x},${s.pos.y}`);
  }

  const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const;

  for (const key of Object.keys(mem)) {
    if (key.startsWith(PLANNER_KEYS.ROAD_PREFIX)) continue;
    if (key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX)) continue;

    for (const posStr of mem[key]) {
      const comma = posStr.indexOf(",");
      const sx = +posStr.slice(0, comma);
      const sy = +posStr.slice(comma + 1);
      for (const [dx, dy] of DIRS) {
        const x = sx + dx;
        const y = sy + dy;
        if (x < 0 || x >= 50 || y < 0 || y >= 50) continue;
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
        const posKey = `${x},${y}`;
        if (occupiedSet.has(posKey)) continue;
        if (roadSet.has(posKey)) continue;
        if (nonRoadSet.has(posKey)) continue;
        roadSet.add(posKey); // prevent duplicate additions in this same run
        addPlannedStructureToMemory(room, roadKey, new RoomPosition(x, y, room.name));
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
  if (roadKeys.length === 0) return;

  // Precompute structure positions from Screeps-cached find — avoids lookForAt per road tile.
  const nonRoadPosSet = new Set<string>();
  const roadsByPos = new Map<string, Structure[]>();
  for (const s of room.find(FIND_STRUCTURES) as Structure[]) {
    const k = `${s.pos.x},${s.pos.y}`;
    if (s.structureType !== STRUCTURE_ROAD) {
      nonRoadPosSet.add(k);
    } else {
      if (!roadsByPos.has(k)) roadsByPos.set(k, []);
      roadsByPos.get(k)!.push(s);
    }
  }

  for (const key of roadKeys) {
    const arr = mem[key] || [];
    if (arr.length === 0) continue;
    const keep: string[] = [];
    for (const posStr of arr) {
      if (nonRoadPosSet.has(posStr)) {
        const roads = roadsByPos.get(posStr);
        if (roads) {
          for (const s of roads) {
            try { (s as any).destroy(); } catch (e) {}
          }
        }
      } else {
        keep.push(posStr);
      }
    }
    mem[key] = keep;
  }
}

type XY = { x: number; y: number };

function getAllPlannedRoadTiles(room: Room): XY[] {
  if (!room.memory.plannedStructures) return [];
  const mem = room.memory.plannedStructures as Record<string, string[]>;
  const out: XY[] = [];
  for (const key of Object.keys(mem)) {
    if (
      !key.startsWith(PLANNER_KEYS.ROAD_PREFIX) &&
      !key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX)
    )
      continue;
    for (const p of mem[key]) {
      const comma = p.indexOf(",");
      out.push({ x: +p.slice(0, comma), y: +p.slice(comma + 1) });
    }
  }
  return out;
}

function clusterTiles(tiles: XY[]): XY[][] {
  const idxMap = new Map<string, number>();
  tiles.forEach((t, i) => idxMap.set(`${t.x},${t.y}`, i));
  const visited = new Array(tiles.length).fill(false);
  const clusters: XY[][] = [];
  for (let i = 0; i < tiles.length; i++) {
    if (visited[i]) continue;
    const stack = [i];
    const cluster: XY[] = [];
    visited[i] = true;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const p = tiles[cur];
      cluster.push(p);
      for (const n of [
        `${p.x + 1},${p.y}`,
        `${p.x - 1},${p.y}`,
        `${p.x},${p.y + 1}`,
        `${p.x},${p.y - 1}`,
      ]) {
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
        let best: { da: XY; db: XY; dist: number } | null = null;
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
        // Create RoomPositions only here where PathFinder actually needs them.
        getOrPlanRoad(
          room, key,
          new RoomPosition(best.da.x, best.da.y, room.name),
          new RoomPosition(best.db.x, best.db.y, room.name)
        );
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

export function structureTypeForKey(key: string): StructureConstant | null {
  if (key.startsWith(PLANNER_KEYS.CONTAINER_PREFIX)) return STRUCTURE_CONTAINER;
  if (key.startsWith(PLANNER_KEYS.ROAD_PREFIX)) return STRUCTURE_ROAD;
  if (key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX)) return STRUCTURE_ROAD;
  if (key === PLANNER_KEYS.RAMPARTS_KEY) return STRUCTURE_RAMPART;
  if (key === PLANNER_KEYS.CONTAINER_CONTROLLER) return STRUCTURE_CONTAINER;
  // Stamp keys
  if (key.startsWith(PLANNER_KEYS.STAMP_SPAWN_PREFIX))  return STRUCTURE_SPAWN;
  if (key.startsWith(PLANNER_KEYS.STAMP_TOWER_PREFIX))  return STRUCTURE_TOWER;
  if (key === PLANNER_KEYS.STAMP_EXTENSION_KEY)         return STRUCTURE_EXTENSION;
  if (key === PLANNER_KEYS.STAMP_STORAGE_KEY)           return STRUCTURE_STORAGE;
  if (key === PLANNER_KEYS.STAMP_TERMINAL_KEY)          return STRUCTURE_TERMINAL;
  if (key === PLANNER_KEYS.STAMP_FACTORY_KEY)           return STRUCTURE_FACTORY;
  if (key === PLANNER_KEYS.STAMP_LAB_KEY)               return STRUCTURE_LAB;
  if (key === PLANNER_KEYS.STAMP_NUKER_KEY)             return STRUCTURE_NUKER;
  if (key === PLANNER_KEYS.STAMP_POWER_SPAWN_KEY)       return STRUCTURE_POWER_SPAWN;
  if (key === PLANNER_KEYS.STAMP_OBSERVER_KEY)          return STRUCTURE_OBSERVER;
  if (key === PLANNER_KEYS.STAMP_ROAD_KEY)              return STRUCTURE_ROAD;
  if (key === PLANNER_KEYS.STAMP_RAMPART_KEY)           return STRUCTURE_RAMPART;
  if (key.startsWith(PLANNER_KEYS.CARDINAL_ROAD_PREFIX)) return STRUCTURE_ROAD;
  if (key.startsWith("cardinal_connector_"))              return STRUCTURE_ROAD;
  return null;
}
