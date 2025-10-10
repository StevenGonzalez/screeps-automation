/**
 * Remote Room Scouting
 *
 * Analyzes nearby rooms for remote mining viability
 * - Safety analysis (hostiles, enemy structures)
 * - Source counting and positions
 * - Path distance calculation
 * - Threat level assessment
 */

import { getRoomMemory } from "../global.memory";

export interface RemoteRoomScan {
  roomName: string;
  scannedAt: number;
  viable: boolean;
  score: number;
  sources: { id: Id<Source>; pos: { x: number; y: number } }[];
  distance: number; // Path distance from home room
  threats: {
    hasHostileStructures: boolean;
    hasHostileCreeps: boolean;
    isReserved: boolean;
    reservedBy?: string;
    adjacentToHostile: boolean;
  };
  terrain: {
    swampPercent: number;
  };
  reason?: string; // Why not viable
}

/**
 * Scan a room for remote mining viability
 */
export function scanRemoteRoom(
  homeRoom: Room,
  targetRoomName: string
): RemoteRoomScan | null {
  // Check if we have vision
  const room = Game.rooms[targetRoomName];
  if (!room) {
    return null; // Need to send a scout
  }

  // Setup memory cache early
  const mem = getRoomMemory(targetRoomName);
  mem.remote = mem.remote || {};
  const remoteData = mem.remote as any;

  const scan: RemoteRoomScan = {
    roomName: targetRoomName,
    scannedAt: Game.time,
    viable: false,
    score: 0,
    sources: [],
    distance: 0,
    threats: {
      hasHostileStructures: false,
      hasHostileCreeps: false,
      isReserved: false,
      adjacentToHostile: false,
    },
    terrain: {
      swampPercent: 0,
    },
  };

  // Check for hostile structures (spawns, towers)
  const hostileStructures = room.find(FIND_HOSTILE_STRUCTURES, {
    filter: (s) =>
      s.structureType === STRUCTURE_SPAWN ||
      s.structureType === STRUCTURE_TOWER ||
      s.structureType === STRUCTURE_KEEPER_LAIR,
  });

  if (hostileStructures.length > 0) {
    scan.viable = false;
    scan.reason = "Hostile structures present";
    scan.threats.hasHostileStructures = true;
    return scan;
  }

  // Check for hostile creeps with combat parts
  const hostileCreeps = room.find(FIND_HOSTILE_CREEPS, {
    filter: (c) =>
      c.getActiveBodyparts(ATTACK) > 0 ||
      c.getActiveBodyparts(RANGED_ATTACK) > 0 ||
      c.owner.username === "Invader",
  });

  if (hostileCreeps.length > 0) {
    scan.threats.hasHostileCreeps = true;
  }

  // Check controller reservation
  if (room.controller && homeRoom.controller && homeRoom.controller.owner) {
    if (room.controller.reservation) {
      if (
        room.controller.reservation.username !==
        homeRoom.controller.owner.username
      ) {
        scan.viable = false;
        scan.reason = `Reserved by ${room.controller.reservation.username}`;
        scan.threats.isReserved = true;
        scan.threats.reservedBy = room.controller.reservation.username;
        return scan;
      }
    }

    // Check if room is owned by someone else
    if (
      room.controller.owner &&
      room.controller.owner.username !== homeRoom.controller.owner.username
    ) {
      scan.viable = false;
      scan.reason = `Owned by ${room.controller.owner.username}`;
      scan.threats.hasHostileStructures = true;
      return scan;
    }
  }

  // Check if adjacent to hostile rooms
  const exits = Game.map.describeExits(targetRoomName);
  if (exits) {
    for (const direction in exits) {
      const adjacentRoom = exits[direction as keyof typeof exits];
      if (adjacentRoom && isHostileRoom(adjacentRoom)) {
        scan.threats.adjacentToHostile = true;
        break;
      }
    }
  }

  // Find sources
  const sources = room.find(FIND_SOURCES);
  scan.sources = sources.map((s) => ({
    id: s.id,
    pos: { x: s.pos.x, y: s.pos.y },
  }));

  // Must have at least 1 source
  if (scan.sources.length === 0) {
    scan.viable = false;
    scan.reason = "No sources found";
    return scan;
  }

  // Calculate path distance from home room spawn
  const homeSpawn = homeRoom.find(FIND_MY_SPAWNS)[0];
  if (!homeSpawn) {
    scan.viable = false;
    scan.reason = "No home spawn";
    return scan;
  }

  // Use first source for distance calculation
  // CACHED: Path distance cached for 500 ticks (expensive operation)
  const firstSource = sources[0];
  const cacheKey = `${homeRoom.name}_${targetRoomName}`;

  if (!remoteData.pathCache) remoteData.pathCache = {};
  const pathCache = remoteData.pathCache[cacheKey];

  if (pathCache && Game.time - pathCache.tick < 500) {
    scan.distance = pathCache.distance;
    if (pathCache.incomplete) {
      scan.viable = false;
      scan.reason = "Path incomplete";
      return scan;
    }
  } else {
    const path = PathFinder.search(
      homeSpawn.pos,
      { pos: firstSource.pos, range: 1 },
      {
        plainCost: 2,
        swampCost: 10,
        maxOps: 4000,
        roomCallback: (roomName) => {
          // Avoid hostile rooms
          if (isHostileRoom(roomName)) {
            return false as any;
          }
          return undefined;
        },
      }
    );

    // Cache the result
    remoteData.pathCache[cacheKey] = {
      distance: path.path.length,
      incomplete: path.incomplete,
      tick: Game.time,
    };

    if (path.incomplete) {
      scan.viable = false;
      scan.reason = "Path incomplete";
      return scan;
    }

    scan.distance = path.path.length;
  }

  // Too far away (> 150 tiles)
  if (scan.distance > 150) {
    scan.viable = false;
    scan.reason = `Too far (${scan.distance} tiles)`;
    return scan;
  }

  // Calculate swamp percentage (CACHED - terrain never changes)
  if (typeof remoteData.swampPercent !== "number") {
    const terrain = room.getTerrain();
    let swampTiles = 0;
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        if (terrain.get(x, y) === TERRAIN_MASK_SWAMP) {
          swampTiles++;
        }
      }
    }
    remoteData.swampPercent = swampTiles / 2500;
  }
  scan.terrain.swampPercent = remoteData.swampPercent;

  // Calculate viability score
  scan.score = calculateRemoteScore(scan);

  // Room is viable if score is positive and no blocking threats
  scan.viable = scan.score > 0 && !scan.threats.adjacentToHostile;

  if (!scan.viable && !scan.reason) {
    scan.reason = "Low viability score";
  }

  return scan;
}

