/**
 * Rampart Planner
 *
 * Identifies critical structures that should be protected by ramparts.
 * Priority-based system: spawn > storage/terminal > towers > links/labs > extensions.
 *
 * Design:
 * - Plans are cached in Memory per room and invalidated on RCL changes
 * - Returns position strings for where ramparts should exist
 * - Focuses on defensive priorities: protect spawn first, then economy, then firepower
 */

import { MemoryManager } from '../memory/memoryManager';

export interface RampartPlan {
  positions: string[]; // Position strings in format "x,y"
  generatedAt: number;
  rcl: number;
}

/**
 * Generate rampart plan for a room
 * Plans ramparts for critical structures based on RCL and availability
 */
export function planRamparts(room: Room): RampartPlan {
  const positions = new Set<string>();

  // Priority 1: Spawns (always protect)
  const spawns = room.find(FIND_MY_SPAWNS);
  for (const spawn of spawns) {
    positions.add(`${spawn.pos.x},${spawn.pos.y}`);
  }

  // Priority 2: Storage and Terminal (critical economy)
  if (room.storage) {
    positions.add(`${room.storage.pos.x},${room.storage.pos.y}`);
  }
  if (room.terminal) {
    positions.add(`${room.terminal.pos.x},${room.terminal.pos.y}`);
  }

  // Priority 3: Towers (defensive structures need protection)
  const towers = room.find(FIND_MY_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_TOWER
  });
  for (const tower of towers) {
    positions.add(`${tower.pos.x},${tower.pos.y}`);
  }

  // Priority 4: Links (RCL 5+)
  if (room.controller && room.controller.level >= 5) {
    const links = room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_LINK
    });
    for (const link of links) {
      positions.add(`${link.pos.x},${link.pos.y}`);
    }
  }

  // Priority 5: Labs (RCL 6+)
  if (room.controller && room.controller.level >= 6) {
    const labs = room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_LAB
    });
    for (const lab of labs) {
      positions.add(`${lab.pos.x},${lab.pos.y}`);
    }
  }

  // Priority 6: Extensions (RCL 7+ and if we have >20 extensions)
  // Only protect extensions at higher RCL to avoid rampart spam
  if (room.controller && room.controller.level >= 7) {
    const extensions = room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_EXTENSION
    });
    if (extensions.length > 20) {
      for (const ext of extensions) {
        positions.add(`${ext.pos.x},${ext.pos.y}`);
      }
    }
  }

  return {
    positions: Array.from(positions),
    generatedAt: Game.time,
    rcl: room.controller?.level ?? 0
  };
}

/**
 * Get or generate rampart plan for a room
 * Uses cached plan if valid, otherwise generates new plan
 */
export function getRampartPlan(room: Room): RampartPlan | null {
  if (!room.controller || !room.controller.my) {
    return null;
  }

  const memPath = `rooms.${room.name}.rampartPlan`;
  const cached = MemoryManager.get<RampartPlan>(memPath, undefined);

  // Invalidate cache if RCL changed or plan is old (>1000 ticks)
  if (cached && cached.rcl === room.controller.level && Game.time - cached.generatedAt < 1000) {
    return cached;
  }

  // Generate new plan
  const plan = planRamparts(room);
  MemoryManager.set(memPath, plan);
  return plan;
}

/**
 * Check if a position should have a rampart according to the plan
 */
export function shouldHaveRampart(room: Room, x: number, y: number): boolean {
  const plan = getRampartPlan(room);
  if (!plan) return false;

  const posKey = `${x},${y}`;
  return plan.positions.includes(posKey);
}
