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
    const source = Game.getObjectById(
      creep.memory.assignedSourceId
    ) as Source | null;
    const container = Game.getObjectById(
      creep.memory.assignedContainerId
    ) as StructureContainer | null;
    if (source && container) {
      if (!creep.pos.isEqualTo(container.pos)) {
        creep.moveTo(container.pos);
        return;
      }
      harvestFromSource(creep, source);
      return;
    }
  }
  const sources = getSources(creep.room);
  if (sources.length === 0) return;
  for (const source of sources) {
    const containers = creep.room.find(FIND_STRUCTURES, {
      filter: (s): s is StructureContainer =>
        s.structureType === STRUCTURE_CONTAINER &&
        s.pos.getRangeTo(source.pos) <= 1,
    });
    if (containers.length > 0) {
      const container: StructureContainer = containers[0];
      if (!creep.pos.isEqualTo(container.pos)) {
        creep.moveTo(container.pos);
        return;
      }
      harvestFromSource(creep, source);
      return;
    }
  }
}
