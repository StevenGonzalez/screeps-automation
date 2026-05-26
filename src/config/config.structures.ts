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
  extensionOffsetsFromSpawn: [] as Array<{ x: number; y: number }>,
  maxExtensionsPerSpawn: 10,
  extensionSearchRadius: 6,
  extensionMinDistanceFromSpawn: 4,
  extensionUseRing: false,
  extensionRingRadius: 2,
  extensionRingEntrances: 2,
};

export const PLANNER_KEYS = {
  CONTAINER_PREFIX: "container",
  CONTAINER_SOURCE_PREFIX: "container_source_",
  CONTAINER_CONTROLLER: "container_controller",
  CONTAINER_MINERAL_PREFIX: "container_mineral_",
  ROAD_PREFIX: "road_",
  NODE_SOURCE_PREFIX: "node_source_",
  NODE_CONTROLLER: "node_controller",
  NODE_MINERAL_PREFIX: "node_mineral_",
  CONNECTOR_PREFIX: "connector_",
  TOWERS_PREFIX: "towers_for_",
  RAMPARTS_KEY: "ramparts",
  EXTENSIONS_PREFIX: "extensions_for_",
  STORAGE_PREFIX: "storage_for_",
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
