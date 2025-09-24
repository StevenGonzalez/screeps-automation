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
    const pct = Math.round(storageStatus.fillRatio * 100);
    const haulers = storageStatus.distributionPlan.recommendedHaulers;
    const state = getRoomStructureLogState(room);
    const cooldown = 150; // ticks
    const significantPctDelta = 3; // % change threshold to log sooner
    const pctDelta = Math.abs((state.storage?.lastPct ?? pct) - pct);
    const haulersChanged = (state.storage?.lastHaulers ?? haulers) !== haulers;
    const crossedOverflowEdge =
      (state.storage?.lastPct ?? pct) < 95 && pct >= 95;

    if (
      Game.time - (state.storage?.lastLogTick ?? 0) >= cooldown ||
      haulersChanged ||
      pctDelta >= significantPctDelta ||
      crossedOverflowEdge
    ) {
      console.log(`🏪 Storage: ${pct}% full, needs ${haulers} haulers`);
      state.storage = {
        lastLogTick: Game.time,
        lastPct: pct,
        lastHaulers: haulers,
      };
    }
  }

  // Extension status is logged within manageEnergyDistribution
  // Tower and link status can be accessed via their respective modules
}

function getRoomStructureLogState(room: Room): any {
  if (!Memory.rooms) Memory.rooms = {} as any;
  if (!Memory.rooms[room.name]) (Memory.rooms as any)[room.name] = {};
  const r = (Memory.rooms as any)[room.name];
  if (!r._structLogs) r._structLogs = {};
  if (!r._structLogs.storage) r._structLogs.storage = null;
  return r._structLogs;
}
