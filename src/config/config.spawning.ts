import {
  ROLE_BUILDER,
  ROLE_HARVESTER,
  ROLE_UPGRADER,
  ROLE_HAULER,
  ROLE_REPAIRER,
  ROLE_APOTHECARY,
} from "./config.roles";

export const BODY_PATTERNS: Record<string, BodyPartConstant[]> = {
  // 2:1 carry-to-move on roads; scales up with energy
  [ROLE_HAULER]: [CARRY, CARRY, MOVE],
  // Apothecary moves resources between storage and labs — same carry-heavy pattern
  [ROLE_APOTHECARY]: [CARRY, CARRY, MOVE],
  // WORK-heavy for maximum build/repair throughput
  [ROLE_BUILDER]: [WORK, WORK, CARRY, MOVE],
  [ROLE_REPAIRER]: [WORK, WORK, CARRY, MOVE],
  // Balanced harvester — moves energy before switching to miners
  [ROLE_HARVESTER]: [WORK, CARRY, MOVE],
  // Upgrader cares most about WORK parts
  [ROLE_UPGRADER]: [WORK, WORK, CARRY, MOVE],
};

export const MAX_BODY_PART_COUNT = 50;

// Fraction of room energy kept in reserve so spawning never starves extensions/towers.
// 0 = spend everything; lower means more aggressive spawning.
export const SPAWN_ENERGY_RESERVE = 0.1;
