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
      miner: creeps.filter(c => c.memory.role === 'miner').length,
      peasant: creeps.filter(c => c.memory.role === 'peasant').length,
      mason: creeps.filter(c => c.memory.role === 'mason').length,
      alchemist: creeps.filter(c => c.memory.role === 'alchemist').length,
      merchant: creeps.filter(c => c.memory.role === 'merchant').length,
      blacksmith: creeps.filter(c => c.memory.role === 'blacksmith').length,
    };
    
    // Count sources to determine how many miners we need
    const sources = room.find(FIND_SOURCES);

    // Determine what role to spawn (priority order)
    let roleToSpawn: string | null = null;

    if (roleCount.miner < sources.length) {
      roleToSpawn = 'miner';
    } else if (roleCount.peasant < 2) {
      roleToSpawn = 'peasant';
    } else if (roleCount.merchant < 2) {
      roleToSpawn = 'merchant';
    } else if (roleCount.blacksmith < 1) {
      roleToSpawn = 'blacksmith';
    } else if (roleCount.mason < 3) {
      roleToSpawn = 'mason';
    } else if (roleCount.alchemist < 2) {
      roleToSpawn = 'alchemist';
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
