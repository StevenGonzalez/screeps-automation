/**
 * Automation Defense
 *
 * Intelligent defense automation and threat response.
 * Analyzes threats, coordinates towers, manages defenses, and responds to attacks.
 */

/// <reference types="@types/screeps" />

import { RoomIntelligence } from "./intelligence";

export interface DefensePlan {
  threatAssessment: {
    currentThreat: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    primaryTargets: DefenseTarget[];
    secondaryTargets: DefenseTarget[];
    recommendedResponse: "MONITOR" | "DEFEND" | "COUNTERATTACK" | "EVACUATE";
  };
  towerActions: {
    towerId: string;
    action: "ATTACK" | "HEAL" | "REPAIR" | "IDLE";
    targetId?: string;
    priority: number;
    reason: string;
  }[];
  creepOrders: {
    role: string;
    count: number;
    bodyParts: BodyPartConstant[];
    priority: number;
    mission: string;
  }[];
  defenseStructures: {
    ramparts: DefenseStructureOrder[];
    walls: DefenseStructureOrder[];
    towers: DefenseStructureOrder[];
  };
  alerts: {
    level: "INFO" | "WARNING" | "CRITICAL";
    message: string;
    action?: string;
  }[];
}

export interface DefenseTarget {
  id: string;
  pos: RoomPosition;
  threatLevel: number;
  bodyParts: BodyPartConstant[];
  estimatedDamage: number;
  priority: number;
  distanceToSpawn: number;
  attackCapability: number;
  healCapability: number;
}

export interface DefenseStructureOrder {
  pos: RoomPosition;
  priority: number;
  reason: string;
  targetHits: number;
}

/**
 * Generate comprehensive defense plan based on room intelligence
 */
export function planDefense(intel: RoomIntelligence): DefensePlan {
  const threatAssessment = assessThreats(intel);
  const towerActions = coordinateTowers(intel, threatAssessment);
  const creepOrders = planDefenseCreeps(intel, threatAssessment);
  const defenseStructures = planDefenseStructures(intel, threatAssessment);
  const alerts = generateAlerts(intel, threatAssessment);

  return {
    threatAssessment,
    towerActions,
    creepOrders,
    defenseStructures,
    alerts,
  };
}

/**
 * Assess current threats and determine response level
 */
function assessThreats(
  intel: RoomIntelligence
): DefensePlan["threatAssessment"] {
  const hostiles = intel.military.hostiles;
  const room = Game.rooms[intel.basic.name];

  if (hostiles.length === 0) {
    return {
      currentThreat: "NONE",
      primaryTargets: [],
      secondaryTargets: [],
      recommendedResponse: "MONITOR",
    };
  }

  // Convert hostiles to defense targets
  const targets: DefenseTarget[] = hostiles.map((hostile) => {
    const spawn = room?.find(FIND_MY_SPAWNS)[0];
    // Reconstruct RoomPosition from cached data (pos may be a plain object from Memory)
    const pos = new RoomPosition(
      hostile.pos.x,
      hostile.pos.y,
      hostile.pos.roomName
    );
    const distanceToSpawn = spawn ? pos.getRangeTo(spawn) : 50;

    return {
      id: hostile.id,
      pos: pos,
      threatLevel: hostile.threatLevel,
      bodyParts: hostile.bodyParts,
      estimatedDamage: calculateEstimatedDamage(hostile.bodyParts),
      priority: calculateTargetPriority(hostile, distanceToSpawn),
      distanceToSpawn,
      attackCapability: calculateAttackCapability(hostile.bodyParts),
      healCapability: calculateHealCapability(hostile.bodyParts),
    };
  });

  // Sort by priority (highest first)
  targets.sort((a, b) => b.priority - a.priority);

  // Determine threat level
  const maxThreatLevel = Math.max(...targets.map((t) => t.threatLevel));
  const totalDamage = targets.reduce((sum, t) => sum + t.estimatedDamage, 0);

  let currentThreat: DefensePlan["threatAssessment"]["currentThreat"] = "LOW";
  let recommendedResponse: DefensePlan["threatAssessment"]["recommendedResponse"] =
    "DEFEND";

  if (maxThreatLevel >= 80 || totalDamage > 1000) {
    currentThreat = "CRITICAL";
    recommendedResponse = "COUNTERATTACK";
  } else if (maxThreatLevel >= 60 || totalDamage > 500) {
    currentThreat = "HIGH";
    recommendedResponse = "DEFEND";
  } else if (maxThreatLevel >= 40 || totalDamage > 200) {
    currentThreat = "MEDIUM";
    recommendedResponse = "DEFEND";
  } else if (maxThreatLevel >= 20) {
    currentThreat = "LOW";
    recommendedResponse = "MONITOR";
  }

  // Split into primary and secondary targets
  const primaryTargets = targets.filter((t) => t.priority >= 70);
  const secondaryTargets = targets.filter((t) => t.priority < 70);

  return {
    currentThreat,
    primaryTargets,
    secondaryTargets,
    recommendedResponse,
  };
}

