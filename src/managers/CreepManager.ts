/**
 * The Royal Court
 * Directs all subjects in their duties
 */

import { RolePeasant } from '../roles/RolePeasant';
import { RoleMason } from '../roles/RoleMason';
import { RoleAlchemist } from '../roles/RoleAlchemist';
import { RoleMerchant } from '../roles/RoleMerchant';
import { RoleBlacksmith } from '../roles/RoleBlacksmith';
import { RoleMiner } from '../roles/RoleMiner';

export class CreepManager {
  /**
   * Run logic for all creeps
   */
  public static runAll(): void {
    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      
      // Ensure memory is initialized
      if (!creep.memory.role) {
        continue;
      }
      if (creep.memory.working === undefined) {
        creep.memory.working = false;
      }
      
      switch (creep.memory.role) {
        case 'peasant':
          RolePeasant.run(creep);
          break;
        case 'mason':
          RoleMason.run(creep);
          break;
        case 'alchemist':
          RoleAlchemist.run(creep);
          break;
        case 'merchant':
          RoleMerchant.run(creep);
          break;
        case 'blacksmith':
          RoleBlacksmith.run(creep);
          break;
        case 'miner':
          RoleMiner.run(creep);
          break;
        default:
          console.log(`⚠️ ${name} has unknown role: ${creep.memory.role}`);
      }
    }
  }
}
