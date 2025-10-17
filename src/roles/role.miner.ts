import { getSources, harvestFromSource } from "../services/services.creep";

export function runMiner(creep: Creep) {
  // Find the closest source
  const sources = getSources(creep.room);
  if (sources.length === 0) return;
  // Find a container adjacent to a source
  for (const source of sources) {
    const containers = creep.room.find(FIND_STRUCTURES, {
      filter: (s) =>
        s.structureType === STRUCTURE_CONTAINER &&
        s.pos.getRangeTo(source.pos) <= 1,
    });
    if (containers.length > 0) {
      const container = containers[0];
      // Move to container if not on it
      if (!creep.pos.isEqualTo(container.pos)) {
        creep.moveTo(container.pos);
        return;
      }
      // Harvest from source
      harvestFromSource(creep, source);
      return;
    }
  }
}
