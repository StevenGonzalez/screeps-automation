import { isSourceKeeperRoom } from "../services/services.combat";

const REMOTE_RESCAN_INTERVAL = 3000;
const DEVELOPING_SCAN_INTERVAL = 10;
const ESTABLISHED_SCAN_INTERVAL = 100;
const REMOTE_HOSTILE_EXPIRY = 2000;   // re-consider hostile remote rooms after this many ticks
const MAX_REMOTE_ROOMS = 3;           // max adjacent rooms to mine per owned room

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
    refreshVisibleRemoteRooms(room);
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
    remote.hostile = hostiles.length > 0;
    if (remote.hostile) {
      remote.hostileUntil = Game.time + REMOTE_HOSTILE_EXPIRY;
      continue;
    }

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
