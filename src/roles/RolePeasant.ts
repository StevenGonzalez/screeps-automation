/**
 * The Peasants
 * Harvesters gather energy from the land
 */

import { harvestEnergy, transferEnergy, collectFromContainers, upgradeController } from '../utils/CreepActions';

export class RolePeasant {
  public static run(creep: Creep): void {
    if (creep.store.getFreeCapacity() > 0) {
      // Priority 1: Collect from containers
      const containerResult = collectFromContainers(creep);
      
      // Priority 2: Harvest from sources if no containers or containers are empty
      if (containerResult === ERR_NOT_FOUND || containerResult === ERR_NOT_ENOUGH_RESOURCES) {
        harvestEnergy(creep);
      }
    } else {
      // Deposit energy with priority: Spawn → Extensions → Controller Container
      const transferResult = transferEnergy(creep, [STRUCTURE_SPAWN, STRUCTURE_EXTENSION, STRUCTURE_CONTAINER]);
      if (transferResult === ERR_NOT_FOUND) {
        // Nothing needs energy, help upgrade the controller
        upgradeController(creep);
      }
    }
  }
}
