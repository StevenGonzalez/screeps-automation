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

/**
 * Manage all structures in a room based on plans
 */
export function manageRoomStructures(
  room: Room,
  defensePlan: any,
  constructionPlan: any,
  economicPlan: any
): void {
  // Priority 1: Execute defensive tower actions
  executeTowerActions(room, defensePlan);

  // Priority 2: Auto-repair with excess energy
  performAutoRepair(room);

  // Priority 3: Link operations for energy distribution
  manageLinks(room, economicPlan);

  // Priority 4: Extension and spawn energy management
  manageEnergyDistribution(room);

  // Priority 5: Status logging and monitoring
  logStructureStatus(room);
}

/**
 * Log structure status for monitoring
 */
function logStructureStatus(room: Room): void {
  // Each structure module handles its own logging
  logSpawnStatus(room);

  // Extension status is logged within manageEnergyDistribution
  // Tower and link status can be accessed via their respective modules
}
