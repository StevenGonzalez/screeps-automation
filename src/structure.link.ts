/**
 * Link Management
 *
 * Handles link operations for energy distribution between sources,
 * spawns, and controller areas for optimal energy logistics.
 */

/// <reference types="@types/screeps" />

/**
 * Manage link operations for energy distribution
 */
export function manageLinks(room: Room, economicPlan: any): void {
  const links = getLinksInRoom(room);
  if (links.length < 2) return;

  // Find source links (near sources) and sink links (near spawn/controller)
  const sources = room.find(FIND_SOURCES);
  const spawns = room.find(FIND_MY_SPAWNS);
  const controller = room.controller;

  const sourceLinks: StructureLink[] = [];
  const sinkLinks: StructureLink[] = [];

  links.forEach((link) => {
    // Check if link is near a source (source link)
    // Allow slightly more relaxed range to accommodate terrain-constrained placements
    const nearSource = sources.some(
      (source) => link.pos.getRangeTo(source) <= 3
    );

    if (nearSource) {
      sourceLinks.push(link);
    } else {
      // Check if link is near spawn or controller (sink link)
      const nearSpawn = spawns.some((spawn) => link.pos.getRangeTo(spawn) <= 3);
      const nearController = controller && link.pos.getRangeTo(controller) <= 3;

      if (nearSpawn || nearController) {
        sinkLinks.push(link);
      }
    }
  });

  // Transfer energy from full source links to empty sink links
  // Prefer sending to the controller-side sink first when available
  const sortedSinks = sinkLinks.sort((a, b) => {
    const aCtrl = controller ? a.pos.getRangeTo(controller) : 99;
    const bCtrl = controller ? b.pos.getRangeTo(controller) : 99;
    return aCtrl - bCtrl;
  });

  sourceLinks.forEach((sourceLink) => {
    if (sourceLink.store.getUsedCapacity(RESOURCE_ENERGY) >= 200) {
      const targetLink = sortedSinks.find(
        (sinkLink) =>
          sinkLink.store.getFreeCapacity(RESOURCE_ENERGY) >= 200 &&
          !sinkLink.cooldown
      );

      if (targetLink) {
        const result = sourceLink.transferEnergy(targetLink);
        if (result === OK) {
          console.log(
            `⚡ Link transfer: Source → ${
              targetLink.pos.findInRange(FIND_MY_SPAWNS, 2).length > 0
                ? "Spawn"
                : "Controller"
            }`
          );
        }
      }
    }
  });
}

/**
 * Get all links in a room
 */
export function getLinksInRoom(room: Room): StructureLink[] {
  return room.find(FIND_MY_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_LINK,
  }) as StructureLink[];
}

/**
 * Get link status for room intelligence
 */
export function getLinkStatus(room: Room): any {
  const links = getLinksInRoom(room);

  return {
    count: links.length,
    totalEnergy: links.reduce(
      (sum, link) => sum + link.store.getUsedCapacity(RESOURCE_ENERGY),
      0
    ),
    totalCapacity: links.reduce(
      (sum, link) => sum + link.store.getCapacity(RESOURCE_ENERGY),
      0
    ),
    activeCooldowns: links.filter((link) => link.cooldown > 0).length,
  };
}

/**
 * Find source links (links near energy sources)
 */
export function getSourceLinks(room: Room): StructureLink[] {
  const links = getLinksInRoom(room);
  const sources = room.find(FIND_SOURCES);

  return links.filter((link) =>
    sources.some((source) => link.pos.getRangeTo(source) <= 2)
  );
}

/**
 * Find sink links (links near spawn or controller)
 */
export function getSinkLinks(room: Room): StructureLink[] {
  const links = getLinksInRoom(room);
  const spawns = room.find(FIND_MY_SPAWNS);
  const controller = room.controller;

  return links.filter((link) => {
    const nearSpawn = spawns.some((spawn) => link.pos.getRangeTo(spawn) <= 2);
    const nearController = controller && link.pos.getRangeTo(controller) <= 2;

    return nearSpawn || nearController;
  });
}

/**
 * Get links that have energy available to transfer
 */
export function getLinksWithEnergy(
  room: Room,
  minimumEnergy: number = 400
): StructureLink[] {
  const links = getLinksInRoom(room);
  return links.filter(
    (link) =>
      link.store.getUsedCapacity(RESOURCE_ENERGY) >= minimumEnergy &&
      !link.cooldown
  );
}

/**
 * Get links that can receive energy
 */
export function getLinksNeedingEnergy(
  room: Room,
  minimumSpace: number = 400
): StructureLink[] {
  const links = getLinksInRoom(room);
  return links.filter(
    (link) => link.store.getFreeCapacity(RESOURCE_ENERGY) >= minimumSpace
  );
}
