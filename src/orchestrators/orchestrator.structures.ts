import {
  planSourceContainer,
  planControllerContainer,
  planMineralContainer,
  planRampartsForStructures,
  planExtensionPositions,
  planTowerPositions,
  addPlannedStructureToMemory,
  ensureMemoryRoomStructures,
  plannedPositionsFromMemory,
  getOrPlanRoad,
  planRoadsAroundStructures,
  pruneRoadsUnderStructures,
  connectRoadClusters,
} from "../services/services.structures";
import { PLANNER_KEYS, STRUCTURE_PLANNER } from "../config/config.structures";

function structureTypeForKey(key: string): StructureConstant | null {
  switch (true) {
    case key.startsWith(PLANNER_KEYS.CONTAINER_PREFIX):
      return STRUCTURE_CONTAINER;
    case key.startsWith(PLANNER_KEYS.EXTENSIONS_PREFIX):
      return STRUCTURE_EXTENSION;
    case key.startsWith(PLANNER_KEYS.ROAD_PREFIX):
    case key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX):
      return STRUCTURE_ROAD;
    case key.startsWith(PLANNER_KEYS.TOWERS_PREFIX):
      return STRUCTURE_TOWER;
    case key === PLANNER_KEYS.RAMPARTS_KEY:
      return STRUCTURE_RAMPART;
    case key === PLANNER_KEYS.CONTAINER_CONTROLLER:
      return STRUCTURE_CONTAINER;
    default:
      return null;
  }
}

function cleanupPlannedStructuresGlobal() {
  const interval = (STRUCTURE_PLANNER as any).plannedCleanupInterval || 0;
  if (!interval || Game.time % interval !== 0) return;

  for (const rn in Game.rooms) {
    try {
      const room = Game.rooms[rn];
      const mem = room.memory.plannedStructures as
        | Record<string, string[]>
        | undefined;
      const meta = (room as any).memory.plannedStructuresMeta || {};
      if (mem) {
        for (const key of Object.keys(mem)) {
          const arr = mem[key] || [];
          if (arr.length <= 1) continue;
          if (
            key === PLANNER_KEYS.CONTAINER_CONTROLLER ||
            key.startsWith(PLANNER_KEYS.CONTAINER_SOURCE_PREFIX) ||
            key.startsWith(PLANNER_KEYS.CONTAINER_MINERAL_PREFIX) ||
            key.startsWith(PLANNER_KEYS.EXTENSIONS_PREFIX)
          ) {
            mem[key] = [arr[0]];
            if (meta && meta[key]) meta[key].createdAt = Game.time;
          } else {
            const seen = new Set<string>();
            const keep: string[] = [];
            for (const p of arr) {
              if (seen.has(p)) continue;
              const [x, y] = p.split(",").map(Number);
              if (isNaN(x) || isNaN(y) || x < 0 || x >= 50 || y < 0 || y >= 50)
                continue;
              seen.add(p);
              keep.push(p);
            }
            mem[key] = keep;
            if (meta && meta[key] && mem[key].length === 0) delete meta[key];
          }
        }
      }
    } catch (e) {}
  }

  const unseenAge = (STRUCTURE_PLANNER as any).plannedCleanupUnseenAge || 0;
  if (unseenAge <= 0) return;
  if (!Memory.rooms) return;
  for (const rname of Object.keys(Memory.rooms)) {
    if (Game.rooms[rname]) continue;
    const rm = (Memory.rooms as any)[rname];
    if (!rm || !rm.plannedStructuresMeta) continue;
    let anyRecent = false;
    for (const k of Object.keys(rm.plannedStructuresMeta)) {
      const info = rm.plannedStructuresMeta[k] as any;
      if (!info || !info.createdAt) continue;
      if (Game.time - info.createdAt < unseenAge) {
        anyRecent = true;
        break;
      }
    }
    if (!anyRecent) {
      delete (Memory.rooms as any)[rname].plannedStructures;
      delete (Memory.rooms as any)[rname].plannedStructuresMeta;
    }
  }
}

