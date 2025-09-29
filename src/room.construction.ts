/**
 * Automation Construction
 *
 * Intelligent construction planning and priority management.
 * Determines what to build, when, and where based on room intelligence.
 */

/// <reference types="@types/screeps" />

import { RoomIntelligence } from "./room.intelligence";
import { getRoomMemory } from "./global.memory";

export interface ConstructionPlan {
  queue: ConstructionTask[];
  priorities: {
    critical: ConstructionTask[];
    important: ConstructionTask[];
    normal: ConstructionTask[];
    deferred: ConstructionTask[];
  };
  recommendations: {
    immediate: string[];
    shortTerm: string[];
    longTerm: string[];
  };
  metrics: {
    totalTasks: number;
    estimatedCost: number;
    estimatedTime: number;
    completionRate: number;
  };
}

export interface ConstructionTask {
  type: BuildableStructureConstant;
  pos: RoomPosition;
  priority: number;
  reason: string;
  estimatedCost: number;
  dependencies: string[];
  urgent: boolean;
}

export interface LayoutPlan {
  core: { x: number; y: number; radius: number };
  extensions: RoomPosition[];
  roads: RoomPosition[];
  containers: RoomPosition[];
  towers: RoomPosition[];
  labs: RoomPosition[];
  storage: RoomPosition | null;
  terminal: RoomPosition | null;
  factory: RoomPosition | null;
}

/**
 * Generate comprehensive construction plan for the room
 */
export function planConstruction(intel: RoomIntelligence): ConstructionPlan {
  const tasks = generateConstructionTasks(intel);
  const prioritized = prioritizeTasks(tasks, intel);

  return {
    queue: tasks,
    priorities: prioritized,
    recommendations: generateRecommendations(intel, tasks),
    metrics: calculateConstructionMetrics(tasks, intel),
  };
}

/**
 * Generate all needed construction tasks based on room state
 */
function generateConstructionTasks(
  intel: RoomIntelligence
): ConstructionTask[] {
  const tasks: ConstructionTask[] = [];
  const { basic, infrastructure } = intel;
  const rcl = basic.rcl;
  const room = Game.rooms[basic.name];
  if (!room) return tasks;

  // Determine a high-quality anchor for a compact, efficient base
  const anchor = findBaseAnchor(room);
  const reserved = new Set<string>();
  const reserve = (pos: RoomPosition) => reserved.add(posKey(pos));
  const isReserved = (pos: RoomPosition) => reserved.has(posKey(pos));

  // Core stamp (roads + storage/terminal/spawn-adj link areas)
  const core = getCoreStamp(anchor);
  for (const r of core.roads) reserve(r);
  if (core.storage) reserve(core.storage);
  if (core.terminal) reserve(core.terminal);
  for (const t of core.towerSlots) reserve(t);

  // 1) Roads: lay core first for pathing stability
  const coreRoadTasks = core.roads
    .filter((p) => isValidBuildPosition(p))
    .map<ConstructionTask>((pos, i) => ({
      type: STRUCTURE_ROAD,
      pos,
      priority: 92 - i * 0.1,
      reason: "Core walkways for compact base",
      estimatedCost: 300,
      dependencies: [],
      urgent: true,
    }));
  tasks.push(...coreRoadTasks);

  // 1a) Ensure clean connectors from each spawn and existing storage/terminal to the hub
  tasks.push(...generateCoreConnectorTasks(intel, anchor, core));

  // 1b) Slightly widen the hub trunk near anchor for less bumping, and add a small redundancy loop
  tasks.push(
    ...generateHubWideningTasks(intel, anchor),
    ...generateCoreLoopTasks(intel, anchor)
  );

  // 1.5) Additional spawns at higher RCLs
  tasks.push(...generateAdditionalSpawnTasks(intel, anchor));

  // 2) Storage/Terminal (RCL gating handled later by executor)
  if (
    rcl >= 4 &&
    (infrastructure.structures.storage || 0) === 0 &&
    core.storage
  ) {
    tasks.push({
      type: STRUCTURE_STORAGE,
      pos: core.storage,
      priority: 90,
      reason: "Central storage at hub",
      estimatedCost: 30000,
      dependencies: [],
      urgent: intel.economy.energyStored > 10000,
    });
  }
  if (
    rcl >= 6 &&
    (infrastructure.structures.terminal || 0) === 0 &&
    core.terminal
  ) {
    tasks.push({
      type: STRUCTURE_TERMINAL,
      pos: core.terminal,
      priority: 76,
      reason: "Terminal adjacent to storage",
      estimatedCost: 100000,
      dependencies: ["storage"],
      urgent: false,
    });
  }

  // 3) Towers: strategic around core
  const neededTowers =
    getTowerLimit(rcl) - (infrastructure.structures.tower || 0);
  if (neededTowers > 0) {
    let towerSpots = core.towerSlots.filter(isPlaceableForTower);
    // Fallback: if all core slots are blocked, use basic positions around the spawn
    if (towerSpots.length === 0) {
      const spawn = room.find(FIND_MY_SPAWNS)[0];
      if (spawn) {
        const fallback = findTowerPositions(spawn.pos, neededTowers);
        towerSpots = fallback.filter(isPlaceableForTower);
      }
    }
    for (let i = 0; i < Math.min(neededTowers, towerSpots.length); i++) {
      const pos = towerSpots[i];
      tasks.push({
        type: STRUCTURE_TOWER,
        pos,
        priority: 84 - i * 2,
        reason: "Defensive tower overlooking hub",
        estimatedCost: 5000,
        dependencies: [],
        // Make the first tower urgent as soon as RCL >= 3 to avoid delays
        urgent:
          intel.military.safetyScore < 50 ||
          (rcl >= 3 && (infrastructure.structures.tower || 0) === 0),
      });
    }
  }

  // 4) Containers near sources and controller (early and urgent for economy)
  tasks.push(...generateContainerTasks(intel));

  // 5) Links: controller + source links at RCL5+
  if (rcl >= 5) {
    // Storage-side link first for logistics hub efficiency
    const storageLink = generateStorageLinkTask(intel, anchor, core.storage);
    if (storageLink) tasks.push(storageLink);
    tasks.push(...generateLinkTasks(intel));
  }

  // 6) Extensions using compact rings around core, skipping reserved tiles
  const extensionNeed =
    getExtensionLimit(rcl) - (infrastructure.structures.extension || 0);
  if (extensionNeed > 0) {
    const extensionPositions = findExtensionRingPositions(
      anchor,
      extensionNeed,
      reserved
    );
    extensionPositions.forEach((pos, index) => {
      tasks.push({
        type: STRUCTURE_EXTENSION,
        pos,
        priority: 82 - index * 0.2,
        reason: "Compact ring extension block",
        estimatedCost: 3000,
        dependencies: [],
        urgent: rcl <= 2 || intel.economy.energyCapacity < 800,
      });
    });
    // Add a short connector spur from first extension back into the hub trunk for easy delivery
    if (extensionPositions.length > 0) {
      const first = extensionPositions[0];
      const path = getCachedPath(
        room,
        `connector:ext:${first.x}:${first.y}`,
        first,
        anchor
      );
      for (let i = 0; i < Math.min(3, path.length); i++) {
        const st = path[i];
        const p = new RoomPosition(st.x, st.y, room.name);
        const hasRoad = p
          .lookFor(LOOK_STRUCTURES)
          .some((s) => s.structureType === STRUCTURE_ROAD);
        if (!hasRoad && isValidBuildPosition(p)) {
          tasks.push({
            type: STRUCTURE_ROAD,
            pos: p,
            priority: 83.5 - i * 0.1,
            reason: "Extension connector spur",
            estimatedCost: 300,
            dependencies: [],
            urgent: rcl <= 3,
          });
        }
      }
    }
  }

  // 6a) Controller connector spur: short road from controller-side container (or nearest tile) back to hub
  tasks.push(...generateControllerConnectorSpur(intel, anchor));

  // 7) Roads to sources and controller from core anchor (prefer after core)
  tasks.push(...generateRoadTasksFromAnchor(intel, anchor));

  // 7a) Small endpoint pads near sources/controller/mineral (last-step spurs)
  tasks.push(...generateEndpointPadRoads(intel, anchor));

  // 8) Terminal/Labs/Factory/Power Spawn via strategic offsets from core
  if (rcl >= 6) {
    tasks.push(...generateLabTasksNearCore(intel, anchor));
    // Extractor & mineral container for mid-game economy
    tasks.push(...generateExtractorTasks(intel));
  }
  if (rcl >= 7 && (infrastructure.structures.factory || 0) === 0) {
    const pos = getFactoryNearCore(anchor);
    tasks.push({
      type: STRUCTURE_FACTORY,
      pos,
      priority: 52,
      reason: "Factory near storage/terminal",
      estimatedCost: 100000,
      dependencies: ["terminal", "storage"],
      urgent: false,
    });
  }
  if (rcl >= 8 && (infrastructure.structures.powerSpawn || 0) === 0) {
    const pos = getPowerSpawnNearCore(anchor);
    tasks.push({
      type: STRUCTURE_POWER_SPAWN,
      pos,
      priority: 48,
      reason: "Power spawn in hub sector",
      estimatedCost: 100000,
      dependencies: ["terminal", "storage"],
      urgent: false,
    });
    // Observer & Nuker planning for late-game capabilities
    tasks.push(...generateObserverTasks(intel, anchor));
    tasks.push(...generateNukerTasks(intel, anchor));
  }

  // 9) Defensive ramparts on key hub tiles (optional but strategic)
  tasks.push(...generateDefensiveTasks(intel));

  return tasks;
}

