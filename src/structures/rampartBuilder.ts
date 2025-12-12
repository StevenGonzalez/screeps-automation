/**
 * Rampart Builder
 *
 * Executes rampart plans by creating construction sites and managing rampart lifecycle.
 * Throttles construction to avoid CPU spikes and construction site limits.
 *
 * Design:
 * - Creates rampart construction sites incrementally (max per check)
 * - Tracks build state in Memory to resume across ticks
 * - Automatic cleanup: destroys ramparts not in current plan
 * - Respects game construction site limits
 */

import { MemoryManager } from '../memory/memoryManager';
import { getRampartPlan } from './rampartPlanner';

// Build throttling: check every N ticks
const BUILD_CHECK_INTERVAL = 20;

// Max construction sites to create per check
const MAX_SITES_PER_CHECK = 3;

// Cleanup interval: check for obsolete ramparts
const CLEANUP_CHECK_INTERVAL = 100;

export interface RampartBuildState {
  lastBuildCheck: number;
  lastCleanupCheck: number;
  builtPositions: string[]; // Positions where ramparts exist or are being built
}

/**
 * Execute rampart plan for a room
 * Creates construction sites for missing ramparts incrementally
 */
export function buildRamparts(room: Room): void {
  const plan = getRampartPlan(room);
  if (!plan || plan.positions.length === 0) {
    return;
  }

  const memPath = `rooms.${room.name}.rampartBuildState`;
  let state = MemoryManager.get<RampartBuildState>(memPath, undefined);
  
  if (!state) {
    state = {
      lastBuildCheck: 0,
      lastCleanupCheck: 0,
      builtPositions: []
    };
  }

  // Throttle build checks
  if (Game.time - state.lastBuildCheck < BUILD_CHECK_INTERVAL) {
    return;
  }

  state.lastBuildCheck = Game.time;

  // Find existing ramparts and construction sites
  const existingRamparts = room.find(FIND_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_RAMPART
  }) as StructureRampart[];

  // Make sure all ramparts are public
  for (const rampart of existingRamparts) {
    if (!rampart.isPublic) {
      rampart.setPublic(true);
    }
  }

  const rampartSites = room.find(FIND_MY_CONSTRUCTION_SITES, {
    filter: (s) => s.structureType === STRUCTURE_RAMPART
  });

  const existingSet = new Set<string>();
  for (const rampart of existingRamparts) {
    existingSet.add(`${rampart.pos.x},${rampart.pos.y}`);
  }
  for (const site of rampartSites) {
    existingSet.add(`${site.pos.x},${site.pos.y}`);
  }

  // Find positions that need ramparts
  const missingPositions: string[] = [];
  for (const posKey of plan.positions) {
    if (!existingSet.has(posKey)) {
      missingPositions.push(posKey);
    }
  }

  // Create construction sites incrementally
  let sitesCreated = 0;
  for (const posKey of missingPositions) {
    if (sitesCreated >= MAX_SITES_PER_CHECK) {
      break;
    }

    const [x, y] = posKey.split(',').map(Number);
    const result = room.createConstructionSite(x, y, STRUCTURE_RAMPART);
    
    if (result === OK) {
      sitesCreated++;
      console.log(`[RampartBuilder] Created rampart site at ${posKey} in ${room.name}`);
    } else if (result === ERR_FULL) {
      // Hit construction site limit, stop trying
      break;
    }
  }

  // Update built positions
  state.builtPositions = Array.from(existingSet);
  MemoryManager.set(memPath, state);

  // Periodic cleanup
  if (Game.time - state.lastCleanupCheck >= CLEANUP_CHECK_INTERVAL) {
    cleanupRamparts(room, plan, state);
    state.lastCleanupCheck = Game.time;
    MemoryManager.set(memPath, state);
  }
}

/**
 * Clean up obsolete ramparts not in current plan
 * Only removes ramparts that aren't protecting anything important
 */
function cleanupRamparts(room: Room, plan: any, state: RampartBuildState): void {
  const planSet = new Set(plan.positions);
  
  const existingRamparts = room.find(FIND_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_RAMPART
  }) as StructureRampart[];

  let removed = 0;
  for (const rampart of existingRamparts) {
    const posKey = `${rampart.pos.x},${rampart.pos.y}`;
    
    // If rampart is not in plan, mark for removal
    if (!planSet.has(posKey)) {
      // Check if there's still a structure underneath that needs protection
      const structures = rampart.pos.lookFor(LOOK_STRUCTURES);
      const hasImportantStructure = structures.some(s => 
        s.structureType === STRUCTURE_SPAWN ||
        s.structureType === STRUCTURE_STORAGE ||
        s.structureType === STRUCTURE_TERMINAL ||
        s.structureType === STRUCTURE_TOWER ||
        s.structureType === STRUCTURE_LINK ||
        s.structureType === STRUCTURE_LAB
      );

      // Only destroy if no important structure underneath
      if (!hasImportantStructure && rampart.destroy() === OK) {
        removed++;
        console.log(`[RampartBuilder] Removed obsolete rampart at ${posKey} in ${room.name}`);
      }
    }
  }

  if (removed > 0) {
    console.log(`[RampartBuilder] Cleanup: removed ${removed} obsolete ramparts in ${room.name}`);
  }

  // Also cancel obsolete rampart construction sites
  const rampartSites = room.find(FIND_MY_CONSTRUCTION_SITES, {
    filter: (s) => s.structureType === STRUCTURE_RAMPART
  });

  let canceledSites = 0;
  for (const site of rampartSites) {
    const posKey = `${site.pos.x},${site.pos.y}`;
    if (!planSet.has(posKey)) {
      site.remove();
      canceledSites++;
    }
  }

  if (canceledSites > 0) {
    console.log(`[RampartBuilder] Cleanup: canceled ${canceledSites} obsolete rampart sites in ${room.name}`);
  }
}

/**
 * Get rampart build statistics for a room
 */
export function getRampartStats(room: Room): { planned: number; built: number; sites: number } {
  const plan = getRampartPlan(room);
  if (!plan) {
    return { planned: 0, built: 0, sites: 0 };
  }

  const ramparts = room.find(FIND_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_RAMPART
  });

  const sites = room.find(FIND_MY_CONSTRUCTION_SITES, {
    filter: (s) => s.structureType === STRUCTURE_RAMPART
  });

  return {
    planned: plan.positions.length,
    built: ramparts.length,
    sites: sites.length
  };
}
