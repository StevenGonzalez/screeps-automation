// One-time migration of live creeps' memory.role to the CURRENT role vocabulary.
//
// The theme has changed more than once (medieval -> crime -> dumb bugs). memory.role is the
// single source of truth for behavior, so any creep alive across a deploy still carries its
// OLD role string and would fall through ROLE_HANDLERS (going inert, wasting a population slot)
// until it dies. This maps every prior value — medieval OR crime — to its current "dumb bugs"
// value. It's guarded by a version tag so it runs exactly once per theme change: bump
// ROLE_THEME (and extend the map) whenever the roster is renamed again.
//
// Iterating Memory.creeps (not Game.creeps) also covers creeps still spawning this tick.

const ROLE_THEME = "bugs";

const ROLE_RENAMES: Record<string, string> = {
  // medieval -> bug
  peasant: "nibbler", miner: "muncher", porter: "dragger", steward: "stuffer",
  scholar: "poker", mason: "stacker", blacksmith: "patcher", prospector: "gnawer",
  apothecary: "mixer", ranger: "wobbler", outrider: "rover", peddler: "plodder",
  herald: "squatter", knight: "biter", wizard: "spitter", cleric: "licker",
  sapper: "chewer", leech: "wiggler", conqueror: "sprawler", settler: "nester",
  breacher: "basher", battlepriest: "drooler", caravan: "lugger", quarrier: "scraper",
  carter: "toter", huntsman: "stomper", delver: "burrower", wain: "packer",
  seeker: "snatcher",
  // crime -> bug
  runner: "nibbler", digger: "muncher", bagman: "dragger", busboy: "stuffer",
  launderer: "poker", contractor: "stacker", fixer: "patcher", cooker: "gnawer",
  chemist: "mixer", lookout: "wobbler", stringer: "rover", mule: "plodder",
  collector: "squatter", enforcer: "biter", triggerman: "spitter", medic: "licker",
  wrecker: "chewer", decoy: "wiggler", capo: "sprawler", transplant: "nester",
  legbreaker: "basher", sawbones: "drooler", courier: "lugger", wildcatter: "scraper",
  trucker: "toter", muscle: "stomper", tunneler: "burrower", carrier: "packer",
  grifter: "snatcher",
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

  (Memory as any).roleTheme = ROLE_THEME;
  if (migrated > 0) {
    console.log(`[rebrand] the bugs woke up: renamed ${migrated} confused creeps.`);
  }
}
