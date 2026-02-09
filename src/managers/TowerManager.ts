/**
 * The Royal Watchtowers
 * Defend the realm and maintain its structures
 */

export class TowerManager {
  /**
   * Run logic for all towers in a room
   */
  public static run(room: Room): void {
    const towers = room.find<StructureTower>(FIND_MY_STRUCTURES, {
      filter: (structure) => structure.structureType === STRUCTURE_TOWER
    });

    for (const tower of towers) {
      this.runTower(tower);
    }
  }

  /**
   * Run logic for a single tower
   * Priority: Attack > Heal > Repair
   */
  private static runTower(tower: StructureTower): void {
    // 1. Attack hostile creeps (highest priority)
    const hostileCreep = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
    if (hostileCreep) {
      tower.attack(hostileCreep);
      return;
    }

    // 2. Heal damaged friendly creeps
    const damagedCreep = tower.pos.findClosestByRange(FIND_MY_CREEPS, {
      filter: (creep) => creep.hits < creep.hitsMax
    });
    if (damagedCreep) {
      tower.heal(damagedCreep);
      return;
    }

    // 3. Repair damaged structures (below 75% health)
    const damagedStructure = tower.pos.findClosestByRange(FIND_STRUCTURES, {
      filter: (structure) => {
        return structure.hits < structure.hitsMax * 0.75 &&
               structure.structureType !== STRUCTURE_WALL &&
               structure.structureType !== STRUCTURE_RAMPART;
      }
    });
    if (damagedStructure) {
      tower.repair(damagedStructure);
      return;
    }

    // 4. Maintain walls and ramparts (keep at minimum level)
    const minWallHits = 10000; // Adjust based on room level
    const damagedDefense = tower.pos.findClosestByRange(FIND_STRUCTURES, {
      filter: (structure) => {
        return (structure.structureType === STRUCTURE_WALL ||
                structure.structureType === STRUCTURE_RAMPART) &&
               structure.hits < minWallHits;
      }
    });
    if (damagedDefense) {
      tower.repair(damagedDefense);
    }
  }
}
