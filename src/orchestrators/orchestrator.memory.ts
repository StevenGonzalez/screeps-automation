import { isSourceKeeperRoom, isPlayerCreep } from "../services/services.combat";
import {
  markRemotePlayerHostile,
  clearRemotePlayerHostile,
} from "../services/services.creep";
import { invalidateCostMatrix } from "../services/services.movement";

// Augment the shared declarations in types.d.ts (interface merging). These add deep-scout
// bookkeeping, the persistent attack-planning fields on RoomIntelData, and the per-player
// empire model — without touching types.d.ts. Existing fields are declared there.
declare global {
  interface RoomMemory {
    // Last tick the deep-exploration BFS ran for this owned room (throttle).
    lastDeepScout?: number;
  }

  interface CreepMemory {
    // Scout: ticks spent trying to reach the current targetRoom (travel budget guard).
    scoutTravelTicks?: number;
  }

  // Persistent, vision-independent intel for attack planning. All new fields are optional
  // and only populated when the room was last seen with vision; readers must tolerate
  // their absence (the room may have been intel'd before these existed). Coordinates are
  // packed as x*50+y to stay compact.
  interface RoomIntelData {
    // Packed controller position (x*50+y), if the room has a controller.
    controllerPos?: number;
    // Packed spawn / tower / source positions (x*50+y each).
    spawnPos?: number[];
    towerPos?: number[];
    sourcePos?: number[];
    // Packed storage/terminal positions + their stored energy and total non-energy load.
    storagePos?: number;
    storageEnergy?: number;
    storageMineral?: number;
    terminalPos?: number;
    terminalEnergy?: number;
    terminalMineral?: number;
    // Defensive barrier strength: summed rampart+wall hits and the single toughest barrier.
    barrierHpTotal?: number;
    barrierHpMax?: number;
    // Mineral type present in the room (for raid value / lab planning).
    mineralType?: MineralConstant;
  }

  // Aggregate empire model for one enemy player, distilled from their room intel. Built and
  // pruned in the WarCouncil scan. Unblocks value-based target selection (a later task).
  interface PlayerIntelData {
    username: string;
    rooms: string[];          // owned room names (bounded)
    roomCount: number;
    maxRcl: number;
    totalTowers: number;
    totalSpawns: number;
    // Coarse strength estimates: military = towers+barriers+rcl; economic = storage/terminal loot.
    militaryStrength: number;
    economicStrength: number;
    // Territory centroid as average room coords (sector grid), for distance/expansion reasoning.
    centroidX: number;
    centroidY: number;
    lastSeen: number;
  }

  interface Memory {
    // Per-player empire aggregates keyed by username. Pruned when not seen in a long time.
    players?: Record<string, PlayerIntelData>;
  }
}

const REMOTE_RESCAN_INTERVAL = 3000;
const DEVELOPING_SCAN_INTERVAL = 10;
const ESTABLISHED_SCAN_INTERVAL = 100;
const REMOTE_HOSTILE_EXPIRY = 2000;   // re-consider hostile remote rooms after this many ticks
const MAX_REMOTE_ROOMS = 3;           // max adjacent rooms to mine per owned room

// ── Deep map exploration (BFS) ──────────────────────────────────────────────────
// Beyond the adjacent rooms queued for remote mining, scouts explore outward in a
// breadth-first sweep so the WarCouncil/empire model has real map knowledge. The BFS
// runs per owned room, expands the frontier through Game.map.describeExits, and stops
// at SCOUT_BFS_DEPTH rooms out. A room is (re-)queued only when its intel is missing or
// stale, so fresh rooms aren't re-walked but old ones get refreshed.
const SCOUT_BFS_DEPTH = 2;            // how many rooms outward the BFS reaches. Kept shallow:
                                     // each scouted room stores a rich intel record, and a deep
                                     // sweep (depth 6 = ~100+ rooms) bloats Memory, whose
                                     // per-tick (de)serialization is a hidden CPU tax. Raise it
                                     // only with CPU headroom and a real need for far-map intel.
const SCOUT_REFRESH_INTERVAL = 10_000; // re-scout a room whose intel is older than this
// Cap concurrent pending rooms low: the spawner raises ~one scout per unclaimed pending
// room, and each scout now services MANY rooms over its life (chaining through the queue).
// The BFS refills this cap every BFS_RUN_INTERVAL as the scout drains it, so exploration
// still progresses outward over time without ever fielding a swarm of scouts at once.
const MAX_PENDING_SCOUT_ROOMS = 4;    // hard cap on a room's scout queue (scout count + memory bound)
const BFS_RUN_INTERVAL = 200;         // only re-run the (cheap but non-trivial) BFS this often

