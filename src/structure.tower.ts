/**
 * Tower Management
 *
 * Handles tower automation including attack, heal, and repair operations.
 * Executes defense plans and provides auto-repair functionality.
 */
// Debug/telemetry
const DEBUG_TOWER_REPAIR = false;

// Thresholds and targets (tune here)
const TOWER_REPAIR_CFG = {
  floorNoThreat: 400,
  floorThreat: 800,
  minWallsRepairEnergy: 950, // only top defenses when very full
};

function getTowerFloor(hostile: boolean): number {
  return hostile
    ? TOWER_REPAIR_CFG.floorThreat
    : TOWER_REPAIR_CFG.floorNoThreat;
}

function getRampartTarget(rcl: number): number {
  if (rcl < 4) return 3000;
  if (rcl < 6) return 10000;
  if (rcl < 8) return 30000;
  return 100000;
}

function getWallTarget(rcl: number): number {
  if (rcl < 6) return 5000;
  if (rcl < 8) return 20000;
  return 50000;
}

/// <reference types="@types/screeps" />
import { RoomCache } from "./room.cache";

/**
 * Execute tower actions from defense plan
 */
export function executeTowerActions(room: Room, defensePlan: any): void {
  if (!defensePlan.towerActions?.length) {
    // Fallback basic AI when no explicit plan provided
    runBasicTowerAI(room);
    return;
  }

  defensePlan.towerActions.forEach((action: any) => {
    const tower = Game.getObjectById<StructureTower>(action.towerId);
    if (!tower) return;

    switch (action.action) {
      case "ATTACK":
        if (action.targetId) {
          const target = Game.getObjectById<Creep>(action.targetId);
          if (target && target.owner && !target.my) {
            const result = tower.attack(target);
            if (result === OK && Game.time % 50 === 0) {
              console.log(
                `🏹 Tower attacking ${target.owner.username}'s ${
                  target.body[0]?.type || "creep"
                }`
              );
            }
          }
        }
        break;

      case "HEAL":
        if (action.targetId) {
          const target = Game.getObjectById<Creep>(action.targetId);
          if (target && target.my && target.hits < target.hitsMax) {
            const result = tower.heal(target);
            if (result === OK && Game.time % 50 === 0) {
              console.log(
                `💚 Tower healing ${target.name} (${target.hits}/${target.hitsMax} HP)`
              );
            }
          }
        }
        break;

      case "REPAIR":
        if (action.targetId) {
          const target = Game.getObjectById<Structure>(action.targetId);
          if (target && target.hits < target.hitsMax) {
            const result = tower.repair(target);
            if (result === OK && Game.time % 200 === 0) {
              console.log(`🔧 Tower repairing ${target.structureType}`);
            }
          }
        }
        break;
    }
  });
}

/**
 * Auto-repair critical structures with available tower energy
 */
