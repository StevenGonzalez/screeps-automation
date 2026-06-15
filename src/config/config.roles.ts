export const ROLE_BUILDER = "mason";
export const ROLE_HARVESTER = "peasant";
export const ROLE_UPGRADER = "scholar";
export const ROLE_REPAIRER = "blacksmith";
export const ROLE_MINER = "miner";
export const ROLE_HAULER = "porter";
export const ROLE_MINERAL_MINER = "prospector";
export const ROLE_SCOUT = "ranger";
export const ROLE_REMOTE_MINER = "outrider";
export const ROLE_REMOTE_HAULER = "peddler";
export const ROLE_RESERVER = "herald";
export const ROLE_KNIGHT = "knight";
export const ROLE_WIZARD = "wizard";
export const ROLE_CLERIC = "cleric";
export const ROLE_SIEGER = "sapper";
export const ROLE_CONQUEROR = "conqueror";
export const ROLE_SETTLER = "settler";
export const ROLE_APOTHECARY = "apothecary";
export const ROLE_POWER_ATTACKER = "breacher";
export const ROLE_POWER_HEALER = "battlepriest";
export const ROLE_POWER_CARRIER = "caravan";
export const ROLE_SK_GUARDIAN = "huntsman";
export const ROLE_SK_MINER = "delver";
export const ROLE_SK_HAULER = "wain";

// Deposit order for the early-game harvester (the only role that uses it, via
// findEnergyDepositTarget). Other roles deposit through their own dedicated logic — haulers
// fill spawn/extension/tower then findDepositTargetExcludingMiner; miners drop into their
// container; upgraders/builders/repairers spend energy rather than bank it.
export const ENERGY_DEPOSIT_PRIORITY: Record<string, StructureConstant[]> = {
  [ROLE_HARVESTER]: [
    STRUCTURE_SPAWN,
    STRUCTURE_EXTENSION,
    STRUCTURE_CONTAINER,
    STRUCTURE_STORAGE,
  ],
};
