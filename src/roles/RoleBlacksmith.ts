/**
 * The Blacksmiths
 * Repair and maintain the kingdom's structures
 */

export class RoleBlacksmith {
  public static run(creep: Creep): void {
    // Toggle working state
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
      creep.say('🔄');
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
      creep.say('🔧');
    }

    if (creep.memory.working) {
      // Find damaged structures (prioritize non-walls)
      const damagedStructure = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (structure) => {
          return structure.hits < structure.hitsMax &&
                 structure.structureType !== STRUCTURE_WALL &&
                 structure.structureType !== STRUCTURE_RAMPART;
        }
      });

      if (damagedStructure) {
        if (creep.repair(damagedStructure) === ERR_NOT_IN_RANGE) {
          creep.moveTo(damagedStructure, {
            visualizePathStyle: { stroke: '#ffff00' }
          });
        }
      } else {
        // If nothing needs immediate repair, maintain walls/ramparts at 10k hits
        const wall = creep.pos.findClosestByPath(FIND_STRUCTURES, {
          filter: (structure) => {
            return (structure.structureType === STRUCTURE_WALL ||
                    structure.structureType === STRUCTURE_RAMPART) &&
                   structure.hits < 10000;
          }
        });

        if (wall) {
          if (creep.repair(wall) === ERR_NOT_IN_RANGE) {
            creep.moveTo(wall, {
              visualizePathStyle: { stroke: '#ffff00' }
            });
          }
        }
      }
    } else {
      // Harvest energy
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
