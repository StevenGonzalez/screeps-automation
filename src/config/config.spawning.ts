export const BUILDER_BODY = [WORK, CARRY, MOVE];
export const HARVESTER_BODY = [WORK, CARRY, MOVE];
export const UPGRADER_BODY = [WORK, CARRY, MOVE];
export const HAULER_BODY = [CARRY, CARRY, MOVE];
export const REPAIRER_BODY = [WORK, CARRY, MOVE];

export const BODY_PATTERNS: Record<string, BodyPartConstant[]> = {
  harvester: HARVESTER_BODY,
  upgrader: UPGRADER_BODY,
  builder: BUILDER_BODY,
  hauler: HAULER_BODY,
  repairer: REPAIRER_BODY,
};

export const MAX_BODY_PART_COUNT = 50;
export const SPAWN_ENERGY_RESERVE = 0.25;
