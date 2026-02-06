/**
 * The Masons
 * Builders construct new structures
 */

import { toggleWorkingState, harvestEnergy, buildStructure } from '../utils/CreepActions';

export class RoleMason {
  public static run(creep: Creep): void {
    // Manage working state
    toggleWorkingState(creep);

    if (creep.memory.working) {
      // Build construction sites
      buildStructure(creep);
    } else {
      // Harvest energy
      harvestEnergy(creep);
    }
  }
}
