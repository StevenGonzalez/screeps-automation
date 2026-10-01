// One-time migration of live creeps' memory.role to the CURRENT role vocabulary.
//
// The theme has changed more than once (medieval -> crime -> dumb bugs -> corporate -> MU
// Online fantasy -> medieval dark fantasy). memory.role is the single source of truth for
// behavior, so any creep alive across a deploy still carries its OLD role string and would fall
// through ROLE_HANDLERS (going inert, wasting a population slot) until it dies. This maps every
// MU class name that was dropped to its current value. It's guarded by a version tag so it runs
// exactly once per theme change: bump ROLE_THEME (and rewrite the map) whenever the roster is
// renamed again.
//
// Only the previous theme is mapped. Creeps live 1500 ticks, so nothing older survives, and
// several older names are reused by the current roster for a different role, so mapping them
// could misroute a creep.
//
// Iterating Memory.creeps (not Game.creeps) also covers creeps still spawning this tick.

const ROLE_THEME = "darkfantasy";

const ROLE_RENAMES: Record<string, string> = {
  wanderer: "peddler",
  fairyelf: "cleric",
  ragefighter: "ravager",
  blademaster: "reaver",
  museelf: "acolyte",
};

export function migrateRoleNames(): void {
  if ((Memory as any).roleTheme === ROLE_THEME) return;

  let migrated = 0;
  for (const name in Memory.creeps) {
    const mem = Memory.creeps[name];
    const renamed = mem && ROLE_RENAMES[mem.role];
    if (renamed) {
      mem.role = renamed;
      migrated++;
    }
  }

  migrateSquadFields();

  (Memory as any).roleTheme = ROLE_THEME;
  if (migrated > 0) {
    console.log(`[rebrand] by royal decree, ${migrated} creeps have sworn new oaths to the castle.`);
  }
}

// Squad ops used to store their head counts under themed names (requiredBiters...). They are
// neutral now so the next theme change leaves them alone; this carries in-flight ops across.
const SQUAD_FIELD_RENAMES: Record<string, string> = {
  requiredKnights: "requiredMelee", requiredEnforcers: "requiredMelee", requiredBiters: "requiredMelee",
  requiredWizards: "requiredRanged", requiredTriggermen: "requiredRanged", requiredSpitters: "requiredRanged",
  requiredClerics: "requiredHealers", requiredMedics: "requiredHealers", requiredLickers: "requiredHealers",
  requiredSiegers: "requiredSiege", requiredWreckers: "requiredSiege", requiredChewers: "requiredSiege",
  requiredDecoys: "requiredDrainers", requiredWigglers: "requiredDrainers",
};

function migrateSquadFields(): void {
  const ops: any[] = [
    Memory.militaryOp,
    ...Object.values(Memory.militaryOps ?? {}),
    ...(Memory.militaryQueue ?? []),
    ...Object.values(Memory.defenseOps ?? {}),
  ];
  for (const op of ops) {
    if (!op) continue;
    for (const from in SQUAD_FIELD_RENAMES) {
      if (op[from] === undefined) continue;
      op[SQUAD_FIELD_RENAMES[from]] = op[from];
      delete op[from];
    }
  }
}