function applyPlannedConstruction(room: Room) {
  if (!room.memory.plannedStructures) return;
  const mem = room.memory.plannedStructures as Record<string, string[]>;
  for (const key of Object.keys(mem)) {
    const type = structureTypeForKey(key);
    if (!type) continue;
    const positions = plannedPositionsFromMemory(room, key);
    for (const pos of positions) {
      const structs = room.lookForAt(
        LOOK_STRUCTURES,
        pos.x,
        pos.y
      ) as Structure[];
      if (structs.some((s) => s.structureType === type)) {
        const arr = mem[key] || [];
        const keyStr = `${pos.x},${pos.y}`;
        mem[key] = arr.filter((s) => s !== keyStr);
        const rampOnTop = (STRUCTURE_PLANNER.rampartOnTopFor || []).some(
          (t) => t === type
        );
        if (rampOnTop) {
          addPlannedStructureToMemory(room, PLANNER_KEYS.RAMPARTS_KEY, pos);
          room.createConstructionSite(pos.x, pos.y, STRUCTURE_RAMPART);
        }
        continue;
      }
      const sites = room.lookForAt(
        LOOK_CONSTRUCTION_SITES,
        pos.x,
        pos.y
      ) as ConstructionSite[];
      if (sites.some((s) => s.structureType === type)) continue;
      room.createConstructionSite(
        pos.x,
        pos.y,
        type as BuildableStructureConstant
      );
    }
  }
}

function ensureRampartsForExistingStructures(room: Room) {
  const rampTypes = (STRUCTURE_PLANNER.rampartOnTopFor ||
    []) as StructureConstant[];
  const structures = room.find(FIND_STRUCTURES) as Structure[];
  for (const s of structures) {
    if (!rampTypes.includes(s.structureType as StructureConstant)) continue;
    if (s.structureType === STRUCTURE_RAMPART) continue;
    const x = s.pos.x;
    const y = s.pos.y;
    const existing = room.lookForAt(LOOK_STRUCTURES, x, y) as Structure[];
    if (existing.some((st) => st.structureType === STRUCTURE_RAMPART)) continue;

    const planned = plannedPositionsFromMemory(room, PLANNER_KEYS.RAMPARTS_KEY);
    if (planned.some((p) => p.x === x && p.y === y)) {
      continue;
    }

    addPlannedStructureToMemory(
      room,
      PLANNER_KEYS.RAMPARTS_KEY,
      new RoomPosition(x, y, room.name)
    );
    room.createConstructionSite(x, y, STRUCTURE_RAMPART);
  }
}

