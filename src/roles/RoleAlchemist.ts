/**
 * The Alchemists
 * Upgraders transmute energy to strengthen the realm
 */

import { toggleWorkingState, harvestEnergy, upgradeController, collectFromContainers } from '../utils/CreepActions';

export class RoleAlchemist {
  public static run(creep: Creep): void {
    // Manage working state
    toggleWorkingState(creep);

    if (creep.memory.working) {
      // Upgrade controller
      upgradeController(creep);
    } else {
      // Try collecting from containers first, then harvest
      const containerResult = collectFromContainers(creep);
      if (containerResult === ERR_NOT_FOUND || containerResult === ERR_NOT_ENOUGH_RESOURCES) {
        harvestEnergy(creep);
      }
    }
  }
}
