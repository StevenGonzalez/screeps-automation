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
import { planTown } from "../planning/planner.town";
import { isSourceSafe } from "../services/services.creep";
import { remoteRoadsEnabled } from "../services/services.remote";
import { getActiveRemoteRooms, getPickedRemoteRoomNames } from "./orchestrator.spawning";

const BUILD_PRIORITY: Partial<Record<StructureConstant, number>> = {
  [STRUCTURE_SPAWN]: 0,
  [STRUCTURE_EXTENSION]: 1,
  [STRUCTURE_CONTAINER]: 2,
  [STRUCTURE_TOWER]: 3,
  [STRUCTURE_STORAGE]: 4,
  [STRUCTURE_TERMINAL]: 5,
  [STRUCTURE_LINK]: 6,
  [STRUCTURE_EXTRACTOR]: 6,
  [STRUCTURE_LAB]: 7,
  [STRUCTURE_FACTORY]: 8,
  [STRUCTURE_NUKER]: 9,
  [STRUCTURE_POWER_SPAWN]: 9,
  [STRUCTURE_OBSERVER]: 9,
  [STRUCTURE_RAMPART]: 10,
  [STRUCTURE_ROAD]: 11,
};

const PERIMETER_PRIORITY = 12;

// The town comes after everything the castle needs.
const TOWN_PRIORITY = 13;

// How many remote container sites may be open at once, across all rooms.
const MAX_REMOTE_CONTAINER_SITES = 2;
// How many remote road sites may be open at once, across all rooms. Haulers
// build them a tick at a time as they pass, so a handful keeps them busy
// without holding the global site cap against the owned rooms.
const MAX_REMOTE_ROAD_SITES = 10;

