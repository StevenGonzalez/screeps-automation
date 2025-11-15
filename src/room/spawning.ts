/**
 * Spawning Management
 *
 * Handles intelligent spawning of creeps based on room needs and priorities.
 * Integrates with economic, construction, and defense plans.
 */

/// <reference types="@types/screeps" />
import { RoomCache } from "./cache";
import { getRoomMemory } from "../global.memory";

import { CreepPersonality } from "../creep/personality";

/**
 * Manage spawning for a room based on all active plans
 */
export function manageRoomSpawning(
  room: Room,
  economicPlan: any,
  defensePlan: any,
  constructionPlan: any,
  intel: any
): void {
  const spawns = room.find(FIND_MY_SPAWNS, {
    filter: (spawn) => !spawn.spawning,
  });

  if (spawns.length === 0) return;

  const spawn = spawns[0];

  // Priority 1: Emergency defense spawning
  if (defensePlan.creepOrders?.length > 0) {
    if (trySpawnDefenseCreeps(spawn, room, defensePlan)) {
      return;
    }
  }

  // Priority 2: Emergency economy (no harvesters)
  const counts = getCurrentCreepCounts(room);
  if (counts.harvester === 0 && counts.miner === 0) {
    // True bootstrap: nothing harvesting in any form
    if (tryEmergencySpawn(spawn, "harvester")) {
      console.log(`🚨 Emergency harvester due to 0 harvesters and 0 miners`);
      return;
    }
  }

  // Priority 3: Regular economic spawning
  if (trySpawnEconomicCreeps(spawn, room, economicPlan)) {
    return;
  }

  // Priority 4: Construction workers (dynamic based on sites and economy)
  if (trySpawnConstructionCreeps(spawn, room, constructionPlan, intel)) {
    return;
  }
}

/**
 * Try to spawn defense creeps based on defense plan
 */
function trySpawnDefenseCreeps(
  spawn: StructureSpawn,
  room: Room,
  defensePlan: any
): boolean {
  for (const order of defensePlan.creepOrders) {
    const existing = room.find(FIND_MY_CREEPS, {
      filter: (c) => c.memory.role === order.role,
    }).length;

    if (existing < order.count) {
      const result = spawn.spawnCreep(
        order.bodyParts,
        `${order.role}_${Game.time}`,
        {
          memory: { role: order.role, priority: "defense" },
        }
      );

      if (result === OK) {
        console.log(
          `🛡️ Spawning ${order.role} for defense (${existing + 1}/${
            order.count
          })`
        );
        return true;
      } else if (result === ERR_NOT_ENOUGH_ENERGY) {
        if (Game.time % 25 === 0) {
          console.log(`💸 Not enough energy for defense ${order.role}`);
        }
      }
    }
  }
  return false;
}

/**
 * Emergency spawn with minimal energy
 */
function tryEmergencySpawn(spawn: StructureSpawn, role: string): boolean {
  const emergencyBody = getEmergencyBody(role, spawn.room.energyAvailable);
  const name = `${role}_emergency_${Game.time}`;

  const result = spawn.spawnCreep(emergencyBody, name, {
    memory: { role, priority: "emergency" },
  });

  if (result === OK) {
    console.log(`🚨 Emergency spawning ${role}!`);
    return true;
  }

  return false;
}

/**
 * Spawn creeps based on economic plan
 */
