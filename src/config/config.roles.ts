// Role identities — a "corporate middle management" theme. These string values ARE memory.role, the
// on-map creep-name prefix, and the Game.arca role labels. They are cosmetic (nothing parses
// them; memory.role is the single source of truth) but live creeps carry the OLD value across
// a deploy, so a theme change is paired with a migration in services.rebrand.ts. Keep every
// value unique: they double as ROLE_HANDLERS / BODY_PATTERNS map keys.
export const ROLE_BUILDER = "facilities";
export const ROLE_HARVESTER = "intern";
export const ROLE_UPGRADER = "consultant";
export const ROLE_REPAIRER = "helpdesk";
export const ROLE_MINER = "associate";
export const ROLE_HAULER = "courier";
export const ROLE_FILLER = "admin";
export const ROLE_MINERAL_MINER = "procurement";
export const ROLE_SCOUT = "recruiter";
export const ROLE_REMOTE_MINER = "freelancer";
export const ROLE_REMOTE_HAULER = "logistics";
export const ROLE_RESERVER = "legal";
export const ROLE_KNIGHT = "hr";
export const ROLE_WIZARD = "compliance";
export const ROLE_CLERIC = "wellness";
export const ROLE_SIEGER = "auditor";
export const ROLE_DRAINER = "pr";
export const ROLE_CONQUEROR = "regional";
export const ROLE_SETTLER = "onboarding";
export const ROLE_APOTHECARY = "research";
export const ROLE_POWER_ATTACKER = "downsizer";
export const ROLE_POWER_HEALER = "benefits";
export const ROLE_POWER_CARRIER = "treasury";
export const ROLE_DEPOSIT_MINER = "offshore";
export const ROLE_DEPOSIT_HAULER = "shipping";
export const ROLE_SK_GUARDIAN = "security";
export const ROLE_SK_MINER = "overtime";
export const ROLE_SK_HAULER = "payroll";
export const ROLE_SCORE_HUNTER = "bizdev";
export const ROLE_UNCLAIMER = "liquidator";

export const ENERGY_DEPOSIT_PRIORITY: Record<string, StructureConstant[]> = {
  [ROLE_HARVESTER]: [
    STRUCTURE_SPAWN,
    STRUCTURE_EXTENSION,
    STRUCTURE_CONTAINER,
    STRUCTURE_STORAGE,
  ],
};
