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
  const harvesters = room.find(FIND_MY_CREEPS, {
    filter: (c) => c.memory.role === "harvester",
  });
  if (harvesters.length === 0) {
    if (tryEmergencySpawn(spawn, "harvester")) {
      return;
    }
  }

  // Priority 3: Regular economic spawning
  if (trySpawnEconomicCreeps(spawn, room, economicPlan)) {
    return;
  }

  // Priority 4: Construction workers (if construction plan exists)
  if (constructionPlan.priorityQueue?.length > 0) {
    if (trySpawnConstructionCreeps(spawn, room, constructionPlan)) {
      return;
    }
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
        console.log(`💸 Not enough energy for defense ${order.role}`);
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

  // Spawn queue in priority order
  const spawnQueue = [
    {
      role: "harvester",
      needed: composition.harvesters || 2,
      current: current.harvester,
    },
    {
      role: "hauler",
      needed: composition.haulers || 1,
      current: current.hauler,
    },
    {
      role: "upgrader",
      needed: composition.upgraders || 1,
      current: current.upgrader,
    },
    {
      role: "builder",
      needed: composition.builders || 1,
      current: current.builder,
    },
  ];

  for (const item of spawnQueue) {
    if (item.current < item.needed) {
      const body = getOptimalBody(
        item.role,
        spawn.room.energyCapacityAvailable
      );
      const name = `${item.role}_${Game.time}`;

      const result = spawn.spawnCreep(body, name, {
        memory: { role: item.role, priority: "economy" },
      });

      if (result === OK) {
        console.log(
          `👷 Spawning ${item.role} (${item.current + 1}/${item.needed})`
        );
        console.log(`🌟 ${CreepPersonality.getSpawnPhrase(item.role)}`);
        return true;
      } else if (result === ERR_NOT_ENOUGH_ENERGY) {
        console.log(`💸 Not enough energy for ${item.role}`);
      }

      // Only try to spawn one creep per tick
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
  constructionPlan: any
): boolean {
  const builders = room.find(FIND_MY_CREEPS, {
    filter: (c) => c.memory.role === "builder",
  });

  // Only spawn more builders if we have active construction and few builders
  if (builders.length < 2 && constructionPlan.priorityQueue.length > 0) {
    const body = getOptimalBody("builder", spawn.room.energyCapacityAvailable);
    const name = `builder_construction_${Game.time}`;

    const result = spawn.spawnCreep(body, name, {
      memory: { role: "builder", priority: "construction" },
    });

    if (result === OK) {
      console.log(`🏗️ Spawning extra builder for construction`);
      console.log(`🌟 ${CreepPersonality.getSpawnPhrase("builder")}`);
      return true;
    }
  }

  return false;
}

/**
 * Get current creep counts by role
 */
function getCurrentCreepCounts(room: Room): { [role: string]: number } {
  return {
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
  };
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
