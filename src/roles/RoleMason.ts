/**
 * The Masons
 * Builders construct and repair structures
 */

export class RoleMason {
  public static run(creep: Creep): void {
    // Toggle working state
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
      creep.say('🔄 harvest');
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
      creep.say('🔨 build');
    }

    if (creep.memory.working) {
      // Build construction sites
      const constructionSite = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
      if (constructionSite) {
        if (creep.build(constructionSite) === ERR_NOT_IN_RANGE) {
          creep.moveTo(constructionSite, {
            visualizePathStyle: { stroke: '#00ff00' }
          });
        }
      } else {
        // No construction sites, repair damaged structures
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
              visualizePathStyle: { stroke: '#00ff00' }
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
