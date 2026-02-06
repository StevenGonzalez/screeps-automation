/**
 * The Peasants
 * Harvesters gather energy from the land
 */

import { harvestEnergy, transferEnergy } from '../utils/CreepActions';

export class RolePeasant {
  public static run(creep: Creep): void {
    if (creep.store.getFreeCapacity() > 0) {
      // Harvest energy
      harvestEnergy(creep);
    } else {
      // Deposit energy to spawn or extension
      transferEnergy(creep);
    }
  }
}