/**
 * Calculate viability score for a remote room
 * Higher score = better room
 */
function calculateRemoteScore(scan: RemoteRoomScan): number {
  let score = 0;

  // Base score: sources (each source is very valuable)
  score += scan.sources.length * 100;

  // Distance penalty (closer is better)
  score -= scan.distance * 0.5;

  // Swamp penalty
  score -= scan.terrain.swampPercent * 20;

  // Threat penalties
  if (scan.threats.hasHostileCreeps) score -= 50;
  if (scan.threats.adjacentToHostile) score -= 100;

  return score;
}

/**
 * Check if a room is hostile (has enemy spawns/towers)
 * CACHED: Results cached for 100 ticks
 */
function isHostileRoom(roomName: string): boolean {
  const room = Game.rooms[roomName];
  if (!room) {
    // Unknown room - check memory cache
    const mem = getRoomMemory(roomName);
    const remoteData = (mem.remote as any) || {};
    if (
      remoteData.hostileCache &&
      Game.time - remoteData.hostileCache.tick < 100
    ) {
      return remoteData.hostileCache.hostile;
    }
    return remoteData.hostile === true;
  }

  // Check cache first
  const mem = getRoomMemory(roomName);
  mem.remote = mem.remote || {};
  const remoteData = mem.remote as any;
  remoteData.hostileCache = remoteData.hostileCache || {};

  if (
    remoteData.hostileCache.tick &&
    Game.time - remoteData.hostileCache.tick < 100
  ) {
    return remoteData.hostileCache.hostile;
  }

  // Calculate and cache
  const hostileStructures = room.find(FIND_HOSTILE_STRUCTURES, {
    filter: (s) =>
      s.structureType === STRUCTURE_SPAWN ||
      s.structureType === STRUCTURE_TOWER,
  });

  const isHostile = hostileStructures.length > 0;
  remoteData.hostileCache = {
    hostile: isHostile,
    tick: Game.time,
  };

  return isHostile;
}

