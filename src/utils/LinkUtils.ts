/**
 * LinkUtils - Shared link discovery helpers
 */

/**
 * Find the base link near the main anchor (spawn or controller)
 * @param room The room to search
 * @returns The base link or null if none found
 */
export function getBaseLink(room: Room): StructureLink | null {
  const links = room.find(FIND_STRUCTURES, {
    filter: (structure) => structure.structureType === STRUCTURE_LINK
  }) as StructureLink[];

  if (links.length === 0) {
    return null;
  }

  const spawns = room.find(FIND_MY_SPAWNS);
  const anchor: { pos: RoomPosition } | null = spawns[0] || room.controller || null;

  if (!anchor) {
    return links[0];
  }

  const nearby = links.filter(link => link.pos.inRangeTo(anchor.pos, 3));
  if (nearby.length > 0) {
    return anchor.pos.findClosestByPath(nearby) as StructureLink | null;
  }

  return anchor.pos.findClosestByPath(links) as StructureLink | null;
}

/**
 * Find links placed near energy sources
 * @param room The room to search
 * @returns Array of source links
 */
export function getSourceLinks(room: Room): StructureLink[] {
  const links = room.find(FIND_STRUCTURES, {
    filter: (structure) => structure.structureType === STRUCTURE_LINK
  }) as StructureLink[];

  if (links.length === 0) {
    return [];
  }

  const sources = room.find(FIND_SOURCES);
  if (sources.length === 0) {
    return [];
  }

  return links.filter(link => sources.some(source => link.pos.inRangeTo(source.pos, 2)));
}
