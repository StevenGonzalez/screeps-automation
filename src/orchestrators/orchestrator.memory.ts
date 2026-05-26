const REMOTE_RESCAN_INTERVAL = 3000;  // re-queue a remote room for scouting this often
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
  if (!room.memory.lastScan || Game.time - room.memory.lastScan > 100) {
    const spawns = room.find(FIND_MY_SPAWNS);
    room.memory.spawnId = spawns.length > 0 ? spawns[0].id : undefined;

    const sources = room.find(FIND_SOURCES);
    room.memory.sourceIds = sources.map((s) => s.id);

    const minerals = room.find(FIND_MINERALS);
    room.memory.mineralId = minerals.length > 0 ? minerals[0].id : undefined;

    const containers = room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    }) as StructureContainer[];
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

    const towers = room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_TOWER,
    });
    room.memory.towerIds = towers.map((t) => t.id as Id<StructureTower>);

    const links = room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_LINK,
    });
    room.memory.linkIds = links.map((l) => l.id as Id<StructureLink>);

    const terminals = room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_TERMINAL,
    });
    room.memory.terminalId =
      terminals.length > 0 ? (terminals[0].id as Id<StructureTerminal>) : undefined;

    const extractors = room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_EXTRACTOR,
    });
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
    }

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

    // Skip source-keeper and highway rooms (coordinates both divisible by 5)
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

type ExitKey = "1" | "3" | "5" | "7";

function isSourceKeeperRoom(roomName: string): boolean {
  const match = roomName.match(/^[WE](\d+)[NS](\d+)$/);
  if (!match) return false;
  const x = parseInt(match[1], 10) % 10;
  const y = parseInt(match[2], 10) % 10;
  // SK rooms: both coordinates land in the 4-5 range of each 10-room sector
  return (x === 4 || x === 5) && (y === 4 || y === 5);
}
