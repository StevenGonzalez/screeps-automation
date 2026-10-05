import {
  isSourceKeeperRoom,
  isPlayerCreep,
  isInvaderCreep,
  remoteThreats,
  findInvaderCore,
} from "../services/services.combat";
import {
  markRemotePlayerHostile,
  clearRemotePlayerHostile,
  markRemoteInvader,
  clearRemoteInvaderEntry,
} from "../services/services.creep";

declare global {
  interface RoomMemory {
    lastDeepScout?: number;
    // Deep (non-adjacent) rooms a scout could not reach, keyed to the retry tick.
    scoutSkipUntil?: Record<string, number>;
  }

  interface CreepMemory {
    scoutTravelTicks?: number;
  }

  interface RoomIntelData {
    controllerPos?: number;
    spawnPos?: number[];
    towerPos?: number[];
    sourcePos?: number[];
    storagePos?: number;
    storageEnergy?: number;
    storageMineral?: number;
    terminalPos?: number;
    terminalEnergy?: number;
    terminalMineral?: number;
    barrierHpTotal?: number;
    barrierHpMax?: number;
    mineralType?: MineralConstant;
  }

  interface PlayerIntelData {
    username: string;
    rooms: string[];
    roomCount: number;
    maxRcl: number;
    totalTowers: number;
    totalSpawns: number;
    militaryStrength: number;
    economicStrength: number;
    centroidX: number;
    centroidY: number;
    lastSeen: number;
  }

  interface Memory {
    players?: Record<string, PlayerIntelData>;
  }
}

const REMOTE_RESCAN_INTERVAL = 3000;
const DEVELOPING_SCAN_INTERVAL = 10;
const ESTABLISHED_SCAN_INTERVAL = 100;
const REMOTE_HOSTILE_EXPIRY = 2000;

const SCOUT_BFS_DEPTH = 2;
// The war council keeps a report for twice this (INTEL_TTL), so the old look
// is still there to set beside the new one.
const SCOUT_REFRESH_INTERVAL = 10_000;
const MAX_PENDING_SCOUT_ROOMS = 4;
const BFS_RUN_INTERVAL = 200;

export function loop() {
  cleanupDeadCreeps();
  initializeMemory();
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    processRoomMemory(room);
  }
  processRemoteRoomDiscovery();
  cleanupEstablishedExpansion();
  if (Game.time % ROOM_MEMORY_GC_INTERVAL === 0) collectRoomMemoryGarbage();
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

function processRoomMemory(room: Room) {
  if (!room.controller || !room.controller.my) return;
  const scanInterval =
    room.controller.level <= 3 ? DEVELOPING_SCAN_INTERVAL : ESTABLISHED_SCAN_INTERVAL;
  const structureDestroyed = hasStructureDestroyedEvent(room);
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

// The raw event log is a JSON string; only parse it on the rare tick that
// something was destroyed. Movement's cost matrix already rebuilds itself when
// the structure count changes, so this only triggers the memory rescan.
function hasStructureDestroyedEvent(room: Room): boolean {
  const raw = room.getEventLog(true) as unknown as string;
  if (!raw.includes(`"event":${EVENT_OBJECT_DESTROYED},`)) return false;
  return (JSON.parse(raw) as EventItem[]).some(
    (e) => e.event === EVENT_OBJECT_DESTROYED && e.data.type !== "creep"
  );
}

function processRemoteRoomDiscovery() {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my) continue;
    pruneRemoteRooms(room);
    discoverAdjacentRooms(room);
    discoverDeepRooms(room);
    refreshVisibleRemoteRooms(room);
  }
}