/**
 * Generate extension construction tasks with optimal positioning
 */
function generateExtensionTasks(
  intel: RoomIntelligence,
  count: number
): ConstructionTask[] {
  // Legacy fallback (unused by new ring planner). Kept for compatibility.
  const tasks: ConstructionTask[] = [];
  const room = Game.rooms[intel.basic.name];
  const spawn = room?.find(FIND_MY_SPAWNS)[0];
  if (!spawn) return tasks;
  const positions = findExtensionPositions(spawn.pos, count);
  positions.forEach((pos, index) => {
    tasks.push({
      type: STRUCTURE_EXTENSION,
      pos,
      priority: 80 - index,
      reason: "Increase energy capacity",
      estimatedCost: 3000,
      dependencies: [],
      urgent: intel.economy.energyCapacity < 800,
    });
  });
  return tasks;
}

/**
 * Generate container tasks for source mining
 */
function generateContainerTasks(intel: RoomIntelligence): ConstructionTask[] {
  const tasks: ConstructionTask[] = [];
  const room = Game.rooms[intel.basic.name];

  intel.economy.sources.forEach((source) => {
    // Check if container already exists near source
    const containerNearby = room
      ?.lookForAtArea(
        LOOK_STRUCTURES,
        source.pos.y - 1,
        source.pos.x - 1,
        source.pos.y + 1,
        source.pos.x + 1,
        true
      )
      .some((item) => item.structure.structureType === STRUCTURE_CONTAINER);

    if (!containerNearby) {
      const pos = findContainerPosition(source.pos);
      if (pos) {
        tasks.push({
          type: STRUCTURE_CONTAINER,
          pos,
          priority: 88,
          reason: `Container for source at ${source.pos.x},${source.pos.y}`,
          estimatedCost: 5000,
          dependencies: [],
          // Make source containers urgent at low RCL to accelerate bootstrap
          urgent: intel.basic.rcl <= 3,
        });
      }
    }
  });

  // Controller container
  const controller = room?.controller;
  if (controller) {
    const containerNearby = room
      ?.lookForAtArea(
        LOOK_STRUCTURES,
        controller.pos.y - 2,
        controller.pos.x - 2,
        controller.pos.y + 2,
        controller.pos.x + 2,
        true
      )
      .some((item) => item.structure.structureType === STRUCTURE_CONTAINER);

    if (!containerNearby) {
      const pos = findContainerPosition(controller.pos);
      if (pos) {
        tasks.push({
          type: STRUCTURE_CONTAINER,
          pos,
          priority: 82,
          reason: "Controller container for upgraders",
          estimatedCost: 5000,
          dependencies: [],
          // Helpful early for upgraders; not as critical as source containers
          urgent: intel.basic.rcl <= 3,
        });
      }
    }
  }

  return tasks;
}

/**
 * Generate road construction tasks
 */
function generateRoadTasks(intel: RoomIntelligence): ConstructionTask[] {
  // Legacy fallback used when anchor cannot be computed
  const tasks: ConstructionTask[] = [];
  const room = Game.rooms[intel.basic.name];
  const spawn = room?.find(FIND_MY_SPAWNS)[0];
  if (!spawn || intel.infrastructure.roads.coverage > 0.7) return tasks;

  // Roads from spawn to sources
  intel.economy.sources.forEach((source) => {
    const path = spawn.pos.findPathTo(source.pos);
    path.forEach((step: PathStep, index: number) => {
      const pos = new RoomPosition(step.x, step.y, intel.basic.name);
      const hasRoad = pos
        .lookFor(LOOK_STRUCTURES)
        .some((s) => s.structureType === STRUCTURE_ROAD);
      if (!hasRoad) {
        tasks.push({
          type: STRUCTURE_ROAD,
          pos,
          priority: 60 - index * 0.1,
          reason: `Road from spawn to source ${source.id}`,
          estimatedCost: 300,
          dependencies: [],
          urgent: false,
        });
      }
    });
  });

  // Road from spawn to controller
  const controller = room?.controller;
  if (controller) {
    const path = spawn.pos.findPathTo(controller.pos);
    path.forEach((step: PathStep, index: number) => {
      const pos = new RoomPosition(step.x, step.y, intel.basic.name);
      const hasRoad = pos
        .lookFor(LOOK_STRUCTURES)
        .some((s) => s.structureType === STRUCTURE_ROAD);
      if (!hasRoad) {
        tasks.push({
          type: STRUCTURE_ROAD,
          pos,
          priority: 55 - index * 0.1,
          reason: "Road from spawn to controller",
          estimatedCost: 300,
          dependencies: [],
          urgent: false,
        });
      }
    });
  }
  return tasks;
}

/**
 * Generate tower construction tasks
 */
function generateTowerTasks(
  intel: RoomIntelligence,
  count: number
): ConstructionTask[] {
  const tasks: ConstructionTask[] = [];
  const room = Game.rooms[intel.basic.name];
  const spawn = room?.find(FIND_MY_SPAWNS)[0];
  if (!spawn) return tasks;

  // Find defensive positions
  const positions = findTowerPositions(spawn.pos, count);

  const threatLevel = intel.military.safetyScore < 50 ? 100 : 0; // Use safetyScore since threatLevel doesn't exist

  positions.forEach((pos, index) => {
    tasks.push({
      type: STRUCTURE_TOWER,
      pos,
      priority: 80 - index * 5,
      reason: threatLevel > 0 ? "Defense against threats" : "Proactive defense",
      estimatedCost: 5000,
      dependencies: [],
      urgent: threatLevel > 50,
    });
  });

  return tasks;
}

/**
 * Generate storage task
 */
function generateStorageTask(intel: RoomIntelligence): ConstructionTask {
  const room = Game.rooms[intel.basic.name];
  const spawn = room?.find(FIND_MY_SPAWNS)[0];
  const pos = findStoragePosition(
    spawn?.pos || new RoomPosition(25, 25, intel.basic.name)
  );

  return {
    type: STRUCTURE_STORAGE,
    pos,
    priority: 78,
    reason: "Central energy storage and logistics hub",
    estimatedCost: 30000,
    dependencies: [],
    urgent: intel.economy.energyStored > 10000,
  };
}

