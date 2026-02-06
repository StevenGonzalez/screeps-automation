/**
 * The Blacksmiths
 * Repair and maintain the kingdom's structures
 */

import { toggleWorkingState, harvestEnergy, repairStructure, repairWalls } from '../utils/CreepActions';

export class RoleBlacksmith {
  public static run(creep: Creep): void {
    // Manage working state
    toggleWorkingState(creep);

    if (creep.memory.working) {
      // Find and repair damaged structures first
      const repairResult = repairStructure(creep);
      
      // If nothing to repair, maintain walls at minimum health threshold
      if (repairResult === ERR_NOT_FOUND) {
        repairWalls(creep, 10000);
      }
    } else {
      // Harvest energy
      harvestEnergy(creep);
    }
  }
}