function trySpawnEconomicCreeps(
  spawn: StructureSpawn,
  room: Room,
  economicPlan: any
): boolean {
  const composition = economicPlan.creepComposition;
  if (!composition) return false;

  const current = getCurrentCreepCounts(room);
  const repairDemand = assessRepairDemand(room);
  const sources = RoomCache.sources(room);
  const hasBuiltContainer = (pos: RoomPosition) => {
    const hasStruct = room
      .lookForAtArea(
        LOOK_STRUCTURES,
        pos.y - 1,
        pos.x - 1,
        pos.y + 1,
        pos.x + 1,
        true
      )
      .some((i) => i.structure.structureType === STRUCTURE_CONTAINER);
    return hasStruct;
  };
  const minerTargets = sources.filter((s) => hasBuiltContainer(s.pos)).length;

  // Spawn queue in priority order
  const hasConstruction = RoomCache.constructionSites(room).length > 0;
  const hasContainersOrStorage =
    room.find(FIND_STRUCTURES, {
      filter: (s) =>
        s.structureType === STRUCTURE_CONTAINER ||
        s.structureType === STRUCTURE_STORAGE,
    }).length > 0;

  // Bootstrap rescue: if spawn is starved but there is energy in containers, force a small hauler
  if (current.hauler === 0) {
    const containersWithEnergy = room.find(FIND_STRUCTURES, {
      filter: (s: AnyStructure) =>
        (s.structureType === STRUCTURE_CONTAINER ||
          s.structureType === STRUCTURE_STORAGE) &&
        (s as AnyStoreStructure).store.getUsedCapacity(RESOURCE_ENERGY) > 0,
    }).length;
    if (containersWithEnergy > 0) {
      const emergencyHauler = getEmergencyBody(
        "hauler",
        spawn.room.energyAvailable
      );
      if (emergencyHauler.length > 0) {
        const name = `hauler_boot_${Game.time}`;
        const res = spawn.spawnCreep(emergencyHauler, name, {
          memory: { role: "hauler", priority: "bootstrap" },
        });
        if (res === OK) {
          console.log(
            `🚚 Bootstrap hauler spawned to pull from containers (${containersWithEnergy})`
          );
          return true;
        }
      }
    }
  }

  // If no upgraders exist, try to spawn a tiny upgrader to avoid stalling controller progress
  if (current.upgrader === 0 && spawn.room.energyAvailable >= 100) {
    const emergencyUpgrader = getEmergencyBody(
      "upgrader",
      spawn.room.energyAvailable
    );
    if (emergencyUpgrader.length > 0) {
      const name = `upgrader_boot_${Game.time}`;
      const res = spawn.spawnCreep(emergencyUpgrader, name, {
        memory: { role: "upgrader", priority: "bootstrap" },
      });
      if (res === OK) {
        console.log(`⚙️ Bootstrap upgrader spawned due to 0 upgraders`);
        return true;
      }
    }
  }

  const spawnQueue = [
    {
      role: "miner",
      // Aim for one miner per source that has a container (or one planned)
      needed: minerTargets,
      current: current.miner,
    },
    {
      role: "harvester",
      // Only spawn harvesters for sources WITHOUT containers, or as backup when miners are insufficient
      needed: Math.max(0, sources.length - minerTargets - current.miner),
      current: current.harvester,
    },
    {
      role: "hauler",
      // Dynamically scale haulers based on source container fullness and needy structures
      needed: hasContainersOrStorage
        ? computeHaulerTarget(spawn.room, composition, current)
        : 0,
      current: current.hauler,
    },
    {
      role: "upgrader",
      // Always keep at least 1 upgrader if we have a controller
      needed: Math.max(1, composition.upgraders || 1),
      current: current.upgrader,
    },
    {
      role: "builder",
      // Only spawn builders when there are construction sites
      needed: hasConstruction ? composition.builders || 1 : 0,
      current: current.builder,
    },
    {
      role: "repairer",
      // Spawn repairers when there is meaningful decay/damage and economy is not starved
      needed: repairDemand.recommendedRepairers,
      current: current.repairer || 0,
    },
    {
      role: "mineralminer",
      // Spawn mineral miner when extractor exists and mineral has resources
      needed: shouldSpawnMineralMiner(spawn.room) ? 1 : 0,
      current: current.mineralminer || 0,
    },
  ];

  for (const item of spawnQueue) {
    if (item.current < item.needed) {
      const body = getBodyForRole(
        item.role,
        spawn.room.energyCapacityAvailable
      );
      const name = `${item.role}_${Game.time}`;

      // Set initial memory with homeRoom for scouts
      const initialMemory: any = { role: item.role, priority: "economy" };

      let result = spawn.spawnCreep(body, name, {
        memory: initialMemory,
      });

      if (result === OK) {
        console.log(
          `👷 Spawning ${item.role} (${item.current + 1}/${item.needed})`
        );

        return true;
      } else if (result === ERR_NOT_ENOUGH_ENERGY) {
        // Fallback: try an emergency-sized body using current energy
        const fallback = getEmergencyBody(
          item.role,
          spawn.room.energyAvailable
        );
        if (fallback.length > 0) {
          result = spawn.spawnCreep(fallback, name, {
            memory: { role: item.role, priority: "economy" },
          });
          if (result === OK) {
            console.log(
              `🪫 Low-energy ${item.role} spawned with emergency body`
            );
            return true;
          }
        }
        // Not enough energy for fallback either; try next role rather than blocking
        if (Game.time % 25 === 0) {
          console.log(`💸 Not enough energy for ${item.role} (even fallback)`);
        }
        continue;
      }

      // Only try to spawn one creep per tick when a spawn attempt was made and not energy-limited
      break;
    }
  }

  return false;
}