export function loop() {
  cleanupPlannedStructuresGlobal();
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

  let spawn: StructureSpawn | null = null;
  if (room.memory.spawnId) {
    spawn = Game.getObjectById(room.memory.spawnId) as StructureSpawn | null;
  }
  if (spawn && room.controller && room.controller.level >= 4) {
    const storageKey = `${PLANNER_KEYS.STORAGE_PREFIX}${spawn.id}`;
    const plannedStorage = plannedPositionsFromMemory(room, storageKey);
    const hasStorage =
      room.find(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_STORAGE,
      }).length > 0;
    if (!hasStorage && plannedStorage.length === 0) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const x = spawn.pos.x + dx;
          const y = spawn.pos.y + dy;
          if (x < 0 || x >= 50 || y < 0 || y >= 50) continue;
          const terrain = room.getTerrain().get(x, y);
          if (terrain === TERRAIN_MASK_WALL) continue;
          const structs = room.lookForAt(LOOK_STRUCTURES, x, y);
          const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y);
          if (structs.length === 0 && sites.length === 0) {
            addPlannedStructureToMemory(
              room,
              storageKey,
              new RoomPosition(x, y, room.name)
            );
            break;
          }
        }
      }
    }
  }

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

    let hasControllerContainer = false;
    let foundContainer: StructureContainer | null = null;

    if (room.memory.upgraderContainerId) {
      const container = Game.getObjectById(
        room.memory.upgraderContainerId
      ) as StructureContainer | null;
      if (
        container &&
        container.structureType === STRUCTURE_CONTAINER &&
        container.pos.getRangeTo(room.controller.pos) <= 2
      ) {
        hasControllerContainer = true;
        foundContainer = container;
      }
    }

    if (!hasControllerContainer) {
      const containers = room.find(FIND_STRUCTURES, {
        filter: (s) =>
          s.structureType === STRUCTURE_CONTAINER &&
          s.pos.getRangeTo(room.controller!.pos) <= 2,
      }) as StructureContainer[];
      if (containers.length > 0) {
        hasControllerContainer = true;
        foundContainer = containers[0];
      }
    }

    if (hasControllerContainer && planned.length > 0) {
      const mem = room.memory.plannedStructures as Record<string, string[]>;
      if (mem && mem[PLANNER_KEYS.CONTAINER_CONTROLLER]) {
        delete mem[PLANNER_KEYS.CONTAINER_CONTROLLER];
      }
      const meta = (room as any).memory.plannedStructuresMeta;
      if (meta && meta[PLANNER_KEYS.CONTAINER_CONTROLLER]) {
        delete meta[PLANNER_KEYS.CONTAINER_CONTROLLER];
      }
    }
    if (planned.length > 1) {
      const mem = room.memory.plannedStructures as Record<string, string[]>;
      if (mem && mem[PLANNER_KEYS.CONTAINER_CONTROLLER]) {
        mem[PLANNER_KEYS.CONTAINER_CONTROLLER] = [
          mem[PLANNER_KEYS.CONTAINER_CONTROLLER][0],
        ];
      }
    }

    if (planned.length === 0 && !hasControllerContainer) {
      const pos = planControllerContainer(room, room.controller);
      if (pos)
        addPlannedStructureToMemory(
          room,
          PLANNER_KEYS.CONTAINER_CONTROLLER,
          pos
        );
    }
  }

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
      const plannedMineral = plannedPositionsFromMemory(
        room,
        `${PLANNER_KEYS.CONTAINER_MINERAL_PREFIX}${mineral.id}`
      );
      if (plannedMineral.length === 0) {
        const mpos = planMineralContainer(room, mineral);
        if (mpos)
          addPlannedStructureToMemory(
            room,
            `${PLANNER_KEYS.CONTAINER_MINERAL_PREFIX}${mineral.id}`,
            mpos
          );
      }

      const mineralKey = `${PLANNER_KEYS.ROAD_PREFIX}${spawn.id}_${PLANNER_KEYS.NODE_MINERAL_PREFIX}${mineral.id}`;
      const existingMineralRoad = plannedPositionsFromMemory(room, mineralKey);
      if (existingMineralRoad.length === 0) {
        const plannedMineral2 = plannedPositionsFromMemory(
          room,
          `${PLANNER_KEYS.CONTAINER_MINERAL_PREFIX}${mineral.id}`
        );
        const targetPos =
          plannedMineral2.length > 0 ? plannedMineral2[0] : mineral.pos;
        const roadPoints = getOrPlanRoad(
          room,
          mineralKey,
          spawn.pos,
          targetPos
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
      const plannedMineral3 = plannedPositionsFromMemory(
        room,
        `${PLANNER_KEYS.CONTAINER_MINERAL_PREFIX}${mineral.id}`
      );
      energyNodes.push({
        id: `${PLANNER_KEYS.NODE_MINERAL_PREFIX}${mineral.id}`,
        pos: plannedMineral3.length > 0 ? plannedMineral3[0] : mineral.pos,
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

  planRoadsAroundStructures(room);

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