/**
 * Generate link tasks
 */
function generateLinkTasks(intel: RoomIntelligence): ConstructionTask[] {
  const tasks: ConstructionTask[] = [];
  const linkLimit = getLinkLimit(intel.basic.rcl);
  const currentLinks = intel.infrastructure.structures.link || 0;

  if (currentLinks >= linkLimit) return tasks;

  const room = Game.rooms[intel.basic.name];
  const controller = room?.controller;

  // First link near controller
  if (currentLinks === 0 && controller) {
    const pos = findLinkPosition(controller.pos);
    tasks.push({
      type: STRUCTURE_LINK,
      pos,
      priority: 70,
      reason: "Controller link for energy distribution",
      estimatedCost: 5000,
      dependencies: [],
      urgent: false,
    });
  }

  // Links near sources
  intel.economy.sources.forEach((source, index) => {
    if (currentLinks + tasks.length < linkLimit) {
      const pos = findLinkPosition(source.pos);
      tasks.push({
        type: STRUCTURE_LINK,
        pos,
        priority: 68 - index,
        reason: `Source link for source ${source.id}`,
        estimatedCost: 5000,
        dependencies: [],
        urgent: false,
      });
    }
  });

  return tasks;
}

/**
 * Generate terminal task
 */
function generateTerminalTask(intel: RoomIntelligence): ConstructionTask {
  const room = Game.rooms[intel.basic.name];
  const spawn = room?.find(FIND_MY_SPAWNS)[0];
  const pos = findTerminalPosition(
    spawn?.pos || new RoomPosition(25, 25, intel.basic.name)
  );

  return {
    type: STRUCTURE_TERMINAL,
    pos,
    priority: 65,
    reason: "Enable market trading and resource transfer",
    estimatedCost: 100000,
    dependencies: ["storage"],
    urgent: false,
  };
}

/**
 * Generate lab tasks
 */
function generateLabTasks(intel: RoomIntelligence): ConstructionTask[] {
  const tasks: ConstructionTask[] = [];
  const labLimit = getLabLimit(intel.basic.rcl);
  const currentLabs = intel.infrastructure.structures.lab || 0;

  if (currentLabs >= labLimit) return tasks;

  const room = Game.rooms[intel.basic.name];
  const spawn = room?.find(FIND_MY_SPAWNS)[0];
  if (!spawn) return tasks;

  const positions = findLabPositions(spawn.pos, labLimit - currentLabs);

  positions.forEach((pos, index) => {
    tasks.push({
      type: STRUCTURE_LAB,
      pos,
      priority: 50 - index,
      reason: "Chemical production and boost creation",
      estimatedCost: 50000,
      dependencies: ["terminal"],
      urgent: false,
    });
  });

  return tasks;
}

/**
 * Generate factory task
 */
function generateFactoryTask(intel: RoomIntelligence): ConstructionTask {
  const room = Game.rooms[intel.basic.name];
  const spawn = room?.find(FIND_MY_SPAWNS)[0];
  const pos = findFactoryPosition(
    spawn?.pos || new RoomPosition(25, 25, intel.basic.name)
  );

  return {
    type: STRUCTURE_FACTORY,
    pos,
    priority: 45,
    reason: "Advanced resource production",
    estimatedCost: 100000,
    dependencies: ["terminal", "storage"],
    urgent: false,
  };
}

/**
 * Generate power spawn task
 */
function generatePowerSpawnTask(intel: RoomIntelligence): ConstructionTask {
  const room = Game.rooms[intel.basic.name];
  const spawn = room?.find(FIND_MY_SPAWNS)[0];
  const pos = findPowerSpawnPosition(
    spawn?.pos || new RoomPosition(25, 25, intel.basic.name)
  );

  return {
    type: STRUCTURE_POWER_SPAWN,
    pos,
    priority: 40,
    reason: "Power processing for advanced operations",
    estimatedCost: 100000,
    dependencies: ["terminal", "storage"],
    urgent: false,
  };
}

/**
 * Generate defensive structure tasks
 */
function generateDefensiveTasks(intel: RoomIntelligence): ConstructionTask[] {
  const tasks: ConstructionTask[] = [];
  const room = Game.rooms[intel.basic.name];
  const threatLevel = intel.military.safetyScore < 50 ? 100 : 0;

  if (threatLevel > 30 || intel.basic.rcl >= 3) {
    // Add ramparts over key structures (spawn, storage, terminal, towers)
    const protectTypes: StructureConstant[] = [
      STRUCTURE_SPAWN,
      STRUCTURE_STORAGE,
      STRUCTURE_TERMINAL,
      STRUCTURE_TOWER,
    ];
    const structures = room?.find(FIND_MY_STRUCTURES) || [];
    structures
      .filter((s) => protectTypes.includes(s.structureType))
      .forEach((s, i) => {
        tasks.push({
          type: STRUCTURE_RAMPART,
          pos: s.pos,
          priority: 36 - i * 0.1,
          reason: `Protect ${s.structureType}`,
          estimatedCost: 1000,
          dependencies: [],
          urgent: threatLevel > 70,
        });
      });
  }

  return tasks;
}

/**
 * Prioritize construction tasks based on room state and strategy
 */
function prioritizeTasks(tasks: ConstructionTask[], intel: RoomIntelligence) {
  const critical: ConstructionTask[] = [];
  const important: ConstructionTask[] = [];
  const normal: ConstructionTask[] = [];
  const deferred: ConstructionTask[] = [];

  tasks.forEach((task) => {
    let adjustedPriority = task.priority;

    // Adjust priorities based on room intelligence
    if (intel.military.hostiles.length > 0 && intel.military.safetyScore < 50) {
      // Under threat - prioritize defensive structures
      if (
        task.type === STRUCTURE_TOWER ||
        task.type === STRUCTURE_RAMPART ||
        task.type === STRUCTURE_WALL
      ) {
        adjustedPriority += 20;
      }
    }

    if (intel.economy.efficiency < 0.5) {
      // Low economic efficiency - prioritize economy structures
      if (
        task.type === STRUCTURE_CONTAINER ||
        task.type === STRUCTURE_EXTENSION ||
        task.type === STRUCTURE_STORAGE
      ) {
        adjustedPriority += 15;
      }
    }

    if (adjustedPriority >= 90 || task.urgent) {
      critical.push(task);
    } else if (adjustedPriority >= 75) {
      important.push(task);
    } else if (adjustedPriority >= 50) {
      normal.push(task);
    } else {
      deferred.push(task);
    }
  });

  // Sort each category by priority
  [critical, important, normal, deferred].forEach((category) => {
    category.sort((a, b) => b.priority - a.priority);
  });

  return { critical, important, normal, deferred };
}

/**
 * Generate construction recommendations
 */
