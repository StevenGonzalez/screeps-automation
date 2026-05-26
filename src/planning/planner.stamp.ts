import { PLANNER_KEYS } from "../config/config.structures";

export type StampStructureType =
  | "spawn"
  | "storage"
  | "terminal"
  | "factory"
  | "tower"
  | "extension"
  | "lab"
  | "nuker"
  | "power_spawn"
  | "observer"
  | "road"
  | "rampart";

export interface StampCell {
  dx: number;
  dy: number;
  type: StampStructureType;
  minRcl: number;
  critical?: boolean;
}

export const CASTLE_STAMP: StampCell[] = [
  // Spawns
  { dx:  0, dy:  0, type: "spawn",       minRcl: 1, critical: true },
  { dx: -2, dy:  0, type: "spawn",       minRcl: 7, critical: true },
  { dx:  2, dy:  0, type: "spawn",       minRcl: 8, critical: true },
  // Core structures on vertical spine
  { dx:  0, dy:  2, type: "storage",     minRcl: 4, critical: true },
  { dx:  0, dy: -2, type: "terminal",    minRcl: 6, critical: true },
  { dx:  0, dy: -4, type: "factory",     minRcl: 7, critical: true },
  { dx:  0, dy: -6, type: "observer",    minRcl: 8 },
  { dx:  2, dy: -4, type: "power_spawn", minRcl: 8, critical: true },
  { dx: -2, dy: -4, type: "nuker",       minRcl: 8 },
  // Towers at corners + E/W midpoints
  { dx: -4, dy: -4, type: "tower",       minRcl: 3 },
  { dx:  4, dy: -4, type: "tower",       minRcl: 5 },
  { dx: -4, dy:  4, type: "tower",       minRcl: 5 },
  { dx:  4, dy:  4, type: "tower",       minRcl: 6 },
  { dx: -4, dy:  0, type: "tower",       minRcl: 7 },
  { dx:  4, dy:  0, type: "tower",       minRcl: 8 },
  // Labs cluster SE (Chebyshev ≤ 2 between neighbors — required for reactions)
  { dx:  3, dy:  2, type: "lab",         minRcl: 6 },
  { dx:  4, dy:  2, type: "lab",         minRcl: 6 },
  { dx:  3, dy:  3, type: "lab",         minRcl: 6 },
  { dx:  4, dy:  3, type: "lab",         minRcl: 7 },
  { dx:  5, dy:  2, type: "lab",         minRcl: 7 },
  { dx:  5, dy:  3, type: "lab",         minRcl: 7 },
  { dx:  3, dy:  4, type: "lab",         minRcl: 7 },
  { dx:  5, dy:  4, type: "lab",         minRcl: 8 },
  { dx:  3, dy:  1, type: "lab",         minRcl: 8 },
  { dx:  4, dy:  1, type: "lab",         minRcl: 8 },
  // Internal roads — horizontal spine
  { dx: -1, dy:  0, type: "road", minRcl: 1 },
  { dx:  1, dy:  0, type: "road", minRcl: 1 },
  { dx: -3, dy:  0, type: "road", minRcl: 1 },
  { dx:  3, dy:  0, type: "road", minRcl: 1 },
  { dx: -5, dy:  0, type: "road", minRcl: 1 },
  { dx:  5, dy:  0, type: "road", minRcl: 1 },
  // Vertical spine
  { dx:  0, dy: -1, type: "road", minRcl: 1 },
  { dx:  0, dy:  1, type: "road", minRcl: 1 },
  { dx:  0, dy: -3, type: "road", minRcl: 1 },
  { dx:  0, dy:  3, type: "road", minRcl: 1 },
  { dx:  0, dy: -5, type: "road", minRcl: 1 },
  { dx:  0, dy:  5, type: "road", minRcl: 1 },
  // Diagonal arms to tower corners
  { dx: -1, dy: -1, type: "road", minRcl: 1 },
  { dx: -2, dy: -2, type: "road", minRcl: 1 },
  { dx: -3, dy: -3, type: "road", minRcl: 1 },
  { dx:  1, dy: -1, type: "road", minRcl: 1 },
  { dx:  2, dy: -2, type: "road", minRcl: 1 },
  { dx:  3, dy: -3, type: "road", minRcl: 1 },
  { dx: -1, dy:  1, type: "road", minRcl: 1 },
  { dx: -2, dy:  2, type: "road", minRcl: 1 },
  { dx: -3, dy:  3, type: "road", minRcl: 1 },
  { dx:  1, dy:  1, type: "road", minRcl: 1 },
  { dx:  2, dy:  2, type: "road", minRcl: 1 },
  // Storage/terminal access roads
  { dx:  1, dy:  2, type: "road", minRcl: 1 },
  { dx: -1, dy:  2, type: "road", minRcl: 1 },
  { dx:  1, dy: -2, type: "road", minRcl: 1 },
  { dx: -1, dy: -2, type: "road", minRcl: 1 },
  { dx:  1, dy: -4, type: "road", minRcl: 1 },
  { dx: -1, dy: -4, type: "road", minRcl: 1 },
  // Extensions — RCL 2 (5 total)
  { dx: -2, dy:  1, type: "extension", minRcl: 2 },
  { dx: -2, dy: -1, type: "extension", minRcl: 2 },
  { dx:  2, dy:  1, type: "extension", minRcl: 2 },
  { dx:  2, dy: -1, type: "extension", minRcl: 2 },
  { dx: -1, dy:  3, type: "extension", minRcl: 2 },
  // RCL 3 (+5 = 10 total)
  { dx:  1, dy:  3, type: "extension", minRcl: 3 },
  { dx: -1, dy: -3, type: "extension", minRcl: 3 },
  { dx:  1, dy: -3, type: "extension", minRcl: 3 },
  { dx: -3, dy:  1, type: "extension", minRcl: 3 },
  { dx: -3, dy: -1, type: "extension", minRcl: 3 },
  // RCL 4 (+10 = 20 total)
  { dx:  3, dy:  1, type: "extension", minRcl: 4 },
  { dx:  3, dy: -1, type: "extension", minRcl: 4 },
  { dx: -4, dy:  1, type: "extension", minRcl: 4 },
  { dx: -4, dy: -1, type: "extension", minRcl: 4 },
  { dx:  4, dy:  1, type: "extension", minRcl: 4 },
  { dx:  4, dy: -1, type: "extension", minRcl: 4 },
  { dx: -1, dy:  4, type: "extension", minRcl: 4 },
  { dx:  1, dy:  4, type: "extension", minRcl: 4 },
  { dx: -2, dy:  3, type: "extension", minRcl: 4 },
  { dx:  2, dy:  3, type: "extension", minRcl: 4 },
  // RCL 5 (+10 = 30 total)
  { dx: -2, dy: -3, type: "extension", minRcl: 5 },
  { dx:  2, dy: -3, type: "extension", minRcl: 5 },
  { dx: -3, dy:  2, type: "extension", minRcl: 5 },
  { dx: -3, dy: -2, type: "extension", minRcl: 5 },
  { dx:  1, dy: -5, type: "extension", minRcl: 5 },
  { dx: -1, dy: -5, type: "extension", minRcl: 5 },
  { dx: -5, dy:  1, type: "extension", minRcl: 5 },
  { dx: -5, dy: -1, type: "extension", minRcl: 5 },
  { dx:  5, dy:  1, type: "extension", minRcl: 5 },
  { dx:  5, dy: -1, type: "extension", minRcl: 5 },
  // RCL 6 (+10 = 40 total)
  { dx: -4, dy:  2, type: "extension", minRcl: 6 },
  { dx: -4, dy: -2, type: "extension", minRcl: 6 },
  { dx:  4, dy: -2, type: "extension", minRcl: 6 },
  { dx: -2, dy:  4, type: "extension", minRcl: 6 },
  { dx:  2, dy:  4, type: "extension", minRcl: 6 },
  { dx: -1, dy:  5, type: "extension", minRcl: 6 },
  { dx:  1, dy:  5, type: "extension", minRcl: 6 },
  { dx: -5, dy:  2, type: "extension", minRcl: 6 },
  { dx: -5, dy: -2, type: "extension", minRcl: 6 },
  { dx:  3, dy: -1, type: "extension", minRcl: 6 },
  // RCL 7 (+10 = 50 total)
  { dx:  5, dy:  2, type: "extension", minRcl: 7 },
  { dx:  5, dy: -2, type: "extension", minRcl: 7 },
  { dx: -3, dy:  4, type: "extension", minRcl: 7 },
  { dx:  2, dy: -5, type: "extension", minRcl: 7 },
  { dx: -2, dy: -5, type: "extension", minRcl: 7 },
  { dx: -3, dy: -4, type: "extension", minRcl: 7 },
  { dx: -5, dy:  3, type: "extension", minRcl: 7 },
  { dx:  5, dy:  3, type: "extension", minRcl: 7 },
  { dx:  5, dy: -3, type: "extension", minRcl: 7 },
  { dx: -5, dy: -3, type: "extension", minRcl: 7 },
  // RCL 8 (+10 = 60 total)
  { dx:  2, dy:  5, type: "extension", minRcl: 8 },
  { dx: -2, dy:  5, type: "extension", minRcl: 8 },
  { dx:  3, dy:  5, type: "extension", minRcl: 8 },
  { dx: -3, dy:  5, type: "extension", minRcl: 8 },
  { dx:  3, dy: -5, type: "extension", minRcl: 8 },
  { dx: -3, dy: -5, type: "extension", minRcl: 8 },
  { dx:  4, dy: -3, type: "extension", minRcl: 8 },
  { dx: -4, dy: -3, type: "extension", minRcl: 8 },
  { dx: -4, dy:  3, type: "extension", minRcl: 8 },
  { dx: -2, dy: -4, type: "extension", minRcl: 8 },
];

