export const BUILDER_BODY = [WORK, CARRY, MOVE];
export const HARVESTER_BODY = [WORK, CARRY, MOVE];
export const UPGRADER_BODY = [WORK, CARRY, MOVE];

export const BODY_PATTERNS: Record<string, BodyPartConstant[]> = {
  harvester: HARVESTER_BODY,
  upgrader: UPGRADER_BODY,
  builder: BUILDER_BODY,
};

export const MAX_BODY_PART_COUNT = 50;