function generateRecommendations(
  intel: RoomIntelligence,
  tasks: ConstructionTask[]
) {
  const immediate: string[] = [];
  const shortTerm: string[] = [];
  const longTerm: string[] = [];

  if (intel.economy.energyCapacity < 800) {
    immediate.push("Build extensions to increase energy capacity");
  }

  if (
    intel.infrastructure.structures.container < intel.economy.sources.length
  ) {
    immediate.push("Build containers near sources for efficient harvesting");
  }

  // Check if current tasks address critical needs
  const hasExtensionTasks = tasks.some(
    (task) => task.type === STRUCTURE_EXTENSION
  );
  const hasTowerTasks = tasks.some((task) => task.type === STRUCTURE_TOWER);

  if (intel.military.hostiles.length > 0 && !hasTowerTasks) {
    immediate.push("Build towers for defense against hostiles");
  }

  if (intel.economy.energyCapacity < 1000 && !hasExtensionTasks) {
    shortTerm.push("Plan more extension construction for energy scaling");
  }

  if (intel.basic.rcl >= 3 && intel.infrastructure.structures.tower === 0) {
    shortTerm.push("Build towers for defense and maintenance");
  }

  if (intel.basic.rcl >= 4 && intel.infrastructure.structures.storage === 0) {
    shortTerm.push("Build storage for bulk energy management");
  }

  if (intel.basic.rcl >= 5 && intel.infrastructure.structures.link === 0) {
    longTerm.push("Build links for efficient energy transport");
  }

  if (intel.basic.rcl >= 6 && intel.infrastructure.structures.terminal === 0) {
    longTerm.push("Build terminal for market access and resource sharing");
  }

  return { immediate, shortTerm, longTerm };
}

/**
 * Calculate construction metrics
 */
function calculateConstructionMetrics(
  tasks: ConstructionTask[],
  intel: RoomIntelligence
) {
  const totalTasks = tasks.length;
  const estimatedCost = tasks.reduce(
    (sum, task) => sum + task.estimatedCost,
    0
  );

  // Estimate time based on builder capacity and energy flow
  const builderWorkParts = (intel.creeps.byRole.builder || 0) * 2; // Assume 2 work parts per builder
  const buildRate = builderWorkParts * 5; // 5 build progress per work part per tick
  const estimatedTime = estimatedCost / Math.max(1, buildRate);

  // Calculate completion rate based on current construction sites
  const activeSites = intel.infrastructure.constructionSites.length;
  const completionRate =
    activeSites > 0 ? Math.min(100, (buildRate / activeSites) * 10) : 100;

  return {
    totalTasks,
    estimatedCost,
    estimatedTime,
    completionRate,
  };
}

// Helper functions for position finding

function findExtensionPositions(
  spawnPos: RoomPosition,
  count: number
): RoomPosition[] {
  const positions: RoomPosition[] = [];
  const roomName = spawnPos.roomName;

  // Simple spiral pattern around spawn
  for (let radius = 2; radius <= 7 && positions.length < count; radius++) {
    for (let dx = -radius; dx <= radius && positions.length < count; dx++) {
      for (let dy = -radius; dy <= radius && positions.length < count; dy++) {
        if (Math.abs(dx) === radius || Math.abs(dy) === radius) {
          const x = spawnPos.x + dx;
          const y = spawnPos.y + dy;

          if (x >= 2 && x <= 47 && y >= 2 && y <= 47) {
            const pos = new RoomPosition(x, y, roomName);
            if (isValidBuildPosition(pos)) {
              positions.push(pos);
            }
          }
        }
      }
    }
  }

  return positions;
}

function findContainerPosition(nearPos: RoomPosition): RoomPosition | null {
  // Find adjacent position that's not blocked; allow replacing a road tile for efficient space usage
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;

      const x = nearPos.x + dx;
      const y = nearPos.y + dy;

      if (x >= 1 && x <= 48 && y >= 1 && y <= 48) {
        const pos = new RoomPosition(x, y, nearPos.roomName);
        if (isValidBuildPosition(pos) || isRoadOrRampartOnly(pos)) {
          return pos;
        }
      }
    }
  }

  return null;
}

function isRoadOrRampartOnly(pos: RoomPosition): boolean {
  const structs = pos.lookFor(LOOK_STRUCTURES);
  if (structs.length === 0) return false;
  return structs.every(
    (s) =>
      s.structureType === STRUCTURE_ROAD ||
      s.structureType === STRUCTURE_RAMPART
  );
}

function findTowerPositions(
  spawnPos: RoomPosition,
  count: number
): RoomPosition[] {
  const positions: RoomPosition[] = [];
  const roomName = spawnPos.roomName;

  // Place towers at strategic positions
  const candidates = [
    new RoomPosition(spawnPos.x - 3, spawnPos.y - 3, roomName),
    new RoomPosition(spawnPos.x + 3, spawnPos.y - 3, roomName),
    new RoomPosition(spawnPos.x - 3, spawnPos.y + 3, roomName),
    new RoomPosition(spawnPos.x + 3, spawnPos.y + 3, roomName),
    new RoomPosition(spawnPos.x, spawnPos.y - 4, roomName),
    new RoomPosition(spawnPos.x, spawnPos.y + 4, roomName),
  ];

  for (const pos of candidates) {
    if (positions.length >= count) break;

    if (pos.x >= 2 && pos.x <= 47 && pos.y >= 2 && pos.y <= 47) {
      if (isValidBuildPosition(pos)) {
        positions.push(pos);
      }
    }
  }

  return positions;
}

function findStoragePosition(spawnPos: RoomPosition): RoomPosition {
  // Place storage near spawn but not blocking paths
  const candidates = [
    new RoomPosition(spawnPos.x - 2, spawnPos.y, spawnPos.roomName),
    new RoomPosition(spawnPos.x + 2, spawnPos.y, spawnPos.roomName),
    new RoomPosition(spawnPos.x, spawnPos.y - 2, spawnPos.roomName),
    new RoomPosition(spawnPos.x, spawnPos.y + 2, spawnPos.roomName),
  ];

  for (const pos of candidates) {
    if (isValidBuildPosition(pos)) {
      return pos;
    }
  }

  return new RoomPosition(spawnPos.x - 2, spawnPos.y - 2, spawnPos.roomName);
}

function findTerminalPosition(spawnPos: RoomPosition): RoomPosition {
  // Place terminal near storage if it exists
  return new RoomPosition(spawnPos.x - 1, spawnPos.y - 2, spawnPos.roomName);
}

function findLinkPosition(nearPos: RoomPosition): RoomPosition {
  // Simple adjacent position
  return new RoomPosition(nearPos.x + 1, nearPos.y + 1, nearPos.roomName);
}

function findLabPositions(
  spawnPos: RoomPosition,
  count: number
): RoomPosition[] {
  const positions: RoomPosition[] = [];
  const roomName = spawnPos.roomName;

  // Group labs together for reaction efficiency
  let baseX = spawnPos.x + 5;
  let baseY = spawnPos.y + 5;

  for (let i = 0; i < count && positions.length < count; i++) {
    const x = baseX + (i % 3);
    const y = baseY + Math.floor(i / 3);

    if (x <= 47 && y <= 47) {
      positions.push(new RoomPosition(x, y, roomName));
    }
  }

  return positions;
}

function findFactoryPosition(spawnPos: RoomPosition): RoomPosition {
  return new RoomPosition(spawnPos.x + 3, spawnPos.y - 1, spawnPos.roomName);
}

function findPowerSpawnPosition(spawnPos: RoomPosition): RoomPosition {
  return new RoomPosition(spawnPos.x - 1, spawnPos.y + 3, spawnPos.roomName);
}

function isValidBuildPosition(pos: RoomPosition): boolean {
  // Simplified validation - in real implementation would check terrain and structures
  const room = Game.rooms[pos.roomName];
  if (!room) return false;

  const terrain = room.getTerrain();
  if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) return false;

  const structures = pos.lookFor(LOOK_STRUCTURES);
  return structures.length === 0;
}

// Towers can replace roads/ramparts; allow those tiles during planning
function isPlaceableForTower(pos: RoomPosition): boolean {
  const room = Game.rooms[pos.roomName];
  if (!room) return false;
  const terrain = room.getTerrain();
  if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) return false;
  const structs = pos.lookFor(LOOK_STRUCTURES);
  if (structs.length === 0) return true;
  // Allow tower plan on road or rampart; executor will remove conflicting road/site
  return structs.every(
    (s) =>
      s.structureType === STRUCTURE_ROAD ||
      s.structureType === STRUCTURE_RAMPART
  );
}

