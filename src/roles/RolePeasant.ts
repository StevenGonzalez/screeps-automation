/**
 * The Peasants
 * Harvesters gather energy from the land
 */

import { harvestEnergy, transferEnergy, collectFromContainers } from '../utils/CreepActions';

export class RolePeasant {
  public static run(creep: Creep): void {
    if (creep.store.getFreeCapacity() > 0) {
      // Priority 1: Collect from containers
      const containerResult = collectFromContainers(creep);
      
      // Priority 2: Harvest from sources only if no containers available
      if (containerResult === ERR_NOT_FOUND) {
        harvestEnergy(creep);
      }
    } else {
      // Deposit energy with priority: Spawn → Extensions → Controller Container
      transferEnergy(creep, [STRUCTURE_SPAWN, STRUCTURE_EXTENSION, STRUCTURE_CONTAINER]);
    }
  }
}
