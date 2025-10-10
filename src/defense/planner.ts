/**
 * Defense Planner
 *
 * Analyzes room layout and plans optimal defense structure placement
 * - Ramparts on all critical structures
 * - Layered rampart rings around core
 * - Strategic wall segments at room exits
 */

export interface DefensePlan {
  ramparts: RoomPosition[];
  walls: RoomPosition[];
  layers: {
    core: RoomPosition[]; // Innermost layer (critical structures)
    inner: RoomPosition[]; // First ring around core
    outer: RoomPosition[]; // Second ring
  };
  exitWalls: RoomPosition[]; // Wall segments at exits
}

// Cache defense plans to avoid expensive recalculation every tick
const defensePlanCache: {
  [roomName: string]: { plan: DefensePlan; time: number };
} = {};
const CACHE_DURATION = 100; // Cache for 100 ticks (static layout)

/**
 * Create a comprehensive defense plan for a room (cached)
 */
export function planRoomDefense(room: Room): DefensePlan {
  // Check cache first
  const cached = defensePlanCache[room.name];
  if (cached && Game.time - cached.time < CACHE_DURATION) {
    return cached.plan;
  }

  // Generate new plan
  const plan = generateDefensePlan(room);

  // Cache it
  defensePlanCache[room.name] = { plan, time: Game.time };

  return plan;
}

/**
 * Generate a fresh defense plan (internal, expensive)
 */
function generateDefensePlan(room: Room): DefensePlan {
  const plan: DefensePlan = {
    ramparts: [],
    walls: [],
    layers: {
      core: [],
      inner: [],
      outer: [],
    },
    exitWalls: [],
  };

  // Find the room center (spawn/storage cluster)
  const center = findRoomCenter(room);
  if (!center) return plan;

  // Step 1: Ramparts on all critical structures
  const criticalStructures = room.find(FIND_MY_STRUCTURES, {
    filter: (s) =>
      s.structureType === STRUCTURE_SPAWN ||
      s.structureType === STRUCTURE_STORAGE ||
      s.structureType === STRUCTURE_TERMINAL ||
      s.structureType === STRUCTURE_TOWER ||
      s.structureType === STRUCTURE_EXTENSION ||
      s.structureType === STRUCTURE_LAB ||
      s.structureType === STRUCTURE_POWER_SPAWN ||
      s.structureType === STRUCTURE_NUKER ||
      s.structureType === STRUCTURE_FACTORY ||
      s.structureType === STRUCTURE_LINK,
  });

  for (const structure of criticalStructures) {
    plan.ramparts.push(structure.pos);
    plan.layers.core.push(structure.pos);
  }

  // Step 2: Create rampart rings around the core
  const innerRing = getRingPositions(room, center, 3);
  const outerRing = getRingPositions(room, center, 5);

  for (const pos of innerRing) {
    if (!isPositionBlocked(pos) && !hasRampart(plan.ramparts, pos)) {
      plan.ramparts.push(pos);
      plan.layers.inner.push(pos);
    }
  }

  for (const pos of outerRing) {
    if (!isPositionBlocked(pos) && !hasRampart(plan.ramparts, pos)) {
      plan.ramparts.push(pos);
      plan.layers.outer.push(pos);
    }
  }

  // Step 3: Fortify room exits with wall segments
  const exits = findExitPositions(room);
  for (const exitGroup of exits) {
    // Place 3-5 wall segments at each exit
    const wallPositions = selectExitWallPositions(exitGroup, 5);
    for (const pos of wallPositions) {
      if (!isPositionBlocked(pos)) {
        plan.walls.push(pos);
        plan.exitWalls.push(pos);
      }
    }
  }

  return plan;
}

/**
 * Invalidate cache for a room (call when major layout changes)
 */
export function invalidateDefensePlanCache(roomName: string): void {
  delete defensePlanCache[roomName];
}

/**
 * Find the center of the room (spawn/storage cluster)
 */
function findRoomCenter(room: Room): RoomPosition | null {
  const spawns = room.find(FIND_MY_SPAWNS);
  const storage = room.storage;

  if (spawns.length === 0) return null;

  // If we have storage, center between storage and spawns
  if (storage) {
    const spawnPos = spawns[0].pos;
    const centerX = Math.floor((storage.pos.x + spawnPos.x) / 2);
    const centerY = Math.floor((storage.pos.y + spawnPos.y) / 2);
    return new RoomPosition(centerX, centerY, room.name);
  }

  // Otherwise, center on first spawn
  return spawns[0].pos;
}

/**
 * Get positions in a ring around a center point
 */