export function performAutoRepair(room: Room): void {
  const towers = getTowersInRoom(room);
  if (towers.length === 0) return;

  // Per-tick guard to avoid multiple towers repairing the same target
  if (!Memory.rooms) Memory.rooms = {} as any;
  if (!Memory.rooms[room.name]) (Memory.rooms as any)[room.name] = {};
  const r = (Memory.rooms as any)[room.name];
  if (!r.towerRepair) r.towerRepair = {};
  const roomMem = r.towerRepair as any;
  if (roomMem.lastTick !== Game.time) {
    roomMem.lastTick = Game.time;
    roomMem.targets = {};
  }

  // One auto-repair action per room per tick to conserve energy
  // Prefer the fullest-energy tower so others stay buffered
  const hostile = RoomCache.hostileCreeps(room).length > 0;
  const rcl = room.controller?.level || 0;
  const towerFloor = getTowerFloor(hostile);
  const minCriticalRepair = Math.min(900, towerFloor + 100);
  const minWallsRepair = TOWER_REPAIR_CFG.minWallsRepairEnergy;
  const rampartTarget = getRampartTarget(rcl);
  const wallTarget = getWallTarget(rcl);

  const sorted = [...towers].sort(
    (a, b) =>
      b.store.getUsedCapacity(RESOURCE_ENERGY) -
      a.store.getUsedCapacity(RESOURCE_ENERGY)
  );

  let repaired = false;
  for (const tower of sorted) {
    if (repaired) break;
    const energy = tower.store.getUsedCapacity(RESOURCE_ENERGY);

    // CRITICAL: Save dying ramparts first - they decay to 0!
    const dyingRamparts = tower.pos.findInRange(FIND_STRUCTURES, 20, {
      filter: (s) => s.structureType === STRUCTURE_RAMPART && s.hits < 300,
    }) as StructureRampart[];

    if (dyingRamparts.length > 0 && energy >= 10) {
      const target = dyingRamparts.reduce((a, b) => (a.hits < b.hits ? a : b));
      if (!roomMem.targets[target.id]) {
        const res = tower.repair(target);
        if (res === OK) {
          console.log(`🚨 Emergency repair: Rampart at ${target.hits} HP`);
          roomMem.targets[target.id] = true;
          repaired = true;
          continue;
        }
      }
    }

    if (energy < minCriticalRepair) continue; // preserve buffer for other repairs

    // 1) Critical core structures at low HP
    const critical = tower.pos.findInRange(FIND_STRUCTURES, 20, {
      filter: (s) => {
        const hp = s.hits / s.hitsMax;
        if (hp < 0.35)
          return (
            s.structureType === STRUCTURE_SPAWN ||
            s.structureType === STRUCTURE_TOWER ||
            s.structureType === STRUCTURE_STORAGE ||
            s.structureType === STRUCTURE_TERMINAL ||
            s.structureType === STRUCTURE_EXTENSION
          );
        if (hp < 0.6)
          return (
            s.structureType === STRUCTURE_SPAWN ||
            s.structureType === STRUCTURE_TOWER
          );
        // Emergency: ramparts with < 100 HP will decay and die!
        if (s.structureType === STRUCTURE_RAMPART && s.hits < 100) {
          return true;
        }
        return false;
      },
    });
    if (critical.length > 0) {
      const target = critical.reduce((a, b) =>
        a.hits / a.hitsMax < b.hits / b.hitsMax ? a : b
      );
      // Skip if already handled this tick or already full
      if (roomMem.targets[target.id]) continue;
      if (target.hits >= target.hitsMax) continue;
      const res = tower.repair(target);
      if (res === OK && DEBUG_TOWER_REPAIR && Game.time % 200 === 0) {
        const pct = Math.round((target.hits / target.hitsMax) * 100);
        console.log(`🔧 Auto-repair: ${target.structureType} (${pct}%)`);
      }
      if (res === OK) {
        roomMem.targets[target.id] = true;
        repaired = true;
      }
      continue;
    }

    // 2) Ramparts (light topping) when very full and no hostiles
    if (
      !hostile &&
      energy >= minWallsRepair &&
      room.storage &&
      room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 50000
    ) {
      const ramparts = tower.pos.findInRange(FIND_STRUCTURES, 20, {
        filter: (s) => s.structureType === STRUCTURE_RAMPART && s.hits < 2000,
      }) as StructureRampart[];
      if (ramparts.length > 0) {
        const target = ramparts.reduce((a, b) => (a.hits < b.hits ? a : b));
        if (roomMem.targets[target.id]) continue;
        if (target.hits >= target.hitsMax) continue;
        const res = tower.repair(target);
        if (res === OK) {
          roomMem.targets[target.id] = true;
          repaired = true;
        }
        if (res === OK && DEBUG_TOWER_REPAIR && Game.time % 400 === 0) {
          console.log(`🛡️ Tower topped rampart to ${target.hits}`);
        }
        continue;
      }

      // 3) Walls (only extreme lows) when very full and no hostiles
      const walls = tower.pos.findInRange(FIND_STRUCTURES, 20, {
        filter: (s) => s.structureType === STRUCTURE_WALL && s.hits < 5000,
      }) as StructureWall[];
      if (walls.length > 0) {
        const target = walls.reduce((a, b) => (a.hits < b.hits ? a : b));
        if (roomMem.targets[target.id]) continue;
        if (target.hits >= target.hitsMax) continue;
        const res = tower.repair(target);
        if (res === OK) {
          roomMem.targets[target.id] = true;
          repaired = true;
        }
        if (res === OK && DEBUG_TOWER_REPAIR && Game.time % 600 === 0) {
          console.log(`🧱 Tower nudged wall to ${target.hits}`);
        }
      }
    }
  }
}

/**
 * Get all towers in a room
 */
export function getTowersInRoom(room: Room): StructureTower[] {
  return RoomCache.towers(room);
}

