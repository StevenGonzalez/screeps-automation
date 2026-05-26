import {
  planSourceContainer,
  planControllerContainer,
  planMineralContainer,
  addPlannedStructureToMemory,
  ensureMemoryRoomStructures,
  plannedPositionsFromMemory,
  planRoadsAroundStructures,
  pruneRoadsUnderStructures,
  connectRoadClusters,
  structureTypeForKey,
} from "../services/services.structures";
import { PLANNER_KEYS, STRUCTURE_PLANNER } from "../config/config.structures";
import { applyCastleStamp, planCardinalArteries } from "../planning/planner.room";

function cleanupPlannedStructuresGlobal() {
  const interval = (STRUCTURE_PLANNER as any).plannedCleanupInterval || 0;
  if (!interval || Game.time % interval !== 0) return;

  for (const rn in Game.rooms) {
    const room = Game.rooms[rn];
    const mem = room.memory.plannedStructures as Record<string, string[]> | undefined;
    const meta = room.memory.plannedStructuresMeta ?? {};
    if (!mem) continue;
    for (const key of Object.keys(mem)) {
      const arr = mem[key] ?? [];
      if (arr.length <= 1) continue;
      if (
        key === PLANNER_KEYS.CONTAINER_CONTROLLER ||
        key.startsWith(PLANNER_KEYS.CONTAINER_SOURCE_PREFIX) ||
        key.startsWith(PLANNER_KEYS.CONTAINER_MINERAL_PREFIX) ||
        (key.startsWith(PLANNER_KEYS.EXTENSIONS_PREFIX) && !key.startsWith("stamp_"))
      ) {
        mem[key] = [arr[0]];
        if (meta[key]) meta[key].createdAt = Game.time;
      } else {
        const seen = new Set<string>();
        const keep: string[] = [];
        for (const p of arr) {
          if (seen.has(p)) continue;
          const [x, y] = p.split(",").map(Number);
          if (isNaN(x) || isNaN(y) || x < 0 || x >= 50 || y < 0 || y >= 50)
            continue;
          seen.add(p);
          keep.push(p);
        }
        mem[key] = keep;
        if (meta[key] && mem[key].length === 0) delete meta[key];
      }
    }
  }

  const unseenAge = STRUCTURE_PLANNER.plannedCleanupUnseenAge;
  if (!unseenAge || unseenAge <= 0) return;
  if (!Memory.rooms) return;
  for (const rname of Object.keys(Memory.rooms)) {
    if (Game.rooms[rname]) continue;
    const rm = Memory.rooms[rname];
    if (!rm?.plannedStructuresMeta) continue;
    let anyRecent = false;
    for (const k of Object.keys(rm.plannedStructuresMeta)) {
      const info = rm.plannedStructuresMeta[k];
      if (!info?.createdAt) continue;
      if (Game.time - info.createdAt < unseenAge) {
        anyRecent = true;
        break;
      }
    }
    if (!anyRecent) {
      delete rm.plannedStructures;
      delete rm.plannedStructuresMeta;
    }
  }
}

function applyPlannedConstruction(room: Room) {
  if (!room.memory.plannedStructures) return;
  const mem = room.memory.plannedStructures as Record<string, string[]>;

  // Precompute structure and construction-site positions grouped by type.
  // Avoids two lookForAt calls per planned position (which is O(positions) lookForAt calls).
  const builtByType = new Map<StructureConstant, Set<string>>();
  const sitesByType = new Map<StructureConstant, Set<string>>();
  for (const s of room.find(FIND_STRUCTURES) as Structure[]) {
    const t = s.structureType as StructureConstant;
    if (!builtByType.has(t)) builtByType.set(t, new Set());
    builtByType.get(t)!.add(`${s.pos.x},${s.pos.y}`);
  }
  for (const s of room.find(FIND_CONSTRUCTION_SITES) as ConstructionSite[]) {
    const t = s.structureType as StructureConstant;
    if (!sitesByType.has(t)) sitesByType.set(t, new Set());
    sitesByType.get(t)!.add(`${s.pos.x},${s.pos.y}`);
  }

  const rampOnTopTypes = new Set<StructureConstant>(
    STRUCTURE_PLANNER.rampartOnTopFor as StructureConstant[]
  );

  for (const key of Object.keys(mem)) {
    const type = structureTypeForKey(key);
    if (!type) continue;
    const built = builtByType.get(type as StructureConstant);
    const sites = sitesByType.get(type as StructureConstant);
    const arr = mem[key];
    const keep: string[] = [];
    for (const posStr of arr) {
      if (built?.has(posStr)) {
        if (rampOnTopTypes.has(type as StructureConstant)) {
          const comma = posStr.indexOf(",");
          const x = +posStr.slice(0, comma);
          const y = +posStr.slice(comma + 1);
          addPlannedStructureToMemory(room, PLANNER_KEYS.RAMPARTS_KEY, new RoomPosition(x, y, room.name));
          room.createConstructionSite(x, y, STRUCTURE_RAMPART);
        }
        continue; // already built — don't keep in planned list
      }
      keep.push(posStr);
      if (!sites?.has(posStr)) {
        const comma = posStr.indexOf(",");
        const x = +posStr.slice(0, comma);
        const y = +posStr.slice(comma + 1);
        room.createConstructionSite(x, y, type as BuildableStructureConstant);
      }
    }
    mem[key] = keep;
  }
}