export function loop() {
  cleanupDeadCreeps();
  initializeMemory();
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    processRoomMemory(room);
  }
  processRemoteRoomDiscovery();
  cleanupEstablishedExpansion();
}

function cleanupDeadCreeps() {
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) {
      delete Memory.creeps[name];
    }
  }
}

function initializeMemory() {
  if (!Memory.uuid) {
    Memory.uuid = 0;
  }
}

/**
 * Refreshes a room's cached structure, source and mineral IDs. Scans frequently
 * while the room is developing (these IDs gate miner/hauler spawning) and lazily
 * once established.
 */
function processRoomMemory(room: Room) {
  if (!room.controller || !room.controller.my) return;
  const scanInterval =
    room.controller.level <= 3 ? DEVELOPING_SCAN_INTERVAL : ESTABLISHED_SCAN_INTERVAL;
  // Self-heal the cache the moment a structure is destroyed. Otherwise a tower/container/
  // spawn killed mid-interval leaves a dead ID cached for up to 100 ticks; consumers that
  // deref it (Game.getObjectById -> null) throw under runSafe and silently go dark for the
  // window — worst exactly during the attack that destroyed it.
  const structureDestroyed = room
    .getEventLog()
    .some((e) => e.event === EVENT_OBJECT_DESTROYED && e.data.type !== "creep");
  // A destroyed structure changes the room's pathing matrix; drop the cached cost matrix
  // so the traffic manager rebuilds it instead of routing around a structure that's gone.
  if (structureDestroyed) invalidateCostMatrix(room.name);
  if (
    structureDestroyed ||
    !room.memory.lastScan ||
    Game.time - room.memory.lastScan > scanInterval
  ) {
    const spawns = room.find(FIND_MY_SPAWNS);
    room.memory.spawnId = spawns.length > 0 ? spawns[0].id : undefined;

    const sources = room.find(FIND_SOURCES);
    room.memory.sourceIds = sources.map((s) => s.id);

    const minerals = room.find(FIND_MINERALS);
    room.memory.mineralId = minerals.length > 0 ? minerals[0].id : undefined;

    // One structure scan shared by every structure-type lookup below. In an owned
    // room every link/observer/power-spawn is ours, so filtering FIND_STRUCTURES by
    // type is equivalent to the per-type FIND_MY_STRUCTURES calls this replaced.
    const structures = room.find(FIND_STRUCTURES);
    const byType = <T extends AnyStructure>(type: StructureConstant): T[] =>
      structures.filter((s) => s.structureType === type) as T[];

    const containers = byType<StructureContainer>(STRUCTURE_CONTAINER);
    room.memory.containerIds = containers.map((c) => c.id as Id<StructureContainer>);

    const minerContainerIds: Id<StructureContainer>[] = [];
    for (const c of containers) {
      for (const s of sources) {
        if (c.pos.getRangeTo(s.pos) <= 1) {
          minerContainerIds.push(c.id as Id<StructureContainer>);
          break;
        }
      }
    }
    room.memory.minerContainerIds = minerContainerIds;

    if (room.controller) {
      const controllerContainers = containers.filter(
        (c) => c.pos.getRangeTo(room.controller!.pos) <= 2
      );
      if (controllerContainers.length > 0) {
        const closest = room.controller!.pos.findClosestByPath(controllerContainers);
        room.memory.upgradeContainerId = closest
          ? (closest.id as Id<StructureContainer>)
          : undefined;
      } else {
        room.memory.upgradeContainerId = undefined;
      }
    }

    const towers = byType<StructureTower>(STRUCTURE_TOWER);
    room.memory.towerIds = towers.map((t) => t.id as Id<StructureTower>);

    const links = byType<StructureLink>(STRUCTURE_LINK);
    room.memory.linkIds = links.map((l) => l.id as Id<StructureLink>);

    const terminals = byType<StructureTerminal>(STRUCTURE_TERMINAL);
    room.memory.terminalId =
      terminals.length > 0 ? (terminals[0].id as Id<StructureTerminal>) : undefined;

    const extractors = byType<StructureExtractor>(STRUCTURE_EXTRACTOR);
    room.memory.extractorId =
      extractors.length > 0 ? (extractors[0].id as Id<StructureExtractor>) : undefined;

    if (minerals.length > 0) {
      const mineralContainers = containers.filter(
        (c) => c.pos.getRangeTo(minerals[0].pos) <= 1
      );
      room.memory.mineralContainerId =
        mineralContainers.length > 0
          ? (mineralContainers[0].id as Id<StructureContainer>)
          : undefined;
    } else {
      room.memory.mineralContainerId = undefined;
    }

    const observers = byType<StructureObserver>(STRUCTURE_OBSERVER);
    room.memory.observerId =
      observers.length > 0 ? (observers[0].id as Id<StructureObserver>) : undefined;

    const powerSpawns = byType<StructurePowerSpawn>(STRUCTURE_POWER_SPAWN);
    room.memory.powerSpawnId =
      powerSpawns.length > 0 ? (powerSpawns[0].id as Id<StructurePowerSpawn>) : undefined;

    room.memory.lastScan = Game.time;
  }
}