/**
 * Get list of adjacent rooms to scan
 * CACHED: Results cached for 10000 ticks (room exits don't change)
 */
export function getAdjacentRooms(roomName: string): string[] {
  const mem = getRoomMemory(roomName);
  mem.remote = mem.remote || {};
  const remoteData = mem.remote as any;
  remoteData.adjacentCache = remoteData.adjacentCache || {};

  // Cache adjacent rooms for a very long time (exits don't change)
  if (
    remoteData.adjacentCache.rooms &&
    Game.time - remoteData.adjacentCache.tick < 10000
  ) {
    return remoteData.adjacentCache.rooms;
  }

  const exits = Game.map.describeExits(roomName);
  if (!exits) {
    remoteData.adjacentCache = { rooms: [], tick: Game.time };
    return [];
  }

  const rooms: string[] = [];
  for (const direction in exits) {
    const adjacentRoom = exits[direction as keyof typeof exits];
    if (adjacentRoom) {
      rooms.push(adjacentRoom);
    }
  }

  remoteData.adjacentCache = { rooms, tick: Game.time };
  return rooms;
}

/**
 * Find best remote rooms for a home room
 */
export function findBestRemoteRooms(
  homeRoom: Room,
  maxRemotes: number = 3
): RemoteRoomScan[] {
  const mem = getRoomMemory(homeRoom.name);
  mem.remote = mem.remote || {};
  const remoteMem = mem.remote as any;
  remoteMem.scans = remoteMem.scans || {};

  const scans: RemoteRoomScan[] = [];

  // Get adjacent rooms
  const adjacentRooms = getAdjacentRooms(homeRoom.name);

  // Scan each adjacent room
  for (const roomName of adjacentRooms) {
    // Skip if scanned recently (within 500 ticks)
    const cachedScan = remoteMem.scans[roomName];
    if (cachedScan && Game.time - cachedScan.scannedAt < 500) {
      scans.push(cachedScan);
      continue;
    }

    // Scan room
    const scan = scanRemoteRoom(homeRoom, roomName);
    if (scan) {
      remoteMem.scans[roomName] = scan;
      scans.push(scan);
    }
  }

  // Sort by score (best first)
  const viableScans = scans
    .filter((s) => s.viable)
    .sort((a, b) => b.score - a.score);

  // Return top N
  return viableScans.slice(0, maxRemotes);
}

/**
 * Check if a remote room is still safe to operate in
 */
export function isRemoteRoomSafe(roomName: string): boolean {
  const room = Game.rooms[roomName];
  if (!room) return true; // No vision, assume safe

  // Check for hostile creeps with combat parts
  const hostileCreeps = room.find(FIND_HOSTILE_CREEPS, {
    filter: (c) =>
      c.getActiveBodyparts(ATTACK) > 0 ||
      c.getActiveBodyparts(RANGED_ATTACK) > 0 ||
      c.owner.username === "Invader",
  });

  return hostileCreeps.length === 0;
}
