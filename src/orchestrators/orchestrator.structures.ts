import {
  planSourceContainer,
  planControllerContainer,
  planRampartsForStructures,
  planTowerPositions,
  addPlannedStructureToMemory,
  ensureMemoryRoomStructures,
  plannedPositionsFromMemory,
  getOrPlanRoad,
  connectRoadClusters,
  applyPlannedConstruction,
} from "../services/services.structures";
import { PLANNER_KEYS } from "../config/config.structures";

export function loop() {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my) continue;
    processRoomStructures(room);
    applyPlannedConstruction(room);
  }
}

function processRoomStructures(room: Room) {
  ensureMemoryRoomStructures(room);

  const sources = room.find(FIND_SOURCES);
  for (const source of sources) {
    const planned = plannedPositionsFromMemory(
      room,
      `${PLANNER_KEYS.CONTAINER_SOURCE_PREFIX}${source.id}`
    );
    if (planned.length > 0) continue;
    const pos = planSourceContainer(room, source);
    if (pos)
      addPlannedStructureToMemory(
        room,
        `${PLANNER_KEYS.CONTAINER_SOURCE_PREFIX}${source.id}`,
        pos
      );
  }

  if (room.controller) {
    const planned = plannedPositionsFromMemory(
      room,
      PLANNER_KEYS.CONTAINER_CONTROLLER
    );
    if (planned.length === 0) {
      const pos = planControllerContainer(room, room.controller);
      if (pos)
        addPlannedStructureToMemory(
          room,
          PLANNER_KEYS.CONTAINER_CONTROLLER,
          pos
        );
    }
  }

  const spawn = room.find(FIND_MY_SPAWNS)[0];
  if (spawn) {
    for (const source of sources) {
      const containerPlanned = plannedPositionsFromMemory(
        room,
        `${PLANNER_KEYS.CONTAINER_SOURCE_PREFIX}${source.id}`
      );
      if (containerPlanned.length === 0) continue;
      const target = containerPlanned[0];
      const roadKey = `${PLANNER_KEYS.ROAD_PREFIX}${spawn.id}_${source.id}`;
      const existingRoad = plannedPositionsFromMemory(room, roadKey);
      if (existingRoad.length > 0) continue;
      const roadPoints = getOrPlanRoad(room, roadKey, spawn.pos, target);
      for (const p of roadPoints) addPlannedStructureToMemory(room, roadKey, p);
    }

    const controllerContainers = plannedPositionsFromMemory(
      room,
      PLANNER_KEYS.CONTAINER_CONTROLLER
    );
    let controllerTarget: RoomPosition | null = null;
    if (controllerContainers.length > 0)
      controllerTarget = controllerContainers[0];
    else if (room.controller) controllerTarget = room.controller.pos;

    if (controllerTarget) {
      const roadKey = `${PLANNER_KEYS.ROAD_PREFIX}${spawn.id}_controller`;
      const existingRoad = plannedPositionsFromMemory(room, roadKey);
      if (existingRoad.length === 0) {
        const roadPoints = getOrPlanRoad(
          room,
          roadKey,
          spawn.pos,
          controllerTarget
        );
        for (const p of roadPoints)
          addPlannedStructureToMemory(room, roadKey, p);
      }
    }

    const towerKey = `${PLANNER_KEYS.TOWERS_PREFIX}${spawn.id}`;
    const existingTowers = plannedPositionsFromMemory(room, towerKey);
    if (existingTowers.length === 0) {
      const towerPositions = planTowerPositions(room, spawn);
      for (const p of towerPositions)
        addPlannedStructureToMemory(room, towerKey, p);
    }
  }

  const importantTypes = Object.keys(
    (room.memory.plannedStructures || {}) as any
  );
  const importantPositions: RoomPosition[] = [];
  for (const t of importantTypes)
    importantPositions.push(...plannedPositionsFromMemory(room, t));

  connectRoadClusters(room);

  const ramparts = planRampartsForStructures(room, importantPositions);
  const rampKey = `ramparts`;
  const existingRamparts = plannedPositionsFromMemory(room, rampKey);
  if (existingRamparts.length === 0 && ramparts.length > 0) {
    for (const p of ramparts) addPlannedStructureToMemory(room, rampKey, p);
  }
}
