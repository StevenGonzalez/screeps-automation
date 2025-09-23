/**
 * Room Orchestration
 *
 * Orchestrates all room-level operations including intelligence gathering,
 * plan execution, and resource management for individual rooms.
 */

/// <reference types="@types/screeps" />

import { analyzeRoom } from "./room.intelligence";
import { planEconomy } from "./room.economy";
import { planConstruction } from "./room.construction";
import { planDefense } from "./room.defense";
import { manageRoomSpawning } from "./room.spawning";
import { manageRoomStructures } from "./room.structures";
import { getRoomMemory } from "./global.memory";
import { CreepPersonality } from "./creep.personality";
import { runHarvester } from "./creep.harvester";
import { runHauler } from "./creep.hauler";
import { runUpgrader } from "./creep.upgrader";
import { runBuilder } from "./creep.builder";
import { runDefender } from "./creep.defender";
import { runRepairer } from "./creep.repairer";
import { runWorker } from "./creep.worker";

/**
 * Process a single room through all automation systems
 */
export function processRoom(roomName: string): void {
  const room = Game.rooms[roomName];
  if (!room) return;

  // Skip rooms we don't control
  if (!room.controller || !room.controller.my) {
    return;
  }

  try {
    // 1. INTELLIGENCE GATHERING
    const intel = gatherRoomIntelligence(room);

    // 2. PLANNING PHASE
    const plans = createRoomPlans(room, intel);

    // 3. EXECUTION PHASE
    executeRoomPlans(room, plans, intel);

    // 4. PERFORMANCE MONITORING
    monitorRoomPerformance(room, intel, plans);
  } catch (error) {
    console.log(`❌ Error processing room ${roomName}: ${error}`);
  }
}

/**
 * Gather comprehensive intelligence about the room
 */
function gatherRoomIntelligence(room: Room): any {
  const roomMemory = getRoomMemory(room.name);

  // Update last scanned time
  roomMemory.lastScanned = Game.time;

  // Gather fresh intelligence
  const intel = analyzeRoom(room);

  // Store key metrics in room memory for historical analysis
  roomMemory.economy = roomMemory.economy || {};
  roomMemory.economy.lastEnergyAvailable = intel.economy.energyAvailable;
  roomMemory.economy.lastEnergyCapacity = intel.economy.energyCapacity;
  roomMemory.economy.lastCreepCount = intel.creeps.total;

  return intel;
}

/**
 * Create all automation plans for the room
 */
function createRoomPlans(room: Room, intel: any): any {
  const roomMemory = getRoomMemory(room.name);

  // Create economic plan
  const economicPlan = planEconomy(intel);
  roomMemory.economy.currentPlan = {
    tick: Game.time,
    composition: economicPlan.creepComposition,
  };

  // Create construction plan
  const constructionPlan = planConstruction(intel);
  roomMemory.construction = roomMemory.construction || {};
  roomMemory.construction.activeProjects =
    (constructionPlan.recommendations?.immediate?.length || 0) +
    (constructionPlan.recommendations?.shortTerm?.length || 0);

  // Create defense plan
  const defensePlan = planDefense(intel);
  roomMemory.defense = roomMemory.defense || {};
  roomMemory.defense.threatLevel = defensePlan.alerts?.length || 0;
  roomMemory.defense.lastThreatScan = Game.time;

  return {
    economic: economicPlan,
    construction: constructionPlan,
    defense: defensePlan,
  };
}

/**
 * Execute all room plans
 */
function executeRoomPlans(room: Room, plans: any, intel: any): void {
  // 1. SPAWNING - Highest priority
  manageRoomSpawning(
    room,
    plans.economic,
    plans.defense,
    plans.construction,
    intel
  );

  // 2. STRUCTURE AUTOMATION - Defensive actions
  manageRoomStructures(room, plans.defense, plans.economic);

  // 3. CREEP MANAGEMENT - Role-based automation
  manageRoomCreeps(room, plans, intel);

  // 4. LOGISTICS - Resource movement and optimization
  manageRoomLogistics(room, plans, intel);
}

/**
 * Manage all creeps in the room with improved role assignment
 */
function manageRoomCreeps(room: Room, plans: any, intel: any): void {
  const creeps = room.find(FIND_MY_CREEPS);

  creeps.forEach((creep) => {
    const role = creep.memory.role || "worker";

    try {
      // Add contextual personality every 20-50 ticks randomly
      if (Game.time % (20 + Math.floor(Math.random() * 30)) === 0) {
        CreepPersonality.contextualSpeak(creep);
      }

      // Enhanced role-based automation
      switch (role) {
        case "harvester":
          runHarvester(creep, intel);
          break;
        case "hauler":
          runHauler(creep, intel);
          break;
        case "upgrader":
          runUpgrader(creep, intel);
          break;
        case "builder":
          runBuilder(creep, plans.construction, intel);
          break;
        case "defender":
          runDefender(creep, plans.defense, intel);
          break;
        case "repairer":
          runRepairer(creep, intel);
          break;
        default:
          // Fallback to basic worker behavior
          runWorker(creep, intel);
          break;
      }
    } catch (error) {
      console.log(`⚠️ Error managing creep ${creep.name}: ${error}`);
    }
  });
}

/**
 * Enhanced harvester role with source assignment
 */

/**
 * Manage room logistics and resource optimization
 */
function manageRoomLogistics(room: Room, plans: any, intel: any): void {
  // Energy balance monitoring
  const energyBalance = calculateEnergyBalance(room, intel);

  if (energyBalance.deficit > 1000) {
    console.log(`⚠️ ${room.name}: Energy deficit of ${energyBalance.deficit}`);
  }

  if (energyBalance.surplus > 2000) {
    console.log(`💰 ${room.name}: Energy surplus of ${energyBalance.surplus}`);
  }
}

/**
 * Calculate room energy balance
 */
function calculateEnergyBalance(room: Room, intel: any): any {
  const income = intel.economy?.energyIncome || 0;
  const consumption = intel.economy?.energyConsumption || 0;

  return {
    income,
    consumption,
    deficit: Math.max(0, consumption - income),
    surplus: Math.max(0, income - consumption),
  };
}

/**
 * Monitor room performance and log key metrics
 */
function monitorRoomPerformance(room: Room, intel: any, plans: any): void {
  // Log performance metrics occasionally
  if (Game.time % 100 === 0) {
    const energyPercent = Math.round(
      (intel.energy.available / intel.energy.capacity) * 100
    );
    console.log(
      `📊 ${room.name}: RCL ${room.controller?.level}, Energy ${energyPercent}%, Creeps ${intel.creeps.total}`
    );
  }
}

/**
 * Get room status summary for global operations
 */
export function getRoomStatus(roomName: string): any {
  const room = Game.rooms[roomName];
  if (!room || !room.controller?.my) {
    return null;
  }

  const intel = analyzeRoom(room);
  const roomMemory = getRoomMemory(roomName);

  return {
    name: roomName,
    rcl: room.controller.level,
    energy: {
      available: intel.economy.energyAvailable,
      capacity: intel.economy.energyCapacity,
      percent: Math.round(
        (intel.economy.energyAvailable / intel.economy.energyCapacity) * 100
      ),
    },
    creeps: intel.creeps.total,
    threats: intel.military.hostiles.length,
    constructionSites: room.find(FIND_CONSTRUCTION_SITES).length,
    lastProcessed: Game.time,
    lastThreatScan: roomMemory.defense?.lastThreatScan || 0,
  };
}
