import {
  getSources,
  harvestFromSource,
  findUnclaimedMinerAssignment,
} from "../services/services.creep";

export function runMiner(creep: Creep) {
  if (!creep.memory.assignedSourceId || !creep.memory.assignedContainerId) {
    const assignment = findUnclaimedMinerAssignment(creep.room);
    if (assignment) {
      creep.memory.assignedSourceId = assignment.source.id;
      creep.memory.assignedContainerId = assignment.container.id;
    }
  }

  if (creep.memory.assignedSourceId && creep.memory.assignedContainerId) {
    const source = Game.getObjectById(creep.memory.assignedSourceId) as Source | null;
    const container = Game.getObjectById(creep.memory.assignedContainerId) as StructureContainer | null;

    if (source && container) {
      if (!creep.pos.isEqualTo(container.pos)) {
        creep.moveTo(container.pos, { reusePath: 20 });
        return;
      }

      // Feed an adjacent link if our store is full or the container is nearly full
      if (
        creep.store.getFreeCapacity() === 0 ||
        container.store.getFreeCapacity(RESOURCE_ENERGY) < 100
      ) {
        const link = findAdjacentLink(creep);
        if (link && link.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
          creep.transfer(link, RESOURCE_ENERGY);
          return;
        }
      }

      harvestFromSource(creep, source);
      return;
    }
  }

  // Fallback: find any source with a container
  const sources = getSources(creep.room);
  for (const source of sources) {
    const containers = creep.room.find(FIND_STRUCTURES, {
      filter: (s): s is StructureContainer =>
        s.structureType === STRUCTURE_CONTAINER &&
        s.pos.getRangeTo(source.pos) <= 1,
    });
    if (containers.length > 0) {
      const container = containers[0];
      if (!creep.pos.isEqualTo(container.pos)) {
        creep.moveTo(container.pos, { reusePath: 20 });
        return;
      }
      harvestFromSource(creep, source);
      return;
    }
  }
}

function findAdjacentLink(creep: Creep): StructureLink | null {
  const links = creep.pos.findInRange(FIND_MY_STRUCTURES, 2, {
    filter: (s): s is StructureLink => s.structureType === STRUCTURE_LINK,
  }) as StructureLink[];
  if (links.length === 0) return null;
  // Prefer the link with the most free capacity
  return links.reduce((a, b) =>
    a.store.getFreeCapacity(RESOURCE_ENERGY) > b.store.getFreeCapacity(RESOURCE_ENERGY) ? a : b
  );
}
