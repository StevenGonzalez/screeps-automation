/**
 * Automation Economy
 *
 * Pure functions for economic decision making and resource optimization.
 * Determines optimal creep counts, energy allocation, and economic strategies.
 */

/// <reference types="@types/screeps" />

import { RoomIntelligence } from "./intelligence";
import { getBodyForRole } from "./spawning";

export interface EconomicPlan {
  creepComposition: {
    harvesters: number;
    haulers: number;
    upgraders: number;
    builders: number;
    total: number;
  };
  energyAllocation: {
    spawning: number;
    upgrading: number;
    building: number;
    storage: number;
    reserves: number;
  };
  priorities: {
    primary: string;
    secondary: string[];
    deferred: string[];
  };
  strategy: "BOOTSTRAP" | "GROWTH" | "OPTIMIZATION" | "EXPANSION" | "DEFENSE";
  metrics: {
    expectedIncome: number;
    expectedExpenses: number;
    sustainabilityRating: number;
    growthPotential: number;
  };
}

/**
 * Generate optimal economic plan based on room intelligence
 */
export function planEconomy(intel: RoomIntelligence): EconomicPlan {
  const strategy = determineEconomicStrategy(intel);

  return {
    creepComposition: calculateOptimalCreeps(intel, strategy),
    energyAllocation: calculateEnergyAllocation(intel, strategy),
    priorities: determinePriorities(intel, strategy),
    strategy,
    metrics: calculateEconomicMetrics(intel, strategy),
  };
}

/**
 * Determine the optimal economic strategy for current room state
 */
function determineEconomicStrategy(
  intel: RoomIntelligence
): EconomicPlan["strategy"] {
  const { basic, economy, military, creeps } = intel;

  // EMERGENCY MODE: Critical energy shortage - survival mode
  // Only applies to established rooms with storage (RCL 4+)
  if (basic.rcl >= 4 && economy.energyStored < 20000 && economy.netFlow < 0) {
    return "DEFENSE"; // Reuse DEFENSE strategy for minimal creeps
  }

  // Defense takes priority if under threat
  if (military.hostiles.length > 0 && military.safetyScore < 50) {
    return "DEFENSE";
  }

  // Bootstrap if very early game
  if (basic.rcl <= 2 || creeps.total < 3) {
    return "BOOTSTRAP";
  }

  // Expansion if mature and wealthy
  if (basic.rcl >= 6 && economy.energyStored > 100000 && economy.netFlow > 0) {
    return "EXPANSION";
  }

  // Optimization if stable but could improve
  if (basic.rcl >= 4 && economy.efficiency > 0.7 && economy.netFlow > 0) {
    return "OPTIMIZATION";
  }

  // Growth is default for active development
  return "GROWTH";
}

/**
 * Calculate dynamic upgrader count based on economic surplus
 * Prevents over-spending energy on upgrading when resources are needed elsewhere
 */
function calculateDynamicUpgraders(intel: RoomIntelligence): number {
  const { economy, basic } = intel;
  const rcl = basic.rcl;
  const energyStored = economy.energyStored;
  const netFlow = economy.netFlow;
  const phase = basic.phase;

  // Base upgraders: always maintain at least 1
  let upgraders = 1;

  // Calculate based on stored energy thresholds
  // Only apply crisis mode if storage exists (RCL 4+)
  if (rcl >= 4 && energyStored < 20000) {
    // CRISIS MODE: Absolute minimum upgrading
    upgraders = netFlow < -3 ? 1 : 1;
  } else if (energyStored < 50000) {
    // Low energy - conservative upgrading (1-2 upgraders)
    upgraders = netFlow > 0 ? 2 : 1;
  } else if (energyStored < 150000) {
    // Moderate energy - balanced upgrading (2-3 upgraders)
    upgraders = Math.min(3, 1 + Math.floor(netFlow / 5));
  } else if (energyStored < 300000) {
    // Good energy reserves - increased upgrading (3-5 upgraders)
    upgraders = Math.min(5, 2 + Math.floor(netFlow / 5));
  } else {
    // Abundant energy - maximize upgrading (5-8 upgraders)
    upgraders = Math.min(8, 3 + Math.floor(energyStored / 50000));
  }

  // Cap based on RCL (don't over-upgrade early on)
  const rclCap = Math.max(2, Math.floor(rcl * 1.5));
  upgraders = Math.min(upgraders, rclCap);

  // Reduce upgraders if net flow is negative
  if (netFlow < -5) {
    upgraders = Math.max(1, Math.floor(upgraders / 2));
  }

  // At RCL 8, only minimal upgrading needed (just keep controller alive)
  if (rcl >= 8) {
    upgraders = 1;
  }

  return upgraders;
}