// Structure limits by RCL
function getExtensionLimit(rcl: number): number {
  const limits = [0, 0, 5, 10, 20, 30, 40, 50, 60];
  return limits[rcl] || 0;
}

function getTowerLimit(rcl: number): number {
  if (rcl < 3) return 0;
  if (rcl < 5) return 1;
  if (rcl < 7) return 2;
  if (rcl < 8) return 3;
  return 6;
}

function getLinkLimit(rcl: number): number {
  if (rcl < 5) return 0;
  if (rcl < 6) return 2;
  if (rcl < 7) return 3;
  if (rcl < 8) return 4;
  return 6;
}

function getLabLimit(rcl: number): number {
  if (rcl < 6) return 0;
  if (rcl < 7) return 3;
  if (rcl < 8) return 6;
  return 10;
}

// ===== Enhanced strategic layout helpers =====

function posKey(pos: RoomPosition): string {
  return `${pos.roomName}:${pos.x}:${pos.y}`;
}

function inBounds(x: number, y: number): boolean {
  return x > 0 && x < 49 && y > 0 && y < 49;
}

function findBaseAnchor(room: Room): RoomPosition {
  // Cached anchor to reduce CPU
  const mem = getRoomMemory(room.name);
  const cached = mem?.construction?.anchor;
  if (cached && typeof cached.x === "number" && typeof cached.y === "number") {
    const pos = new RoomPosition(cached.x, cached.y, room.name);
    if (
      inBounds(pos.x, pos.y) &&
      room.getTerrain().get(pos.x, pos.y) !== TERRAIN_MASK_WALL
    ) {
      return pos;
    }
  }

  // Prefer around room center, away from exits and walls, with low wall density in radius 4-5
  const center = new RoomPosition(25, 25, room.name);
  const candidates: RoomPosition[] = [];
  for (let dx = -5; dx <= 5; dx++) {
    for (let dy = -5; dy <= 5; dy++) {
      const x = center.x + dx;
      const y = center.y + dy;
      if (!inBounds(x, y)) continue;
      candidates.push(new RoomPosition(x, y, room.name));
    }
  }
  const terrain = room.getTerrain();
  let best: { pos: RoomPosition; score: number } | null = null;
  const controller = room.controller;
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  const sources = room.find(FIND_SOURCES);

  for (const pos of candidates) {
    if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) continue;

    // Score based on: distance to exits (keep >= 6), low nearby walls, proximity to controller/sources
    const minExitDist = Math.min(pos.x, pos.y, 49 - pos.x, 49 - pos.y);
    if (minExitDist < 6) continue;

    let wallPenalty = 0;
    for (let rx = -4; rx <= 4; rx++) {
      for (let ry = -4; ry <= 4; ry++) {
        if (!inBounds(pos.x + rx, pos.y + ry)) continue;
        if (terrain.get(pos.x + rx, pos.y + ry) === TERRAIN_MASK_WALL)
          wallPenalty += 1;
      }
    }

    const ctrlDist = controller ? pos.getRangeTo(controller.pos) : 20;
    const spawnDist = spawn ? pos.getRangeTo(spawn.pos) : 10;
    const avgSourceDist = sources.length
      ? sources.reduce((s, src) => s + pos.getRangeTo(src.pos), 0) /
        sources.length
      : 20;

    // Weight towards being reasonably close to spawn while balanced to controller/sources
    const score =
      minExitDist * 2 -
      wallPenalty -
      (ctrlDist + avgSourceDist) * 0.1 -
      spawnDist * 0.2;
    if (!best || score > best.score) best = { pos, score };
  }

  const anchor = best?.pos || center;
  // Store in memory for future ticks
  mem.construction = mem.construction || {};
  mem.construction.anchor = { x: anchor.x, y: anchor.y };
  return anchor;
}

function generateAdditionalSpawnTasks(
  intel: RoomIntelligence,
  anchor: RoomPosition
): ConstructionTask[] {
  const tasks: ConstructionTask[] = [];
  const rcl = intel.basic.rcl;
  const room = Game.rooms[intel.basic.name];
  if (!room) return tasks;
  const existing = intel.infrastructure.structures.spawn || 0;
  const limit = rcl < 7 ? 1 : rcl < 8 ? 2 : 3;
  const need = Math.max(0, limit - existing);
  if (need <= 0) return tasks;

  // Choose slots around anchor in a small ring not blocking core roads
  const offsets: Array<{ x: number; y: number }> = [
    { x: -2, y: 1 },
    { x: 2, y: -1 },
    { x: -2, y: -1 },
  ];
  let placed = 0;
  for (const o of offsets) {
    if (placed >= need) break;
    const x = anchor.x + o.x;
    const y = anchor.y + o.y;
    if (!inBounds(x, y)) continue;
    const pos = new RoomPosition(x, y, room.name);
    if (!isValidBuildPosition(pos)) continue;
    tasks.push({
      type: STRUCTURE_SPAWN,
      pos,
      priority: 88 - placed,
      reason: "Additional spawn near hub",
      estimatedCost: 15000,
      dependencies: [],
      urgent: false,
    });
    placed++;
  }
  return tasks;
}

function getCoreStamp(anchor: RoomPosition): {
  roads: RoomPosition[];
  storage: RoomPosition | null;
  terminal: RoomPosition | null;
  towerSlots: RoomPosition[];
} {
  const r: RoomPosition[] = [];
  const roomName = anchor.roomName;
  // Cross roads
  for (let d = -2; d <= 2; d++) {
    if (inBounds(anchor.x + d, anchor.y))
      r.push(new RoomPosition(anchor.x + d, anchor.y, roomName));
    if (inBounds(anchor.x, anchor.y + d))
      r.push(new RoomPosition(anchor.x, anchor.y + d, roomName));
  }
  // Ring roads at radius 2
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      if (Math.abs(dx) === 2 || Math.abs(dy) === 2) {
        const x = anchor.x + dx;
        const y = anchor.y + dy;
        if (inBounds(x, y)) r.push(new RoomPosition(x, y, roomName));
      }
    }
  }
  // Strategic core placements near center
  const storage = inBounds(anchor.x + 1, anchor.y)
    ? new RoomPosition(anchor.x + 1, anchor.y, roomName)
    : null;
  const terminal = inBounds(anchor.x - 1, anchor.y)
    ? new RoomPosition(anchor.x - 1, anchor.y, roomName)
    : null;
  const towerSlots: RoomPosition[] = [];
  const tOffsets = [
    { x: -3, y: -1 },
    { x: -1, y: -3 },
    { x: 1, y: -3 },
    { x: 3, y: -1 },
    { x: 3, y: 1 },
    { x: -1, y: 3 },
  ];
  for (const o of tOffsets) {
    const x = anchor.x + o.x;
    const y = anchor.y + o.y;
    if (inBounds(x, y)) towerSlots.push(new RoomPosition(x, y, roomName));
  }
  return { roads: r, storage, terminal, towerSlots };
}

function findExtensionRingPositions(
  anchor: RoomPosition,
  count: number,
  reserved: Set<string>
): RoomPosition[] {
  const results: RoomPosition[] = [];
  const room = Game.rooms[anchor.roomName];
  if (!room) return results;
  const terrain = room.getTerrain();
  const taken = new Set<string>(reserved);

  let radius = 3; // start just beyond core ring
  while (results.length < count && radius <= 10) {
    for (let dx = -radius; dx <= radius && results.length < count; dx++) {
      for (let dy = -radius; dy <= radius && results.length < count; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue; // outer ring only
        const x = anchor.x + dx;
        const y = anchor.y + dy;
        if (!inBounds(x, y)) continue;
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
        const pos = new RoomPosition(x, y, anchor.roomName);
        const key = posKey(pos);
        if (taken.has(key)) continue;
        // Avoid controller, sources tiles
        const tileHasImportant = pos.look() as LookAtResult[];
        if (
          tileHasImportant.some(
            (t) =>
              t.type === LOOK_STRUCTURES || t.type === LOOK_CONSTRUCTION_SITES
          )
        )
          continue;
        // New: ensure at least one adjacent walkable tile and reachability from anchor
        if (!hasAccessibleAdjacentTile(pos)) continue;
        if (!isReachableFromAnchor(anchor, pos)) continue;
        // Prefer plains over swamps for extensions; allow roads later to be placed in between
        results.push(pos);
        taken.add(key);
      }
    }
    radius++;
  }
  return results;
}