export function stampMemoryKeyFor(cell: StampCell): string {
  switch (cell.type) {
    case "spawn":       return `${PLANNER_KEYS.STAMP_SPAWN_PREFIX}${cell.minRcl}`;
    case "tower":       return `${PLANNER_KEYS.STAMP_TOWER_PREFIX}${cell.dx}_${cell.dy}`;
    case "extension":   return PLANNER_KEYS.STAMP_EXTENSION_KEY;
    case "lab":         return PLANNER_KEYS.STAMP_LAB_KEY;
    case "road":        return PLANNER_KEYS.STAMP_ROAD_KEY;
    case "rampart":     return PLANNER_KEYS.STAMP_RAMPART_KEY;
    case "storage":     return PLANNER_KEYS.STAMP_STORAGE_KEY;
    case "terminal":    return PLANNER_KEYS.STAMP_TERMINAL_KEY;
    case "factory":     return PLANNER_KEYS.STAMP_FACTORY_KEY;
    case "observer":    return PLANNER_KEYS.STAMP_OBSERVER_KEY;
    case "nuker":       return PLANNER_KEYS.STAMP_NUKER_KEY;
    case "power_spawn": return PLANNER_KEYS.STAMP_POWER_SPAWN_KEY;
    default:            return PLANNER_KEYS.CASTLE_STAMP_KEY;
  }
}

export function getStampCellsForRcl(rcl: number): StampCell[] {
  return CASTLE_STAMP.filter((cell) => cell.minRcl <= rcl);
}