function buildPriority(key: string): number {
  if (key === PLANNER_KEYS.STAMP_RAMPART_KEY) return PERIMETER_PRIORITY;
  if (key === PLANNER_KEYS.TOWN_WALL_KEY || key === PLANNER_KEYS.TOWN_RAMPART_KEY) return TOWN_PRIORITY;
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

export function applyPlannedConstruction(room: Room) {
  if (!room.memory.plannedStructures) return;
  const mem = room.memory.plannedStructures as Record<string, string[]>;
  const terrain = room.getTerrain();

  const builtByType = new Map<StructureConstant, Set<string>>();
  const sitesByType = new Map<StructureConstant, Set<string>>();
  const roadByPos = new Map<string, Structure>();
  const roadSiteByPos = new Map<string, ConstructionSite>();
  // Leftovers from a previous owner sit in builtByType but not against our caps.
  const ownBuiltCount = new Map<StructureConstant, number>();
  for (const s of room.find(FIND_STRUCTURES) as Structure[]) {
    const t = s.structureType as StructureConstant;
    if (!builtByType.has(t)) builtByType.set(t, new Set());
    builtByType.get(t)!.add(`${s.pos.x},${s.pos.y}`);
    if ((s as OwnedStructure).my !== false) ownBuiltCount.set(t, (ownBuiltCount.get(t) ?? 0) + 1);
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

  // Queue only a few sites per room at a time, in priority order, so builders
  // finish the important structures before lower-value ones. MAX_CONSTRUCTION_SITES
  // is a global cap shared by every room and remote, so also honor whatever room
  // is left in it.
  const perRoomCap = STRUCTURE_PLANNER.maxActiveConstructionSites;
  let roomSiteCount = 0;
  for (const set of sitesByType.values()) roomSiteCount += set.size;
  const globalRemaining =
    MAX_CONSTRUCTION_SITES - Object.keys(Game.constructionSites).length;
  let budget = Math.min(globalRemaining, perRoomCap - roomSiteCount);

  const keys = Object.keys(mem).sort(
    (a, b) => buildPriority(a) - buildPriority(b)
  );

  // When the room is already at its cap, let a higher-priority planned structure
  // (e.g. a freshly unlocked tower) bump the lowest-priority pending site (a
  // road) instead of waiting behind it.
  const prioOfSite = (s: ConstructionSite): number =>
    BUILD_PRIORITY[s.structureType as StructureConstant] ?? 11;
  let evictPool: ConstructionSite[] | null = null;
  const evictForPriority = (target: number): boolean => {
    if (evictPool === null) {
      evictPool = (room.find(FIND_MY_CONSTRUCTION_SITES) as ConstructionSite[])
        .filter((s) => s.progress === 0)
        .sort((a, b) => prioOfSite(a) - prioOfSite(b));
    }
    const victim = evictPool[evictPool.length - 1];
    if (!victim || prioOfSite(victim) <= target) return false;
    evictPool.pop();
    victim.remove();
    return true;
  };

  const rcl = room.controller?.level ?? 0;
  const placedByType = new Map<StructureConstant, number>();
  const atStructureLimit = (t: StructureConstant): boolean => {
    const limit = CONTROLLER_STRUCTURES[t as BuildableStructureConstant]?.[rcl];
    if (limit === undefined) return false;
    const count =
      (ownBuiltCount.get(t) ?? 0) + (sitesByType.get(t)?.size ?? 0) + (placedByType.get(t) ?? 0);
    return count >= limit;
  };

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
          // Only place a site where no rampart stands or is queued, and pay for
          // it out of the same budget as every other site.
          const rampartSites = sitesByType.get(STRUCTURE_RAMPART) ?? new Set<string>();
          const covered =
            builtByType.get(STRUCTURE_RAMPART)?.has(posStr) || rampartSites.has(posStr);
          if (!covered && budget > 0 && room.createConstructionSite(x, y, STRUCTURE_RAMPART) === OK) {
            budget--;
            rampartSites.add(posStr);
            sitesByType.set(STRUCTURE_RAMPART, rampartSites);
          }
        }
        continue;
      }
      const comma = posStr.indexOf(",");
      const x = +posStr.slice(0, comma);
      const y = +posStr.slice(comma + 1);
      // Minerals often sit on wall terrain, and the engine lets an extractor
      // be placed there; every other planned type is invalid on a wall.
      if (type !== STRUCTURE_EXTRACTOR && terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      keep.push(posStr);
      if (sites?.has(posStr)) continue;
      // Past the RCL limit the engine rejects the site anyway; check before
      // evicting, or a lower-priority site is thrown away for nothing.
      if (atStructureLimit(type as StructureConstant)) continue;
      if (budget <= 0) {
        if (!evictForPriority(buildPriority(key))) continue;
        budget++;
      }
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
        placedByType.set(type as StructureConstant, (placedByType.get(type as StructureConstant) ?? 0) + 1);
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
    // Walls are only planned for the town; a hand-placed wall site survives
    // as it always has.
    if (site.structureType === STRUCTURE_WALL) continue;
    const set = plannedByType.get(site.structureType as StructureConstant);
    // Only police types the planner lays out; hand-placed sites of other types survive.
    if (!set) continue;
    if (set.has(`${site.pos.x},${site.pos.y}`)) continue;
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

// Outside owned rooms we place source containers in the remotes a home works,
// and roads there once it lays remote roads (its haulers build and repair
// those). Anything else out there - including sites in a remote that has since
// dropped out of the worked set - is an orphan: nothing builds it and it holds
// a slot against the global site cap forever.
export function cleanupSitesOutsideOwnedRooms() {
  const { containerRooms, roadRooms } = workedRemoteRooms();
  for (const id in Game.constructionSites) {
    const site = Game.constructionSites[id];
    if (Game.rooms[site.pos.roomName]?.controller?.my) continue;
    if (site.structureType === STRUCTURE_CONTAINER && containerRooms.has(site.pos.roomName)) continue;
    if (site.structureType === STRUCTURE_ROAD && roadRooms.has(site.pos.roomName)) continue;
    site.remove();
  }
}

// Remotes some home works (invaded or not, see getPickedRemoteRoomNames), and
// the subset of those whose home lays roads.
function workedRemoteRooms(): { containerRooms: Set<string>; roadRooms: Set<string> } {
  const containerRooms = new Set<string>();
  const roadRooms = new Set<string>();
  for (const rn in Game.rooms) {
    const room = Game.rooms[rn];
    if (!room.controller?.my) continue;
    const roads = remoteRoadsEnabled(room);
    for (const name of getPickedRemoteRoomNames(room)) {
      containerRooms.add(name);
      if (roads) roadRooms.add(name);
    }
  }
  return { containerRooms, roadRooms };
}

export function loop() {
  cleanupPlannedStructuresGlobal();
  if (Game.time % 100 === 0) cleanupSitesOutsideOwnedRooms();
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
  }

  if (Game.time % 100 === 0) {
    let budget = MAX_REMOTE_CONTAINER_SITES - countRemoteContainerSites();
    let roadBudget = MAX_REMOTE_ROAD_SITES - countRemoteSites(STRUCTURE_ROAD);
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;
      const remotes = getActiveRemoteRooms(room);
      if (budget > 0) budget = planRemoteRoomContainers(room, remotes, budget);
      if (roadBudget > 0 && remoteRoadsEnabled(room)) {
        roadBudget = planRemoteRoads(room, remotes, roadBudget);
      }
    }
  }
}

// A remote container costs 5000 energy the miner burns building it instead of
// hauling home, so an open site is a source that earns nothing until it closes.
// Opening every one at once stalls all remote income simultaneously; cap the
// in-flight count so each remote comes online and starts paying before the next
// one starts costing.
export function countRemoteContainerSites(): number {
  return countRemoteSites(STRUCTURE_CONTAINER);
}

function countRemoteSites(type: BuildableStructureConstant): number {
  let count = 0;
  for (const id in Game.constructionSites) {
    const site = Game.constructionSites[id];
    if (site.structureType !== type) continue;
    if (Game.rooms[site.pos.roomName]?.controller?.my) continue;
    count++;
  }
  return count;
}

// A container is only worth placing where we control the ground: our own rooms
// or ones we hold a reservation on. Anywhere else we cannot defend it, cannot
// repair it beyond the miner sitting on it, and the site is likely rejected
// outright by the server.
export function canBuildInRemote(remoteRoom: Room, myName: string | undefined): boolean {
  const ctrl = remoteRoom.controller;
  if (!ctrl) return false;
  if (ctrl.owner && !ctrl.my) return false;
  if (ctrl.reservation && ctrl.reservation.username !== myName) return false;
  return true;
}