// Check if there is at least one adjacent walkable tile (non-wall and not blocked by non-walkable structures)
function hasAccessibleAdjacentTile(pos: RoomPosition): boolean {
  const room = Game.rooms[pos.roomName];
  if (!room) return false;
  const terrain = room.getTerrain();
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const x = pos.x + dx;
      const y = pos.y + dy;
      if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      const here = new RoomPosition(x, y, pos.roomName);
      const structs = here.lookFor(LOOK_STRUCTURES);
      const blocked = structs.some((s) => {
        if (s.structureType === STRUCTURE_ROAD) return false;
        if (s.structureType === STRUCTURE_CONTAINER) return false;
        if (s.structureType === STRUCTURE_RAMPART) return false; // assume our ramparts are passable
        return true;
      });
      if (!blocked) return true;
    }
  }
  return false;
}

// Verify there is a viable path from anchor to target position (range 1)
function isReachableFromAnchor(
  anchor: RoomPosition,
  target: RoomPosition
): boolean {
  if (anchor.roomName !== target.roomName) return false;
  const room = Game.rooms[anchor.roomName];
  if (!room) return false;
  const result = PathFinder.search(
    anchor,
    { pos: target, range: 1 },
    {
      maxRooms: 1,
      maxOps: 2000,
      roomCallback: (roomName: string) => {
        if (roomName !== room.name) return false as any;
        const costs = new PathFinder.CostMatrix();
        const terrain = room.getTerrain();
        for (let y = 1; y < 49; y++) {
          for (let x = 1; x < 49; x++) {
            const t = terrain.get(x, y);
            if (t === TERRAIN_MASK_WALL) {
              costs.set(x, y, 0xff);
            }
          }
        }
        // Make existing non-walkable structures very costly
        const structs = room.find(FIND_STRUCTURES);
        for (const s of structs) {
          const { x, y } = s.pos;
          if (
            s.structureType === STRUCTURE_ROAD ||
            s.structureType === STRUCTURE_CONTAINER ||
            s.structureType === STRUCTURE_RAMPART
          ) {
            // treat roads as cheap
            if (s.structureType === STRUCTURE_ROAD) costs.set(x, y, 1);
            continue;
          }
          costs.set(x, y, 0xff);
        }
        return costs;
      },
    }
  );
  // Consider reachable if not incomplete (found a path) and path length reasonable
  return !result.incomplete && result.path.length > 0;
}

function generateRoadTasksFromAnchor(
  intel: RoomIntelligence,
  anchor: RoomPosition
): ConstructionTask[] {
  const tasks: ConstructionTask[] = [];
  const room = Game.rooms[intel.basic.name];
  if (!room) return tasks;
  const sources = room.find(FIND_SOURCES);
  const controller = room.controller;
  const mineral = room.find(FIND_MINERALS)[0];

  // Path to sources
  for (const src of sources) {
    const path = getCachedPath(room, `to:source:${src.id}`, anchor, src.pos);
    path.forEach((step: PathStep, i: number) => {
      const pos = new RoomPosition(step.x, step.y, room.name);
      const hasRoad = pos
        .lookFor(LOOK_STRUCTURES)
        .some((s) => s.structureType === STRUCTURE_ROAD);
      if (!hasRoad) {
        tasks.push({
          type: STRUCTURE_ROAD,
          pos,
          priority: 62 - i * 0.05,
          reason: `Road from hub to source`,
          estimatedCost: 300,
          dependencies: [],
          urgent: false,
        });
      }
    });
  }

  // Path to controller
  if (controller) {
    const path = getCachedPath(
      room,
      `to:controller:${controller.id}`,
      anchor,
      controller.pos
    );
    path.forEach((step: PathStep, i: number) => {
      const pos = new RoomPosition(step.x, step.y, room.name);
      const hasRoad = pos
        .lookFor(LOOK_STRUCTURES)
        .some((s) => s.structureType === STRUCTURE_ROAD);
      if (!hasRoad) {
        tasks.push({
          type: STRUCTURE_ROAD,
          pos,
          priority: 58 - i * 0.05,
          reason: `Road from hub to controller`,
          estimatedCost: 300,
          dependencies: [],
          urgent: false,
        });
      }
    });
  }

  // Path to mineral (optional; low priority)
  if (mineral) {
    const path = getCachedPath(
      room,
      `to:mineral:${mineral.id}`,
      anchor,
      mineral.pos
    );
    path.forEach((step: PathStep, i: number) => {
      const pos = new RoomPosition(step.x, step.y, room.name);
      const hasRoad = pos
        .lookFor(LOOK_STRUCTURES)
        .some((s) => s.structureType === STRUCTURE_ROAD);
      if (!hasRoad) {
        tasks.push({
          type: STRUCTURE_ROAD,
          pos,
          priority: 50 - i * 0.05,
          reason: `Road from hub to mineral`,
          estimatedCost: 300,
          dependencies: [],
          urgent: false,
        });
      }
    });
  }

  return tasks;
}

// Ensure short connectors from spawns/storage/terminal to the core cross, so haulers don't get stuck on last tiles
function generateCoreConnectorTasks(
  intel: RoomIntelligence,
  anchor: RoomPosition,
  core: {
    roads: RoomPosition[];
    storage: RoomPosition | null;
    terminal: RoomPosition | null;
    towerSlots: RoomPosition[];
  }
): ConstructionTask[] {
  const tasks: ConstructionTask[] = [];
  const room = Game.rooms[intel.basic.name];
  if (!room) return tasks;
  const connectors: RoomPosition[] = [];

  const spawns = room.find(FIND_MY_SPAWNS);
  for (const s of spawns) {
    // Direct straight connector to anchor along x then y
    const path = getCachedPath(room, `connector:spawn:${s.id}`, s.pos, anchor);
    for (let i = 0; i < Math.min(4, path.length); i++) {
      const st = path[i];
      connectors.push(new RoomPosition(st.x, st.y, room.name));
    }
  }
  if (core.storage) {
    const path = getCachedPath(
      room,
      `connector:storage:${core.storage.x}:${core.storage.y}`,
      core.storage,
      anchor
    );
    for (let i = 0; i < Math.min(3, path.length); i++) {
      const st = path[i];
      connectors.push(new RoomPosition(st.x, st.y, room.name));
    }
  }
  if (core.terminal) {
    const path = getCachedPath(
      room,
      `connector:terminal:${core.terminal.x}:${core.terminal.y}`,
      core.terminal,
      anchor
    );
    for (let i = 0; i < Math.min(3, path.length); i++) {
      const st = path[i];
      connectors.push(new RoomPosition(st.x, st.y, room.name));
    }
  }

  for (const pos of connectors) {
    const hasRoad = pos
      .lookFor(LOOK_STRUCTURES)
      .some((s) => s.structureType === STRUCTURE_ROAD);
    if (!hasRoad && isValidBuildPosition(pos)) {
      tasks.push({
        type: STRUCTURE_ROAD,
        pos,
        priority: 91.5,
        reason: "Connector to hub",
        estimatedCost: 300,
        dependencies: [],
        urgent: true,
      });
    }
  }
  return tasks;
}

