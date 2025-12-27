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
  if (rcl < 4) return 10000;
  if (rcl < 6) return 50000;
  if (rcl < 8) return 300000;
  return 1000000; // 1M HP at RCL 8 - much safer!
}

function getWallTarget(rcl: number): number {
  if (rcl < 6) return 10000;
  if (rcl < 8) return 100000;
  return 500000; // 500k HP at RCL 8
}

/// <reference types="@types/screeps" />
import { RoomCache } from "../room/cache";
import { 
  countBodyParts,
  isFastCreep,
  isNearRoomEdge,
  isHealerKiter,
  isDrainTank,
  isEfficientTarget
} from "../utils/combat.utils";

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

  // EMERGENCY MODE: Skip all repairs during energy crisis (let towers save energy for defense)
  // Only applies to rooms with storage (RCL 4+)
  const storage = room.storage;
  const energyStored = (storage?.store.energy || 0);
  const isEmergencyMode = storage && energyStored < 20000;
  if (isEmergencyMode) return;

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

    // CRITICAL: Save dying structures first - INCREASED THRESHOLDS
    const dyingStructures = tower.pos.findInRange(FIND_STRUCTURES, 20, {
      filter: (s) =>
        (s.structureType === STRUCTURE_RAMPART && s.hits < 5000) || // Ramparts decay fast!
        (s.structureType === STRUCTURE_CONTAINER && s.hits < 1500) ||
        (s.structureType === STRUCTURE_ROAD && s.hits < 500),
    });

    if (dyingStructures.length > 0 && energy >= 10) {
      const target = dyingStructures.reduce((a, b) => (a.hits < b.hits ? a : b));
      if (!roomMem.targets[target.id]) {
        const res = tower.repair(target);
        if (res === OK) {
          console.log(`🚨 Emergency repair: ${target.structureType} at ${target.hits} HP`);
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
        // Emergency: ramparts with < 10k HP need immediate attention!
        if (s.structureType === STRUCTURE_RAMPART && s.hits < 10000) {
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

    // 2) Ramparts - maintain healthy levels even during threats
    // Repair ramparts more aggressively to prevent breakthrough
    const rampartRepairThreshold = hostile ? 50000 : rampartTarget * 0.8;
    if (energy >= minWallsRepair) {
      const ramparts = tower.pos.findInRange(FIND_STRUCTURES, 20, {
        filter: (s) => s.structureType === STRUCTURE_RAMPART && s.hits < rampartRepairThreshold,
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

      // 3) Walls - maintain healthy levels
      const wallRepairThreshold = hostile ? 30000 : wallTarget * 0.7;
      const walls = tower.pos.findInRange(FIND_STRUCTURES, 20, {
        filter: (s) => s.structureType === STRUCTURE_WALL && s.hits < wallRepairThreshold,
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
    const towerEnergy = tower.store.getUsedCapacity(RESOURCE_ENERGY);
    
    // CRITICAL: Preserve energy during drain attacks
    // If tower is low on energy, be VERY selective about targets
    const energyPreserveMode = towerEnergy < 500;
    const maxEnergyPerTarget = energyPreserveMode ? 200 : 500;
    
    // 1) Attack viable hostiles, but AVOID ENERGY DRAINS
    const hostiles = RoomCache.hostileCreeps(room);
    const viableHostiles = hostiles.filter((hostile: Creep) => {
      const distance = tower.pos.getRangeTo(hostile.pos);
      
      // ANTI-DRAIN: Skip tanks with TOUGH parts that would drain our energy
      if (isDrainTank(hostile)) {
        // Check if there are healers nearby supporting this tank
        const nearbyHealers = hostiles.filter((h: Creep) => {
          return h.id !== hostile.id && 
                 countBodyParts(h, HEAL) > 0 && 
                 h.pos.getRangeTo(hostile.pos) <= 3;
        });
        
        if (nearbyHealers.length > 0 || countBodyParts(hostile, HEAL) > 0) {
          if (Game.time % 50 === 0) {
            console.log(
              `🚫 DRAIN DETECTED: Ignoring tank ${hostile.owner.username} with ${nearbyHealers.length} healers - PRESERVING ENERGY`
            );
          }
          return false;
        }
      }
      
      // ANTI-DRAIN: Check energy efficiency before attacking
      if (!isEfficientTarget(hostile, tower, room, maxEnergyPerTarget)) {
        if (Game.time % 50 === 0) {
          console.log(
            `🚫 Energy inefficient target ${hostile.owner.username} - would waste ${maxEnergyPerTarget}+ energy`
          );
        }
        return false;
      }
      
      // Skip edge kiters (harassment)
      const healParts = countBodyParts(hostile, HEAL);
      if (healParts > 3 && isHealerKiter(hostile) && isNearRoomEdge(hostile.pos)) {
        let towerDamage = 600;
        if (distance > 5) {
          towerDamage = Math.max(150, 600 - (distance - 5) * 30);
        }
        const healRate = healParts * 12;
        const netDamage = towerDamage - healRate;

        if (netDamage <= 50) {
          if (Game.time % 100 === 0) {
            console.log(
              `🚫 Ignoring invulnerable kiter ${
                hostile.owner.username
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

    const hostile = tower.pos.findClosestByRange(
      viableHostiles
    ) as Creep | null;
    if (hostile) {
      const res = tower.attack(hostile);
      if (res === OK && Game.time % 50 === 0) {
        console.log(`🏹 Tower ${tower.pos.x},${tower.pos.y} attacking hostile`);
      }
      
      // Warn if energy is getting critically low
      if (towerEnergy < 300 && Game.time % 25 === 0) {
        console.log(`⚠️ Tower ${tower.pos.x},${tower.pos.y} low energy: ${towerEnergy} - DRAIN ATTACK?`);
      }
      continue;
    } else if (hostiles.length > 0 && viableHostiles.length === 0) {
      // All hostiles filtered out - likely drain attack!
      if (Game.time % 50 === 0) {
        console.log(`🛡️ DRAIN ATTACK DETECTED - All ${hostiles.length} hostiles filtered as energy drains`);
      }
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
