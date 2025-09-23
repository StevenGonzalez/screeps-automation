/**
 * Room Structure Orchestration
 *
 * Coordinates all structure types in a room by delegating to specialized modules.
 * Provides a unified interface for room-level structure management.
 */

/// <reference types="@types/screeps" />

import { executeTowerActions, performAutoRepair } from "./structure.tower";
import { manageLinks } from "./structure.link";
import { manageEnergyDistribution } from "./structure.extension";
import { logSpawnStatus } from "./structure.spawn";
import { manageStorageStructures } from "./structure.storage";

/**
 * Manage all structures in a room based on plans
 */
export function manageRoomStructures(
  room: Room,
  defensePlan: any,
  economicPlan: any
): void {
  // Priority 1: Execute defensive tower actions
  executeTowerActions(room, defensePlan);

  // Priority 2: Auto-repair with excess energy
  performAutoRepair(room);

  // Priority 3: Storage and container management
  const storageStatus = manageStorageStructures(room);

  // Priority 4: Link operations for energy distribution
  manageLinks(room, economicPlan);

  // Priority 5: Extension and spawn energy management
  manageEnergyDistribution(room);

  // Priority 6: Status logging and monitoring
  logStructureStatus(room, storageStatus);
}

/**
 * Log structure status for monitoring
 */
function logStructureStatus(room: Room, storageStatus?: any): void {
  // Each structure module handles its own logging
  logSpawnStatus(room);

  // Log storage status if available
  if (storageStatus && storageStatus.distributionPlan) {
    console.log(
      `🏪 Storage: ${Math.round(storageStatus.fillRatio * 100)}% full, needs ${
        storageStatus.distributionPlan.recommendedHaulers
      } haulers`
    );
  }

  // Extension status is logged within manageEnergyDistribution
  // Tower and link status can be accessed via their respective modules
}