/**
 * Coordinate tower actions for optimal defense
 */
function coordinateTowers(
  intel: RoomIntelligence,
  threat: DefensePlan["threatAssessment"]
): DefensePlan["towerActions"] {
  const room = Game.rooms[intel.basic.name];
  const towers =
    (room?.find(FIND_MY_STRUCTURES, {
      filter: { structureType: STRUCTURE_TOWER },
    }) as StructureTower[]) || [];

  const actions: DefensePlan["towerActions"] = [];

  if (towers.length === 0) return actions;

  // If no threats, focus on maintenance
  if (threat.currentThreat === "NONE") {
    return assignMaintenanceTasks(towers, room);
  }

  // Assign towers to targets
  const allTargets = [...threat.primaryTargets, ...threat.secondaryTargets];

  towers.forEach((tower) => {
    if (tower.store.energy < 50) {
      actions.push({
        towerId: tower.id,
        action: "IDLE",
        priority: 0,
        reason: "Insufficient energy",
      });
      return;
    }

    // Find best target for this tower
    const bestTarget = findBestTargetForTower(tower, allTargets);

    if (bestTarget) {
      const targetCreep = Game.getObjectById<Creep>(bestTarget.id);
      if (targetCreep) {
        actions.push({
          towerId: tower.id,
          action: "ATTACK",
          targetId: bestTarget.id,
          priority: bestTarget.priority,
          reason: `Attacking ${targetCreep.owner.username}'s ${targetCreep.body.length}-part creep`,
        });

        // Remove target from available targets for other towers
        const targetIndex = allTargets.indexOf(bestTarget);
        if (targetIndex > -1) {
          allTargets.splice(targetIndex, 1);
        }
      }
    } else {
      // No attack targets, check for healing/repair
      const healAction = findHealTarget(tower, room);
      if (healAction) {
        actions.push(healAction);
      } else {
        const repairAction = findRepairTarget(tower, room);
        if (repairAction) {
          actions.push(repairAction);
        } else {
          actions.push({
            towerId: tower.id,
            action: "IDLE",
            priority: 0,
            reason: "No valid targets",
          });
        }
      }
    }
  });

  // Sort by priority
  actions.sort((a, b) => b.priority - a.priority);

  return actions;
}

/**
 * Plan defensive creep spawning
 */
