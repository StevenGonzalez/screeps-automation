/**
 * Room Intelligence
 *
 * Pure functions for analyzing room state and extracting insights.
 * No side effects, just pure data analysis and intelligence gathering.
 */

/// <reference types="@types/screeps" />

export interface RoomIntelligence {
  basic: {
    name: string;
    rcl: number;
    owned: boolean;
    phase: "EARLY" | "DEVELOPING" | "MATURE" | "POWERHOUSE";
  };
  economy: {
    energyAvailable: number;
    energyCapacity: number;
    energyStored: number;
    sources: Array<{
      id: string;
      energy: number;
      maxEnergy: number;
      pos: RoomPosition;
      efficiency: number;
    }>;
    income: number;
    expenses: number;
    netFlow: number;
    efficiency: number;
  };
  military: {
    hostiles: Array<{
      id: string;
      owner: string;
      pos: RoomPosition;
      bodyParts: BodyPartConstant[];
      threatLevel: number;
    }>;
    defenses: Array<{
      id: string;
      type: StructureConstant;
      pos: RoomPosition;
      energy: number;
      hits: number;
    }>;
    safetyScore: number;
    recommendedDefenseLevel: "MINIMAL" | "STANDARD" | "FORTRESS";
  };
  infrastructure: {
    structures: Record<StructureConstant, number>;
    constructionSites: Array<{
      id: string;
      structureType: BuildableStructureConstant;
      pos: RoomPosition;
      progress: number;
    }>;
    roads: {
      coverage: number;
      efficiency: number;
      maintenanceNeeded: number;
    };
    layout: {
      corePosition?: RoomPosition;
      sourceDistances: number[];
      controllerDistance: number;
      compactness: number;
    };
  };
  creeps: {
    total: number;
    byRole: Record<string, number>;
    productivity: Record<string, number>;
    avgTicksToLive: number;
    workParts: number;
    carryParts: number;
    moveParts: number;
  };
  needs: {
    urgent: string[];
    important: string[];
    optimization: string[];
    expansion: string[];
  };
}

/**
 * Analyze a room and extract comprehensive intelligence
 */
export function analyzeRoom(room: Room): RoomIntelligence {
  return {
    basic: analyzeBasicInfo(room),
    economy: analyzeEconomy(room),
    military: analyzeMilitary(room),
    infrastructure: analyzeInfrastructure(room),
    creeps: analyzeCreeps(room),
    needs: analyzeNeeds(room),
  };
}

/**
 * Basic room information and classification
 */
function analyzeBasicInfo(room: Room): RoomIntelligence["basic"] {
  const controller = room.controller;
  const rcl = controller?.level || 0;
  const owned = controller?.my || false;

  // Determine development phase
  let phase: RoomIntelligence["basic"]["phase"] = "EARLY";
  const storage = room.storage;
  const energyStored = storage?.store.energy || 0;

  if (rcl >= 8 && energyStored > 500000) {
    phase = "POWERHOUSE";
  } else if (rcl >= 6 && energyStored > 100000) {
    phase = "MATURE";
  } else if (rcl >= 4) {
    phase = "DEVELOPING";
  }

  return {
    name: room.name,
    rcl,
    owned,
    phase,
  };
}

/**
 * Economic analysis - energy flows, efficiency, potential
 */
function analyzeEconomy(room: Room): RoomIntelligence["economy"] {
  const sources = room.find(FIND_SOURCES);
  const storage = room.storage;
  const terminal = room.terminal;

  // Analyze each source
  const sourceData = sources.map((source) => {
    const containers = source.pos.findInRange(FIND_STRUCTURES, 2, {
      filter: { structureType: STRUCTURE_CONTAINER },
    }) as StructureContainer[];

    const nearbyCreeps = source.pos.findInRange(FIND_MY_CREEPS, 1, {
      filter: (creep: Creep) => creep.memory.role === "harvester",
    });

    // Calculate efficiency based on harvester presence and container
    let efficiency = 0;
    if (nearbyCreeps.length > 0) {
      efficiency = containers.length > 0 ? 0.95 : 0.7; // Container = more efficient
    }

    return {
      id: source.id,
      energy: source.energy,
      maxEnergy: source.energyCapacity,
      pos: source.pos,
      efficiency,
    };
  });

  // Calculate theoretical vs actual income
  const theoreticalIncome = sources.length * 10; // 10 energy per tick per source
  const actualIncome = calculateActualIncome(room, sourceData);
  const efficiency =
    theoreticalIncome > 0 ? actualIncome / theoreticalIncome : 0;

  return {
    energyAvailable: room.energyAvailable,
    energyCapacity: room.energyCapacityAvailable,
    energyStored: (storage?.store.energy || 0) + (terminal?.store.energy || 0),
    sources: sourceData,
    income: actualIncome,
    expenses: estimateExpenses(room),
    netFlow: actualIncome - estimateExpenses(room),
    efficiency,
  };
}

/**
 * Military analysis - threats, defenses, safety
 */