function getRingPositions(
  room: Room,
  center: RoomPosition,
  radius: number
): RoomPosition[] {
  const positions: RoomPosition[] = [];

  for (let x = center.x - radius; x <= center.x + radius; x++) {
    for (let y = center.y - radius; y <= center.y + radius; y++) {
      // Check if position is on the ring (not inside or outside)
      const dx = Math.abs(x - center.x);
      const dy = Math.abs(y - center.y);
      const distance = Math.max(dx, dy); // Chebyshev distance

      if (distance === radius && x >= 1 && x <= 48 && y >= 1 && y <= 48) {
        positions.push(new RoomPosition(x, y, room.name));
      }
    }
  }

  return positions;
}

/**
 * Check if a position is blocked by terrain or structures
 */
function isPositionBlocked(pos: RoomPosition): boolean {
  // Check terrain
  const terrain = Game.map.getRoomTerrain(pos.roomName);
  if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) return true;

  // Check for non-walkable structures
  const structures = pos.lookFor(LOOK_STRUCTURES);
  for (const structure of structures) {
    if (
      structure.structureType !== STRUCTURE_ROAD &&
      structure.structureType !== STRUCTURE_CONTAINER &&
      structure.structureType !== STRUCTURE_RAMPART
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a position already has a rampart planned
 */
function hasRampart(ramparts: RoomPosition[], pos: RoomPosition): boolean {
  return ramparts.some((r) => r.x === pos.x && r.y === pos.y);
}

/**
 * Find exit positions grouped by exit direction
 */
function findExitPositions(room: Room): RoomPosition[][] {
  const exits: RoomPosition[][] = [[], [], [], []]; // Top, Right, Bottom, Left

  // Top exit (y=0)
  for (let x = 1; x < 49; x++) {
    const pos = new RoomPosition(x, 0, room.name);
    const terrain = Game.map.getRoomTerrain(room.name);
    if (terrain.get(x, 0) !== TERRAIN_MASK_WALL) {
      exits[0].push(pos);
    }
  }

  // Right exit (x=49)
  for (let y = 1; y < 49; y++) {
    const pos = new RoomPosition(49, y, room.name);
    const terrain = Game.map.getRoomTerrain(room.name);
    if (terrain.get(49, y) !== TERRAIN_MASK_WALL) {
      exits[1].push(pos);
    }
  }

  // Bottom exit (y=49)
  for (let x = 1; x < 49; x++) {
    const pos = new RoomPosition(x, 49, room.name);
    const terrain = Game.map.getRoomTerrain(room.name);
    if (terrain.get(x, 49) !== TERRAIN_MASK_WALL) {
      exits[2].push(pos);
    }
  }

  // Left exit (x=0)
  for (let y = 1; y < 49; y++) {
    const pos = new RoomPosition(0, y, room.name);
    const terrain = Game.map.getRoomTerrain(room.name);
    if (terrain.get(0, y) !== TERRAIN_MASK_WALL) {
      exits[3].push(pos);
    }
  }

  return exits.filter((e) => e.length > 0);
}

/**
 * Select optimal positions for exit walls (choke points)
 */
function selectExitWallPositions(
  exitPositions: RoomPosition[],
  count: number
): RoomPosition[] {
  if (exitPositions.length === 0) return [];

  // Move one tile inward from the exit
  const inwardPositions = exitPositions.map((pos) => {
    if (pos.y === 0) return new RoomPosition(pos.x, pos.y + 1, pos.roomName);
    if (pos.y === 49) return new RoomPosition(pos.x, pos.y - 1, pos.roomName);
    if (pos.x === 0) return new RoomPosition(pos.x + 1, pos.y, pos.roomName);
    if (pos.x === 49) return new RoomPosition(pos.x - 1, pos.y, pos.roomName);
    return pos;
  });

  // Select evenly spaced positions
  const selected: RoomPosition[] = [];
  const step = Math.max(1, Math.floor(inwardPositions.length / count));

  for (
    let i = 0;
    i < inwardPositions.length && selected.length < count;
    i += step
  ) {
    selected.push(inwardPositions[i]);
  }

  return selected;
}

/**
 * Get rampart HP target based on layer
 */
export function getRampartHPTarget(
  pos: RoomPosition,
  plan: DefensePlan
): number {
  // Check which layer this rampart belongs to
  if (plan.layers.core.some((p) => p.x === pos.x && p.y === pos.y)) {
    return 10000000; // 10M HP for core structures
  }

  if (plan.layers.inner.some((p) => p.x === pos.x && p.y === pos.y)) {
    return 5000000; // 5M HP for inner ring
  }

  if (plan.layers.outer.some((p) => p.x === pos.x && p.y === pos.y)) {
    return 1000000; // 1M HP for outer ring
  }

  return 300000; // 300K HP default
}

/**
 * Get wall HP target
 */
export function getWallHPTarget(pos: RoomPosition, plan: DefensePlan): number {
  if (plan.exitWalls.some((p) => p.x === pos.x && p.y === pos.y)) {
    return 1000000; // 1M HP for exit walls
  }

  return 300000; // 300K HP default
}