function planDefenseCreeps(
  intel: RoomIntelligence,
  threat: DefensePlan["threatAssessment"]
): DefensePlan["creepOrders"] {
  const orders: DefensePlan["creepOrders"] = [];

  if (threat.currentThreat === "NONE" || threat.currentThreat === "LOW") {
    return orders; // No defensive creeps needed
  }

  const energyAvailable = intel.economy.energyCapacity;
  const rcl = intel.basic.rcl;

  // Determine what type of defenders we need
  const totalAttackCapability = threat.primaryTargets.reduce(
    (sum, t) => sum + t.attackCapability,
    0
  );
  const totalHealCapability = threat.primaryTargets.reduce(
    (sum, t) => sum + t.healCapability,
    0
  );

  if (threat.currentThreat === "CRITICAL" || threat.currentThreat === "HIGH") {
    // Spawn combat creeps
    if (totalAttackCapability > 500) {
      // Heavy attackers needed
      orders.push({
        role: "defender_heavy",
        count: Math.min(3, Math.ceil(totalAttackCapability / 300)),
        bodyParts: generateDefenderBody("heavy", energyAvailable),
        priority: 95,
        mission: "Eliminate high-threat attackers",
      });
    } else {
      // Standard defenders
      orders.push({
        role: "defender",
        count: Math.min(2, Math.ceil(totalAttackCapability / 200)),
        bodyParts: generateDefenderBody("standard", energyAvailable),
        priority: 85,
        mission: "Eliminate medium-threat attackers",
      });
    }

    if (totalHealCapability > 200) {
      // Anti-healer specialists
      orders.push({
        role: "defender_anti_heal",
        count: 1,
        bodyParts: generateDefenderBody("anti_heal", energyAvailable),
        priority: 90,
        mission: "Target enemy healers",
      });
    }
  }

  if (threat.currentThreat === "MEDIUM") {
    // Light defense
    orders.push({
      role: "defender_light",
      count: 1,
      bodyParts: generateDefenderBody("light", energyAvailable),
      priority: 60,
      mission: "Handle light threats",
    });
  }

  return orders;
}

/**
 * Plan defensive structure improvements
 */
function planDefenseStructures(
  intel: RoomIntelligence,
  threat: DefensePlan["threatAssessment"]
): DefensePlan["defenseStructures"] {
  const room = Game.rooms[intel.basic.name];
  const spawns = room?.find(FIND_MY_SPAWNS) || [];
  const towers =
    room?.find(FIND_MY_STRUCTURES, {
      filter: { structureType: STRUCTURE_TOWER },
    }) || [];

  const ramparts: DefenseStructureOrder[] = [];
  const walls: DefenseStructureOrder[] = [];
  const towerOrders: DefenseStructureOrder[] = [];

  if (threat.currentThreat === "NONE") {
    return { ramparts, walls, towers: towerOrders };
  }

  // Protect critical structures with ramparts
  spawns.forEach((spawn) => {
    const existingRampart = spawn.pos
      .lookFor(LOOK_STRUCTURES)
      .find((s) => s.structureType === STRUCTURE_RAMPART) as StructureRampart;

    if (!existingRampart) {
      ramparts.push({
        pos: spawn.pos,
        priority: 95,
        reason: "Protect spawn from attacks",
        targetHits: 10000,
      });
    } else if (existingRampart.hits < 5000) {
      ramparts.push({
        pos: spawn.pos,
        priority: 80,
        reason: "Reinforce damaged spawn rampart",
        targetHits: 15000,
      });
    }
  });

  towers.forEach((tower) => {
    const existingRampart = tower.pos
      .lookFor(LOOK_STRUCTURES)
      .find((s) => s.structureType === STRUCTURE_RAMPART) as StructureRampart;

    if (!existingRampart && threat.currentThreat !== "LOW") {
      ramparts.push({
        pos: tower.pos,
        priority: 85,
        reason: "Protect tower from attacks",
        targetHits: 8000,
      });
    } else if (existingRampart && existingRampart.hits < 3000) {
      ramparts.push({
        pos: tower.pos,
        priority: 70,
        reason: "Reinforce damaged tower rampart",
        targetHits: 10000,
      });
    }
  });

  // Add perimeter walls for high threats
  if (threat.currentThreat === "HIGH" || threat.currentThreat === "CRITICAL") {
    const perimeterPositions = findPerimeterPositions(room, spawns);
    perimeterPositions.forEach((pos) => {
      walls.push({
        pos,
        priority: 40,
        reason: "Perimeter defense wall",
        targetHits: 5000,
      });
    });
  }

  return { ramparts, walls, towers: towerOrders };
}