function analyzeMilitary(room: Room): RoomIntelligence["military"] {
  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  const towers = room.find(FIND_MY_STRUCTURES, {
    filter: { structureType: STRUCTURE_TOWER },
  }) as StructureTower[];

  const ramparts = room.find(FIND_MY_STRUCTURES, {
    filter: { structureType: STRUCTURE_RAMPART },
  }) as StructureRampart[];

  // Analyze each hostile
  const hostileData = hostiles.map((hostile) => ({
    id: hostile.id,
    owner: hostile.owner.username,
    pos: hostile.pos,
    bodyParts: hostile.body.map((part) => part.type),
    threatLevel: calculateThreatLevel(hostile),
  }));

  // Analyze defenses
  const defenseData = [...towers, ...ramparts].map((structure) => ({
    id: structure.id,
    type: structure.structureType,
    pos: structure.pos,
    energy:
      structure.structureType === STRUCTURE_TOWER
        ? (structure as StructureTower).store.energy
        : 0,
    hits: structure.hits,
  }));

  // Calculate safety score (0-100)
  const totalThreat = hostileData.reduce((sum, h) => sum + h.threatLevel, 0);
  const totalDefense = towers.length * 50 + ramparts.length * 10; // Simplified
  const safetyScore = Math.min(
    100,
    Math.max(0, 100 - totalThreat + totalDefense)
  );

  // Recommend defense level
  let recommendedDefenseLevel: RoomIntelligence["military"]["recommendedDefenseLevel"] =
    "MINIMAL";
  if (totalThreat > 100 || room.controller!.level >= 6) {
    recommendedDefenseLevel = "FORTRESS";
  } else if (totalThreat > 20 || room.controller!.level >= 3) {
    recommendedDefenseLevel = "STANDARD";
  }

  return {
    hostiles: hostileData,
    defenses: defenseData,
    safetyScore,
    recommendedDefenseLevel,
  };
}

/**
 * Infrastructure analysis - buildings, roads, layout efficiency
 */
function analyzeInfrastructure(room: Room): RoomIntelligence["infrastructure"] {
  const structures = room.find(FIND_STRUCTURES);
  const constructionSites = room.find(FIND_CONSTRUCTION_SITES);
  const roads = room.find(FIND_STRUCTURES, {
    filter: { structureType: STRUCTURE_ROAD },
  }) as StructureRoad[];

  // Count structures by type
  const structureCounts = structures.reduce((counts, structure) => {
    counts[structure.structureType] =
      (counts[structure.structureType] || 0) + 1;
    return counts;
  }, {} as Record<StructureConstant, number>);

  // Analyze construction sites
  const siteData = constructionSites.map((site) => ({
    id: site.id,
    structureType: site.structureType,
    pos: site.pos,
    progress: site.progress / site.progressTotal,
  }));

  // Calculate road efficiency
  const totalRoads = roads.length;
  const damagedRoads = roads.filter(
    (road) => road.hits < road.hitsMax * 0.8
  ).length;
  const roadCoverage = calculateRoadCoverage(room, roads);

  // Analyze layout
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  const sources = room.find(FIND_SOURCES);
  const controller = room.controller!;

  const sourceDistances = spawn
    ? sources.map((source) => spawn.pos.getRangeTo(source.pos))
    : [];

  const controllerDistance = spawn ? spawn.pos.getRangeTo(controller.pos) : 0;

  // Calculate compactness (lower is more compact)
  const compactness =
    sourceDistances.reduce((sum, dist) => sum + dist, controllerDistance) /
    (sourceDistances.length + 1);

  return {
    structures: structureCounts,
    constructionSites: siteData,
    roads: {
      coverage: roadCoverage,
      efficiency: 1 - damagedRoads / Math.max(1, totalRoads),
      maintenanceNeeded: damagedRoads,
    },
    layout: {
      corePosition: spawn?.pos,
      sourceDistances,
      controllerDistance,
      compactness,
    },
  };
}

/**
 * Creep analysis - population, productivity, composition
 */
