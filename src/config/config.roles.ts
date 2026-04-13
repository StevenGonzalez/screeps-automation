export const ROLE_BUILDER = "mason";
export const ROLE_HARVESTER = "peasant";
export const ROLE_UPGRADER = "steward";
export const ROLE_REPAIRER = "blacksmith";
export const ROLE_MINER = "quarryman";
export const ROLE_HAULER = "carter";

const LEGACY_ROLE_ALIASES: Record<string, string> = {
  builder: ROLE_BUILDER,
  harvester: ROLE_HARVESTER,
  upgrader: ROLE_UPGRADER,
  repairer: ROLE_REPAIRER,
  miner: ROLE_MINER,
  hauler: ROLE_HAULER,
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
};