/**
 * Compute dynamic hauler target based on:
 * - Baseline from economic plan
 * - Number of miners (throughput to move) including mineral miners
 * - Overfull source containers (fill ratio > 80%)
 * - Count of needy structures (spawns/extensions/towers needing energy)
 */
function computeHaulerTarget(
  room: Room,
  composition: any,
  current: Record<string, number>
): number {
  const base = Math.max(1, composition.haulers || 1);
  // Include both energy miners and mineral miners for hauler calculation
  const totalMiners = (current.miner || 0) + (current.mineralminer || 0);
  const byMiners = Math.max(1, Math.min(3, totalMiners));

  const containers = RoomCache.containers(room);
  const sources = RoomCache.sources(room);
  const sourceContainers = containers.filter((c) =>
    sources.some((src) => c.pos.isNearTo(src))
  );

  // Also check mineral containers
  const minerals_all = RoomCache.minerals(room);
  const mineralContainers = containers.filter((c) => {
    const mineral = minerals_all[0];
    return mineral && c.pos.isNearTo(mineral);
  });

  const allMiningContainers = [...sourceContainers, ...mineralContainers];
  const overfullContainers = allMiningContainers.filter((c) => {
    const cap = c.store.getCapacity() || 2000;
    const used = c.store.getUsedCapacity() || 0;
    return used / cap > 0.8;
  }).length;

  const needyStructures = room.find(FIND_MY_STRUCTURES, {
    filter: (s: AnyStructure) =>
      (s.structureType === STRUCTURE_SPAWN ||
        s.structureType === STRUCTURE_EXTENSION ||
        s.structureType === STRUCTURE_TOWER) &&
      (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  }).length;

  // Heuristics:
  // - Ensure at least 2 haulers when there are needy structures and containers exist
  // - Add capacity for each overfull container, up to +2
  // - Cap to prevent runaway; we can revisit once links/storage stabilize
  let target = Math.max(base, byMiners);
  if (needyStructures > 0) target = Math.max(target, 2);
  if (overfullContainers > 0)
    target = Math.max(target, Math.min(2 + overfullContainers, 4));

  // If storage exists and is healthy, allow one more hauler to accelerate distribution at mid-game
  if (
    room.storage &&
    room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 10000
  ) {
    target = Math.min(5, Math.max(target, 3));
  }

  return target;
}

/**
 * Try to spawn construction workers
 */
function trySpawnConstructionCreeps(
  spawn: StructureSpawn,
  room: Room,
  constructionPlan: any,
  intel: any
): boolean {
  const counts = getCurrentCreepCounts(room);
  const rcl = room.controller?.level || 0;
  const sites = RoomCache.constructionSites(room).length;

  // Only count non-deferred tasks (things builders will actually work on now)
  // Filter out null/undefined entries to get accurate count
  const activeTasks =
    (constructionPlan?.priorities?.critical?.filter((t: any) => t).length ||
      0) +
    (constructionPlan?.priorities?.important?.filter((t: any) => t).length ||
      0) +
    (constructionPlan?.priorities?.normal?.filter((t: any) => t).length || 0);

  // No construction sites and no active tasks? Don't spawn builders
  if (sites === 0 && activeTasks === 0) {
    return false;
  }

  // Extra guard: if there are no active sites and all planned tasks are roads, skip spawning builders
  // (Roads are low priority and can wait)
  if (sites === 0 && activeTasks > 0) {
    const pri = constructionPlan?.priorities;
    const prioritized: any[] = [
      ...(pri?.critical || []),
      ...(pri?.important || []),
      ...(pri?.normal || []),
    ].filter((t) => t); // Filter out null/undefined

    const nonRoadPlanned = prioritized.filter(
      (t) => t.type && t.type !== STRUCTURE_ROAD
    ).length;

    if (nonRoadPlanned === 0) {
      if (Game.time % 100 === 0) {
        const roadCount = prioritized.filter(
          (t) => t.type === STRUCTURE_ROAD
        ).length;
        console.log(
          `⏸️ Skipping builder spawn - only ${roadCount} roads planned (can wait)`
        );
      }
      return false;
    }
  }

  // Economy signals
  const energyCap = room.energyCapacityAvailable || 300;
  const energyAvail = room.energyAvailable || 0;
  const stored =
    intel?.economy?.energyStored ??
    (room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) || 0);
  const energyRatio = Math.max(
    0,
    Math.min(1, energyAvail / Math.max(1, energyCap))
  );

  // Dynamic target builders based on construction energy requirements
  // Base rule: 1 builder per 5,000 energy needed for construction
  const constructionEnergy = constructionPlan?.metrics?.estimatedCost || 0;
  let target = Math.max(1, Math.ceil(constructionEnergy / 5000));

  // Cap builders at 6 to avoid spawning too many (unless there's truly massive construction)
  if (constructionEnergy < 50000) {
    target = Math.min(target, 6);
  }

  // Early-game and economy gating: keep lean if capacity is low or logistics not ready
  if (energyCap < 400 || counts.harvester < 2 || counts.hauler < 1) {
    target = Math.min(target, 1);
  }
  // If energy is currently very low and storage is empty, avoid spawning extra builders
  if (energyRatio < 0.3 && stored < 5000) {
    target = Math.min(target, 1);
  }
  // RCL-based cap: early rooms can't support too many builders
  if (rcl <= 2) target = Math.min(target, 2);
  if (rcl <= 4) target = Math.min(target, 4);

  const currentBuilders = counts.builder;
  if (currentBuilders < target) {
    const body = getBodyForRole("builder", spawn.room.energyCapacityAvailable);
    const name = `builder_construction_${Game.time}`;
    const result = spawn.spawnCreep(body, name, {
      memory: { role: "builder", priority: "construction" },
    });
    if (result === OK) {
      const constructionEnergy = constructionPlan?.metrics?.estimatedCost || 0;
      console.log(
        `🏗️ Spawning builder (${
          currentBuilders + 1
        }/${target}) for ${sites} sites / ${constructionEnergy.toLocaleString()} energy`
      );
      return true;
    } else if (result === ERR_NOT_ENOUGH_ENERGY) {
      if (Game.time % 25 === 0) {
        console.log(
          `💸 Not enough energy to add builder (${currentBuilders}/${target})`
        );
      }
    }
  }

  return false;
}