/**
 * Generate defense alerts
 */
function generateAlerts(
  intel: RoomIntelligence,
  threat: DefensePlan["threatAssessment"]
): DefensePlan["alerts"] {
  const alerts: DefensePlan["alerts"] = [];

  switch (threat.currentThreat) {
    case "CRITICAL":
      alerts.push({
        level: "CRITICAL",
        message: `CRITICAL THREAT: ${threat.primaryTargets.length} high-level attackers detected!`,
        action: "Spawn emergency defenders and activate all defenses",
      });
      break;

    case "HIGH":
      alerts.push({
        level: "WARNING",
        message: `HIGH THREAT: ${threat.primaryTargets.length} attackers approaching`,
        action: "Prepare defensive measures and spawn defenders",
      });
      break;

    case "MEDIUM":
      alerts.push({
        level: "WARNING",
        message: `MEDIUM THREAT: ${
          threat.primaryTargets.length + threat.secondaryTargets.length
        } hostiles detected`,
        action: "Monitor situation and prepare light defenses",
      });
      break;

    case "LOW":
      alerts.push({
        level: "INFO",
        message: `LOW THREAT: ${
          threat.primaryTargets.length + threat.secondaryTargets.length
        } weak hostiles detected`,
        action: "Monitor with towers, no emergency response needed",
      });
      break;
  }

  // Energy warnings for towers
  const room = Game.rooms[intel.basic.name];
  const towers = room?.find(FIND_MY_STRUCTURES, {
    filter: { structureType: STRUCTURE_TOWER },
  }) as StructureTower[];
  const lowEnergyTowers =
    towers?.filter((t) => t.store.energy < 200).length || 0;

  if (lowEnergyTowers > 0 && threat.currentThreat !== "NONE") {
    alerts.push({
      level: "WARNING",
      message: `${lowEnergyTowers} tower(s) running low on energy during threat`,
      action: "Prioritize tower energy supply",
    });
  }

  return alerts;
}

// Helper functions

function calculateEstimatedDamage(bodyParts: BodyPartConstant[]): number {
  return (
    bodyParts.filter((part) => part === ATTACK).length * 30 +
    bodyParts.filter((part) => part === RANGED_ATTACK).length * 10
  );
}

function calculateAttackCapability(bodyParts: BodyPartConstant[]): number {
  return (
    bodyParts.filter((part) => part === ATTACK).length * 30 +
    bodyParts.filter((part) => part === RANGED_ATTACK).length * 10
  );
}

function calculateHealCapability(bodyParts: BodyPartConstant[]): number {
  return bodyParts.filter((part) => part === HEAL).length * 12;
}

function calculateTargetPriority(
  hostile: RoomIntelligence["military"]["hostiles"][0],
  distanceToSpawn: number
): number {
  let priority = hostile.threatLevel;

  // Closer threats are higher priority
  priority += Math.max(0, 50 - distanceToSpawn * 2);

  // Attackers are higher priority than scouts
  const attackParts = hostile.bodyParts.filter(
    (part) => part === ATTACK || part === RANGED_ATTACK
  ).length;
  priority += attackParts * 5;

  // Healers are high priority targets
  const healParts = hostile.bodyParts.filter((part) => part === HEAL).length;
  priority += healParts * 10;

  return Math.min(100, priority);
}

