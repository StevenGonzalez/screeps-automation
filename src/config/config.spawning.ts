import {
  ROLE_BUILDER,
  ROLE_HARVESTER,
  ROLE_UPGRADER,
} from "./config.roles";

export const BUILDER_BODY = [WORK, CARRY, MOVE];
export const HARVESTER_BODY = [WORK, CARRY, MOVE];
export const UPGRADER_BODY = [WORK, CARRY, MOVE];

export const BODY_PATTERNS: Record<string, BodyPartConstant[]> = {
  [ROLE_HARVESTER]: HARVESTER_BODY,
  [ROLE_UPGRADER]: UPGRADER_BODY,
  [ROLE_BUILDER]: BUILDER_BODY,
};

export const MAX_BODY_PART_COUNT = 50;
export const SPAWN_ENERGY_RESERVE = 0.25;
