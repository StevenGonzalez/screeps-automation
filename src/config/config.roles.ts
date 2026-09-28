// Role identities — a medieval fantasy theme borrowing from MU Online. The home room is the
// castle; remote roles are travelers who come to trade. These string values ARE memory.role,
// the on-map creep-name prefix, and the Game.arca role labels. They are cosmetic (nothing
// parses them; memory.role is the single source of truth) but live creeps carry the OLD value
// across a deploy, so a theme change is paired with a migration in services.rebrand.ts. Keep
// every value unique: they double as ROLE_HANDLERS / BODY_PATTERNS map keys.
export const ROLE_BUILDER = "mason";
export const ROLE_HARVESTER = "villager";
export const ROLE_UPGRADER = "enchanter";
export const ROLE_REPAIRER = "blacksmith";
export const ROLE_MINER = "miner";
export const ROLE_HAULER = "porter";
export const ROLE_FILLER = "barmaid";
export const ROLE_MINERAL_MINER = "jeweler";
export const ROLE_SCOUT = "raven";
export const ROLE_REMOTE_MINER = "wanderer";
export const ROLE_REMOTE_HAULER = "merchant";
export const ROLE_RESERVER = "envoy";
export const ROLE_KNIGHT = "dragonknight";
export const ROLE_WIZARD = "darkwizard";
export const ROLE_CLERIC = "fairyelf";
export const ROLE_SIEGER = "ragefighter";
export const ROLE_DRAINER = "gladiator";
export const ROLE_CONQUEROR = "darklord";
export const ROLE_SETTLER = "pilgrim";
export const ROLE_APOTHECARY = "goblin";
export const ROLE_POWER_ATTACKER = "blademaster";
export const ROLE_POWER_HEALER = "museelf";
export const ROLE_POWER_CARRIER = "looter";
export const ROLE_DEPOSIT_MINER = "nomad";
export const ROLE_DEPOSIT_HAULER = "caravan";
export const ROLE_SK_GUARDIAN = "lancer";
export const ROLE_SK_MINER = "delver";
export const ROLE_SK_HAULER = "packmule";
export const ROLE_SCORE_HUNTER = "seeker";
export const ROLE_UNCLAIMER = "usurper";

export const ENERGY_DEPOSIT_PRIORITY: Record<string, StructureConstant[]> = {
  [ROLE_HARVESTER]: [
    STRUCTURE_SPAWN,
    STRUCTURE_EXTENSION,
    STRUCTURE_CONTAINER,
    STRUCTURE_STORAGE,
  ],
};