/**
 * Get current creep counts by role (including spawning creeps)
 * CACHED: Filtering all creeps is expensive, cache for 3 ticks
 */
function getCurrentCreepCounts(room: Room): { [role: string]: number } {
  const mem = getRoomMemory(room.name);
  mem.creepCountCache = mem.creepCountCache || {};
  const cache = mem.creepCountCache as any;

  // Return cached counts if fresh
  if (cache.counts && cache.tick && Game.time - cache.tick < 3) {
    return cache.counts;
  }

  // Count spawning creeps
  const spawningCounts: { [role: string]: number } = {};
  RoomCache.mySpawns(room).forEach((spawn) => {
    if (spawn.spawning) {
      const spawningCreep = Game.creeps[spawn.spawning.name];
      if (spawningCreep && spawningCreep.memory.role) {
        spawningCounts[spawningCreep.memory.role] =
          (spawningCounts[spawningCreep.memory.role] || 0) + 1;
      }
    }
  });

  const counts = {
    miner:
      RoomCache.myCreeps(room).filter((c) => c.memory.role === "miner").length +
      (spawningCounts.miner || 0),
    harvester:
      RoomCache.myCreeps(room).filter((c) => c.memory.role === "harvester")
        .length + (spawningCounts.harvester || 0),
    hauler:
      RoomCache.myCreeps(room).filter((c) => c.memory.role === "hauler")
        .length + (spawningCounts.hauler || 0),
    upgrader:
      RoomCache.myCreeps(room).filter((c) => c.memory.role === "upgrader")
        .length + (spawningCounts.upgrader || 0),
    builder:
      RoomCache.myCreeps(room).filter((c) => c.memory.role === "builder")
        .length + (spawningCounts.builder || 0),
    defender:
      RoomCache.myCreeps(room).filter((c) => c.memory.role === "defender")
        .length + (spawningCounts.defender || 0),
    repairer:
      RoomCache.myCreeps(room).filter((c) => c.memory.role === "repairer")
        .length + (spawningCounts.repairer || 0),
    mineralminer:
      RoomCache.myCreeps(room).filter((c) => c.memory.role === "mineralminer")
        .length + (spawningCounts.mineralminer || 0),
  };

  // Cache the result
  cache.counts = counts;
  cache.tick = Game.time;

  return counts;
}

