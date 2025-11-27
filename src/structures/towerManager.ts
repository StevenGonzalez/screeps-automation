// src/structures/towerManager.ts

export class TowerManager {
  run() {
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;

      this.manageTowersInRoom(room);
    }
  }

  private manageTowersInRoom(room: Room) {
    const towers = room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_TOWER
    }) as StructureTower[];

    if (towers.length === 0) return;

    // Priority 1: Attack hostile creeps
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    if (hostiles.length > 0) {
      for (const tower of towers) {
        if (tower.store[RESOURCE_ENERGY] === 0) continue;
        
        // Target the closest hostile
        const target = tower.pos.findClosestByRange(hostiles);
        if (target) {
          tower.attack(target);
        }
      }
      return; // Skip healing/repair if under attack
    }

    // Priority 2: Heal damaged creeps
    const damagedCreeps = room.find(FIND_MY_CREEPS, {
      filter: c => c.hits < c.hitsMax
    });
    
    if (damagedCreeps.length > 0) {
      for (const tower of towers) {
        if (tower.store[RESOURCE_ENERGY] === 0) continue;
        
        const target = tower.pos.findClosestByRange(damagedCreeps);
        if (target) {
          tower.heal(target);
        }
      }
      return;
    }

    // Priority 3: Repair structures (only if tower has enough energy)
    for (const tower of towers) {
      if (tower.store[RESOURCE_ENERGY] < 500) continue; // Save energy for defense
      
      const damagedStructures = room.find(FIND_STRUCTURES, {
        filter: s => {
          // Don't repair walls or ramparts here (they have too many hits)
          if (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) {
            return false;
          }
          return s.hits < s.hitsMax;
        }
      });

      if (damagedStructures.length > 0) {
        // Sort by hits percentage to prioritize critical structures
        damagedStructures.sort((a, b) => (a.hits / a.hitsMax) - (b.hits / b.hitsMax));
        const target = damagedStructures[0];
        tower.repair(target);
      }
    }
  }
}

export const towerManager = new TowerManager();
