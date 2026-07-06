import {
  planSourceContainer,
  planControllerContainer,
  planControllerLink,
  planSourceLink,
  planMineralContainer,
  addPlannedStructureToMemory,
  ensureMemoryRoomStructures,
  plannedPositionsFromMemory,
  removeRoadsAroundStructures,
  pruneRoadsUnderStructures,
  removeConnectorRoads,
  structureTypeForKey,
  nextSpawnName,
} from "../services/services.structures";
import { PLANNER_KEYS, STRUCTURE_PLANNER } from "../config/config.structures";
import { applyCastleStamp, planCardinalArteries } from "../planning/planner.room";
import { planDefensivePerimeter } from "../planning/planner.rampart";
import { isSourceSafe } from "../services/services.creep";

const BUILD_PRIORITY: Partial<Record<StructureConstant, number>> = {
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

const PERIMETER_PRIORITY = 12;

function buildPriority(key: string): number {
  if (key === PLANNER_KEYS.STAMP_RAMPART_KEY) return PERIMETER_PRIORITY;
  const type = structureTypeForKey(key);
  return type ? BUILD_PRIORITY[type] ?? 11 : 11;
}

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
        key.startsWith(PLANNER_KEYS.CONTAINER_MINERAL_PREFIX)
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
  const terrain = room.getTerrain();

  const builtByType = new Map<StructureConstant, Set<string>>();
  const sitesByType = new Map<StructureConstant, Set<string>>();
  const roadByPos = new Map<string, Structure>();
  const roadSiteByPos = new Map<string, ConstructionSite>();
  for (const s of room.find(FIND_STRUCTURES) as Structure[]) {
    const t = s.structureType as StructureConstant;
    if (!builtByType.has(t)) builtByType.set(t, new Set());
    builtByType.get(t)!.add(`${s.pos.x},${s.pos.y}`);
    if (t === STRUCTURE_ROAD) roadByPos.set(`${s.pos.x},${s.pos.y}`, s);
  }
  for (const s of room.find(FIND_CONSTRUCTION_SITES) as ConstructionSite[]) {
    const t = s.structureType as StructureConstant;
    if (!sitesByType.has(t)) sitesByType.set(t, new Set());
    sitesByType.get(t)!.add(`${s.pos.x},${s.pos.y}`);
    if (t === STRUCTURE_ROAD) roadSiteByPos.set(`${s.pos.x},${s.pos.y}`, s);
  }

  const rampOnTopTypes = new Set<StructureConstant>(
    STRUCTURE_PLANNER.rampartOnTopFor as StructureConstant[]
  );

  const roadCompatible = new Set<StructureConstant>([
    STRUCTURE_ROAD,
    STRUCTURE_RAMPART,
    STRUCTURE_CONTAINER,
  ]);
  const roadKeys = Object.keys(mem).filter(
    (k) => structureTypeForKey(k) === STRUCTURE_ROAD
  );
  const conflictedRoadKeys = new Set<string>();
  for (const key of Object.keys(mem)) {
    const type = structureTypeForKey(key);
    if (!type || roadCompatible.has(type as StructureConstant)) continue;
    for (const posStr of mem[key]) {
      const road = roadByPos.get(posStr);
      const roadSite = roadSiteByPos.get(posStr);
      if (!road && !roadSite) continue;
      if (road) road.destroy();
      if (roadSite) roadSite.remove();
      for (const rk of roadKeys) {
        if (mem[rk].indexOf(posStr) !== -1) conflictedRoadKeys.add(rk);
      }
    }
  }
  for (const rk of conflictedRoadKeys) {
    delete mem[rk];
    if (room.memory.plannedStructuresMeta) {
      delete room.memory.plannedStructuresMeta[rk];
    }
  }

  const roadCap = STRUCTURE_PLANNER.maxRoadConstructionSites;
  let roadSiteCount = roadSiteByPos.size;
  if (roadSiteCount > roadCap) {
    for (const [pos, site] of roadSiteByPos) {
      if (roadSiteCount <= roadCap) break;
      if (site.progress > 0) continue;
      site.remove();
      roadSiteByPos.delete(pos);
      roadSiteCount--;
    }
  }

  let budget = MAX_CONSTRUCTION_SITES - Object.keys(Game.constructionSites).length;
  const keys = Object.keys(mem).sort(
    (a, b) => buildPriority(a) - buildPriority(b)
  );

  const perimeterKey = PLANNER_KEYS.STAMP_RAMPART_KEY;
  const perimeterCap = STRUCTURE_PLANNER.maxPerimeterConstructionSites;
  const rampartSites = sitesByType.get(STRUCTURE_RAMPART);
  let perimeterSiteCount = 0;
  if (rampartSites && mem[perimeterKey]) {
    for (const p of mem[perimeterKey]) if (rampartSites.has(p)) perimeterSiteCount++;
  }

  for (const key of keys) {
    const type = structureTypeForKey(key);
    if (!type) continue;
    const isRoad = type === STRUCTURE_ROAD;
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
        continue;
      }
      const comma = posStr.indexOf(",");
      const x = +posStr.slice(0, comma);
      const y = +posStr.slice(comma + 1);
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      keep.push(posStr);
      if (sites?.has(posStr)) continue;
      if (budget <= 0) continue;
      if (isRoad && roadSiteCount >= roadCap) continue;
      if (key === perimeterKey && perimeterSiteCount >= perimeterCap) continue;
      let result: ScreepsReturnCode;
      if (type === STRUCTURE_SPAWN) {
        const name = nextSpawnName(room);
        result = name
          ? room.createConstructionSite(x, y, STRUCTURE_SPAWN, name)
          : ERR_NAME_EXISTS;
      } else {
        result = room.createConstructionSite(x, y, type as BuildableStructureConstant);
      }
      if (result === OK) {
        budget--;
        if (isRoad) roadSiteCount++;
        if (key === perimeterKey) perimeterSiteCount++;
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
    if (set?.has(`${site.pos.x},${site.pos.y}`)) continue;
    if (site.progress > 0) continue;
    site.remove();
  }
}