function assessRepairDemand(room: Room): { recommendedRepairers: number } {
  // Scan for damaged structures and decaying roads/containers
  const critical = room.find(FIND_STRUCTURES, {
    filter: (s) =>
      (s.structureType === STRUCTURE_CONTAINER ||
        s.structureType === STRUCTURE_ROAD ||
        s.structureType === STRUCTURE_SPAWN ||
        s.structureType === STRUCTURE_TOWER ||
        s.structureType === STRUCTURE_STORAGE ||
        s.structureType === STRUCTURE_TERMINAL) &&
      s.hits < s.hitsMax * 0.5,
  }).length;

  const rampartsLow = room.find(FIND_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_RAMPART && s.hits < 5000,
  }).length;

  const roadsMedium = room.find(FIND_STRUCTURES, {
    filter: (s) =>
      s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax * 0.3,
  }).length;

  // Very strict scoring - repairers should be rare
  // Only spawn when there's substantial damage, not just minor decay
  let recommended = 0;

  if (critical > 0) {
    // Critical structures need immediate attention
    recommended = 1;
  } else if (rampartsLow > 20 || roadsMedium > 50) {
    // Significant rampart/road decay
    recommended = 1;
  } else if (rampartsLow > 50 && roadsMedium > 100) {
    // Massive decay across many structures
    recommended = 2;
  }
  // Never spawn 3 repairers - 2 is the maximum

  return { recommendedRepairers: recommended };
}
/**
 * Calculate optimal body parts for a given role and energy
 * Exported for use by other modules (e.g., economy.ts)
 */
