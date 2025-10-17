import {
  planSourceContainer,
  planControllerContainer,
  planRampartsForStructures,
  planExtensionPositions,
  planTowerPositions,
  ensureRampartsForExistingStructures,
  addPlannedStructureToMemory,
  ensureMemoryRoomStructures,
  plannedPositionsFromMemory,
  getOrPlanRoad,
  planRoadsAroundStructures,
  pruneRoadsUnderStructures,
  connectRoadClusters,
  applyPlannedConstruction,
} from "../services/services.structures";
import { PLANNER_KEYS } from "../config/config.structures";
import { STRUCTURE_PLANNER } from "../config/config.structures";

export function loop() {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my) continue;
    processRoomStructures(room);
    applyPlannedConstruction(room);
    ensureRampartsForExistingStructures(room);
  }
}

function processRoomStructures(room: Room) {
  const last = room.memory.lastStructurePlanTick || 0;
  if (Game.time - last < STRUCTURE_PLANNER.planInterval) return;
  ensureMemoryRoomStructures(room);

  try {
    const meta = (room as any).memory.plannedStructuresMeta || {};
    const mem = (room.memory.plannedStructures || {}) as Record<
      string,
      string[]
    >;
    const now = Game.time;
    const pruneAge = (STRUCTURE_PLANNER as any).plannedRoadPruneTicks || 0;
    if (pruneAge > 0) {
      for (const key of Object.keys(mem)) {
        if (
          !key.startsWith(PLANNER_KEYS.ROAD_PREFIX) &&
          !key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX)
        )
          continue;
        const info = meta[key];
        if (!info || !info.createdAt) continue;
        if (now - info.createdAt < pruneAge) continue;

        const positions = mem[key] || [];
        let anyLive = false;
        for (const p of positions) {
          const [px, py] = p.split(",").map(Number);
          const structs = room.lookForAt(
            LOOK_STRUCTURES,
            px,
            py
          ) as Structure[];
          if (structs.length > 0) {
            anyLive = true;
            break;
          }
          const sites = room.lookForAt(
            LOOK_CONSTRUCTION_SITES,
            px,
            py
          ) as ConstructionSite[];
          if (sites.length > 0) {
            anyLive = true;
            break;
          }
        }
        if (!anyLive) {
          delete (room as any).memory.plannedStructures[key];
          delete (room as any).memory.plannedStructuresMeta[key];
        }
      }
    }
  } catch (e) {}

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
      const roadKey = `${PLANNER_KEYS.ROAD_PREFIX}${spawn.id}_${PLANNER_KEYS.NODE_SOURCE_PREFIX}${source.id}`;
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
      const roadKey = `${PLANNER_KEYS.ROAD_PREFIX}${spawn.id}_${PLANNER_KEYS.NODE_CONTROLLER}`;
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

    const mineral = room.find(FIND_MINERALS)[0] as Mineral | undefined;
    if (mineral) {
      const mineralKey = `${PLANNER_KEYS.ROAD_PREFIX}${spawn.id}_${PLANNER_KEYS.NODE_MINERAL_PREFIX}${mineral.id}`;
      const existingMineralRoad = plannedPositionsFromMemory(room, mineralKey);
      if (existingMineralRoad.length === 0) {
        const roadPoints = getOrPlanRoad(
          room,
          mineralKey,
          spawn.pos,
          mineral.pos
        );
        for (const p of roadPoints)
          addPlannedStructureToMemory(room, mineralKey, p);
      }
    }

    const energyNodes: { id: string; pos: RoomPosition }[] = [];
    for (const source of sources) {
      const containerPlanned = plannedPositionsFromMemory(
        room,
        `${PLANNER_KEYS.CONTAINER_SOURCE_PREFIX}${source.id}`
      );
      if (containerPlanned.length > 0)
        energyNodes.push({
          id: `${PLANNER_KEYS.NODE_SOURCE_PREFIX}${source.id}`,
          pos: containerPlanned[0],
        });
      else
        energyNodes.push({
          id: `${PLANNER_KEYS.NODE_SOURCE_PREFIX}${source.id}`,
          pos: source.pos,
        });
    }

    if (controllerTarget) {
      energyNodes.push({
        id: PLANNER_KEYS.NODE_CONTROLLER,
        pos: controllerTarget,
      });
    }

    if (mineral) {
      energyNodes.push({
        id: `${PLANNER_KEYS.NODE_MINERAL_PREFIX}${mineral.id}`,
        pos: mineral.pos,
      });
    }

    for (let i = 0; i < energyNodes.length; i++) {
      for (let j = i + 1; j < energyNodes.length; j++) {
        const a = energyNodes[i];
        const b = energyNodes[j];
        const key = `${PLANNER_KEYS.ROAD_PREFIX}${a.id}_${b.id}`;
        const existing = plannedPositionsFromMemory(room, key);
        if (existing.length > 0) continue;
        const roadPoints = getOrPlanRoad(room, key, a.pos, b.pos);
        for (const p of roadPoints) addPlannedStructureToMemory(room, key, p);
      }
    }

    const towerKey = `${PLANNER_KEYS.TOWERS_PREFIX}${spawn.id}`;
    const existingTowers = plannedPositionsFromMemory(room, towerKey);
    if (existingTowers.length === 0) {
      const towerPositions = planTowerPositions(room, spawn);
      for (const p of towerPositions)
        addPlannedStructureToMemory(room, towerKey, p);
    }

    const extKey = `${PLANNER_KEYS.EXTENSIONS_PREFIX}${spawn.id}`;
    const existingExt = plannedPositionsFromMemory(room, extKey);
    if (existingExt.length === 0) {
      const extPositions = planExtensionPositions(
        room,
        spawn as StructureSpawn
      );
      for (const p of extPositions)
        addPlannedStructureToMemory(room, extKey, p);
    }
  }

  const importantTypes = Object.keys(
    (room.memory.plannedStructures || {}) as any
  );
  const importantPositions: RoomPosition[] = [];
  for (const t of importantTypes)
    importantPositions.push(...plannedPositionsFromMemory(room, t));

  // Plan roads around existing planned structures (except extensions) when tiles are open
  planRoadsAroundStructures(room);

  // Remove planned/built roads that sit under non-road structures
  pruneRoadsUnderStructures(room);

  connectRoadClusters(room);

  room.memory.lastStructurePlanTick = Game.time;

  const ramparts = planRampartsForStructures(room, importantPositions);
  const rampKey = PLANNER_KEYS.RAMPARTS_KEY;
  const existingRamparts = plannedPositionsFromMemory(room, rampKey).map(
    (p) => `${p.x},${p.y}`
  );
  const existingSet = new Set(existingRamparts);
  for (const p of ramparts) {
    const key = `${p.x},${p.y}`;
    if (!existingSet.has(key)) addPlannedStructureToMemory(room, rampKey, p);
  }
}