function discoverDeepRooms(room: Room): void {
  if (!room.memory.pendingScoutRooms) room.memory.pendingScoutRooms = [];

  const last = room.memory.lastDeepScout ?? 0;
  if (Game.time - last < BFS_RUN_INTERVAL) return;
  room.memory.lastDeepScout = Game.time;

  const skip = room.memory.scoutSkipUntil;
  if (skip) {
    for (const rn in skip) if (skip[rn] <= Game.time) delete skip[rn];
    if (Object.keys(skip).length === 0) delete room.memory.scoutSkipUntil;
  }

  if (room.memory.pendingScoutRooms.length >= MAX_PENDING_SCOUT_ROOMS) return;

  const ownedNames = new Set(
    Object.keys(Game.rooms).filter((rn) => Game.rooms[rn].controller?.my)
  );

  const intel = Memory.intel ?? {};
  const isFresh = (rn: string): boolean => {
    const seen = intel[rn]?.lastSeen;
    return seen !== undefined && Game.time - seen < SCOUT_REFRESH_INTERVAL;
  };

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

        if (ownedNames.has(neighbor)) {
          next.push(neighbor);
          continue;
        }
        const status = Game.map.getRoomStatus(neighbor).status;
        if (status === "closed" || status === "novice" || status === "respawn") continue;
        if (isSourceKeeperRoom(neighbor)) {
          next.push(neighbor);
          continue;
        }

        next.push(neighbor);

        if (isFresh(neighbor)) continue;
        if ((room.memory.scoutSkipUntil?.[neighbor] ?? 0) > Game.time) continue;
        if (room.memory.pendingScoutRooms.includes(neighbor)) continue;
        if (room.memory.pendingScoutRooms.length >= MAX_PENDING_SCOUT_ROOMS) return;

        const route = Game.map.findRoute(room.name, neighbor);
        if (route === ERR_NO_PATH) continue;

        room.memory.pendingScoutRooms.push(neighbor);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
}

// Remotes are only mined next door to home: deep scouting used to turn every
// surveyed room into one. A room we now own is a colony, not a remote to drain.
export function pruneRemoteRooms(room: Room): void {
  const remotes = room.memory.remoteRooms;
  if (!remotes || remotes.length === 0) return;
  const adjacent = new Set(Object.values(Game.map.describeExits(room.name)));
  const keep = remotes.filter(
    (r) => adjacent.has(r.roomName) && !Game.rooms[r.roomName]?.controller?.my
  );
  if (keep.length !== remotes.length) room.memory.remoteRooms = keep;
}

const FOREIGN_OWNED_RETRY = 20_000;

// Marks the remote hostile when another player owns or reserves its controller,
// and returns true if so. An Invader reservation is left to our reserver to clear.
export function applyRemoteControllerStatus(
  entry: RemoteRoomData,
  controller: StructureController | undefined,
  me: string | undefined
): boolean {
  if (!controller) return false;
  if (controller.owner && !controller.my) {
    entry.hostile = true;
    entry.hostileUntil = Game.time + FOREIGN_OWNED_RETRY;
    return true;
  }
  const reserver = controller.reservation?.username;
  if (!reserver || reserver === me || reserver === "Invader") return false;
  markRemotePlayerHostile(entry, reserver);
  return true;
}

export function discoverAdjacentRooms(room: Room) {
  if (!room.memory.pendingScoutRooms) room.memory.pendingScoutRooms = [];
  if (!room.memory.remoteRooms) room.memory.remoteRooms = [];

  const knownNames = new Set<string>([
    room.name,
    ...room.memory.remoteRooms.map((r) => r.roomName),
    ...room.memory.pendingScoutRooms,
    ...Object.keys(Game.rooms).filter(
      (rn) => Game.rooms[rn].controller?.my
    ),
  ]);

  room.memory.pendingScoutRooms = room.memory.pendingScoutRooms.filter(
    (rn) => !room.memory.remoteRooms!.some((r) => r.roomName === rn)
  );

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

  // Every adjacent room is a candidate; spawning ranks them by profit and
  // works as many as the home can afford (see getActiveRemoteRooms).
  const exits = Game.map.describeExits(room.name);
  for (const dir in exits) {
    const adjacentName = exits[dir as ExitKey];
    if (!adjacentName || knownNames.has(adjacentName)) continue;

    if (isSourceKeeperRoom(adjacentName) || isHighwayRoom(adjacentName)) continue;

    room.memory.pendingScoutRooms.push(adjacentName);
    knownNames.add(adjacentName);
  }
}