export function getBodyForRole(
  role: string,
  energyAvailable: number
): BodyPartConstant[] {
  const basic: BodyPartConstant[] = [WORK, CARRY, MOVE];

  if (energyAvailable < 200) return basic;

  switch (role) {
    case "miner":
      // Static miner: prioritize WORK parts and a couple of MOVE
      if (energyAvailable >= 800)
        return [WORK, WORK, WORK, WORK, WORK, WORK, MOVE, MOVE];
      if (energyAvailable >= 550) return [WORK, WORK, WORK, WORK, WORK, MOVE];
      if (energyAvailable >= 400) return [WORK, WORK, WORK, MOVE];
      return [WORK, WORK, MOVE];
    case "harvester":
      if (energyAvailable >= 800)
        return [
          WORK,
          WORK,
          WORK,
          WORK,
          WORK,
          WORK,
          CARRY,
          CARRY,
          MOVE,
          MOVE,
          MOVE,
          MOVE,
        ];
      if (energyAvailable >= 550)
        return [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE, MOVE];
      if (energyAvailable >= 350) return [WORK, WORK, WORK, CARRY, MOVE, MOVE];
      return basic;

    case "hauler":
      if (energyAvailable >= 800)
        return [
          CARRY,
          CARRY,
          CARRY,
          CARRY,
          CARRY,
          CARRY,
          CARRY,
          CARRY,
          CARRY,
          CARRY, // 10 CARRY (capacity 500)
          MOVE,
          MOVE,
          MOVE,
          MOVE,
          MOVE, // 5 MOVE (on roads, 2:1 ratio is fine)
        ];
      if (energyAvailable >= 600)
        return [
          CARRY,
          CARRY,
          CARRY,
          CARRY,
          CARRY,
          CARRY,
          MOVE,
          MOVE,
          MOVE,
          MOVE,
        ];
      if (energyAvailable >= 450)
        return [CARRY, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE];
      if (energyAvailable >= 300) return [CARRY, CARRY, CARRY, MOVE, MOVE];
      return [CARRY, CARRY, MOVE];

    case "upgrader":
      if (energyAvailable >= 1000)
        return [
          WORK,
          WORK,
          WORK,
          WORK,
          WORK,
          CARRY,
          CARRY,
          CARRY,
          MOVE,
          MOVE,
          MOVE,
          MOVE,
        ];
      if (energyAvailable >= 800)
        return [WORK, WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE];
      if (energyAvailable >= 400) return [WORK, WORK, CARRY, CARRY, MOVE, MOVE];
      return basic;

    case "builder":
      if (energyAvailable >= 800)
        return [
          WORK,
          WORK,
          WORK,
          WORK,
          CARRY,
          CARRY,
          CARRY,
          MOVE,
          MOVE,
          MOVE,
          MOVE,
        ];
      if (energyAvailable >= 600)
        return [WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE];
      if (energyAvailable >= 400) return [WORK, WORK, CARRY, CARRY, MOVE, MOVE];
      return basic;

    case "repairer":
      // Same as builder - needs WORK to repair and CARRY to haul energy
      if (energyAvailable >= 800)
        return [
          WORK,
          WORK,
          WORK,
          WORK,
          CARRY,
          CARRY,
          CARRY,
          MOVE,
          MOVE,
          MOVE,
          MOVE,
        ];
      if (energyAvailable >= 600)
        return [WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE];
      if (energyAvailable >= 400) return [WORK, WORK, CARRY, CARRY, MOVE, MOVE];
      return basic;

    case "mineralminer":
      // Mineral miner: WORK parts for mining minerals
      if (energyAvailable >= 1200)
        return [
          WORK,
          WORK,
          WORK,
          WORK,
          WORK,
          WORK,
          WORK,
          WORK,
          WORK,
          WORK,
          MOVE,
          MOVE,
          MOVE,
          MOVE,
          MOVE,
        ];
      if (energyAvailable >= 800)
        return [WORK, WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, MOVE];
      if (energyAvailable >= 550)
        return [WORK, WORK, WORK, WORK, WORK, MOVE, MOVE];
      return [WORK, WORK, WORK, MOVE];

    case "defender":
      // Mix of melee and ranged for versatility against kiters/healers
      if (energyAvailable >= 1000)
        return [
          RANGED_ATTACK,
          RANGED_ATTACK,
          ATTACK,
          ATTACK,
          MOVE,
          MOVE,
          MOVE,
          MOVE,
        ];
      if (energyAvailable >= 780)
        return [RANGED_ATTACK, ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE, MOVE];
      if (energyAvailable >= 580)
        return [ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE];
      if (energyAvailable >= 390) return [ATTACK, ATTACK, MOVE, MOVE];
      return [ATTACK, MOVE];

    case "healer":
      if (energyAvailable >= 1000)
        return [HEAL, HEAL, HEAL, HEAL, MOVE, MOVE, MOVE, MOVE];
      if (energyAvailable >= 650) return [HEAL, HEAL, HEAL, MOVE, MOVE, MOVE];
      if (energyAvailable >= 300) return [HEAL, HEAL, MOVE];
      return [HEAL, MOVE];

    default:
      return basic;
  }
}

/**
 * Check if mineral miner should be spawned
 */
function shouldSpawnMineralMiner(room: Room): boolean {
  // Only spawn if RCL >= 6 and extractor exists
  if (!room.controller || room.controller.level < 6) return false;

  const extractor = room.find(FIND_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_EXTRACTOR,
  })[0];

  if (!extractor) return false;

  // Check if mineral has resources available
  const mineral = RoomCache.minerals(room)[0];
  if (!mineral || mineral.mineralAmount === 0) return false;

  return true;
}

/**
 * Calculate emergency body parts (minimal energy usage)
 */
function getEmergencyBody(
  role: string,
  energyAvailable: number
): BodyPartConstant[] {
  const basic: BodyPartConstant[] = [WORK, CARRY, MOVE];

  // Minimum 200 energy for functional creeps - need [WORK, CARRY, MOVE]
  // Anything less is useless (can't work without energy transport)
  if (energyAvailable < 200) {
    return []; // Don't spawn useless creeps
  }

  // Use basic body for emergency spawns with 200+ energy
  return basic;
}
