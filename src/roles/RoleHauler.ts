/**
 * The Merchants
 * Haulers transport goods between storage and consumers
 */

export class RoleHauler {
  public static run(creep: Creep): void {
    // Toggle working state
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
      creep.say('📦 pickup');
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
      creep.say('🚚 deliver');
    }

    if (creep.memory.working) {
      // Deliver to spawn, extension, or tower
      const target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (structure) => {
          return (structure.structureType === STRUCTURE_EXTENSION ||
                  structure.structureType === STRUCTURE_SPAWN ||
                  structure.structureType === STRUCTURE_TOWER) &&
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
    } else {
      // Pick up dropped energy or from containers
      const droppedEnergy = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: (resource) => resource.resourceType === RESOURCE_ENERGY
      });

      if (droppedEnergy) {
        if (creep.pickup(droppedEnergy) === ERR_NOT_IN_RANGE) {
          creep.moveTo(droppedEnergy, {
            visualizePathStyle: { stroke: '#ffaa00' }
          });
        }
      } else {
        // Fall back to harvesting if nothing to pick up
        const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
        if (source) {
          if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
            creep.moveTo(source, {
              visualizePathStyle: { stroke: '#ffaa00' }
            });
          }
        }
      }
    }
  }
}