function processRemoteRoomDiscovery() {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my) continue;
    discoverAdjacentRooms(room);
    discoverDeepRooms(room);
    refreshVisibleRemoteRooms(room);
  }
}

// Breadth-first exploration of the map outward from an owned room. Expands the frontier
// through described exits up to SCOUT_BFS_DEPTH, queuing any room whose intel is missing
// or stale into pendingScoutRooms (which the scout role/spawner already drain). Closed and
// novice/respawn-protected rooms are skipped (unreachable / can't be entered), and SK rooms
// are skipped (an unguarded MOVE-only scout dies there). Reachability is verified with
// Game.map.findRoute before queuing so we never strand a scout against a sealed border.
//
// The BFS uses Memory.intel[room].lastSeen as the global "last scouted" timestamp — both
// the scout (on arrival) and the WarCouncil (on vision) keep it fresh, so this naturally
// avoids re-queuing fresh rooms while refreshing stale ones.
function discoverDeepRooms(room: Room): void {
  if (!room.memory.pendingScoutRooms) room.memory.pendingScoutRooms = [];

  // Throttle: BFS frontier doesn't change tick to tick, and a busy queue shouldn't grow.
  const last = room.memory.lastDeepScout ?? 0;
  if (Game.time - last < BFS_RUN_INTERVAL) return;
  room.memory.lastDeepScout = Game.time;

  if (room.memory.pendingScoutRooms.length >= MAX_PENDING_SCOUT_ROOMS) return;

  const ownedNames = new Set(
    Object.keys(Game.rooms).filter((rn) => Game.rooms[rn].controller?.my)
  );

  const intel = Memory.intel ?? {};
  const isFresh = (rn: string): boolean => {
    const seen = intel[rn]?.lastSeen;
    return seen !== undefined && Game.time - seen < SCOUT_REFRESH_INTERVAL;
  };

  // Standard BFS over the room graph. `visited` guards against re-expanding a room; the
  // frontier carries depth so we stop expanding past SCOUT_BFS_DEPTH.
  const visited = new Set<string>([room.name]);
  let frontier: string[] = [room.name];

  for (let depth = 0; depth < SCOUT_BFS_DEPTH; depth++) {
    const next: string[] = [];
    for (const current of frontier) {
      const exits = Game.map.describeExits(current);
      for (const dir in exits) {
        const neighbor = exits[dir as ExitKey];
        if (!neighbor || visited.has(neighbor)) continue;
        visited.add(neighbor);

        // Don't queue our own rooms or rooms we can't/shouldn't enter.
        if (ownedNames.has(neighbor)) {
          next.push(neighbor); // still expand THROUGH it to reach rooms beyond
          continue;
        }
        const status = Game.map.getRoomStatus(neighbor).status;
        if (status === "closed" || status === "novice" || status === "respawn") continue;
        if (isSourceKeeperRoom(neighbor)) {
          next.push(neighbor); // pathable corridor, just don't scout it
          continue;
        }

        next.push(neighbor); // keep exploring outward from here regardless

        if (isFresh(neighbor)) continue;
        if (room.memory.pendingScoutRooms.includes(neighbor)) continue;
        if (room.memory.pendingScoutRooms.length >= MAX_PENDING_SCOUT_ROOMS) return;

        // Confirm there's an actual route (the border may be sealed even if exits exist),
        // so the scout isn't sent toward an unreachable room it can never clear.
        const route = Game.map.findRoute(room.name, neighbor);
        if (route === ERR_NO_PATH) continue;

        room.memory.pendingScoutRooms.push(neighbor);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
}

function discoverAdjacentRooms(room: Room) {
  if (!room.memory.pendingScoutRooms) room.memory.pendingScoutRooms = [];
  if (!room.memory.remoteRooms) room.memory.remoteRooms = [];

  const knownNames = new Set<string>([
    room.name,
    ...room.memory.remoteRooms.map((r) => r.roomName),
    ...room.memory.pendingScoutRooms,
    // Don't queue rooms that are already owned
    ...Object.keys(Game.rooms).filter(
      (rn) => Game.rooms[rn].controller?.my
    ),
  ]);

  // Expire stale pending rooms that were never scouted (creep died in transit)
  // Re-add them below if still needed
  room.memory.pendingScoutRooms = room.memory.pendingScoutRooms.filter(
    (rn) => !room.memory.remoteRooms!.some((r) => r.roomName === rn)
  );

  // Re-queue remote rooms that haven't been seen in a while
  for (const remote of room.memory.remoteRooms) {
    const expired = Game.time - remote.lastSeen > REMOTE_RESCAN_INTERVAL;
    const hostileExpired =
      remote.hostile &&
      remote.hostileUntil !== undefined &&
      Game.time > remote.hostileUntil;
    if ((expired || hostileExpired) && !room.memory.pendingScoutRooms.includes(remote.roomName)) {
      room.memory.pendingScoutRooms.push(remote.roomName);
    }
  }

  // Only queue new adjacent rooms if we haven't hit the remote room cap
  const activeRemoteCount = room.memory.remoteRooms.filter((r) => !r.hostile).length;
  if (activeRemoteCount >= MAX_REMOTE_ROOMS) return;

  const exits = Game.map.describeExits(room.name);
  for (const dir in exits) {
    const adjacentName = exits[dir as ExitKey];
    if (!adjacentName || knownNames.has(adjacentName)) continue;

    // Skip source-keeper rooms — unguarded remote miners/reservers would die there.
    if (isSourceKeeperRoom(adjacentName)) continue;

    room.memory.pendingScoutRooms.push(adjacentName);
    knownNames.add(adjacentName);

    if (room.memory.pendingScoutRooms.length + activeRemoteCount >= MAX_REMOTE_ROOMS) break;
  }
}

function refreshVisibleRemoteRooms(room: Room) {
  if (!room.memory.remoteRooms) return;
  for (const remote of room.memory.remoteRooms) {
    const visible = Game.rooms[remote.roomName];
    if (!visible) continue;

    remote.lastSeen = Game.time;
    const hostiles = visible.find(FIND_HOSTILE_CREEPS);
    if (hostiles.some(isPlayerCreep)) {
      // Player present — escalating backoff (don't stomp it with the flat window below).
      markRemotePlayerHostile(remote);
      continue;
    }
    if (hostiles.length > 0) {
      remote.hostile = true;
      remote.hostileUntil = Game.time + REMOTE_HOSTILE_EXPIRY;
      continue;
    }
    clearRemotePlayerHostile(remote);

    // Refresh source → container mapping while the room is visible
    const sources = visible.find(FIND_SOURCES);
    for (const source of sources) {
      let entry = remote.sources.find((s) => s.sourceId === source.id);
      if (!entry) {
        entry = { sourceId: source.id };
        remote.sources.push(entry);
      }
      const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (s): s is StructureContainer =>
          s.structureType === STRUCTURE_CONTAINER,
      }) as StructureContainer[];
      entry.containerId = containers.length > 0 ? containers[0].id : undefined;
    }
  }
}

// Auto-clear expansion data 1000 ticks after the new room is established so
// it doesn't accumulate stale state across multiple expansion cycles.
const EXPANSION_CLEANUP_DELAY = 1000;

function cleanupEstablishedExpansion() {
  const exp = Memory.expansion;
  if (!exp || exp.phase !== "established") return;
  if (!exp.establishedAt) {
    exp.establishedAt = Game.time;
    return;
  }
  if (Game.time - exp.establishedAt > EXPANSION_CLEANUP_DELAY) {
    console.log(`[Expansion] Clearing expansion record for ${exp.roomName}`);
    delete Memory.expansion;
  }
}

type ExitKey = "1" | "3" | "5" | "7";
