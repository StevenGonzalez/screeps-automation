// Role identities — a "dumb little bugs" theme. These string values ARE memory.role, the
// on-map creep-name prefix, and the Game.arca role labels. They are cosmetic (nothing parses
// them; memory.role is the single source of truth) but live creeps carry the OLD value across
// a deploy, so a theme change is paired with a migration in services.rebrand.ts. Keep every
// value unique: they double as ROLE_HANDLERS / BODY_PATTERNS map keys.
export const ROLE_BUILDER = "stacker";
export const ROLE_HARVESTER = "nibbler";
export const ROLE_UPGRADER = "poker";
export const ROLE_REPAIRER = "patcher";
export const ROLE_MINER = "muncher";
export const ROLE_HAULER = "dragger";
export const ROLE_FILLER = "stuffer";
export const ROLE_MINERAL_MINER = "gnawer";
export const ROLE_SCOUT = "wobbler";
export const ROLE_REMOTE_MINER = "rover";
export const ROLE_REMOTE_HAULER = "plodder";
export const ROLE_RESERVER = "squatter";
export const ROLE_KNIGHT = "biter";
export const ROLE_WIZARD = "spitter";
export const ROLE_CLERIC = "licker";
export const ROLE_SIEGER = "chewer";
export const ROLE_DRAINER = "wiggler";
export const ROLE_CONQUEROR = "sprawler";
export const ROLE_SETTLER = "nester";
export const ROLE_APOTHECARY = "mixer";
export const ROLE_POWER_ATTACKER = "basher";
export const ROLE_POWER_HEALER = "drooler";
export const ROLE_POWER_CARRIER = "lugger";
export const ROLE_DEPOSIT_MINER = "scraper";
export const ROLE_DEPOSIT_HAULER = "toter";
export const ROLE_SK_GUARDIAN = "stomper";
export const ROLE_SK_MINER = "burrower";
export const ROLE_SK_HAULER = "packer";
export const ROLE_SCORE_HUNTER = "snatcher";

export const ENERGY_DEPOSIT_PRIORITY: Record<string, StructureConstant[]> = {
  [ROLE_HARVESTER]: [
    STRUCTURE_SPAWN,
    STRUCTURE_EXTENSION,
    STRUCTURE_CONTAINER,
    STRUCTURE_STORAGE,
  ],
};
