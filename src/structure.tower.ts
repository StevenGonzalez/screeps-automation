/**
 * Tower Management
 *
 * Handles tower automation including attack, heal, and repair operations.
 * Executes defense plans and provides auto-repair functionality.
 */

/// <reference types="@types/screeps" />

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

  towers.forEach((tower) => {
    // Only use towers for repair if they have plenty of energy
    if (tower.store.getUsedCapacity(RESOURCE_ENERGY) < 600) return;

    // Priority repair targets
    const criticalTargets = tower.pos.findInRange(FIND_STRUCTURES, 20, {
      filter: (s) => {
        const healthPercent = s.hits / s.hitsMax;

        // Critical structures need immediate repair
        if (healthPercent < 0.3) {
          return (
            s.structureType === STRUCTURE_SPAWN ||
            s.structureType === STRUCTURE_TOWER ||
            s.structureType === STRUCTURE_STORAGE ||
            s.structureType === STRUCTURE_TERMINAL
          );
        }

        // Important structures at medium damage
        if (healthPercent < 0.6) {
          return (
            s.structureType === STRUCTURE_SPAWN ||
            s.structureType === STRUCTURE_TOWER
          );
        }

        // Minor repairs for walls/ramparts only if tower is very full
        if (
          healthPercent < 0.8 &&
          tower.store.getUsedCapacity(RESOURCE_ENERGY) > 800
        ) {
          return (
            s.structureType === STRUCTURE_WALL ||
            s.structureType === STRUCTURE_RAMPART
          );
        }

        return false;
      },
    });

    // Repair the most damaged critical structure first
    if (criticalTargets.length > 0) {
      const target = criticalTargets.reduce((prev, curr) =>
        prev.hits / prev.hitsMax < curr.hits / curr.hitsMax ? prev : curr
      );

      const result = tower.repair(target);
      if (
        result === OK &&
        (Game.time % 200 === 0 ||
          Math.round((target.hits / target.hitsMax) * 100) < 20)
      ) {
        const healthPercent = Math.round((target.hits / target.hitsMax) * 100);
        console.log(
          `🔧 Auto-repair: ${target.structureType} (${healthPercent}%)`
        );
      }
    }
  });
}

/**
 * Get all towers in a room
 */
export function getTowersInRoom(room: Room): StructureTower[] {
  return room.find(FIND_MY_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_TOWER,
  }) as StructureTower[];
}

// Simple built-in tower AI when no defense plan issues orders
function runBasicTowerAI(room: Room): void {
  const towers = getTowersInRoom(room);
  for (const tower of towers) {
    // 1) Attack closest hostile
    const hostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
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
