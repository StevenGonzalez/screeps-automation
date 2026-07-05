// Minimal Screeps global shim for unit tests. Source modules reference a handful of game
// constants in module-level lookup tables (e.g. the structure attack-priority map in
// services.combat). Node has no Screeps runtime, so define just those constants — with their
// real game values — before the modules under test are imported.
const STRUCTURE_CONSTANTS: Record<string, string> = {
  STRUCTURE_SPAWN: "spawn",
  STRUCTURE_EXTENSION: "extension",
  STRUCTURE_LINK: "link",
  STRUCTURE_STORAGE: "storage",
  STRUCTURE_TOWER: "tower",
  STRUCTURE_OBSERVER: "observer",
  STRUCTURE_POWER_SPAWN: "powerSpawn",
  STRUCTURE_EXTRACTOR: "extractor",
  STRUCTURE_LAB: "lab",
  STRUCTURE_TERMINAL: "terminal",
  STRUCTURE_CONTAINER: "container",
  STRUCTURE_NUKER: "nuker",
  STRUCTURE_FACTORY: "factory",
};

for (const [name, value] of Object.entries(STRUCTURE_CONSTANTS)) {
  (globalThis as Record<string, unknown>)[name] = value;
}
