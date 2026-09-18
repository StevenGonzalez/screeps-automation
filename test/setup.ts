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
  STRUCTURE_ROAD: "road",
  STRUCTURE_RAMPART: "rampart",
  STRUCTURE_NUKER: "nuker",
  STRUCTURE_FACTORY: "factory",
};

for (const [name, value] of Object.entries(STRUCTURE_CONSTANTS)) {
  (globalThis as Record<string, unknown>)[name] = value;
}

// Game constants read at module load time (not just inside functions), so they
// have to exist before a test file imports an orchestrator.
const GAME_CONSTANTS: Record<string, unknown> = {
  WORK: "work",
  CARRY: "carry",
  MOVE: "move",
  ATTACK: "attack",
  RANGED_ATTACK: "ranged_attack",
  HEAL: "heal",
  TOUGH: "tough",
  CLAIM: "claim",
  BODYPART_COST: {
    work: 100,
    carry: 50,
    move: 50,
    attack: 80,
    ranged_attack: 150,
    heal: 250,
    tough: 10,
    claim: 600,
  },
  CARRY_CAPACITY: 50,
  RESOURCE_ENERGY: "energy",
  NUKER_GHODIUM_CAPACITY: 5000,
  NUKER_ENERGY_CAPACITY: 300000,
  POWER_BANK_DECAY: 5000,
};

for (const [name, value] of Object.entries(GAME_CONSTANTS)) {
  if ((globalThis as Record<string, unknown>)[name] === undefined) {
    (globalThis as Record<string, unknown>)[name] = value;
  }
}
