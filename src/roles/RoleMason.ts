/**
 * The Masons
 * Builders construct new structures
 */

import { toggleWorkingState, harvestEnergy, buildStructure, collectFromContainers, upgradeController } from '../utils/CreepActions';

export class RoleMason {
  public static run(creep: Creep): void {
    // Manage working state
    toggleWorkingState(creep);

    if (creep.memory.working) {
      // Build construction sites, or upgrade if none exist
      const buildResult = buildStructure(creep);
      if (buildResult === ERR_NOT_FOUND) {
        upgradeController(creep);
      }
    } else {
      // Try collecting from containers first, then harvest
      const containerResult = collectFromContainers(creep);
      if (containerResult === ERR_NOT_FOUND || containerResult === ERR_NOT_ENOUGH_RESOURCES) {
        harvestEnergy(creep);
      }
    }
  }
}