function ensureRampartsForExistingStructures(room: Room) {
  const rampTypes = (STRUCTURE_PLANNER.rampartOnTopFor ||
    []) as StructureConstant[];
  const structures = room.find(FIND_STRUCTURES) as Structure[];

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
    if (Game.time % 100 === 0) planRemoteRoomContainers(room);
  }
}

function planRemoteRoomContainers(homeRoom: Room) {
  for (const remote of homeRoom.memory.remoteRooms ?? []) {
    if (remote.hostile) continue;
    const remoteRoom = Game.rooms[remote.roomName];
    if (!remoteRoom) continue;

    const terrain = remoteRoom.getTerrain();
    for (const sourceData of remote.sources) {
      const source = Game.getObjectById(sourceData.sourceId) as Source | null;
      if (!source) continue;

      if (sourceData.containerId) {
        const existing = Game.getObjectById(sourceData.containerId) as StructureContainer | null;
        if (existing) {
          planRemoteRoad(homeRoom, existing.pos);
          continue;
        }
        sourceData.containerId = undefined;
      }

      const built = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (s): s is StructureContainer => s.structureType === STRUCTURE_CONTAINER,
      }) as StructureContainer[];
      if (built.length > 0) {
        sourceData.containerId = built[0].id;
        planRemoteRoad(homeRoom, built[0].pos);
        continue;
      }

      const site = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      });
      if (site.length > 0) continue;

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

const REMOTE_ROAD_SITES_PER_CALL = 5;

function planRemoteRoad(homeRoom: Room, from: RoomPosition) {
  const storage = homeRoom.storage;
  if (!storage) return;

  const result = PathFinder.search(
    from,
    { pos: storage.pos, range: 1 },
    {
      plainCost: 2,
      swampCost: 10,
      maxOps: 4000,
      roomCallback: (roomName) => {
        const r = Game.rooms[roomName];
        if (!r) return new PathFinder.CostMatrix();
        const cm = new PathFinder.CostMatrix();
        for (const s of r.find(FIND_STRUCTURES)) {
          if (s.structureType === STRUCTURE_ROAD) cm.set(s.pos.x, s.pos.y, 1);
          else if (
            s.structureType !== STRUCTURE_CONTAINER &&
            s.structureType !== STRUCTURE_RAMPART
          ) {
            cm.set(s.pos.x, s.pos.y, 255);
          }
        }
        return cm;
      },
    }
  );
  if (result.incomplete) return;

  let placed = 0;
  for (const pos of result.path) {
    if (placed >= REMOTE_ROAD_SITES_PER_CALL) break;
    const r = Game.rooms[pos.roomName];
    if (!r) continue;
    const here = r.lookAt(pos.x, pos.y);
    const blocked = here.some(
      (o) =>
        (o.type === "structure" && (o.structure as Structure).structureType === STRUCTURE_ROAD) ||
        (o.type === "constructionSite" &&
          (o.constructionSite as ConstructionSite).structureType === STRUCTURE_ROAD)
    );
    if (blocked) continue;
    if (r.createConstructionSite(pos.x, pos.y, STRUCTURE_ROAD) === OK) placed++;
  }
}

