/**
 * Automation Construction
 *
 * Intelligent construction planning and priority management.
 * Determines what to build, when, and where based on room intelligence.
 */

/// <reference types="@types/screeps" />

import { RoomIntelligence } from "./room.intelligence";

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
  const { basic, infrastructure, economy } = intel;
  const rcl = basic.rcl;

  // Extensions - highest priority for energy capacity
  const neededExtensions =
    getExtensionLimit(rcl) - infrastructure.structures.extension;
  if (neededExtensions > 0) {
    tasks.push(...generateExtensionTasks(intel, neededExtensions));
  }

  // Containers for sources
  tasks.push(...generateContainerTasks(intel));

  // Roads for efficiency
  tasks.push(...generateRoadTasks(intel));

  // Towers for defense
  const neededTowers = getTowerLimit(rcl) - infrastructure.structures.tower;
  if (neededTowers > 0) {
    tasks.push(...generateTowerTasks(intel, neededTowers));
  }

  // Storage at RCL 4+
  if (rcl >= 4 && infrastructure.structures.storage === 0) {
    tasks.push(generateStorageTask(intel));
  }

  // Links at RCL 5+
  if (rcl >= 5) {
    tasks.push(...generateLinkTasks(intel));
  }

  // Terminal at RCL 6+
  if (rcl >= 6 && infrastructure.structures.terminal === 0) {
    tasks.push(generateTerminalTask(intel));
  }

  // Labs at RCL 6+
  if (rcl >= 6) {
    tasks.push(...generateLabTasks(intel));
  }

  // Factory at RCL 7+
  if (rcl >= 7 && infrastructure.structures.factory === 0) {
    tasks.push(generateFactoryTask(intel));
  }

  // Power spawn at RCL 8
  if (rcl >= 8 && infrastructure.structures.powerSpawn === 0) {
    tasks.push(generatePowerSpawnTask(intel));
  }

  // Walls and ramparts for defense
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
  const tasks: ConstructionTask[] = [];
  const room = Game.rooms[intel.basic.name];
  const spawn = room?.find(FIND_MY_SPAWNS)[0];
  if (!spawn) return tasks;

  // Find positions near spawn in a compact formation
  const positions = findExtensionPositions(spawn.pos, count);

  positions.forEach((pos, index) => {
    tasks.push({
      type: STRUCTURE_EXTENSION,
      pos,
      priority: 90 - index, // First extensions are highest priority
      reason: "Increase energy capacity for larger creeps",
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
          priority: 85,
          reason: `Container for source at ${source.pos.x},${source.pos.y}`,
          estimatedCost: 5000,
          dependencies: [],
          urgent: intel.basic.rcl >= 3,
        });
      }
    }
  });

  // Controller container
  const controller = room?.controller;
  if (controller && intel.basic.rcl >= 3) {
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
          priority: 75,
          reason: "Controller container for upgraders",
          estimatedCost: 5000,
          dependencies: [],
          urgent: false,
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
  const tasks: ConstructionTask[] = [];
  const room = Game.rooms[intel.basic.name];
  const spawn = room?.find(FIND_MY_SPAWNS)[0];
  if (!spawn || intel.infrastructure.roads.coverage > 0.7) return tasks;

  // Roads from spawn to sources
  intel.economy.sources.forEach((source) => {
    const path = spawn.pos.findPathTo(source.pos);
    path.forEach((step: PathStep, index: number) => {
      const pos = new RoomPosition(step.x, step.y, intel.basic.name);

      // Check if road already exists
      const structures = pos.lookFor(LOOK_STRUCTURES);
      const hasRoad = structures.some(
        (s) => s.structureType === STRUCTURE_ROAD
      );

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

      const structures = pos.lookFor(LOOK_STRUCTURES);
      const hasRoad = structures.some(
        (s) => s.structureType === STRUCTURE_ROAD
      );

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
  const currentLinks = intel.infrastructure.structures.link;

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
  const currentLabs = intel.infrastructure.structures.lab;

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
    // Add some basic rampart tasks for key structures
    const spawns = room?.find(FIND_MY_SPAWNS);
    spawns?.forEach((spawn: StructureSpawn) => {
      tasks.push({
        type: STRUCTURE_RAMPART,
        pos: spawn.pos,
        priority: 35,
        reason: "Protect spawn structure",
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
  // Find adjacent position that's not blocked
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;

      const x = nearPos.x + dx;
      const y = nearPos.y + dy;

      if (x >= 1 && x <= 48 && y >= 1 && y <= 48) {
        const pos = new RoomPosition(x, y, nearPos.roomName);
        if (isValidBuildPosition(pos)) {
          return pos;
        }
      }
    }
  }

  return null;
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