export function refreshVisibleRemoteRooms(room: Room) {
  if (!room.memory.remoteRooms) return;
  for (const remote of room.memory.remoteRooms) {
    const visible = Game.rooms[remote.roomName];
    if (!visible) continue;

    remote.lastSeen = Game.time;
    if (applyRemoteControllerStatus(remote, visible.controller, room.controller?.owner?.username)) {
      continue;
    }
    // An Invader core reserves the room and blocks harvesting; a knight has to clear it.
    const core = findInvaderCore(visible);
    if (core) markRemoteInvader(remote, visible);
    const hostiles = remoteThreats(visible);
    const player = hostiles.find(isPlayerCreep);
    if (player) {
      markRemotePlayerHostile(remote, player.owner.username);
      continue;
    }
    // Invader creeps get a knight sized to them, as a core does. Marking the
    // room hostile as well would drop it from the remotes this home works, and
    // knights are only sent to those, so no knight would ever come.
    if (hostiles.some(isInvaderCreep)) {
      clearRemotePlayerHostile(remote);
      markRemoteInvader(remote, visible);
      continue;
    }
    if (hostiles.length > 0) {
      remote.hostile = true;
      remote.hostileUntil = Game.time + REMOTE_HOSTILE_EXPIRY;
      continue;
    }
    clearRemotePlayerHostile(remote);
    // Seen clear, the room is safe for every castle that lists it. Only a
    // castle whose own creeps walked in used to clear its mark: the other's
    // stood for the whole window, and Thornbarrow sent a knight to the Crow
    // Glen after Embercrag's had already cleared it.
    if (!core) clearRemoteInvaderEntry(remote);

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

const ROOM_MEMORY_GC_INTERVAL = 1000;

// Every room a creep walks through gets a Memory.rooms entry via room.memory.
// Drop the ones nothing refers to; anything possibly in use is kept.
export function collectRoomMemoryGarbage(): void {
  if (!Memory.rooms) return;
  const keep = new Set<string>();
  for (const rn in Game.rooms) {
    // Visible rooms may be mid-use this tick; they get another chance next pass.
    keep.add(rn);
    const mem = Memory.rooms[rn];
    if (!Game.rooms[rn].controller?.my || !mem) continue;
    for (const r of mem.remoteRooms ?? []) keep.add(r.roomName);
    for (const r of mem.pendingScoutRooms ?? []) keep.add(r);
  }
  for (const op of Memory.skOps ?? []) keep.add(op.roomName);
  for (const op of Memory.powerOps ?? []) keep.add(op.roomName);
  for (const op of Memory.depositOps ?? []) keep.add(op.roomName);
  if (Memory.expansion) keep.add(Memory.expansion.roomName);
  for (const q of Memory.expansionQueue ?? []) keep.add(q.roomName);
  if (Memory.militaryOp) keep.add(Memory.militaryOp.targetRoom);
  for (const k in Memory.militaryOps ?? {}) keep.add(Memory.militaryOps![k].targetRoom);
  for (const q of Memory.militaryQueue ?? []) keep.add(q.targetRoom);
  for (const k in Memory.defenseOps ?? {}) keep.add(Memory.defenseOps![k].room);
  for (const k in Memory.drainOps ?? {}) keep.add(Memory.drainOps![k].targetRoom);

  for (const rn in Memory.rooms) {
    if (keep.has(rn)) continue;
    const mem = Memory.rooms[rn];
    // Planned-structure data has its own unseen-age cleanup in the structures orchestrator.
    if (mem?.plannedStructures || mem?.plannedStructuresMeta) continue;
    delete Memory.rooms[rn];
  }
}

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

function isHighwayRoom(roomName: string): boolean {
  const m = roomName.match(/^[WE](\d+)[NS](\d+)$/);
  if (!m) return false;
  return parseInt(m[1], 10) % 10 === 0 || parseInt(m[2], 10) % 10 === 0;
}
