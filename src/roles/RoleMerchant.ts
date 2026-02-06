/**
 * The Merchants
 * Haulers transport goods between storage and consumers
 */

import { toggleWorkingState, harvestEnergy, transferEnergy, pickupEnergy, collectFromContainers, upgradeController } from '../utils/CreepActions';

export class RoleMerchant {
  public static run(creep: Creep): void {
    // Manage working state
    toggleWorkingState(creep);

    if (creep.memory.working) {
      // Deliver to spawn, extension, or tower
      const transferResult = transferEnergy(creep, [STRUCTURE_SPAWN, STRUCTURE_EXTENSION, STRUCTURE_TOWER]);
      if (transferResult === ERR_NOT_FOUND) {
        // Nothing needs energy, help upgrade the controller
        upgradeController(creep);
      }
    } else {
      // Try picking up dropped energy first
      const pickupResult = pickupEnergy(creep);
      if (pickupResult === ERR_NOT_FOUND) {
        // Then try containers
        const containerResult = collectFromContainers(creep);
        if (containerResult === ERR_NOT_FOUND || containerResult === ERR_NOT_ENOUGH_RESOURCES) {
          // Finally harvest from sources
          harvestEnergy(creep);
        }
      }
    }
  }
}
