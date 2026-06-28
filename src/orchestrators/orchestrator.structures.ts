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

// Lower number = placed first. The global construction-site cap (100) is scarce
// and roads vastly outnumber everything else, so economy structures must claim
// site slots before roads/ramparts or they starve. Anything unlisted defaults to
// road-tier priority.
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

// Priority for the build queue, keyed on the planner key (not just the structure
// type) so the defensive PERIMETER (STAMP_RAMPART_KEY) can sit BELOW roads while
// the on-top ramparts protecting critical structures (RAMPARTS_KEY) stay high.
// The perimeter is a large, purely-defensive ring; it must never out-compete the
// economy or roads for the scarce global site cap. 12 = after everything listed.
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

  // Precompute structure and construction-site positions grouped by type.
  // Avoids two lookForAt calls per planned position (which is O(positions) lookForAt calls).
  const builtByType = new Map<StructureConstant, Set<string>>();
  const sitesByType = new Map<StructureConstant, Set<string>>();
  // Roads tracked as objects so leftover roads under planned obstacles can be cleared.
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

  // Resolve road↔obstacle tile conflicts. An extension/spawn/tower/etc. cannot
  // share a tile with a road, so when a planned obstacle lands on a leftover road
  // (e.g. after a layout change), clear that road — built or site — and drop the
  // tile from every planned road key so it isn't rebuilt. The obstacle's own
  // site goes down on a later pass, once the tile is free.
  const roadCompatible = new Set<StructureConstant>([
    STRUCTURE_ROAD,
    STRUCTURE_RAMPART,
    STRUCTURE_CONTAINER,
  ]);
  const roadKeys = Object.keys(mem).filter(
    (k) => structureTypeForKey(k) === STRUCTURE_ROAD
  );
  // Road keys that lost a tile to an obstacle. We drop the WHOLE key (not just the
  // conflicting tile) so the road planners re-derive/re-path it around the obstacle
  // next pass. Splicing a single tile out of a pathed artery would leave a permanent
  // gap — planRoadKey only re-paths a key whose list is empty.
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

  // Trim untouched road sites that exceed the per-room cap so they stop hogging
  // the global construction-site limit (MAX_CONSTRUCTION_SITES). Roads with energy
  // already invested are left alone; trimmed ones get re-placed once structures are
  // down. This is what lets an already-saturated room recover and start placing
  // extensions again.
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

  // Global site budget: never exceed the player-wide cap, and place economy
  // structures before roads/ramparts so roads can't monopolise the slots.
  let budget = MAX_CONSTRUCTION_SITES - Object.keys(Game.constructionSites).length;
  const keys = Object.keys(mem).sort(
    (a, b) => buildPriority(a) - buildPriority(b)
  );

  const perimeterKey = PLANNER_KEYS.STAMP_RAMPART_KEY;
  // Pace the perimeter purely by the number of CONCURRENT construction sites, never by
  // built-rampart HP. The previous HP gate (cap=0 while the weakest perimeter rampart was
  // below 1000 hits) deadlocked: a rampart completes at 1 hit, so the first one built
  // instantly pinned the cap to 0 — blocking the rest of the wall AND the replacement of any
  // rampart that later decayed to nothing. Construction sites don't decay, and the repair
  // system lifts freshly-built ramparts off 1 hit (findCriticalDefenseTarget prioritises
  // anything below 1000), so a flat concurrent-site cap is the correct, stall-free pacing.
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
        continue; // already built — don't keep in planned list
      }
      const comma = posStr.indexOf(",");
      const x = +posStr.slice(0, comma);
      const y = +posStr.slice(comma + 1);
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      keep.push(posStr); // retain the position even if no site is placed this tick
      if (sites?.has(posStr)) continue;
      if (budget <= 0) continue; // global cap reached — try again next pass
      if (isRoad && roadSiteCount >= roadCap) continue; // roads leave headroom
      if (key === perimeterKey && perimeterSiteCount >= perimeterCap) continue;
      let result: ScreepsReturnCode;
      if (type === STRUCTURE_SPAWN) {
        // Give every bot-built spawn an MU-themed name (Lorencia, Devias, …).
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
    if (set?.has(`${site.pos.x},${site.pos.y}`)) continue;
    // Don't scrap a site that already has energy invested (e.g. an extension
    // relocating during a layout change) — only clear untouched stray sites.
    if (site.progress > 0) continue;
    site.remove();
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
// Once a source container exists we also plan roads from it back toward home storage
// so remote miners/haulers can run road-weighted bodies (see orchestrator.spawning).
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
        if (existing) {
          // Container is built — its road back to storage is worth planning now.
          planRemoteRoad(homeRoom, existing.pos);
          continue;
        }
        sourceData.containerId = undefined;
      }

      // Check for a container already built near the source.
      const built = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (s): s is StructureContainer => s.structureType === STRUCTURE_CONTAINER,
      }) as StructureContainer[];
      if (built.length > 0) {
        sourceData.containerId = built[0].id;
        planRemoteRoad(homeRoom, built[0].pos);
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

// Cap on road construction sites planned per call. Construction sites share a small global pool
// (100) that the local economy must claim first, so we trickle remote roads out a few at a time.
const REMOTE_ROAD_SITES_PER_CALL = 5;

// Plan roads from a remote source container back toward home storage. Low priority by
// construction: we only place road sites for tiles whose room is currently visible (so we can
// confirm nothing is already there) and stop after a small per-call budget so remote roads never
// crowd out the economy on the global site cap. Idempotent — skips tiles that already hold a
// road / road site / blocking structure.
function planRemoteRoad(homeRoom: Room, from: RoomPosition) {
  const storage = homeRoom.storage;
  if (!storage) return; // no anchor to path back to yet

  const result = PathFinder.search(
    from,
    { pos: storage.pos, range: 1 },
    {
      plainCost: 2,
      swampCost: 10,
      maxOps: 4000,
      // Prefer existing roads; treat them as cheap so the path reuses the home road network.
      roomCallback: (roomName) => {
        const r = Game.rooms[roomName];
        if (!r) return new PathFinder.CostMatrix(); // unseen room — default costs
        const cm = new PathFinder.CostMatrix();
        for (const s of r.find(FIND_STRUCTURES)) {
          if (s.structureType === STRUCTURE_ROAD) cm.set(s.pos.x, s.pos.y, 1);
          else if (
            s.structureType !== STRUCTURE_CONTAINER &&
            s.structureType !== STRUCTURE_RAMPART
          ) {
            cm.set(s.pos.x, s.pos.y, 255); // block tiles occupied by solid structures
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
    if (!r) continue; // can't safely place into an unseen room
    // Skip if a road / road site already exists here.
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

  // Castle stamp: place RCL-appropriate structures
  applyCastleStamp(room);

  // Seal the base behind a defensive rampart curtain enclosing the stamp + the
  // freshly-planned extension rings. Self-gates on RCL and throttles its own
  // recompute; its tiles share STAMP_RAMPART_KEY so they inherit the low build
  // priority and existing rampart repair handling.
  planDefensivePerimeter(room);

  // Source containers
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

  // Energy links. The link engine only *sends* from miner-adjacent links to
  // controller/storage sinks, so a link is useless until it has a partner — there's no
  // value in the lone RCL5 link, so the first functional pair (source link + controller
  // link) lands together at RCL6. Per-RCL cap rollout: source link + controller @6,
  // storage-hub (placed by the castle stamp) @7, 2nd source link @8.
  if (room.controller) {
    const rcl = room.controller.level;

    // Controller link (sink) from RCL6.
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

    // Source links (senders). Rank sources by distance from storage so the farthest
    // (longest hauls saved) gets the first link @RCL6; remaining sources wait until RCL8.
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

  // Extractor — built ON the mineral (RCL6+). Without it the mineral can't be harvested at all,
  // so the prospector + mineral-sale pipeline never starts. Plan it once; the build loop places
  // the site (createConstructionSite is a no-op below RCL6) and drops it once built, and the
  // extractorId guard stops us re-planning afterwards.
  if (mineral && (room.controller?.level ?? 0) >= 6 && !room.memory.extractorId) {
    const extractorKey = `${PLANNER_KEYS.EXTRACTOR_PREFIX}${mineral.id}`;
    if (plannedPositionsFromMemory(room, extractorKey).length === 0) {
      addPlannedStructureToMemory(room, extractorKey, mineral.pos);
    }
  }

  // Cardinal arteries + economic connectors
  planCardinalArteries(room);

  removeRoadsAroundStructures(room);
  pruneRoadsUnderStructures(room);
  removeConnectorRoads(room);

  room.memory.lastStructurePlanTick = Game.time;
  // Ramparts for existing structures are handled by ensureRampartsForExistingStructures (runs every 5t).
}
