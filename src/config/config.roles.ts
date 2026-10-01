// Role identities — a medieval, dark-fantasy kingdom. The home room is the castle;
// remote roles are outside vendors (peddlers, merchants, envoys) who come to trade.
// These string values ARE memory.role and the Game.arca role labels. They are
// cosmetic (memory.role is the single source of truth) but live creeps carry the
// OLD value across a deploy, so a theme change is paired with a migration in
// services.rebrand.ts. Keep every value unique: they double as ROLE_HANDLERS /
// BODY_PATTERNS map keys.
export const ROLE_BUILDER = "mason";
export const ROLE_HARVESTER = "villager";
export const ROLE_UPGRADER = "enchanter";
export const ROLE_REPAIRER = "blacksmith";
export const ROLE_MINER = "miner";
export const ROLE_HAULER = "porter";
export const ROLE_FILLER = "barmaid";
export const ROLE_MINERAL_MINER = "jeweler";
export const ROLE_SCOUT = "raven";
export const ROLE_REMOTE_MINER = "peddler";
export const ROLE_REMOTE_HAULER = "merchant";
export const ROLE_RESERVER = "envoy";
export const ROLE_KNIGHT = "dragonknight";
export const ROLE_WIZARD = "darkwizard";
export const ROLE_CLERIC = "cleric";
export const ROLE_SIEGER = "ravager";
export const ROLE_DRAINER = "gladiator";
export const ROLE_CONQUEROR = "darklord";
export const ROLE_SETTLER = "pilgrim";
export const ROLE_APOTHECARY = "goblin";
export const ROLE_POWER_ATTACKER = "reaver";
export const ROLE_POWER_HEALER = "acolyte";
export const ROLE_POWER_CARRIER = "looter";
export const ROLE_DEPOSIT_MINER = "nomad";
export const ROLE_DEPOSIT_HAULER = "caravan";
export const ROLE_SK_GUARDIAN = "lancer";
export const ROLE_SK_MINER = "delver";
export const ROLE_SK_HAULER = "packmule";
export const ROLE_SCORE_HUNTER = "seeker";
export const ROLE_UNCLAIMER = "usurper";
// The townsfolk of the castle's quarter: militia archers who sleep in the
// cottages and man the walls, and lookouts posted in the neighbouring rooms.
export const ROLE_TOWNSFOLK = "townsfolk";

// How each role is styled in a creep's name: "Mason Aldric", "Dragon Knight Edric II".
export const ROLE_TITLES: Record<string, string> = {
  [ROLE_BUILDER]: "Mason",
  [ROLE_HARVESTER]: "Villager",
  [ROLE_UPGRADER]: "Enchanter",
  [ROLE_REPAIRER]: "Blacksmith",
  [ROLE_MINER]: "Miner",
  [ROLE_HAULER]: "Porter",
  [ROLE_FILLER]: "Barmaid",
  [ROLE_MINERAL_MINER]: "Jeweler",
  [ROLE_SCOUT]: "Raven",
  [ROLE_REMOTE_MINER]: "Peddler",
  [ROLE_REMOTE_HAULER]: "Merchant",
  [ROLE_RESERVER]: "Envoy",
  [ROLE_KNIGHT]: "Dragon Knight",
  [ROLE_WIZARD]: "Dark Wizard",
  [ROLE_CLERIC]: "Cleric",
  [ROLE_SIEGER]: "Ravager",
  [ROLE_DRAINER]: "Gladiator",
  [ROLE_CONQUEROR]: "Dark Lord",
  [ROLE_SETTLER]: "Pilgrim",
  [ROLE_APOTHECARY]: "Goblin",
  [ROLE_POWER_ATTACKER]: "Reaver",
  [ROLE_POWER_HEALER]: "Acolyte",
  [ROLE_POWER_CARRIER]: "Looter",
  [ROLE_DEPOSIT_MINER]: "Nomad",
  [ROLE_DEPOSIT_HAULER]: "Caravan",
  [ROLE_SK_GUARDIAN]: "Lancer",
  [ROLE_SK_MINER]: "Delver",
  [ROLE_SK_HAULER]: "Packmule",
  [ROLE_SCORE_HUNTER]: "Seeker",
  [ROLE_UNCLAIMER]: "Usurper",
  [ROLE_TOWNSFOLK]: "Yeoman",
};

export const ENERGY_DEPOSIT_PRIORITY: Record<string, StructureConstant[]> = {
  [ROLE_HARVESTER]: [
    STRUCTURE_SPAWN,
    STRUCTURE_EXTENSION,
    STRUCTURE_CONTAINER,
    STRUCTURE_STORAGE,
  ],
};
