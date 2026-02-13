/**
 * The Merchants
 * Haulers transport goods between storage and consumers
 */

import { toggleWorkingState, harvestEnergy, transferEnergy, pickupEnergy, collectFromContainers, collectFromBaseLink, upgradeController } from '../utils/CreepActions';

export class RoleMerchant {
  public static run(creep: Creep): void {
    // Manage working state
    toggleWorkingState(creep);

    if (creep.memory.working) {
      // Deliver to spawn, extension, or tower
      const transferResult = transferEnergy(creep, [STRUCTURE_SPAWN, STRUCTURE_EXTENSION, STRUCTURE_TOWER]);
      if (transferResult === ERR_NOT_FOUND) {
        // If core consumers are full, deposit surplus into storage
        const storageResult = transferEnergy(creep, [STRUCTURE_STORAGE]);
        if (storageResult === ERR_NOT_FOUND) {
          // Nothing needs energy, help upgrade the controller
          upgradeController(creep);
        }
      }
    } else {
      // Prefer the base link if it has energy
      const linkResult = collectFromBaseLink(creep);
      if (linkResult === OK || linkResult === ERR_NOT_IN_RANGE) {
        return;
      }

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
