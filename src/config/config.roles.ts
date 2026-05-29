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
export const ROLE_CHEMIST = "chemist";
export const ROLE_POWER_ATTACKER = "breacher";
export const ROLE_POWER_HEALER = "battlepriest";
export const ROLE_POWER_CARRIER = "caravan";

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
