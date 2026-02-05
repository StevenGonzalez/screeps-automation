/**
 * The Royal Court
 * Directs all subjects in their duties
 */

import { RoleHarvester } from '../roles/RoleHarvester';
import { RoleBuilder } from '../roles/RoleBuilder';
import { RoleUpgrader } from '../roles/RoleUpgrader';
import { RoleHauler } from '../roles/RoleHauler';

export class CreepManager {
  /**
   * Run logic for all creeps
   */
  public static runAll(): void {
    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      
      switch (creep.memory.role) {
        case 'harvester':
          RoleHarvester.run(creep);
          break;
        case 'builder':
          RoleBuilder.run(creep);
          break;
        case 'upgrader':
          RoleUpgrader.run(creep);
          break;
        case 'hauler':
          RoleHauler.run(creep);
          break;
        default:
          console.log(`⚠️ ${name} has unknown role: ${creep.memory.role}`);
      }
    }
  }
}
