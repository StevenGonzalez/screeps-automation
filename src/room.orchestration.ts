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
          runHarvesterRole(creep, intel);
          break;
        case "hauler":
          runHaulerRole(creep, intel);
          break;
        case "upgrader":
          runUpgraderRole(creep, intel);
          break;
        case "builder":
          runBuilderRole(creep, plans.construction, intel);
          break;
        case "defender":
          runDefenderRole(creep, plans.defense, intel);
          break;
        case "repairer":
          runRepairerRole(creep, intel);
          break;
        default:
          // Fallback to basic worker behavior
          runWorkerRole(creep, intel);
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
function runHarvesterRole(creep: Creep, intel: any): void {
  if (creep.store.getFreeCapacity() > 0) {
    // Find assigned source or assign one
    if (!creep.memory.sourceId) {
      const sources = creep.room.find(FIND_SOURCES);
      const source = sources.find((s) => {
        const assignedHarvesters = creep.room.find(FIND_MY_CREEPS, {
          filter: (c) =>
            c.memory.role === "harvester" && c.memory.sourceId === s.id,
        }).length;
        return assignedHarvesters < 2; // Max 2 harvesters per source
      });

      if (source) {
        creep.memory.sourceId = source.id;
      }
    }

    const source = Game.getObjectById(creep.memory.sourceId) as Source | null;
    if (source) {
      const harvestResult = creep.harvest(source);
      if (harvestResult === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, { visualizePathStyle: { stroke: "#ffaa00" } });
      } else if (harvestResult === OK) {
        CreepPersonality.speak(creep, "harvest");
      }
    }
  } else {
    // Deposit energy to nearby container or spawn/extension
    let targets = creep.pos.findInRange(FIND_STRUCTURES, 3, {
      filter: (s) => {
        return (
          (s.structureType === STRUCTURE_CONTAINER ||
            s.structureType === STRUCTURE_SPAWN ||
            s.structureType === STRUCTURE_EXTENSION) &&
          s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        );
      },
    });

    // If no targets nearby, find any valid target in the room
    if (targets.length === 0) {
      targets = creep.room.find(FIND_MY_STRUCTURES, {
        filter: (s) => {
          return (
            (s.structureType === STRUCTURE_SPAWN ||
              s.structureType === STRUCTURE_EXTENSION ||
              s.structureType === STRUCTURE_TOWER) &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
          );
        },
      });

      // If still no targets, try storage or containers
      if (targets.length === 0) {
        targets = creep.room.find(FIND_STRUCTURES, {
          filter: (s) => {
            return (
              (s.structureType === STRUCTURE_CONTAINER ||
                s.structureType === STRUCTURE_STORAGE) &&
              s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
            );
          },
        });
      }
    }

    if (targets.length > 0) {
      const target = targets[0];
      const transferResult = creep.transfer(target, RESOURCE_ENERGY);
      if (transferResult === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { visualizePathStyle: { stroke: "#ffffff" } });
      } else if (transferResult === OK) {
        CreepPersonality.speak(creep, "transfer");
      }
    }
  }
}

/**
 * Enhanced hauler role for energy logistics
 */
function runHaulerRole(creep: Creep, intel: any): void {
  if (creep.store.getUsedCapacity() === 0) {
    // Pick up energy from containers, storage, or dropped resources
    const energySources = creep.room.find(FIND_STRUCTURES, {
      filter: (s) => {
        return (
          (s.structureType === STRUCTURE_CONTAINER ||
            s.structureType === STRUCTURE_STORAGE) &&
          s.store.getUsedCapacity(RESOURCE_ENERGY) > 100
        );
      },
    });

    const droppedEnergy = creep.room.find(FIND_DROPPED_RESOURCES, {
      filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
    });

    let target = null;
    if (energySources.length > 0) {
      target = creep.pos.findClosestByPath(energySources);
    } else if (droppedEnergy.length > 0) {
      target = creep.pos.findClosestByPath(droppedEnergy);
    }

    if (target) {
      if (target instanceof Resource) {
        if (creep.pickup(target) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target);
        }
      } else {
        if (creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target);
        }
      }
    }
  } else {
    // Deliver energy to spawns, extensions, and towers
    const targets = creep.room.find(FIND_STRUCTURES, {
      filter: (s) => {
        return (
          (s.structureType === STRUCTURE_SPAWN ||
            s.structureType === STRUCTURE_EXTENSION ||
            s.structureType === STRUCTURE_TOWER) &&
          s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        );
      },
    });

    if (targets.length > 0) {
      const target = creep.pos.findClosestByPath(targets);
      if (target) {
        const transferResult = creep.transfer(target, RESOURCE_ENERGY);
        if (transferResult === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, { visualizePathStyle: { stroke: "#ffffff" } });
        } else if (transferResult === OK) {
          CreepPersonality.speak(creep, "transfer");
        }
      }
    }
  }
}

/**
 * Enhanced upgrader role with link support
 */
