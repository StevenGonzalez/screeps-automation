/**
 * The Merchants
 * Haulers transport goods between storage and consumers
 */

import { toggleWorkingState, harvestEnergy, transferEnergy, pickupEnergy } from '../utils/CreepActions';

export class RoleMerchant {
  public static run(creep: Creep): void {
    // Manage working state
    toggleWorkingState(creep);

    if (creep.memory.working) {
      // Deliver to spawn, extension, or tower
      transferEnergy(creep, [STRUCTURE_SPAWN, STRUCTURE_EXTENSION, STRUCTURE_TOWER]);
    } else {
      // Try picking up dropped energy first, then harvest
      const pickupResult = pickupEnergy(creep);
      if (pickupResult === ERR_NOT_FOUND) {
        harvestEnergy(creep);
      }
    }
  }
}