/**
 * Calculate optimal creep composition for the strategy
 */
function calculateOptimalCreeps(
  intel: RoomIntelligence,
  strategy: EconomicPlan["strategy"]
): EconomicPlan["creepComposition"] {
  const { basic, economy, infrastructure, creeps } = intel;
  const rcl = basic.rcl;
  const sourceCount = economy.sources.length;

  let harvesters = 0;
  let haulers = 0;
  let upgraders = 0;
  let builders = 0;

  switch (strategy) {
    case "BOOTSTRAP":
      // Minimal viable economy - one harvester per source, upgraders, builders as needed
      harvesters = Math.max(sourceCount, 2);
      // Keep minimal upgraders during bootstrap
      upgraders = 1;
      builders =
        infrastructure.constructionSites.length > 0
          ? Math.max(1, Math.floor(rcl / 2))
          : 0;
      haulers = rcl >= 2 ? 1 : 0;
      break;

    case "GROWTH":
      // Balanced growth - efficient harvesting with strong building
      harvesters = sourceCount * (rcl >= 4 ? 1 : 2); // Fewer harvesters with containers
      haulers = rcl >= 2 ? Math.min(sourceCount, 3) : 0;
      // Dynamic upgraders based on net energy flow and stored energy
      upgraders = calculateDynamicUpgraders(intel);
      builders =
        infrastructure.constructionSites.length > 0
          ? Math.max(2, Math.floor(rcl / 2))
          : 1;
      break;

    case "OPTIMIZATION":
      // Fine-tuned for efficiency
      harvesters = sourceCount; // One per source with optimal bodies
      haulers = Math.max(2, Math.floor(sourceCount * 1.5));
      // Dynamic upgraders based on actual economic surplus
      upgraders = calculateDynamicUpgraders(intel);
      builders = infrastructure.constructionSites.length > 2 ? 2 : 1;
      break;

    case "EXPANSION":
      // Prepare for new room claiming
      harvesters = sourceCount;
      haulers = 2;
      upgraders = 1; // Minimal upgrading
      builders = 1;
      // Note: This would also plan for claimer/pioneer creeps
      break;

    case "DEFENSE":
      // Emergency military focus
      harvesters = Math.min(sourceCount, 2); // Minimal economy
      haulers = 1;
      upgraders = 0; // No upgrading during crisis
      builders = 0; // No building during crisis
      // Note: Would also plan for military creeps
      break;
  }

  const total = harvesters + haulers + upgraders + builders;

  return { harvesters, haulers, upgraders, builders, total };
}

/**
 * Determine how to allocate energy resources
 */
function calculateEnergyAllocation(
  intel: RoomIntelligence,
  strategy: EconomicPlan["strategy"]
): EconomicPlan["energyAllocation"] {
  const totalEnergy = intel.economy.energyAvailable;

  let spawning = 0;
  let upgrading = 0;
  let building = 0;
  let storage = 0;
  let reserves = 0;

  switch (strategy) {
    case "BOOTSTRAP":
      spawning = Math.min(totalEnergy * 0.6, 300);
      upgrading = Math.min(totalEnergy * 0.3, 200);
      building = totalEnergy - spawning - upgrading;
      break;

    case "GROWTH":
      spawning = Math.min(totalEnergy * 0.4, 800);
      building = Math.min(totalEnergy * 0.4, 500);
      upgrading = Math.min(totalEnergy * 0.2, 300);
      break;

    case "OPTIMIZATION":
      spawning = Math.min(totalEnergy * 0.3, 1000);
      upgrading = Math.min(totalEnergy * 0.4, 1000);
      building = Math.min(totalEnergy * 0.2, 400);
      reserves = totalEnergy - spawning - upgrading - building;
      break;

    case "EXPANSION":
      spawning = Math.min(totalEnergy * 0.5, 1200); // Big creeps for new room
      storage = Math.min(totalEnergy * 0.3, 800); // Save energy for expansion
      upgrading = Math.min(totalEnergy * 0.1, 200); // Minimal upgrading
      building = totalEnergy - spawning - storage - upgrading;
      break;

    case "DEFENSE":
      spawning = Math.min(totalEnergy * 0.8, 1500); // Priority on military creeps
      upgrading = 0;
      building = 0;
      reserves = totalEnergy - spawning;
      break;
  }

  return { spawning, upgrading, building, storage, reserves };
}

/**
 * Determine task priorities for the economic strategy
 */