// Simple built-in tower AI when no defense plan issues orders
function runBasicTowerAI(room: Room): void {
  const towers = getTowersInRoom(room);
  for (const tower of towers) {
    // 1) Attack closest hostile, but filter out kiters
    const hostiles = RoomCache.hostileCreeps(room);
    const viableHostiles = hostiles.filter((hostile) => {
      // Filter out harassment/kiting targets
      const healParts = hostile.body.filter((p) => p.type === HEAL).length;
      const moveParts = hostile.body.filter((p) => p.type === MOVE).length;
      const attackParts = hostile.body.filter(
        (p) => p.type === ATTACK || p.type === RANGED_ATTACK
      ).length;
      const distance = tower.pos.getRangeTo(hostile.pos);

      const isFastCreep = moveParts >= hostile.body.length * 0.4;
      const nearEdge =
        hostile.pos.x <= 5 ||
        hostile.pos.x >= 44 ||
        hostile.pos.y <= 5 ||
        hostile.pos.y >= 44;
      const isHealerKiter =
        healParts > 0 && attackParts <= 3 && healParts >= attackParts * 0.75;

      // Skip if it's a kiter that can outheal us or has mostly heals
      if (healParts > 0 && (isHealerKiter || isFastCreep) && nearEdge) {
        // Tower damage formula: 600 at range <=5, linear falloff to 150 at range 20+
        let towerDamage = 600;
        if (distance > 5) {
          towerDamage = Math.max(150, 600 - (distance - 5) * 30);
        }
        const healRate = healParts * 12;
        const netDamage = towerDamage - healRate;

        if (netDamage <= 200) {
          // Need at least 200 net damage - otherwise takes too many hits
          if (Game.time % 100 === 0) {
            console.log(
              `🚫 Ignoring kiter ${
                hostile.owner.username
              }: ${healParts} HEAL vs ${Math.round(
                towerDamage
              )} dmg (net: ${Math.round(netDamage)})`
            );
          }
          return false; // Don't waste energy
        }
      }

      return true;
    });

    const hostile = tower.pos.findClosestByRange(viableHostiles);
    if (hostile) {
      const res = tower.attack(hostile);
      if (res === OK && Game.time % 50 === 0) {
        console.log(`🏹 Tower ${tower.pos.x},${tower.pos.y} attacking hostile`);
      }
      continue;
    }

    // 2) Heal friendly creeps if injured
    const wounded = tower.pos.findClosestByRange(FIND_MY_CREEPS, {
      filter: (c) => c.hits < c.hitsMax,
    });
    if (wounded) {
      const res = tower.heal(wounded);
      if (res === OK && Game.time % 100 === 0) {
        console.log(
          `💚 Tower ${tower.pos.x},${tower.pos.y} healing ${wounded.name}`
        );
      }
      continue;
    }

    // 3) Frugal auto-repair using existing logic
    if (tower.store.getUsedCapacity(RESOURCE_ENERGY) >= 700) {
      const critical = tower.pos.findInRange(FIND_STRUCTURES, 20, {
        filter: (s) => {
          const hp = s.hits / s.hitsMax;
          if (hp < 0.3)
            return (
              s.structureType === STRUCTURE_SPAWN ||
              s.structureType === STRUCTURE_TOWER ||
              s.structureType === STRUCTURE_STORAGE ||
              s.structureType === STRUCTURE_TERMINAL
            );
          if (hp < 0.6)
            return (
              s.structureType === STRUCTURE_SPAWN ||
              s.structureType === STRUCTURE_TOWER
            );
          return false;
        },
      });
      if (critical.length) {
        const target = critical.reduce((a, b) =>
          a.hits / a.hitsMax < b.hits / b.hitsMax ? a : b
        );
        tower.repair(target);
      }
    }
  }
}

/**
 * Get tower status for room intelligence
 */
export function getTowerStatus(room: Room): any {
  const towers = getTowersInRoom(room);

  return {
    count: towers.length,
    totalEnergy: towers.reduce(
      (sum, tower) => sum + tower.store.getUsedCapacity(RESOURCE_ENERGY),
      0
    ),
    totalCapacity: towers.reduce(
      (sum, tower) => sum + tower.store.getCapacity(RESOURCE_ENERGY),
      0
    ),
    readyToFire: towers.filter(
      (tower) => tower.store.getUsedCapacity(RESOURCE_ENERGY) >= 10
    ).length,
  };
}

/**
 * Check if towers need energy refill
 */
export function getTowersNeedingEnergy(room: Room): StructureTower[] {
  const towers = getTowersInRoom(room);
  return towers.filter(
    (tower) => tower.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  );
}
