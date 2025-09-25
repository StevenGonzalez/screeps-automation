/**
 * Spawning Management
 *
 * Handles intelligent spawning of creeps based on room needs and priorities.
 * Integrates with economic, construction, and defense plans.
 */

/// <reference types="@types/screeps" />

import { CreepPersonality } from "./creep.personality";

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
        console.log(`🌟 ${CreepPersonality.getSpawnPhrase(order.role)}`);
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
    console.log(`🌟 ${CreepPersonality.getSpawnPhrase(role)}`);
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
  const sources = room.find(FIND_SOURCES);
  const containersOrSites = (pos: RoomPosition) => {
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
    if (hasStruct) return true;
    const hasSite = room
      .lookForAtArea(
        LOOK_CONSTRUCTION_SITES,
        pos.y - 1,
        pos.x - 1,
        pos.y + 1,
        pos.x + 1,
        true
      )
      .some((i) => i.constructionSite.structureType === STRUCTURE_CONTAINER);
    return hasSite;
  };
  const minerTargets = sources.filter((s) => containersOrSites(s.pos)).length;

  // Spawn queue in priority order
  const hasConstruction = room.find(FIND_CONSTRUCTION_SITES).length > 0;
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
          console.log(`🌟 ${CreepPersonality.getSpawnPhrase("hauler")}`);
          return true;
        }
      }
    }
  }

  // If no harvesters and energy is low, spawn a tiny harvester even if a miner exists
  if (current.harvester === 0 && spawn.room.energyAvailable >= 100) {
    const emergencyHarvester = getEmergencyBody(
      "harvester",
      spawn.room.energyAvailable
    );
    if (emergencyHarvester.length > 0) {
      const name = `harvester_boot_${Game.time}`;
      const res = spawn.spawnCreep(emergencyHarvester, name, {
        memory: { role: "harvester", priority: "bootstrap" },
      });
      if (res === OK) {
        console.log(
          `⛏️ Bootstrap harvester spawned due to 0 harvesters and low energy`
        );
        console.log(`🌟 ${CreepPersonality.getSpawnPhrase("harvester")}`);
        return true;
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
        console.log(`🌟 ${CreepPersonality.getSpawnPhrase("upgrader")}`);
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
      // Reduce harvesters as miners come online
      needed: Math.max(0, (composition.harvesters || 2) - current.miner),
      current: current.harvester,
    },
    {
      role: "hauler",
      // Only spawn haulers when we have something to haul
      needed: hasContainersOrStorage
        ? Math.max(composition.haulers || 1, Math.min(2, current.miner))
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
  ];

  for (const item of spawnQueue) {
    if (item.current < item.needed) {
      const body = getOptimalBody(
        item.role,
        spawn.room.energyCapacityAvailable
      );
      const name = `${item.role}_${Game.time}`;

      let result = spawn.spawnCreep(body, name, {
        memory: { role: item.role, priority: "economy" },
      });

      if (result === OK) {
        console.log(
          `👷 Spawning ${item.role} (${item.current + 1}/${item.needed})`
        );
        console.log(`🌟 ${CreepPersonality.getSpawnPhrase(item.role)}`);
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
            console.log(`🌟 ${CreepPersonality.getSpawnPhrase(item.role)}`);
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
  const sites = room.find(FIND_CONSTRUCTION_SITES).length;
  const plannedTasks =
    (constructionPlan?.queue?.length || 0) +
    ((constructionPlan?.priorities?.critical?.length || 0) +
      (constructionPlan?.priorities?.important?.length || 0) +
      (constructionPlan?.priorities?.normal?.length || 0));

  if (sites === 0 && plannedTasks === 0) return false;

  // Extra guard: if there are no active sites and all planned tasks are roads (often deferred early), skip spawning builders
  if (sites === 0) {
    const pri = constructionPlan?.priorities;
    const prioritized: any[] = [
      ...(pri?.critical || []),
      ...(pri?.important || []),
      ...(pri?.normal || []),
    ];
    const nonRoadPlanned = prioritized.filter(
      (t) => t && t.type && t.type !== STRUCTURE_ROAD
    ).length;
    if (nonRoadPlanned === 0) {
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

  // Dynamic target builders based on construction volume and economy
  let target = 1;
  if (sites > 5 || plannedTasks > 10) target = 2;
  if (sites > 20 || plannedTasks > 40) target = 3;

  // Early-game and economy gating: keep lean if capacity is low or logistics not ready
  if (energyCap < 400 || counts.harvester < 2 || counts.hauler < 1) {
    target = Math.min(target, 1);
  }
  // If energy is currently very low and storage is empty, avoid spawning extra builders
  if (energyRatio < 0.3 && stored < 5000) {
    target = Math.min(target, 1);
  }
  // RCL-based cap
  if (rcl <= 2) target = Math.min(target, 2);

  const currentBuilders = counts.builder;
  if (currentBuilders < target) {
    const body = getOptimalBody("builder", spawn.room.energyCapacityAvailable);
    const name = `builder_construction_${Game.time}`;
    const result = spawn.spawnCreep(body, name, {
      memory: { role: "builder", priority: "construction" },
    });
    if (result === OK) {
      console.log(
        `🏗️ Spawning builder (${
          currentBuilders + 1
        }/${target}) for ${sites} sites / ${plannedTasks} tasks`
      );
      console.log(`🌟 ${CreepPersonality.getSpawnPhrase("builder")}`);
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
 * Get current creep counts by role
 */
function getCurrentCreepCounts(room: Room): { [role: string]: number } {
  return {
    miner: room.find(FIND_MY_CREEPS, {
      filter: (c) => c.memory.role === "miner",
    }).length,
    harvester: room.find(FIND_MY_CREEPS, {
      filter: (c) => c.memory.role === "harvester",
    }).length,
    hauler: room.find(FIND_MY_CREEPS, {
      filter: (c) => c.memory.role === "hauler",
    }).length,
    upgrader: room.find(FIND_MY_CREEPS, {
      filter: (c) => c.memory.role === "upgrader",
    }).length,
    builder: room.find(FIND_MY_CREEPS, {
      filter: (c) => c.memory.role === "builder",
    }).length,
    defender: room.find(FIND_MY_CREEPS, {
      filter: (c) => c.memory.role === "defender",
    }).length,
    repairer: room.find(FIND_MY_CREEPS, {
      filter: (c) => c.memory.role === "repairer",
    }).length,
  };
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
      s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax * 0.5,
  }).length;

  let score =
    critical * 2 +
    Math.min(5, Math.floor(rampartsLow / 5)) +
    Math.min(5, Math.floor(roadsMedium / 20));
  // Economy-aware cap: do not over-spawn repairers
  const recommended = score === 0 ? 0 : score <= 2 ? 1 : score <= 5 ? 2 : 3;
  return { recommendedRepairers: recommended };
}

/**
 * Calculate optimal body parts for a given role and energy
 */
function getOptimalBody(
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

    case "defender":
      if (energyAvailable >= 780)
        return [ATTACK, ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE, MOVE];
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
 * Calculate emergency body parts (minimal energy usage)
 */
function getEmergencyBody(
  role: string,
  energyAvailable: number
): BodyPartConstant[] {
  const basic: BodyPartConstant[] = [WORK, CARRY, MOVE];

  if (energyAvailable < 200) {
    // Absolute minimum
    switch (role) {
      case "miner":
        return energyAvailable >= 150 ? [WORK, MOVE] : [WORK];
      case "harvester":
        return energyAvailable >= 150 ? [WORK, MOVE] : [WORK];
      case "hauler":
        return energyAvailable >= 100 ? [CARRY, MOVE] : [CARRY];
      default:
        return energyAvailable >= 50 ? [MOVE] : [];
    }
  }

  // Use basic body for emergency spawns with 200+ energy
  return basic;
}
