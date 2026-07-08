import {
  getSafeSources,
  harvestFromSource,
  findUnclaimedMinerAssignment,
  isSourceSafe,
} from "../services/services.creep";

const CONTAINER_REPAIR_THRESHOLD = 0.9;

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

    if (source && !isSourceSafe(source)) {
      creep.memory.assignedSourceId = undefined;
      creep.memory.assignedContainerId = undefined;
      return;
    }

    if (source && container) {
      if (!creep.pos.isEqualTo(container.pos)) {
        creep.moveTo(container.pos, { reusePath: 50 });
        return;
      }

      if (
        container.hits < container.hitsMax * CONTAINER_REPAIR_THRESHOLD &&
        creep.store[RESOURCE_ENERGY] > 0
      ) {
        creep.repair(container);
        return;
      }

      if (creep.store.getFreeCapacity() === 0) {
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

  const sources = getSafeSources(creep.room);
  for (const source of sources) {
    const containers = creep.room.find(FIND_STRUCTURES, {
      filter: (s): s is StructureContainer =>
        s.structureType === STRUCTURE_CONTAINER &&
        s.pos.getRangeTo(source.pos) <= 1,
    });
    if (containers.length > 0) {
      const container = containers[0];
      if (!creep.pos.isEqualTo(container.pos)) {
        creep.moveTo(container.pos, { reusePath: 50 });
        return;
      }
      harvestFromSource(creep, source);
      return;
    }
  }

  // Fallback: no source has a container (destroyed or not built yet). Drop-mine
  // the nearest safe source so income continues instead of idling; haulers and
  // the collect logic pick up the dropped energy.
  if (sources.length > 0) {
    const source = creep.pos.findClosestByRange(sources) ?? sources[0];
    harvestFromSource(creep, source);
  }
}

function findAdjacentLink(creep: Creep): StructureLink | null {
  const links = creep.pos.findInRange(FIND_MY_STRUCTURES, 1, {
    filter: (s): s is StructureLink => s.structureType === STRUCTURE_LINK,
  }) as StructureLink[];
  if (links.length === 0) return null;
  return links.reduce((a, b) =>
    a.store.getFreeCapacity(RESOURCE_ENERGY) > b.store.getFreeCapacity(RESOURCE_ENERGY) ? a : b
  );
}