function runUpgraderRole(creep: Creep, intel: any): void {
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
    // Try to get energy from nearby link first
    const links = creep.pos.findInRange(FIND_MY_STRUCTURES, 3, {
      filter: (s) =>
        s.structureType === STRUCTURE_LINK &&
        s.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
    });

    if (links.length > 0) {
      if (creep.withdraw(links[0], RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(links[0]);
      }
      return;
    }

    // Fallback to containers and storage
    const energySources = creep.room.find(FIND_STRUCTURES, {
      filter: (s) => {
        return (
          (s.structureType === STRUCTURE_CONTAINER ||
            s.structureType === STRUCTURE_STORAGE) &&
          s.store.getUsedCapacity(RESOURCE_ENERGY) > 0
        );
      },
    });

    if (energySources.length > 0) {
      const target = creep.pos.findClosestByPath(energySources);
      if (
        target &&
        creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
      ) {
        creep.moveTo(target);
      }
    } else {
      // Fallback: Harvest from the nearest source if no stored energy
      const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
      if (source) {
        if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
          creep.moveTo(source, { visualizePathStyle: { stroke: "#ffaa00" } });
        }
      }
    }
  } else {
    // Upgrade the controller
    const upgradeResult = creep.upgradeController(creep.room.controller!);
    if (upgradeResult === ERR_NOT_IN_RANGE) {
      creep.moveTo(creep.room.controller!, {
        visualizePathStyle: { stroke: "#ffffff" },
      });
    } else if (upgradeResult === OK) {
      CreepPersonality.speak(creep, "upgrade");
    }
  }
}

/**
 * Enhanced builder role with construction priority
 */
function runBuilderRole(creep: Creep, constructionPlan: any, intel: any): void {
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
    // Get energy (similar to hauler logic)
    const energySources = creep.room.find(FIND_STRUCTURES, {
      filter: (s) => {
        return (
          (s.structureType === STRUCTURE_CONTAINER ||
            s.structureType === STRUCTURE_STORAGE) &&
          s.store.getUsedCapacity(RESOURCE_ENERGY) > 0
        );
      },
    });

    if (energySources.length > 0) {
      const target = creep.pos.findClosestByPath(energySources);
      if (
        target &&
        creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
      ) {
        creep.moveTo(target);
      }
    }
  } else {
    // Build from construction plan priority queue
    if (constructionPlan.recommendations?.immediate?.length) {
      const siteId = constructionPlan.recommendations.immediate[0];
      const targetSite = Game.getObjectById(siteId) as ConstructionSite | null;
      if (targetSite) {
        if (creep.build(targetSite) === ERR_NOT_IN_RANGE) {
          creep.moveTo(targetSite, {
            visualizePathStyle: { stroke: "#ffffff" },
          });
        }
        return;
      }
    }

    // Fallback to any construction site
    const targets = creep.room.find(FIND_CONSTRUCTION_SITES);
    if (targets.length > 0) {
      const target = creep.pos.findClosestByPath(targets);
      if (target && creep.build(target) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target);
      }
    }
  }
}

/**
 * Enhanced defender role with threat response
 */
function runDefenderRole(creep: Creep, defensePlan: any, intel: any): void {
  const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);

  if (hostiles.length > 0) {
    const target = creep.pos.findClosestByRange(hostiles);
    if (target) {
      if (creep.attack(target) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { visualizePathStyle: { stroke: "#ff0000" } });
      }
    }
  } else {
    // Patrol or move to defensive positions
    if (!creep.memory.patrolTarget) {
      const exits = creep.room.find(FIND_EXIT);
      if (exits.length > 0) {
        creep.memory.patrolTarget =
          exits[Math.floor(Math.random() * exits.length)];
      }
    }

    if (creep.memory.patrolTarget) {
      creep.moveTo(creep.memory.patrolTarget.x, creep.memory.patrolTarget.y);

      if (
        creep.pos.getRangeTo(
          creep.memory.patrolTarget.x,
          creep.memory.patrolTarget.y
        ) < 2
      ) {
        delete creep.memory.patrolTarget;
      }
    }
  }
}

/**
 * Repairer role for infrastructure maintenance
 */
function runRepairerRole(creep: Creep, intel: any): void {
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
    // Get energy (similar logic to other roles)
    const energySources = creep.room.find(FIND_STRUCTURES, {
      filter: (s) => {
        return (
          (s.structureType === STRUCTURE_CONTAINER ||
            s.structureType === STRUCTURE_STORAGE) &&
          s.store.getUsedCapacity(RESOURCE_ENERGY) > 0
        );
      },
    });

    if (energySources.length > 0) {
      const target = creep.pos.findClosestByPath(energySources);
      if (
        target &&
        creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
      ) {
        creep.moveTo(target);
      }
    }
  } else {
    // Repair damaged structures
    const targets = creep.room.find(FIND_STRUCTURES, {
      filter: (s) =>
        s.hits < s.hitsMax &&
        s.structureType !== STRUCTURE_WALL &&
        s.structureType !== STRUCTURE_RAMPART,
    });

    if (targets.length > 0) {
      const target = targets.reduce((prev, curr) =>
        prev.hits / prev.hitsMax < curr.hits / curr.hitsMax ? prev : curr
      );

      if (creep.repair(target) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { visualizePathStyle: { stroke: "#00ff00" } });
      }
    }
  }
}

/**
 * Fallback worker role for unassigned creeps
 */
function runWorkerRole(creep: Creep, intel: any): void {
  // Basic worker: harvest, then upgrade or build
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
    const sources = creep.room.find(FIND_SOURCES);
    if (sources.length > 0) {
      const source = creep.pos.findClosestByPath(sources);
      if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
        creep.moveTo(source);
      }
    }
  } else {
    const constructionSites = creep.room.find(FIND_CONSTRUCTION_SITES);
    if (constructionSites.length > 0) {
      const target = creep.pos.findClosestByPath(constructionSites);
      if (target && creep.build(target) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target);
      }
    } else if (creep.room.controller) {
      if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
        creep.moveTo(creep.room.controller);
      }
    }
  }
}

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
