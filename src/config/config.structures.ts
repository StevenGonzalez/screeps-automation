export const STRUCTURE_PLANNER = {
  containerOffset: 1,
  upgradeContainerOffset: 2,
  roadPadding: 0,
  rampartPadding: 1,
  towerOffsetsFromSpawn: [
    { x: 3, y: 0 },
    { x: -3, y: 0 },
    { x: 0, y: 3 },
    { x: 0, y: -3 },
  ],
  visualTickInterval: 50,
  visualRoadSampleStep: 4,
  visualMaxDotsPerKey: 200,
  planInterval: 50,
  rampartOnTopFor: [STRUCTURE_CONTAINER, STRUCTURE_SPAWN, STRUCTURE_STORAGE],
};

export const PLANNER_KEYS = {
  CONTAINER_PREFIX: "container",
  CONTAINER_SOURCE_PREFIX: "container_source_",
  CONTAINER_CONTROLLER: "container_controller",
  ROAD_PREFIX: "road_",
  NODE_SOURCE_PREFIX: "node_source_",
  NODE_CONTROLLER: "node_controller",
  NODE_MINERAL_PREFIX: "node_mineral_",
  CONNECTOR_PREFIX: "connector_",
  TOWERS_PREFIX: "towers_for_",
  RAMPARTS_KEY: "ramparts",
};
