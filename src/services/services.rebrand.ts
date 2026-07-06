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