function processRoomStructures(room: Room) {
  const last = room.memory.lastStructurePlanTick || 0;
  if (Game.time - last < STRUCTURE_PLANNER.planInterval) return;
  ensureMemoryRoomStructures(room);

  const meta = room.memory.plannedStructuresMeta ?? {};
  const mem = (room.memory.plannedStructures ?? {}) as Record<string, string[]>;
  const pruneAge = STRUCTURE_PLANNER.plannedRoadPruneTicks;
  if (pruneAge > 0) {
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

  applyCastleStamp(room);

  planDefensivePerimeter(room);

  const sources = room.find(FIND_SOURCES);
  for (const source of sources) {
    if (!isSourceSafe(source)) continue;
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

  if (room.controller) {
    const rcl = room.controller.level;

    if (rcl >= 6) {
      const plannedLink = plannedPositionsFromMemory(room, PLANNER_KEYS.LINK_CONTROLLER);
      const builtNearController =
        room.controller.pos.findInRange(FIND_MY_STRUCTURES, 3, {
          filter: (s) => s.structureType === STRUCTURE_LINK,
        }).length > 0;
      if (plannedLink.length === 0 && !builtNearController) {
        const pos = planControllerLink(room, room.controller);
        if (pos) addPlannedStructureToMemory(room, PLANNER_KEYS.LINK_CONTROLLER, pos);
      }
    }

    const ref = room.storage?.pos ?? room.find(FIND_MY_SPAWNS)[0]?.pos;
    if (ref) {
      const ranked = room
        .find(FIND_SOURCES)
        .filter((s) => isSourceSafe(s))
        .sort((a, b) => b.pos.getRangeTo(ref) - a.pos.getRangeTo(ref));
      ranked.forEach((source, i) => {
        if (rcl < (i === 0 ? 6 : 8)) return;
        const key = `${PLANNER_KEYS.LINK_SOURCE_PREFIX}${source.id}`;
        if (plannedPositionsFromMemory(room, key).length > 0) return;
        const builtNearSource =
          source.pos.findInRange(FIND_MY_STRUCTURES, 2, {
            filter: (s) => s.structureType === STRUCTURE_LINK,
          }).length > 0;
        if (builtNearSource) return;
        const pos = planSourceLink(room, source);
        if (pos) addPlannedStructureToMemory(room, key, pos);
      });
    }
  }

  const mineral = room.find(FIND_MINERALS)[0] as Mineral | undefined;
  if (mineral) {
    const containerKey = `${PLANNER_KEYS.CONTAINER_MINERAL_PREFIX}${mineral.id}`;
    const plannedMineral = plannedPositionsFromMemory(room, containerKey);
    if (plannedMineral.length === 0) {
      const mpos = planMineralContainer(room, mineral);
      if (mpos) addPlannedStructureToMemory(room, containerKey, mpos);
    }
  }

  if (mineral && (room.controller?.level ?? 0) >= 6 && !room.memory.extractorId) {
    const extractorKey = `${PLANNER_KEYS.EXTRACTOR_PREFIX}${mineral.id}`;
    if (plannedPositionsFromMemory(room, extractorKey).length === 0) {
      addPlannedStructureToMemory(room, extractorKey, mineral.pos);
    }
  }

  planCardinalArteries(room);

  removeRoadsAroundStructures(room);
  pruneRoadsUnderStructures(room);
  removeConnectorRoads(room);

  room.memory.lastStructurePlanTick = Game.time;
}