// Widen the trunk near the anchor to reduce congestion (small 2-wide segment on N/S/E/W for 3 tiles)
function generateHubWideningTasks(
  intel: RoomIntelligence,
  anchor: RoomPosition
): ConstructionTask[] {
  const tasks: ConstructionTask[] = [];
  const room = Game.rooms[intel.basic.name];
  if (!room) return tasks;
  // Gate by early RCL/economy so we don't overbuild cosmetic roads too soon
  if (intel.basic.rcl < 3 || (intel.economy?.energyCapacity || 0) < 550) {
    return tasks;
  }
  const widenOffsets: Array<{ x: number; y: number }> = [];
  for (let d = -2; d <= 2; d++) {
    widenOffsets.push({ x: 1, y: d });
    widenOffsets.push({ x: -1, y: d });
    widenOffsets.push({ x: d, y: 1 });
    widenOffsets.push({ x: d, y: -1 });
  }
  const added = new Set<string>();
  for (const o of widenOffsets) {
    const x = anchor.x + o.x;
    const y = anchor.y + o.y;
    if (!inBounds(x, y)) continue;
    const pos = new RoomPosition(x, y, room.name);
    const key = posKey(pos);
    if (added.has(key)) continue;
    const hasRoad = pos
      .lookFor(LOOK_STRUCTURES)
      .some((s) => s.structureType === STRUCTURE_ROAD);
    if (!hasRoad && isValidBuildPosition(pos)) {
      tasks.push({
        type: STRUCTURE_ROAD,
        pos,
        priority: 91.2,
        reason: "Widen hub trunk",
        estimatedCost: 300,
        dependencies: [],
        urgent: false,
      });
      added.add(key);
    }
  }
  return tasks;
}

// Add a small redundancy loop around the core cross (ring at radius 3 around anchor)
function generateCoreLoopTasks(
  intel: RoomIntelligence,
  anchor: RoomPosition
): ConstructionTask[] {
  const tasks: ConstructionTask[] = [];
  const room = Game.rooms[intel.basic.name];
  if (!room) return tasks;
  // Gate by RCL/economy to avoid overbuilding too early
  if (intel.basic.rcl < 3 || (intel.economy?.energyCapacity || 0) < 550) {
    return tasks;
  }
  const r = 3;
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = anchor.x + dx;
      const y = anchor.y + dy;
      if (!inBounds(x, y)) continue;
      const pos = new RoomPosition(x, y, room.name);
      const hasRoad = pos
        .lookFor(LOOK_STRUCTURES)
        .some((s) => s.structureType === STRUCTURE_ROAD);
      if (!hasRoad && isValidBuildPosition(pos)) {
        tasks.push({
          type: STRUCTURE_ROAD,
          pos,
          priority: 60,
          reason: "Core redundancy loop",
          estimatedCost: 300,
          dependencies: [],
          urgent: false,
        });
      }
    }
  }
  return tasks;
}

// Place labs in a compact cluster near the core, RCL-gated and dedup-safe
function generateLabTasksNearCore(
  intel: RoomIntelligence,
  anchor: RoomPosition
): ConstructionTask[] {
  const tasks: ConstructionTask[] = [];
  const room = Game.rooms[intel.basic.name];
  if (!room) return tasks;
  const needed =
    getLabLimit(intel.basic.rcl) - (intel.infrastructure.structures.lab || 0);
  if (needed <= 0) return tasks;

  // 10-lab cluster offset to top-right quadrant from anchor
  const labOffsets: Array<{ x: number; y: number }> = [
    { x: -1, y: -1 },
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: -1, y: 0 },
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: -1, y: 1 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 2, y: 0 },
  ].map((o) => ({ x: o.x + 4, y: o.y - 4 }));

  for (let i = 0; i < Math.min(needed, labOffsets.length); i++) {
    const x = anchor.x + labOffsets[i].x;
    const y = anchor.y + labOffsets[i].y;
    if (!inBounds(x, y)) continue;
    const pos = new RoomPosition(x, y, room.name);
    if (!isValidBuildPosition(pos)) continue;
    tasks.push({
      type: STRUCTURE_LAB,
      pos,
      priority: 54 - i,
      reason: "Clustered lab for boosts & reactions",
      estimatedCost: 50000,
      dependencies: ["terminal"],
      urgent: false,
    });
  }
  return tasks;
}

// Create short spur roads around the endpoint tiles for sources, controller, and mineral
function generateEndpointPadRoads(
  intel: RoomIntelligence,
  anchor: RoomPosition
): ConstructionTask[] {
  const tasks: ConstructionTask[] = [];
  const room = Game.rooms[intel.basic.name];
  if (!room) return tasks;
  const poi: RoomPosition[] = [];
  const sources = room.find(FIND_SOURCES);
  for (const s of sources) poi.push(s.pos);
  if (room.controller) poi.push(room.controller.pos);
  const mineral = room.find(FIND_MINERALS)[0];
  if (mineral) poi.push(mineral.pos);

  const seen = new Set<string>();
  for (const p of poi) {
    // Find path to get the last step near the POI
    const path = anchor.findPathTo(p, {
      ignoreCreeps: true,
      ignoreRoads: false,
    });
    if (path.length === 0) continue;
    const last = path[path.length - 1];
    const end = new RoomPosition(last.x, last.y, room.name);
    // Cross of four tiles around the endpoint (not including the POI tile itself)
    const offsets = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    for (const o of offsets) {
      const x = end.x + o.x;
      const y = end.y + o.y;
      if (!inBounds(x, y)) continue;
      const pos = new RoomPosition(x, y, room.name);
      const key = posKey(pos);
      if (seen.has(key)) continue;
      const hasRoad = pos
        .lookFor(LOOK_STRUCTURES)
        .some((s) => s.structureType === STRUCTURE_ROAD);
      if (!hasRoad && isValidBuildPosition(pos)) {
        tasks.push({
          type: STRUCTURE_ROAD,
          pos,
          priority: 57,
          reason: "Endpoint pad spur",
          estimatedCost: 300,
          dependencies: [],
          urgent: false,
        });
        seen.add(key);
      }
    }
  }
  return tasks;
}

// Create a short connector from controller's container (or nearest step) back to the hub trunk
function generateControllerConnectorSpur(
  intel: RoomIntelligence,
  anchor: RoomPosition
): ConstructionTask[] {
  const tasks: ConstructionTask[] = [];
  const room = Game.rooms[intel.basic.name];
  if (!room || !room.controller) return tasks;
  const ctrl = room.controller;

  // Prefer a container tile adjacent to the controller
  let start: RoomPosition | null = null;
  const nearContainers = ctrl.pos
    .findInRange(FIND_STRUCTURES, 2)
    .filter((s) => s.structureType === STRUCTURE_CONTAINER);
  if (nearContainers.length) start = nearContainers[0].pos;
  if (!start) {
    // Otherwise, pick a walkable tile near controller edge
    const terrain = room.getTerrain();
    for (let dx = -1; dx <= 1 && !start; dx++) {
      for (let dy = -1; dy <= 1 && !start; dy++) {
        const x = ctrl.pos.x + dx;
        const y = ctrl.pos.y + dy;
        if (!inBounds(x, y)) continue;
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
        const pos = new RoomPosition(x, y, room.name);
        // Avoid placing directly on controller tile
        if (pos.isEqualTo(ctrl.pos)) continue;
        start = pos;
      }
    }
  }
  if (!start) return tasks;

  // Short path segment from start → anchor
  const path = getCachedPath(
    room,
    `connector:controller:${start.x}:${start.y}`,
    start,
    anchor
  );
  for (let i = 0; i < Math.min(3, path.length); i++) {
    const st = path[i];
    const p = new RoomPosition(st.x, st.y, room.name);
    const hasRoad = p
      .lookFor(LOOK_STRUCTURES)
      .some((s) => s.structureType === STRUCTURE_ROAD);
    if (!hasRoad && isValidBuildPosition(p)) {
      tasks.push({
        type: STRUCTURE_ROAD,
        pos: p,
        priority: 83.2 - i * 0.1,
        reason: "Controller connector spur",
        estimatedCost: 300,
        dependencies: [],
        urgent: intel.basic.rcl <= 3,
      });
    }
  }
  return tasks;
}