function findBestTargetForTower(
  tower: StructureTower,
  targets: DefenseTarget[]
): DefenseTarget | null {
  if (targets.length === 0) return null;

  // Filter out harassment/kiting targets (low commitment, quick exit strategy)
  const viableTargets = targets.filter((target) => {
    const creep = Game.getObjectById<Creep>(target.id);
    if (!creep) return false;

    // Check if this is a harassment pattern:
    // 1. Creep has significant heal parts (can outheal tower damage)
    const healParts = creep.body.filter((p) => p.type === HEAL).length;
    const toughParts = creep.body.filter((p) => p.type === TOUGH).length;
    const moveParts = creep.body.filter((p) => p.type === MOVE).length;
    const attackParts = creep.body.filter(
      (p) => p.type === ATTACK || p.type === RANGED_ATTACK
    ).length;

    // 2. High mobility (can escape quickly)
    const isFastCreep = moveParts >= creep.body.length * 0.4;

    // 3. Near edge of room (easy escape)
    const nearEdge =
      creep.pos.x <= 5 ||
      creep.pos.x >= 44 ||
      creep.pos.y <= 5 ||
      creep.pos.y >= 44;

    // 4. Low attack capability relative to healing
    const isHealerKiter =
      healParts > 0 && attackParts <= 3 && healParts >= attackParts * 0.75;

    // Detect harassment: fast healer near edge with low attack capability
    if (healParts > 0 && (isHealerKiter || isFastCreep) && nearEdge) {
      // This is likely a kiting harasser - only target if we can kill it quickly
      const distance = tower.pos.getRangeTo(creep.pos);
      // Tower damage formula: 600 at range <=5, linear falloff to 150 at range 20+
      let towerDamage = 600;
      if (distance > 5) {
        towerDamage = Math.max(150, 600 - (distance - 5) * 30);
      }
      const healRate = healParts * 12; // HEAL parts heal 12/tick
      const netDamage = towerDamage - healRate;

      // If we can't overcome heal rate significantly, don't waste energy
      if (netDamage <= 200) {
        // Need at least 200 net damage - otherwise takes too many hits
        if (Game.time % 100 === 0) {
          console.log(
            `🚫 Ignoring kiter ${
              creep.owner.username
            }: ${healParts} HEAL vs ${Math.round(
              towerDamage
            )} dmg (net: ${Math.round(netDamage)})`
          );
        }
        return false;
      }
    }

    return true;
  });

  // Score targets based on tower position and capabilities
  const scoredTargets = viableTargets.map((target) => {
    const distance = tower.pos.getRangeTo(target.pos);
    const effectiveness = Math.max(0.3, 1 - (distance - 5) * 0.05); // Tower effectiveness by distance
    const score = target.priority * effectiveness;

    return { target, score, distance };
  });

  // Sort by score (highest first)
  scoredTargets.sort((a, b) => b.score - a.score);

  return scoredTargets[0]?.target || null;
}

function assignMaintenanceTasks(
  towers: StructureTower[],
  room: Room | undefined
): DefensePlan["towerActions"] {
  const actions: DefensePlan["towerActions"] = [];

  if (!room) return actions;

  towers.forEach((tower) => {
    if (tower.store.energy < 100) {
      actions.push({
        towerId: tower.id,
        action: "IDLE",
        priority: 0,
        reason: "Low energy - conserving for defense",
      });
      return;
    }

    // Look for damaged creeps first
    const damagedCreeps = room.find(FIND_MY_CREEPS, {
      filter: (creep: Creep) =>
        creep.hits < creep.hitsMax && tower.pos.getRangeTo(creep) <= 20,
    });

    if (damagedCreeps.length > 0) {
      const target = damagedCreeps.sort((a, b) => a.hits - b.hits)[0];
      actions.push({
        towerId: tower.id,
        action: "HEAL",
        targetId: target.id,
        priority: 60,
        reason: `Healing ${target.memory.role} creep`,
      });
      return;
    }

    // No structure REPAIR orders here; centralized auto-repair handles structures

    actions.push({
      towerId: tower.id,
      action: "IDLE",
      priority: 0,
      reason: "No maintenance needed",
    });
  });

  return actions;
}