function cleanupUnplannedConstructionSites(room: Room) {
  if (!room.memory.plannedStructures) return;
  const sites = room.find(FIND_CONSTRUCTION_SITES);
  if (sites.length === 0) return;
  const mem = room.memory.plannedStructures as Record<string, string[]>;

  // Build type → planned-position set once, not once per construction site.
  const plannedByType = new Map<StructureConstant, Set<string>>();
  for (const key of Object.keys(mem)) {
    const type = structureTypeForKey(key);
    if (!type) continue;
    const t = type as StructureConstant;
    if (!plannedByType.has(t)) plannedByType.set(t, new Set());
    const set = plannedByType.get(t)!;
    for (const p of mem[key]) set.add(p);
  }

  for (const site of sites) {
    const set = plannedByType.get(site.structureType as StructureConstant);
    if (!set?.has(`${site.pos.x},${site.pos.y}`)) {
      site.remove();
    }
  }
}

function ensureRampartsForExistingStructures(room: Room) {
  const rampTypes = (STRUCTURE_PLANNER.rampartOnTopFor ||
    []) as StructureConstant[];
  const structures = room.find(FIND_STRUCTURES) as Structure[];

  // Precompute existing rampart positions and planned-rampart set — avoids lookForAt per structure.
  const existingRampSet = new Set<string>();
  for (const s of structures) {
    if (s.structureType === STRUCTURE_RAMPART) existingRampSet.add(`${s.pos.x},${s.pos.y}`);
  }
  const plannedRampSet = new Set<string>(
    room.memory.plannedStructures?.[PLANNER_KEYS.RAMPARTS_KEY] ?? []
  );

  for (const s of structures) {
    if (!rampTypes.includes(s.structureType as StructureConstant)) continue;
    if (s.structureType === STRUCTURE_RAMPART) continue;
    const posKey = `${s.pos.x},${s.pos.y}`;
    if (existingRampSet.has(posKey) || plannedRampSet.has(posKey)) continue;

    plannedRampSet.add(posKey);
    addPlannedStructureToMemory(
      room,
      PLANNER_KEYS.RAMPARTS_KEY,
      new RoomPosition(s.pos.x, s.pos.y, room.name)
    );
    room.createConstructionSite(s.pos.x, s.pos.y, STRUCTURE_RAMPART);
  }
}

export function loop() {
  cleanupPlannedStructuresGlobal();
  // Construction site management doesn't need to run every tick — once per 5 ticks is plenty.
  const applyConstruction = Game.time % 5 === 0;
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my) continue;
    processRoomStructures(room);
    if (applyConstruction) {
      applyPlannedConstruction(room);
      cleanupUnplannedConstructionSites(room);
      ensureRampartsForExistingStructures(room);
    }
    // Place container sites in visible remote rooms so miners have somewhere to deposit.
    if (Game.time % 100 === 0) planRemoteRoomContainers(room);
  }
}

// For each source in a remote room that is currently visible, create a container
// construction site adjacent to the source if none exists yet.  We write back
// the planned/found container ID so remote haulers can find it immediately.
function planRemoteRoomContainers(homeRoom: Room) {
  for (const remote of homeRoom.memory.remoteRooms ?? []) {
    if (remote.hostile) continue;
    const remoteRoom = Game.rooms[remote.roomName];
    if (!remoteRoom) continue;

    const terrain = remoteRoom.getTerrain();
    for (const sourceData of remote.sources) {
      const source = Game.getObjectById(sourceData.sourceId) as Source | null;
      if (!source) continue;

      // Keep cached ID in sync with reality.
      if (sourceData.containerId) {
        const existing = Game.getObjectById(sourceData.containerId) as StructureContainer | null;
        if (existing) continue;
        sourceData.containerId = undefined;
      }

      // Check for a container already built near the source.
      const built = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (s): s is StructureContainer => s.structureType === STRUCTURE_CONTAINER,
      }) as StructureContainer[];
      if (built.length > 0) {
        sourceData.containerId = built[0].id;
        continue;
      }

      // Check for an in-progress construction site.
      const site = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      });
      if (site.length > 0) continue;

      // Place a site on the first walkable tile adjacent to the source.
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const x = source.pos.x + dx;
          const y = source.pos.y + dy;
          if (x < 1 || x >= 49 || y < 1 || y >= 49) continue;
          if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
          if (remoteRoom.createConstructionSite(x, y, STRUCTURE_CONTAINER) === OK) break;
        }
      }
    }
  }
}

