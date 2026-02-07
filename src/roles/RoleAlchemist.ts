/**
 * The Alchemists
 * Upgraders transmute energy to strengthen the realm
 */

import {
  toggleWorkingState,
  harvestEnergy,
  upgradeController,
  collectFromContainers,
  collectFromControllerContainer
} from '../utils/CreepActions';

export class RoleAlchemist {
  public static run(creep: Creep): void {
    // Manage working state
    toggleWorkingState(creep);

    if (creep.memory.working) {
      // Upgrade controller
      upgradeController(creep);
    } else {
      // Prefer controller container, then other containers, then harvest
      const controllerResult = collectFromControllerContainer(creep);
      if (controllerResult === ERR_NOT_FOUND || controllerResult === ERR_NOT_ENOUGH_RESOURCES) {
        const containerResult = collectFromContainers(creep);
        if (containerResult === ERR_NOT_FOUND || containerResult === ERR_NOT_ENOUGH_RESOURCES) {
          harvestEnergy(creep);
        }
      }
    }
  }
}
