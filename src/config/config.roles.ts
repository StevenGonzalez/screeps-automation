export const ROLE_BUILDER = "mason";
export const ROLE_HARVESTER = "serf";
export const ROLE_UPGRADER = "sage";
export const ROLE_REPAIRER = "blacksmith";
export const ROLE_MINER = "delver";
export const ROLE_HAULER = "squire";
export const ROLE_MINERAL_MINER = "alchemist";
export const ROLE_SCOUT = "ranger";
export const ROLE_REMOTE_MINER = "wanderer";
export const ROLE_REMOTE_HAULER = "peddler";
export const ROLE_RESERVER = "herald";
export const ROLE_KNIGHT = "knight";
export const ROLE_WIZARD = "wizard";
export const ROLE_PALADIN = "paladin";
export const ROLE_CLAIMER = "claimer";
export const ROLE_PIONEER = "pioneer";

const LEGACY_ROLE_ALIASES: Record<string, string> = {
  // original code-level names
  builder: ROLE_BUILDER,
  harvester: ROLE_HARVESTER,
  upgrader: ROLE_UPGRADER,
  repairer: ROLE_REPAIRER,
  miner: ROLE_MINER,
  hauler: ROLE_HAULER,
  // first-round thematic names (now replaced)
  peasant: ROLE_HARVESTER,
  quarryman: ROLE_MINER,
  carter: ROLE_HAULER,
  steward: ROLE_UPGRADER,
  prospector: ROLE_MINERAL_MINER,
  outrider: ROLE_SCOUT,
  courier: ROLE_REMOTE_HAULER,
  warden: ROLE_RESERVER,
  // note: "delver" (old remote miner) is not aliased — ROLE_MINER is now "delver",
  // so old delver creeps dispatch as stationary miners until they die naturally.
};

export function normalizeRole(role?: string): string | undefined {
  if (!role) return role;
  if (LEGACY_ROLE_ALIASES[role]) return LEGACY_ROLE_ALIASES[role];
  return role;
}

export const ENERGY_DEPOSIT_PRIORITY: Record<string, StructureConstant[]> = {
  [ROLE_HARVESTER]: [
    STRUCTURE_SPAWN,
    STRUCTURE_EXTENSION,
    STRUCTURE_CONTAINER,
    STRUCTURE_STORAGE,
  ],
  [ROLE_UPGRADER]: [STRUCTURE_CONTROLLER],
  [ROLE_BUILDER]: [],
  [ROLE_REPAIRER]: [STRUCTURE_STORAGE, STRUCTURE_CONTAINER],
  [ROLE_MINER]: [STRUCTURE_CONTAINER, STRUCTURE_STORAGE],
  [ROLE_HAULER]: [
    STRUCTURE_SPAWN,
    STRUCTURE_EXTENSION,
    STRUCTURE_TOWER,
    STRUCTURE_STORAGE,
    STRUCTURE_CONTAINER,
  ],
  [ROLE_MINERAL_MINER]: [STRUCTURE_CONTAINER, STRUCTURE_STORAGE, STRUCTURE_TERMINAL],
};