// Containers go only to the remotes the home is working (see
// getActiveRemoteRooms): a site in one nobody mines is never built and holds
// one of the few container slots against a remote that would be.
export function planRemoteRoomContainers(
  homeRoom: Room,
  remotes: RemoteRoomData[],
  budget: number
): number {
  const myName = homeRoom.controller?.owner?.username;
  for (const remote of remotes) {
    if (budget <= 0) return budget;
    const remoteRoom = Game.rooms[remote.roomName];
    if (!remoteRoom) continue;
    if (!canBuildInRemote(remoteRoom, myName)) continue;

    const terrain = remoteRoom.getTerrain();
    for (const sourceData of remote.sources) {
      if (budget <= 0) return budget;
      const source = Game.getObjectById(sourceData.sourceId) as Source | null;
      if (!source) continue;

      if (sourceData.containerId) {
        const existing = Game.getObjectById(sourceData.containerId) as StructureContainer | null;
        if (existing) continue;
        sourceData.containerId = undefined;
      }

      const built = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (s): s is StructureContainer => s.structureType === STRUCTURE_CONTAINER,
      }) as StructureContainer[];
      if (built.length > 0) {
        sourceData.containerId = built[0].id;
        continue;
      }

      const site = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      });
      if (site.length > 0) continue;

      let placed = false;
      for (let dx = -1; dx <= 1 && !placed; dx++) {
        for (let dy = -1; dy <= 1 && !placed; dy++) {
          if (dx === 0 && dy === 0) continue;
          const x = source.pos.x + dx;
          const y = source.pos.y + dy;
          if (x < 1 || x >= 49 || y < 1 || y >= 49) continue;
          if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
          if (remoteRoom.createConstructionSite(x, y, STRUCTURE_CONTAINER) === OK) placed = true;
        }
      }
      if (placed) budget--;
    }
  }
  return budget;
}

// Road sites along each active remote source's path from home, inside the
// remote room (the home's side is the planner's cardinal artery). A source
// gets its road once its container stands, so the miner is not splitting its
// energy between the two. The path comes from the profit ranking's distance
// cache (getRemoteSourcePathLength), so no search runs here.
export function planRemoteRoads(
  homeRoom: Room,
  remotes: RemoteRoomData[],
  budget: number
): number {
  const myName = homeRoom.controller?.owner?.username;
  for (const remote of remotes) {
    const remoteRoom = Game.rooms[remote.roomName];
    if (!remoteRoom || !canBuildInRemote(remoteRoom, myName)) continue;
    for (const src of remote.sources) {
      if (!src.containerId || !src.roadTiles) continue;
      for (const tile of src.roadTiles.split(";")) {
        if (budget <= 0) return budget;
        const [x, y] = tile.split(",").map(Number);
        const hasRoad = remoteRoom
          .lookForAt(LOOK_STRUCTURES, x, y)
          .some((s) => s.structureType === STRUCTURE_ROAD);
        if (hasRoad || remoteRoom.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).length > 0) continue;
        if (remoteRoom.createConstructionSite(x, y, STRUCTURE_ROAD) === OK) budget--;
      }
    }
  }
  return budget;
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

  planTown(room);

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
        // The farthest source gets a link as soon as links unlock at RCL 5,
        // paired with the storage link; the second waits for RCL 8.
        if (rcl < (i === 0 ? 5 : 8)) return;
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

  planMineralStructures(room);

  planCardinalArteries(room, getActiveRemoteRooms(room));

  removeRoadsAroundStructures(room);
  pruneRoadsUnderStructures(room);
  removeConnectorRoads(room);

  room.memory.lastStructurePlanTick = Game.time;
}

// The mineral container is only the mineral miner's standing tile, and that
// miner needs an extractor, which unlocks at RCL 6. Before then the container
// would just decay, so drop any plan made for it earlier.
export function planMineralStructures(room: Room) {
  const mineral = room.find(FIND_MINERALS)[0] as Mineral | undefined;
  if (!mineral) return;

  const containerKey = `${PLANNER_KEYS.CONTAINER_MINERAL_PREFIX}${mineral.id}`;
  if ((room.controller?.level ?? 0) < 6) {
    delete room.memory.plannedStructures?.[containerKey];
    delete room.memory.plannedStructuresMeta?.[containerKey];
    return;
  }

  if (plannedPositionsFromMemory(room, containerKey).length === 0) {
    const mpos = planMineralContainer(room, mineral);
    if (mpos) addPlannedStructureToMemory(room, containerKey, mpos);
  }

  if (!room.memory.extractorId) {
    const extractorKey = `${PLANNER_KEYS.EXTRACTOR_PREFIX}${mineral.id}`;
    if (plannedPositionsFromMemory(room, extractorKey).length === 0) {
      addPlannedStructureToMemory(room, extractorKey, mineral.pos);
    }
  }
}