function determinePriorities(
  intel: RoomIntelligence,
  strategy: EconomicPlan["strategy"]
): EconomicPlan["priorities"] {
  const { basic, infrastructure, military } = intel;

  let primary = "";
  let secondary: string[] = [];
  let deferred: string[] = [];

  switch (strategy) {
    case "BOOTSTRAP":
      primary = "spawn_harvesters";
      secondary = ["build_extensions", "upgrade_controller"];
      deferred = ["roads", "walls", "labs"];
      break;

    case "GROWTH":
      primary = "balanced_growth";
      secondary = ["infrastructure", "source_containers", "tower_defense"];
      deferred = ["labs", "terminal", "power"];
      break;

    case "OPTIMIZATION":
      primary = "efficiency_improvements";
      secondary = ["road_network", "link_network", "lab_production"];
      deferred = ["decorations", "excess_walls"];
      break;

    case "EXPANSION":
      primary = "prepare_expansion";
      secondary = ["stockpile_energy", "scout_rooms", "claim_creeps"];
      deferred = ["local_upgrades", "non_essential_buildings"];
      break;

    case "DEFENSE":
      primary = "eliminate_threats";
      secondary = ["spawn_military", "repair_defenses", "secure_resources"];
      deferred = ["everything_else"];
      break;
  }

  return { primary, secondary, deferred };
}

/**
 * Calculate economic performance metrics
 */
function calculateEconomicMetrics(
  intel: RoomIntelligence,
  strategy: EconomicPlan["strategy"]
): EconomicPlan["metrics"] {
  const { economy, creeps } = intel;

  // Expected income based on sources and efficiency
  const expectedIncome = economy.sources.reduce((total, source) => {
    return total + source.maxEnergy * source.efficiency * 0.1; // 10% per tick at max efficiency
  }, 0);

  // Expected expenses based on creep count and structures
  const expectedExpenses = creeps.total * 0.5 + economy.energyCapacity * 0.01;

  // Sustainability rating (0-100)
  const sustainabilityRating =
    expectedIncome > 0
      ? Math.min(100, (expectedIncome / Math.max(1, expectedExpenses)) * 50)
      : 0;

  // Growth potential based on room state and strategy
  let growthPotential = 50; // Base

  if (strategy === "BOOTSTRAP") growthPotential = 90;
  else if (strategy === "GROWTH") growthPotential = 80;
  else if (strategy === "OPTIMIZATION") growthPotential = 60;
  else if (strategy === "EXPANSION") growthPotential = 95;
  else if (strategy === "DEFENSE") growthPotential = 20;

  // Adjust for actual performance
  if (economy.efficiency > 0.8) growthPotential += 10;
  if (economy.netFlow < 0) growthPotential -= 30;

  growthPotential = Math.max(0, Math.min(100, growthPotential));

  return {
    expectedIncome,
    expectedExpenses,
    sustainabilityRating,
    growthPotential,
  };
}

/**
 * Quick economic health check
 */
export function assessEconomicHealth(intel: RoomIntelligence): {
  status: "CRITICAL" | "POOR" | "STABLE" | "GOOD" | "EXCELLENT";
  issues: string[];
  recommendations: string[];
} {
  const { economy, creeps, basic } = intel;
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Check energy flow
  if (economy.netFlow < 0) {
    issues.push("Negative energy flow");
    recommendations.push("Reduce creep count or improve harvesting");
  }

  // Check efficiency
  if (economy.efficiency < 0.5) {
    issues.push("Low harvesting efficiency");
    recommendations.push(
      "Add containers near sources or fix harvester positioning"
    );
  }

  // Check creep population
  const expectedCreeps = basic.rcl * 2 + economy.sources.length;
  if (creeps.total < expectedCreeps * 0.5) {
    issues.push("Insufficient creep population");
    recommendations.push("Increase spawning priority");
  }

  // Determine status
  let status: "CRITICAL" | "POOR" | "STABLE" | "GOOD" | "EXCELLENT" = "STABLE";

  if (issues.length >= 3 || economy.netFlow < -10) {
    status = "CRITICAL";
  } else if (issues.length >= 2 || economy.efficiency < 0.3) {
    status = "POOR";
  } else if (economy.efficiency > 0.8 && economy.netFlow > 5) {
    status = "EXCELLENT";
  } else if (economy.efficiency > 0.6 && economy.netFlow > 0) {
    status = "GOOD";
  }

  return { status, issues, recommendations };
}

/**
 * Calculate optimal body composition for a role based on economy
 * Delegates to spawning module which has the comprehensive body calculations
 */
export function calculateOptimalBody(
  role: string,
  energyAvailable: number,
  intel: RoomIntelligence
): BodyPartConstant[] {
  // Delegate to the comprehensive body calculation in spawning module
  return getBodyForRole(role, energyAvailable);
}
