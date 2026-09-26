// One-time migration of live creeps' memory.role to the CURRENT role vocabulary.
//
// The theme has changed more than once (medieval -> crime -> dumb bugs -> corporate). memory.role
// is the single source of truth for behavior, so any creep alive across a deploy still carries
// its OLD role string and would fall through ROLE_HANDLERS (going inert, wasting a population
// slot) until it dies. This maps every prior value to its current "corporate" value. It's
// guarded by a version tag so it runs exactly once per theme change: bump ROLE_THEME (and
// extend the map) whenever the roster is renamed again.
//
// The crime-era "courier" (power carrier) is deliberately absent: "courier" is now the hauler.
//
// Iterating Memory.creeps (not Game.creeps) also covers creeps still spawning this tick.

const ROLE_THEME = "corporate";

const ROLE_RENAMES: Record<string, string> = {
  // medieval -> corporate
  peasant: "intern", miner: "associate", porter: "courier", steward: "admin",
  scholar: "consultant", mason: "facilities", blacksmith: "helpdesk", prospector: "procurement",
  apothecary: "research", ranger: "recruiter", outrider: "freelancer", peddler: "logistics",
  herald: "legal", knight: "hr", wizard: "compliance", cleric: "wellness",
  sapper: "auditor", leech: "pr", conqueror: "regional", settler: "onboarding",
  breacher: "downsizer", battlepriest: "benefits", caravan: "treasury", quarrier: "offshore",
  carter: "shipping", huntsman: "security", delver: "overtime", wain: "payroll",
  seeker: "bizdev",
  // crime -> corporate
  runner: "intern", digger: "associate", bagman: "courier", busboy: "admin",
  launderer: "consultant", contractor: "facilities", fixer: "helpdesk", cooker: "procurement",
  chemist: "research", lookout: "recruiter", stringer: "freelancer", mule: "logistics",
  collector: "legal", enforcer: "hr", triggerman: "compliance", medic: "wellness",
  wrecker: "auditor", decoy: "pr", capo: "regional", transplant: "onboarding",
  legbreaker: "downsizer", sawbones: "benefits", wildcatter: "offshore",
  trucker: "shipping", muscle: "security", tunneler: "overtime", carrier: "payroll",
  grifter: "bizdev",
  // bugs -> corporate
  stacker: "facilities", nibbler: "intern", poker: "consultant", patcher: "helpdesk",
  muncher: "associate", dragger: "courier", stuffer: "admin", gnawer: "procurement",
  wobbler: "recruiter", rover: "freelancer", plodder: "logistics", squatter: "legal",
  biter: "hr", spitter: "compliance", licker: "wellness", chewer: "auditor", wiggler: "pr",
  sprawler: "regional", nester: "onboarding", mixer: "research", basher: "downsizer",
  drooler: "benefits", lugger: "treasury", scraper: "offshore", toter: "shipping",
  stomper: "security", burrower: "overtime", packer: "payroll", snatcher: "bizdev",
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
    console.log(`[rebrand] per the reorg, ${migrated} creeps have new titles. Same pay.`);
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
