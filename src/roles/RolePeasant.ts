/**
 * The Peasants
 * Harvesters gather energy from the land
 */

export class RolePeasant {
  public static run(creep: Creep): void {
    if (creep.store.getFreeCapacity() > 0) {
      // Find energy source
      const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
      if (source) {
        if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
          creep.moveTo(source, {
            visualizePathStyle: { stroke: '#ffaa00' }
          });
        }
      }
    } else {
      // Deposit energy to spawn or extension
      const target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (structure) => {
          return (structure.structureType === STRUCTURE_EXTENSION ||
                  structure.structureType === STRUCTURE_SPAWN) &&
                 structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
        }
      });

      if (target) {
        if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, {
            visualizePathStyle: { stroke: '#ffffff' }
          });
        }
      }
    }
  }
}
