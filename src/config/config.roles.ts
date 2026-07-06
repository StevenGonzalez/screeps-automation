export const ROLE_BUILDER = "contractor";
export const ROLE_HARVESTER = "runner";
export const ROLE_UPGRADER = "launderer";
export const ROLE_REPAIRER = "fixer";
export const ROLE_MINER = "digger";
export const ROLE_HAULER = "bagman";
export const ROLE_FILLER = "busboy";
export const ROLE_MINERAL_MINER = "cooker";
export const ROLE_SCOUT = "lookout";
export const ROLE_REMOTE_MINER = "stringer";
export const ROLE_REMOTE_HAULER = "mule";
export const ROLE_RESERVER = "collector";
export const ROLE_KNIGHT = "enforcer";
export const ROLE_WIZARD = "triggerman";
export const ROLE_CLERIC = "medic";
export const ROLE_SIEGER = "wrecker";
export const ROLE_DRAINER = "decoy";
export const ROLE_CONQUEROR = "capo";
export const ROLE_SETTLER = "transplant";
export const ROLE_APOTHECARY = "chemist";
export const ROLE_POWER_ATTACKER = "legbreaker";
export const ROLE_POWER_HEALER = "sawbones";
export const ROLE_POWER_CARRIER = "courier";
export const ROLE_DEPOSIT_MINER = "wildcatter";
export const ROLE_DEPOSIT_HAULER = "trucker";
export const ROLE_SK_GUARDIAN = "muscle";
export const ROLE_SK_MINER = "tunneler";
export const ROLE_SK_HAULER = "carrier";
export const ROLE_SCORE_HUNTER = "grifter";

export const ENERGY_DEPOSIT_PRIORITY: Record<string, StructureConstant[]> = {
  [ROLE_HARVESTER]: [
    STRUCTURE_SPAWN,
    STRUCTURE_EXTENSION,
    STRUCTURE_CONTAINER,
    STRUCTURE_STORAGE,
  ],
};
