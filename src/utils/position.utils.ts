/**
 * Position Utilities
 *
 * Shared utility functions for position validation and manipulation
 */

/**
 * Check if coordinates are within room bounds (excluding walls)
 */
export function inBounds(x: number, y: number): boolean {
  return x > 0 && x < 49 && y > 0 && y < 49;
}

/**
 * Check if a position is walkable (not a wall)
 */
export function isWalkable(pos: RoomPosition): boolean {
  const terrain = Game.map.getRoomTerrain(pos.roomName);
  return terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL;
}

/**
 * Check if a position is valid for building structures
 */
export function isValidBuildPosition(pos: RoomPosition): boolean {
  if (!inBounds(pos.x, pos.y)) return false;
  if (!isWalkable(pos)) return false;
  
  const structures = pos.lookFor(LOOK_STRUCTURES);
  return !structures.some((s) => 
    s.structureType !== STRUCTURE_ROAD && 
    s.structureType !== STRUCTURE_CONTAINER &&
    s.structureType !== STRUCTURE_RAMPART
  );
}

/**
 * Generate a position key for caching
 */
export function posKey(pos: RoomPosition): string {
  return `${pos.roomName}:${pos.x}:${pos.y}`;
}
