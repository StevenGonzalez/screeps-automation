/**
 * The Alchemists
 * Upgraders transmute energy to strengthen the realm
 */

import { toggleWorkingState, harvestEnergy, upgradeController } from '../utils/CreepActions';

export class RoleAlchemist {
  public static run(creep: Creep): void {
    // Manage working state
    toggleWorkingState(creep);

    if (creep.memory.working) {
      // Upgrade controller
      upgradeController(creep);
    } else {
      // Harvest energy
      harvestEnergy(creep);
    }
  }
}