function findHealTarget(
  tower: StructureTower,
  room: Room | undefined
): DefensePlan["towerActions"][0] | null {
  if (!room || tower.store.energy < 50) return null;

  const damagedCreeps = room.find(FIND_MY_CREEPS, {
    filter: (creep: Creep) =>
      creep.hits < creep.hitsMax && tower.pos.getRangeTo(creep) <= 20,
  });

  if (damagedCreeps.length > 0) {
    const target = damagedCreeps.sort((a, b) => a.hits - b.hits)[0];
    return {
      towerId: tower.id,
      action: "HEAL",
      targetId: target.id,
      priority: 70,
      reason: `Emergency heal for ${target.memory.role}`,
    };
  }

  return null;
}

function findRepairTarget(
  tower: StructureTower,
  room: Room | undefined
): DefensePlan["towerActions"][0] | null {
  // Disable REPAIR via defense plan; structure repairs are coordinated in performAutoRepair
  return null;
}

function generateDefenderBody(
  type: "light" | "standard" | "heavy" | "anti_heal",
  energyAvailable: number
): BodyPartConstant[] {
  const maxCost = Math.min(energyAvailable, 3000);

  switch (type) {
    case "light":
      // Fast, cheap defender for scouts
      if (maxCost >= 650) {
        return [ATTACK, ATTACK, MOVE, MOVE, MOVE, TOUGH, TOUGH];
      } else {
        return [ATTACK, MOVE, MOVE, TOUGH];
      }

    case "standard":
      // Balanced attacker
      if (maxCost >= 1000) {
        return [
          ATTACK,
          ATTACK,
          ATTACK,
          ATTACK,
          MOVE,
          MOVE,
          MOVE,
          MOVE,
          TOUGH,
          TOUGH,
        ];
      } else if (maxCost >= 650) {
        return [ATTACK, ATTACK, ATTACK, MOVE, MOVE, TOUGH];
      } else {
        return [ATTACK, ATTACK, MOVE, TOUGH];
      }

    case "heavy":
      // Maximum firepower
      const attackParts = Math.min(Math.floor(maxCost / 130), 12); // ATTACK + MOVE = 130
      const body: BodyPartConstant[] = [];
      for (let i = 0; i < attackParts; i++) body.push(ATTACK);
      for (let i = 0; i < attackParts; i++) body.push(MOVE);
      if (maxCost - attackParts * 130 >= 10) body.push(TOUGH);
      return body;

    case "anti_heal":
      // Ranged attacker for targeting healers
      if (maxCost >= 800) {
        return [
          RANGED_ATTACK,
          RANGED_ATTACK,
          RANGED_ATTACK,
          MOVE,
          MOVE,
          MOVE,
          TOUGH,
        ];
      } else {
        return [RANGED_ATTACK, RANGED_ATTACK, MOVE, MOVE];
      }

    default:
      return [ATTACK, MOVE, TOUGH];
  }
}

function findPerimeterPositions(
  room: Room | undefined,
  spawns: StructureSpawn[]
): RoomPosition[] {
  if (!room || spawns.length === 0) return [];

  // Simple perimeter - positions around spawn at distance 4-6
  const positions: RoomPosition[] = [];
  const spawn = spawns[0];

  for (let radius = 4; radius <= 6; radius++) {
    for (let angle = 0; angle < 360; angle += 45) {
      const radians = (angle * Math.PI) / 180;
      const x = Math.round(spawn.pos.x + radius * Math.cos(radians));
      const y = Math.round(spawn.pos.y + radius * Math.sin(radians));

      if (x >= 2 && x <= 47 && y >= 2 && y <= 47) {
        const pos = new RoomPosition(x, y, room.name);
        const terrain = room.getTerrain();
        if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
          positions.push(pos);
        }
      }
    }
  }

  return positions.slice(0, 20); // Limit to reasonable number
}
