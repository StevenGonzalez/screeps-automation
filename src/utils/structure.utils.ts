/**
 * Structure Utilities
 *
 * Shared utility functions for structure detection and validation
 */

/**
 * Check if a container exists near a position
 */
export function hasContainerNear(pos: RoomPosition, range: number = 1): boolean {
  return pos.findInRange(FIND_STRUCTURES, range, {
    filter: (s) => s.structureType === STRUCTURE_CONTAINER
  }).length > 0;
}

/**
 * Check if a container construction site exists near a position
 */
export function hasContainerSiteNear(pos: RoomPosition, range: number = 1): boolean {
  return pos.findInRange(FIND_CONSTRUCTION_SITES, range, {
    filter: (s) => s.structureType === STRUCTURE_CONTAINER
  }).length > 0;
}

/**
 * Check if a container is adjacent to a source
 */
export function isSourceContainer(container: StructureContainer): boolean {
  return container.pos.findInRange(FIND_SOURCES, 1).length > 0;
}

/**
 * Check if a container is near the controller
 */
export function isControllerContainer(container: StructureContainer): boolean {
  const ctrl = container.room.controller;
  return !!ctrl && container.pos.inRangeTo(ctrl.pos, 3);
}

/**
 * Check if a container is near a mineral
 */
export function isMineralContainer(container: StructureContainer): boolean {
  return container.pos.findInRange(FIND_MINERALS, 2).length > 0;
}

/**
 * Check if a position has a specific structure type
 */
export function hasStructureType(pos: RoomPosition, type: StructureConstant): boolean {
  return pos.lookFor(LOOK_STRUCTURES).some((s) => s.structureType === type);
}

/**
 * Check if a position has a road
 */
export function hasRoad(pos: RoomPosition): boolean {
  return hasStructureType(pos, STRUCTURE_ROAD);
}
