// MU Online map/town names, in expansion order. A bot-built spawn in a room
// with no spawn yet claims the first name here not already in use; additional
// spawns in an already-named room get a Roman-numeral suffix (see nextSpawnName).
export const MU_TOWN_NAMES = [
  "Lorencia", "Devias", "Noria", "Atlans", "Tarkan", "Icarus",
  "Aida", "Kanturu", "Crywolf", "Vulcanus", "Elbeland", "Karutan",
  "LostTower", "Dungeon", "Kalima",
];

export const STRUCTURE_PLANNER = {
  containerOffset: 1,
  upgradeContainerOffset: 2,
  roadPadding: 0,
  rampartPadding: 1,
  towerOffsetsFromSpawn: [
    { x: 2, y: 0 },
    { x: -2, y: 0 },
    { x: 0, y: 2 },
    { x: 0, y: -2 },
  ],
  planInterval: 50,
  // Screeps caps total construction sites per player at MAX_CONSTRUCTION_SITES (100).
  // Roads outnumber every other planned structure, so bound how many road sites a
  // room may have pending at once — this leaves headroom under the global cap for
  // economy structures (extensions especially) to get a site.
  maxRoadConstructionSites: 15,
  plannedCleanupInterval: 1000,
  plannedCleanupUnseenAge: 10000,
  plannedRoadPruneTicks: 5000,
  rampartOnTopFor: [
    STRUCTURE_CONTAINER,
    STRUCTURE_SPAWN,
    STRUCTURE_STORAGE,
    STRUCTURE_EXTENSION,
    STRUCTURE_TOWER,
    STRUCTURE_LAB,
    STRUCTURE_NUKER,
    STRUCTURE_POWER_SPAWN,
    STRUCTURE_OBSERVER,
    STRUCTURE_TERMINAL,
    STRUCTURE_FACTORY,
  ] as StructureConstant[],
};

export const PLANNER_KEYS = {
  CONTAINER_PREFIX: "container",
  CONTAINER_SOURCE_PREFIX: "container_source_",
  CONTAINER_CONTROLLER: "container_controller",
  CONTAINER_MINERAL_PREFIX: "container_mineral_",
  ROAD_PREFIX: "road_",
  CONNECTOR_PREFIX: "connector_",
  RAMPARTS_KEY: "ramparts",
  // Castle stamp keys
  CASTLE_STAMP_KEY:      "castle_stamp",
  STAMP_SPAWN_PREFIX:    "stamp_spawn_",
  STAMP_STORAGE_KEY:     "stamp_storage",
  STAMP_TERMINAL_KEY:    "stamp_terminal",
  STAMP_FACTORY_KEY:     "stamp_factory",
  STAMP_TOWER_PREFIX:    "stamp_tower_",
  STAMP_EXTENSION_KEY:   "stamp_extensions",
  STAMP_LAB_KEY:         "stamp_labs",
  STAMP_NUKER_KEY:       "stamp_nuker",
  STAMP_POWER_SPAWN_KEY: "stamp_power_spawn",
  STAMP_OBSERVER_KEY:    "stamp_observer",
  STAMP_ROAD_KEY:        "stamp_roads",
  STAMP_RAMPART_KEY:     "stamp_ramparts",
  CARDINAL_ROAD_PREFIX:  "cardinal_road_",
};

export const STAMP_PLANNER = {
  halfSize: 6,
  anchorMinEdgeDistance: 8,
  bfsMaxRadius: 5,
};

// Defensive perimeter: a sealed ring of ramparts enclosing the whole base core
// (stamp structures + the Merchant Ring extensions), not just the stamp box.
export const PERIMETER_PLANNER = {
  // Don't wall off the base until it's worth defending (storage exists at RCL 4).
  minRcl: 4,
  // Tiles of breathing room added around the bounding box of all core structures,
  // so the wall doesn't sit flush against extensions/towers and creeps can still
  // path along the inside edge.
  margin: 2,
  // Keep the ring off the room border (creeps standing on edge tiles can leave the
  // room) — exit tiles are 0 and 49; clamp the box to a usable interior.
  minEdge: 2,
  maxEdge: 47,
  // Recompute the perimeter only this often. The base footprint grows slowly (a
  // ring of extensions per RCL), so a wide interval keeps CPU near zero while still
  // expanding the wall as the base does.
  replanInterval: 1500,
};

export const TOWER_COUNT_PER_RCL: Record<number, number> = {
  0: 0,
  1: 0,
  2: 0,
  3: 1,
  4: 1,
  5: 2,
  6: 2,
  7: 3,
  8: 6,
};

export type TowerDistributionMode = "even" | "primary";
export const TOWER_DISTRIBUTION_MODE: TowerDistributionMode = "even";
export const TOWER_PRIMARY_SPAWN_MEMORY_KEY = "primarySpawnId";
