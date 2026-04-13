/**
 * The Blacksmiths
 * Repair and maintain the kingdom's structures
 */

import { toggleWorkingState, harvestEnergy, repairStructure, repairWalls, collectFromContainers, upgradeController } from '../utils/CreepActions';

export class RoleBlacksmith {
  public static run(creep: Creep): void {
    // Manage working state
    toggleWorkingState(creep);

    if (creep.memory.working) {
      // Find and repair damaged structures first
      const repairResult = repairStructure(creep);
      
      // If nothing to repair, maintain walls at minimum health threshold
      if (repairResult === ERR_NOT_FOUND) {
        const wallResult = repairWalls(creep, 10000);
        if (wallResult === ERR_NOT_FOUND) {
          // Nothing to repair, help upgrade the controller
          upgradeController(creep);
        }
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
