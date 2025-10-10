/**
 * Defense Maintenance
 *
 * Manages defense structure HP targets and repair priorities
 * Integrates with construction and repair systems
 */

import { DefensePlan, getRampartHPTarget, getWallHPTarget } from "./planner";

export interface DefenseStatus {
  ramparts: {
    total: number;
    critical: number; // Below 25% HP
    damaged: number; // Below target HP
  };
  walls: {
    total: number;
    critical: number;
    damaged: number;
  };
  repairPriority: Structure[];
}

/**
 * Analyze current defense status
 */
export function analyzeDefenseStatus(
  room: Room,
  plan: DefensePlan
): DefenseStatus {
  const status: DefenseStatus = {
    ramparts: { total: 0, critical: 0, damaged: 0 },
    walls: { total: 0, critical: 0, damaged: 0 },
    repairPriority: [],
  };

  // Check all ramparts
  const ramparts = room.find(FIND_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_RAMPART,
  }) as StructureRampart[];

  for (const rampart of ramparts) {
    status.ramparts.total++;
    const target = getRampartHPTarget(rampart.pos, plan);
    const hpPercent = rampart.hits / target;

    if (hpPercent < 0.25) {
      status.ramparts.critical++;
      status.repairPriority.push(rampart);
    } else if (rampart.hits < target) {
      status.ramparts.damaged++;
      if (hpPercent < 0.75) {
        // Add to repair queue if below 75%
        status.repairPriority.push(rampart);
      }
    }
  }

  // Check all walls
  const walls = room.find(FIND_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_WALL,
  }) as StructureWall[];

  for (const wall of walls) {
    status.walls.total++;
    const target = getWallHPTarget(wall.pos, plan);
    const hpPercent = wall.hits / target;

    if (hpPercent < 0.25) {
      status.walls.critical++;
      status.repairPriority.push(wall);
    } else if (wall.hits < target) {
      status.walls.damaged++;
      if (hpPercent < 0.75) {
        status.repairPriority.push(wall);
      }
    }
  }

  // Sort repair priority: critical first, then by HP percentage
  status.repairPriority.sort((a, b) => {
    const aTarget =
      a.structureType === STRUCTURE_RAMPART
        ? getRampartHPTarget(a.pos, plan)
        : getWallHPTarget(a.pos, plan);
    const bTarget =
      b.structureType === STRUCTURE_RAMPART
        ? getRampartHPTarget(b.pos, plan)
        : getWallHPTarget(b.pos, plan);

    const aPercent = a.hits / aTarget;
    const bPercent = b.hits / bTarget;

    return aPercent - bPercent; // Lowest percentage first
  });

  return status;
}

// Cache defense status to avoid expensive recalculation every tick
const defenseStatusCache: {
  [roomName: string]: { status: DefenseStatus; time: number };
} = {};
const STATUS_CACHE_DURATION = 10; // Cache for 10 ticks (repair status changes slowly)

/**
 * Get defense structures that need repair
 * Returns structures sorted by priority (cached)
 */
export function getDefenseRepairTargets(
  room: Room,
  plan: DefensePlan,
  limit: number = 10
): Structure[] {
  // Check cache first
  const cached = defenseStatusCache[room.name];
  if (cached && Game.time - cached.time < STATUS_CACHE_DURATION) {
    return cached.status.repairPriority.slice(0, limit);
  }

  // Calculate fresh status
  const status = analyzeDefenseStatus(room, plan);

  // Cache it
  defenseStatusCache[room.name] = { status, time: Game.time };

  return status.repairPriority.slice(0, limit);
}

/**
 * Check if a structure should be repaired based on defense plan
 */
export function shouldRepairDefense(
  structure: Structure,
  plan: DefensePlan
): boolean {
  if (
    structure.structureType !== STRUCTURE_RAMPART &&
    structure.structureType !== STRUCTURE_WALL
  ) {
    return false;
  }

  const target =
    structure.structureType === STRUCTURE_RAMPART
      ? getRampartHPTarget(structure.pos, plan)
      : getWallHPTarget(structure.pos, plan);

  return structure.hits < target * 0.95; // Repair if below 95% of target
}

/**
 * Get the repair target HP for a structure
 */
export function getRepairTarget(
  structure: Structure,
  plan: DefensePlan
): number {
  if (structure.structureType === STRUCTURE_RAMPART) {
    return getRampartHPTarget(structure.pos, plan);
  }
  if (structure.structureType === STRUCTURE_WALL) {
    return getWallHPTarget(structure.pos, plan);
  }
  return structure.hitsMax;
}

/**
 * Determine how many repairers are needed based on defense status
 */
export function getRequiredRepairers(room: Room, plan: DefensePlan): number {
  const status = analyzeDefenseStatus(room, plan);

  // Base repairers: 0
  let required = 0;

  // Add 1 repairer for every 5 critical structures
  if (status.ramparts.critical + status.walls.critical > 0) {
    required += Math.ceil(
      (status.ramparts.critical + status.walls.critical) / 5
    );
  }

  // Add 1 repairer if we have lots of damaged structures
  if (status.ramparts.damaged + status.walls.damaged > 20) {
    required += 1;
  }

  // Cap at 3 repairers max
  return Math.min(required, 3);
}

/**
 * Log defense status (for debugging)
 */
export function logDefenseStatus(room: Room, plan: DefensePlan): void {
  const status = analyzeDefenseStatus(room, plan);

  console.log(`\n🛡️ [Defense] ${room.name} Status:`);
  console.log(
    `  Ramparts: ${status.ramparts.total} (${status.ramparts.critical} critical, ${status.ramparts.damaged} damaged)`
  );
  console.log(
    `  Walls: ${status.walls.total} (${status.walls.critical} critical, ${status.walls.damaged} damaged)`
  );
  console.log(`  Repair Queue: ${status.repairPriority.length} structures`);

  if (status.repairPriority.length > 0) {
    const top3 = status.repairPriority.slice(0, 3);
    console.log(`  Top priorities:`);
    for (const structure of top3) {
      const target = getRepairTarget(structure, plan);
      const percent = Math.floor((structure.hits / target) * 100);
      console.log(
        `    - ${structure.structureType} at ${structure.pos}: ${percent}% (${structure.hits}/${target})`
      );
    }
  }
}
