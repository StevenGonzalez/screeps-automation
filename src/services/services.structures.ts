import {
  STRUCTURE_PLANNER,
  PLANNER_KEYS,
  TOWER_COUNT_PER_RCL,
  TOWER_DISTRIBUTION_MODE,
  TOWER_PRIMARY_SPAWN_MEMORY_KEY,
  MU_TOWN_NAMES,
} from "../config/config.structures";

const SPAWN_SUFFIXES = ["", "-II", "-III", "-IV"];

export function baseTownName(spawnName: string): string {
  const dash = spawnName.lastIndexOf("-");
  if (dash > 0 && /^(II|III|IV|\d+)$/.test(spawnName.slice(dash + 1))) {
    return spawnName.slice(0, dash);
  }
  return spawnName;
}

export function nextSpawnName(room: Room): string | undefined {
  const existing = room.find(FIND_MY_SPAWNS);
  const pendingSites = room.find(FIND_MY_CONSTRUCTION_SITES, {
    filter: (s) => s.structureType === STRUCTURE_SPAWN,
  }).length;

  if (existing.length > 0) {
    const base = baseTownName(existing[0].name);
    const slot = existing.length + pendingSites;
    return `${base}${SPAWN_SUFFIXES[slot] ?? `-${slot + 1}`}`;
  }

  const used = new Set<string>();
  for (const name in Game.spawns) used.add(baseTownName(Game.spawns[name].name));
  return MU_TOWN_NAMES.find((t) => !used.has(t));
}

function isWalkable(room: Room, x: number, y: number): boolean {
  const look = room.getTerrain().get(x, y);
  return look !== TERRAIN_MASK_WALL;
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
  if (key === PLANNER_KEYS.LINK_CONTROLLER) return STRUCTURE_LINK;
  if (key.startsWith(PLANNER_KEYS.LINK_SOURCE_PREFIX)) return STRUCTURE_LINK;
  if (key.startsWith(PLANNER_KEYS.EXTRACTOR_PREFIX)) return STRUCTURE_EXTRACTOR;
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
  if (key === PLANNER_KEYS.STAMP_LINK_KEY)              return STRUCTURE_LINK;
  if (key === PLANNER_KEYS.STAMP_ROAD_KEY)              return STRUCTURE_ROAD;
  if (key === PLANNER_KEYS.STAMP_RAMPART_KEY)           return STRUCTURE_RAMPART;
  if (key === PLANNER_KEYS.STAMP_WALL_KEY)              return STRUCTURE_WALL;
  if (key.startsWith(PLANNER_KEYS.CARDINAL_ROAD_PREFIX)) return STRUCTURE_ROAD;
  if (key.startsWith("cardinal_connector_"))              return STRUCTURE_ROAD;
  if (key === PLANNER_KEYS.TOWN_WALL_KEY)                return STRUCTURE_WALL;
  if (key === PLANNER_KEYS.TOWN_RAMPART_KEY)             return STRUCTURE_RAMPART;
  return null;
}
