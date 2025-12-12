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

    // Priority 3: Emergency repairs only (let repairers handle routine maintenance)
    for (const tower of towers) {
      if (tower.store[RESOURCE_ENERGY] < 500) continue; // Save energy for defense
      
      // Only handle TRUE emergencies:
      const emergencyStructures = room.find(FIND_STRUCTURES, {
        filter: s => {
          // Skip walls entirely
          if (s.structureType === STRUCTURE_WALL) return false;
          
          // Emergency: ramparts below 5k hits
          if (s.structureType === STRUCTURE_RAMPART) {
            return s.hits < 5000;
          }
          
          // Emergency: critical structures below 50% HP
          const isCritical = s.structureType === STRUCTURE_SPAWN || 
                            s.structureType === STRUCTURE_TOWER ||
                            s.structureType === STRUCTURE_STORAGE ||
                            s.structureType === STRUCTURE_TERMINAL;
          
          if (isCritical) {
            return s.hits < s.hitsMax * 0.5;
          }
          
          // Don't repair anything else - let repairers handle it
          return false;
        }
      });

      if (emergencyStructures.length > 0) {
        // Sort by absolute hits for ramparts, percentage for others
        emergencyStructures.sort((a, b) => {
          if (a.structureType === STRUCTURE_RAMPART && b.structureType === STRUCTURE_RAMPART) {
            return a.hits - b.hits;
          }
          if (a.structureType === STRUCTURE_RAMPART) return -1; // Prioritize ramparts
          if (b.structureType === STRUCTURE_RAMPART) return 1;
          return (a.hits / a.hitsMax) - (b.hits / b.hitsMax);
        });
        
        tower.repair(emergencyStructures[0]);
      }
    }
  }
}

export const towerManager = new TowerManager();