function processRoomStructures(room: Room) {
  const last = room.memory.lastStructurePlanTick || 0;
  if (Game.time - last < STRUCTURE_PLANNER.planInterval) return;
  ensureMemoryRoomStructures(room);

  // Prune stale road keys that never got built
  const meta = room.memory.plannedStructuresMeta ?? {};
  const mem = (room.memory.plannedStructures ?? {}) as Record<string, string[]>;
  const pruneAge = STRUCTURE_PLANNER.plannedRoadPruneTicks;
  if (pruneAge > 0) {
    // Precompute occupied positions once instead of calling lookForAt per road tile.
    const occupiedPos = new Set<string>();
    for (const s of room.find(FIND_STRUCTURES) as Structure[]) occupiedPos.add(`${s.pos.x},${s.pos.y}`);
    for (const s of room.find(FIND_CONSTRUCTION_SITES) as ConstructionSite[]) occupiedPos.add(`${s.pos.x},${s.pos.y}`);

    for (const key of Object.keys(mem)) {
      if (
        !key.startsWith(PLANNER_KEYS.ROAD_PREFIX) &&
        !key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX) &&
        !key.startsWith(PLANNER_KEYS.CARDINAL_ROAD_PREFIX) &&
        !key.startsWith("cardinal_connector_")
      )
        continue;
      const info = meta[key];
      if (!info?.createdAt) continue;
      if (Game.time - info.createdAt < pruneAge) continue;
      let anyLive = false;
      for (const p of mem[key] ?? []) {
        if (occupiedPos.has(p)) { anyLive = true; break; }
      }
      if (!anyLive) {
        delete room.memory.plannedStructures![key];
        if (room.memory.plannedStructuresMeta) delete room.memory.plannedStructuresMeta[key];
      }
    }
  }

  // Migrate: remove old per-spawn extension/tower/storage keys once anchor is set
  if (room.memory.castleAnchor) {
    for (const key of Object.keys(mem)) {
      if (
        key.startsWith(PLANNER_KEYS.EXTENSIONS_PREFIX) ||
        key.startsWith(PLANNER_KEYS.TOWERS_PREFIX) ||
        key.startsWith(PLANNER_KEYS.STORAGE_PREFIX)
      ) {
        delete mem[key];
        if (room.memory.plannedStructuresMeta) delete room.memory.plannedStructuresMeta[key];
      }
    }
  }

  // Castle stamp: place RCL-appropriate structures
  applyCastleStamp(room);

  // Source containers
  const sources = room.find(FIND_SOURCES);
  for (const source of sources) {
    const planned = plannedPositionsFromMemory(
      room,
      `${PLANNER_KEYS.CONTAINER_SOURCE_PREFIX}${source.id}`
    );
    if (planned.length > 0) continue;
    const pos = planSourceContainer(room, source);
    if (pos)
      addPlannedStructureToMemory(
        room,
        `${PLANNER_KEYS.CONTAINER_SOURCE_PREFIX}${source.id}`,
        pos
      );
  }

  // Controller container
  if (room.controller) {
    const planned = plannedPositionsFromMemory(room, PLANNER_KEYS.CONTAINER_CONTROLLER);
    let hasControllerContainer = false;

    if (room.memory.upgradeContainerId) {
      const container = Game.getObjectById(
        room.memory.upgradeContainerId
      ) as StructureContainer | null;
      if (
        container &&
        container.structureType === STRUCTURE_CONTAINER &&
        container.pos.getRangeTo(room.controller.pos) <= 2
      ) {
        hasControllerContainer = true;
      }
    }
    if (!hasControllerContainer) {
      const containers = room.find(FIND_STRUCTURES, {
        filter: (s) =>
          s.structureType === STRUCTURE_CONTAINER &&
          s.pos.getRangeTo(room.controller!.pos) <= 2,
      }) as StructureContainer[];
      if (containers.length > 0) hasControllerContainer = true;
    }

    if (hasControllerContainer && planned.length > 0) {
      delete mem[PLANNER_KEYS.CONTAINER_CONTROLLER];
      if (room.memory.plannedStructuresMeta) delete room.memory.plannedStructuresMeta[PLANNER_KEYS.CONTAINER_CONTROLLER];
    } else if (planned.length > 1) {
      mem[PLANNER_KEYS.CONTAINER_CONTROLLER] = [mem[PLANNER_KEYS.CONTAINER_CONTROLLER][0]];
    } else if (planned.length === 0 && !hasControllerContainer) {
      const pos = planControllerContainer(room, room.controller);
      if (pos) addPlannedStructureToMemory(room, PLANNER_KEYS.CONTAINER_CONTROLLER, pos);
    }
  }

  // Mineral container
  const mineral = room.find(FIND_MINERALS)[0] as Mineral | undefined;
  if (mineral) {
    const containerKey = `${PLANNER_KEYS.CONTAINER_MINERAL_PREFIX}${mineral.id}`;
    const plannedMineral = plannedPositionsFromMemory(room, containerKey);
    if (plannedMineral.length === 0) {
      const mpos = planMineralContainer(room, mineral);
      if (mpos) addPlannedStructureToMemory(room, containerKey, mpos);
    }
  }

  // Cardinal arteries + economic connectors
  planCardinalArteries(room);

  planRoadsAroundStructures(room);
  pruneRoadsUnderStructures(room);
  connectRoadClusters(room);

  room.memory.lastStructurePlanTick = Game.time;
  // Ramparts for existing structures are handled by ensureRampartsForExistingStructures (runs every 5t).
}
