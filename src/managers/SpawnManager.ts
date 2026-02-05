/**
 * The Royal Barracks
 * Where new subjects are recruited and trained
 */

import { BodyBuilder } from '../utils/BodyBuilder';
import { NameGenerator } from '../utils/NameGenerator';

export class SpawnManager {
  /**
   * Manages spawning for a room
   */
  public static run(room: Room): void {
    const spawns = room.find(FIND_MY_SPAWNS, {
      filter: (spawn) => !spawn.spawning
    });

    if (spawns.length === 0) return;

    const spawn = spawns[0];
    
    // Count creeps by role
    const creeps = room.find(FIND_MY_CREEPS);
    const roleCount = {
      harvester: creeps.filter(c => c.memory.role === 'harvester').length,
      builder: creeps.filter(c => c.memory.role === 'builder').length,
      upgrader: creeps.filter(c => c.memory.role === 'upgrader').length,
      hauler: creeps.filter(c => c.memory.role === 'hauler').length,
    };

    // Determine what role to spawn (priority order)
    let roleToSpawn: string | null = null;

    if (roleCount.harvester < 2) {
      roleToSpawn = 'harvester';
    } else if (roleCount.hauler < 2) {
      roleToSpawn = 'hauler';
    } else if (roleCount.builder < 3) {
      roleToSpawn = 'builder';
    } else if (roleCount.upgrader < 2) {
      roleToSpawn = 'upgrader';
    }

    if (roleToSpawn) {
      this.spawnCreep(spawn, roleToSpawn, room);
    }
  }

  private static spawnCreep(spawn: StructureSpawn, role: string, room: Room): void {
    const body = BodyBuilder.buildBody(role, room.energyAvailable);
    const name = NameGenerator.generate(role);
    
    const result = spawn.spawnCreep(body, name, {
      memory: { role, working: false, room: room.name }
    });

    if (result === OK) {
      console.log(`🏰 The Crown recruits ${name} the ${role}`);
    } else if (result === ERR_NOT_ENOUGH_ENERGY) {
      // Not enough energy yet, will try next tick
    } else {
      console.log(`⚠️ Failed to recruit ${role}: ${result}`);
    }
  }
}