// Cache room paths to reduce CPU; invalidates with TTL or anchor change
function getCachedPath(
  room: Room,
  key: string,
  from: RoomPosition,
  to: RoomPosition,
  ttl: number = 5000
): PathStep[] {
  const mem = getRoomMemory(room.name);
  mem.construction = mem.construction || ({} as any);
  const anchorKey = `${from.x}:${from.y}`;
  if (!mem.construction.paths) (mem.construction as any).paths = {};
  const store: any = (mem.construction as any).paths;
  const rec = store[key];
  const now = Game.time;
  const needsRecalc =
    !rec ||
    !rec.path ||
    rec.anchorKey !== anchorKey ||
    now - (rec.time || 0) > ttl;
  if (needsRecalc) {
    const result = PathFinder.search(
      from,
      { pos: to, range: 1 },
      {
        plainCost: 2,
        swampCost: 5,
        maxOps: 2000,
        roomCallback: (name) => {
          if (name !== room.name) return false as any;
          return new PathFinder.CostMatrix();
        },
      }
    );
    const steps: PathStep[] = [];
    let last = from;
    for (const p of result.path) {
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      const direction = last.getDirectionTo(p);
      steps.push({ x: p.x, y: p.y, dx, dy, direction } as PathStep);
      last = p;
    }
    store[key] = {
      time: now,
      anchorKey,
      path: steps.map((s: PathStep) => [s.x, s.y]),
    };
    // Prune path cache to avoid unbounded growth
    try {
      const entries = Object.keys(store);
      const MAX_ENTRIES = 80;
      if (entries.length > MAX_ENTRIES) {
        entries
          .map((k) => ({ k, t: store[k]?.time || 0 }))
          .sort((a, b) => a.t - b.t)
          .slice(0, entries.length - MAX_ENTRIES)
          .forEach((e) => delete store[e.k]);
      }
    } catch {}
    return steps;
  }
  const arr: Array<[number, number]> = rec.path;
  let lastPos = from;
  const steps: PathStep[] = arr.map(([x, y]) => {
    const dx = x - lastPos.x;
    const dy = y - lastPos.y;
    const direction = lastPos.getDirectionTo(new RoomPosition(x, y, room.name));
    lastPos = new RoomPosition(x, y, room.name);
    return { x, y, dx, dy, direction } as PathStep;
  });
  return steps;
}

// (Note) Valid implementation of generateLabTasksNearCore exists earlier in the file.

function getFactoryNearCore(anchor: RoomPosition): RoomPosition {
  const x = anchor.x + 2;
  const y = anchor.y + 2;
  return new RoomPosition(
    Math.min(48, Math.max(1, x)),
    Math.min(48, Math.max(1, y)),
    anchor.roomName
  );
}

// ===== New strategic tasks =====

function generateStorageLinkTask(
  intel: RoomIntelligence,
  anchor: RoomPosition,
  storagePos: RoomPosition | null
): ConstructionTask | null {
  const rcl = intel.basic.rcl;
  const room = Game.rooms[intel.basic.name];
  if (!room || !storagePos) return null;
  if (getLinkLimit(rcl) <= (intel.infrastructure.structures.link || 0))
    return null;
  // Choose an adjacent tile to storage for the hub link
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const x = storagePos.x + dx;
      const y = storagePos.y + dy;
      if (!inBounds(x, y)) continue;
      const pos = new RoomPosition(x, y, room.name);
      // Avoid placing over storage tile; allow empty tile only
      if (!isValidBuildPosition(pos)) continue;
      // Ensure not already a link nearby
      const hasLink = pos
        .findInRange(FIND_STRUCTURES, 1)
        .some((s) => s.structureType === STRUCTURE_LINK);
      if (hasLink) continue;
      return {
        type: STRUCTURE_LINK,
        pos,
        priority: 72,
        reason: "Storage-side link for fast energy routing",
        estimatedCost: 5000,
        dependencies: ["storage"],
        urgent: false,
      };
    }
  }
  return null;
}

function generateExtractorTasks(intel: RoomIntelligence): ConstructionTask[] {
  const tasks: ConstructionTask[] = [];
  const room = Game.rooms[intel.basic.name];
  if (!room) return tasks;
  const rcl = intel.basic.rcl;
  if (rcl < 6) return tasks;

  const mineral = room.find(FIND_MINERALS)[0];
  if (!mineral) return tasks;

  const existingExtractor = room.find(FIND_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_EXTRACTOR,
  }).length;
  if (existingExtractor === 0) {
    tasks.push({
      type: STRUCTURE_EXTRACTOR,
      pos: mineral.pos,
      priority: 53,
      reason: "Enable mineral harvesting",
      estimatedCost: 5000,
      dependencies: [],
      urgent: false,
    });
  }

  // Add a container near mineral if missing
  const hasContainer = mineral.pos
    .findInRange(FIND_STRUCTURES, 1)
    .some((s) => s.structureType === STRUCTURE_CONTAINER);
  if (!hasContainer) {
    const cpos = findContainerPosition(mineral.pos);
    if (cpos) {
      tasks.push({
        type: STRUCTURE_CONTAINER,
        pos: cpos,
        priority: 52,
        reason: "Container at mineral site",
        estimatedCost: 5000,
        dependencies: [],
        urgent: false,
      });
    }
  }

  return tasks;
}

function generateObserverTasks(
  intel: RoomIntelligence,
  anchor: RoomPosition
): ConstructionTask[] {
  const tasks: ConstructionTask[] = [];
  if (intel.basic.rcl < 8) return tasks;
  const room = Game.rooms[intel.basic.name];
  if (!room) return tasks;
  const existing = intel.infrastructure.structures.observer || 0;
  if (existing > 0) return tasks;
  const x = anchor.x + 4;
  const y = anchor.y + 0;
  if (!inBounds(x, y)) return tasks;
  const pos = new RoomPosition(x, y, room.name);
  if (!isValidBuildPosition(pos)) return tasks;
  tasks.push({
    type: STRUCTURE_OBSERVER,
    pos,
    priority: 46,
    reason: "Observer near hub for remote scouting",
    estimatedCost: 8000,
    dependencies: ["terminal"],
    urgent: false,
  });
  return tasks;
}

function generateNukerTasks(
  intel: RoomIntelligence,
  anchor: RoomPosition
): ConstructionTask[] {
  const tasks: ConstructionTask[] = [];
  if (intel.basic.rcl < 8) return tasks;
  const room = Game.rooms[intel.basic.name];
  if (!room) return tasks;
  const existing = intel.infrastructure.structures.nuker || 0;
  if (existing > 0) return tasks;
  const x = anchor.x - 4;
  const y = anchor.y + 0;
  if (!inBounds(x, y)) return tasks;
  const pos = new RoomPosition(x, y, room.name);
  if (!isValidBuildPosition(pos)) return tasks;
  tasks.push({
    type: STRUCTURE_NUKER,
    pos,
    priority: 44,
    reason: "Nuker positioned with logistics access",
    estimatedCost: 100000,
    dependencies: ["terminal", "storage"],
    urgent: false,
  });
  return tasks;
}

function getPowerSpawnNearCore(anchor: RoomPosition): RoomPosition {
  const x = anchor.x - 2;
  const y = anchor.y + 2;
  return new RoomPosition(
    Math.min(48, Math.max(1, x)),
    Math.min(48, Math.max(1, y)),
    anchor.roomName
  );
}
