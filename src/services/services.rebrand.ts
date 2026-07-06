// One-time migration for the organized-crime rebrand.
//
// The role identities in config.roles.ts changed from a medieval roster (knight, porter,
// scholar…) to a crime-family one (enforcer, bagman, launderer…). memory.role is the single
// source of truth for a creep's behavior, so any creep alive across the deploy still carries
// its OLD role string and would fall through ROLE_HANDLERS (going inert, burning a population
// slot) until it dies. This rewrites those stored values to the new vocabulary exactly once,
// then flips a Memory flag so it never runs again.
//
// Iterating Memory.creeps (rather than Game.creeps) also covers creeps still spawning this
// tick, whose Game.creeps entry doesn't exist yet.

const ROLE_RENAMES: Record<string, string> = {
  mason: "contractor",
  peasant: "runner",
  scholar: "launderer",
  blacksmith: "fixer",
  miner: "digger",
  porter: "bagman",
  steward: "busboy",
  prospector: "cooker",
  ranger: "lookout",
  outrider: "stringer",
  peddler: "mule",
  herald: "collector",
  knight: "enforcer",
  wizard: "triggerman",
  cleric: "medic",
  sapper: "wrecker",
  leech: "decoy",
  conqueror: "capo",
  settler: "transplant",
  apothecary: "chemist",
  breacher: "legbreaker",
  battlepriest: "sawbones",
  caravan: "courier",
  quarrier: "wildcatter",
  carter: "trucker",
  huntsman: "muscle",
  delver: "tunneler",
  wain: "carrier",
  seeker: "grifter",
};

export function migrateRoleNames(): void {
  if ((Memory as any).crimeRebrandDone) return;

  let migrated = 0;
  for (const name in Memory.creeps) {
    const mem = Memory.creeps[name];
    const renamed = mem && ROLE_RENAMES[mem.role];
    if (renamed) {
      mem.role = renamed;
      migrated++;
    }
  }

  (Memory as any).crimeRebrandDone = true;
  if (migrated > 0) {
    console.log(`[rebrand] The family reorganized: renamed ${migrated} made creeps.`);
  }
}