function analyzeCreeps(room: Room): RoomIntelligence["creeps"] {
  const creeps = room.find(FIND_MY_CREEPS);

  // Count by role
  const byRole = creeps.reduce((counts, creep) => {
    const role = creep.memory.role || "unknown";
    counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, {} as Record<string, number>);

  // Analyze productivity (simplified)
  const productivity = Object.keys(byRole).reduce((prod, role) => {
    prod[role] = calculateRoleProductivity(room, role);
    return prod;
  }, {} as Record<string, number>);

  // Body part analysis
  const totalParts = creeps.reduce(
    (totals, creep) => {
      creep.body.forEach((part) => {
        if (part.type === WORK) totals.work++;
        else if (part.type === CARRY) totals.carry++;
        else if (part.type === MOVE) totals.move++;
      });
      return totals;
    },
    { work: 0, carry: 0, move: 0 }
  );

  const avgTicksToLive =
    creeps.length > 0
      ? creeps.reduce((sum, creep) => sum + (creep.ticksToLive || 1500), 0) /
        creeps.length
      : 0;

  return {
    total: creeps.length,
    byRole,
    productivity,
    avgTicksToLive,
    workParts: totalParts.work,
    carryParts: totalParts.carry,
    moveParts: totalParts.move,
  };
}

/**
 * Needs analysis - what the room requires for optimization
 */
function analyzeNeeds(room: Room): RoomIntelligence["needs"] {
  const urgent: string[] = [];
  const important: string[] = [];
  const optimization: string[] = [];
  const expansion: string[] = [];

  const rcl = room.controller!.level;
  const spawns = room.find(FIND_MY_SPAWNS);
  const towers = room.find(FIND_MY_STRUCTURES, {
    filter: { structureType: STRUCTURE_TOWER },
  });
  const creeps = room.find(FIND_MY_CREEPS);
  const hostiles = room.find(FIND_HOSTILE_CREEPS);

  // Urgent needs
  if (spawns.length === 0) urgent.push("spawn");
  if (hostiles.length > 0 && towers.length === 0 && rcl >= 3)
    urgent.push("tower");
  if (creeps.length < 3) urgent.push("creeps");

  // Important needs
  if (rcl >= 4 && !room.storage) important.push("storage");
  if (rcl >= 6 && !room.terminal) important.push("terminal");
  if (towers.length < Math.min(rcl, 6)) important.push("more_towers");

  // Optimization opportunities
  const roads = room.find(FIND_STRUCTURES, {
    filter: { structureType: STRUCTURE_ROAD },
  });
  const sources = room.find(FIND_SOURCES);
  if (roads.length < sources.length * 5) optimization.push("road_network");
  if (creeps.length > 15) optimization.push("creep_efficiency");

  // Expansion readiness
  if (rcl >= 4 && room.energyAvailable > 1000) expansion.push("ready");
  if (rcl >= 6 && room.storage && room.storage.store.energy > 50000) {
    expansion.push("optimal");
  }

  return { urgent, important, optimization, expansion };
}

// === UTILITY FUNCTIONS ===

function calculateThreatLevel(creep: Creep): number {
  const attackParts = creep.body.filter(
    (p) => p.type === ATTACK || p.type === RANGED_ATTACK
  ).length;
  const healParts = creep.body.filter((p) => p.type === HEAL).length;

  return attackParts * 10 + healParts * 15 + creep.body.length;
}

function calculateActualIncome(room: Room, sources: Array<any>): number {
  // Calculate actual income based on active harvesters and source efficiency
  const harvesters = room.find(FIND_MY_CREEPS, {
    filter: (creep) => creep.memory.role === "harvester",
  });

  // Each harvester can contribute to income based on their work parts and source efficiency
  const harvesterEfficiency =
    harvesters.length > 0 ? Math.min(harvesters.length / sources.length, 1) : 0;

  return sources.reduce((total, source) => {
    return total + source.efficiency * 10 * harvesterEfficiency;
  }, 0);
}

function estimateExpenses(room: Room): number {
  const creeps = room.find(FIND_MY_CREEPS);
  const spawns = room.find(FIND_MY_SPAWNS);
  const towers = room.find(FIND_MY_STRUCTURES, {
    filter: { structureType: STRUCTURE_TOWER },
  });

  // Simplified expense calculation
  const creepUpkeep = creeps.length * 0.5; // Rough estimate
  const towerUpkeep = towers.length * 2;
  const spawnUsage = spawns.filter((s) => s.spawning).length * 10;

  return creepUpkeep + towerUpkeep + spawnUsage;
}

function calculateRoadCoverage(room: Room, roads: StructureRoad[]): number {
  // Simplified road coverage calculation
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  if (!spawn) return 0;

  const sources = room.find(FIND_SOURCES);
  const controller = room.controller!;

  // Check if main paths have roads
  let coveredPaths = 0;
  let totalPaths = sources.length + 1; // sources + controller

  sources.forEach((source) => {
    const path = spawn.pos.findPathTo(source);
    const roadsOnPath = path.filter((step) =>
      roads.some((road) => road.pos.x === step.x && road.pos.y === step.y)
    );
    if (roadsOnPath.length > path.length * 0.5) coveredPaths++;
  });

  const controllerPath = spawn.pos.findPathTo(controller);
  const roadsToController = controllerPath.filter((step) =>
    roads.some((road) => road.pos.x === step.x && road.pos.y === step.y)
  );
  if (roadsToController.length > controllerPath.length * 0.5) coveredPaths++;

  return coveredPaths / totalPaths;
}

function calculateRoleProductivity(room: Room, role: string): number {
  // Simplified productivity calculation
  // In a real implementation, this would track actual work done
  const creepsOfRole = room.find(FIND_MY_CREEPS, {
    filter: (creep: Creep) => creep.memory.role === role,
  });

  if (creepsOfRole.length === 0) return 0;

  // Base productivity on body parts and room conditions
  const avgWorkParts =
    creepsOfRole.reduce((sum, creep) => {
      return sum + creep.body.filter((p) => p.type === WORK).length;
    }, 0) / creepsOfRole.length;

  return Math.min(1, avgWorkParts / 5); // Normalize to 0-1
}
