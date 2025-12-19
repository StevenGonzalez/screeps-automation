/// <reference types="@types/screeps" />
import { visualPath } from "../path.styles";
import { CreepPersonality } from "./personality";
import { getTowersInRoom } from "../structure/tower";
import { RoomCache } from "../room/cache";
import { planRoomDefense } from "../defense/planner";
import {
  getDefenseRepairTargets,
  shouldRepairDefense,
} from "../defense/maintenance";

export function runRepairer(creep: Creep, intel: any): void {
  // EMERGENCY MODE: Only critical repairs during energy crisis (only if storage exists)
  const storage = creep.room.storage;
  const energyStored = (storage?.store.energy || 0);
  const isEmergencyMode = storage && energyStored < 20000 && intel.economy?.netFlow < 0;

  // If towers are well-stocked, let them handle most emergency repairs.
  const towers = getTowersInRoom(creep.room);
  const towerHighEnergy = towers.some(
    (t: StructureTower) => t.store.getUsedCapacity(RESOURCE_ENERGY) >= 700
  );

  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
    const stores = creep.room.find(FIND_STRUCTURES, {
      filter: (s: AnyStructure) =>
        (s.structureType === STRUCTURE_CONTAINER ||
          s.structureType === STRUCTURE_STORAGE) &&
        (s as AnyStoreStructure).store.getUsedCapacity(RESOURCE_ENERGY) > 0,
    }) as AnyStoreStructure[];
    const target = creep.pos.findClosestByPath(stores);
    if (target) {
      const res = creep.withdraw(target, RESOURCE_ENERGY);
      if (res === ERR_NOT_IN_RANGE) {
        creep.moveTo(target);
        CreepPersonality.speak(creep, "move");
      } else if (res === OK) {
        CreepPersonality.speak(creep, "withdraw");
      }
    } else {
      CreepPersonality.speak(creep, "frustrated");
    }
  } else {
    // Get defense plan for intelligent repair
    const defensePlan = planRoomDefense(creep.room);

    // 1) Prioritize truly critical non-fortification structures
    // ALWAYS repair spawns, towers, storage, extensions at <30%
    // In emergency: also repair containers and extensions at <50%
    const criticalThreshold = isEmergencyMode ? 0.3 : (towerHighEnergy ? 0.2 : 0.3);
    const critical = creep.room.find(FIND_STRUCTURES, {
      filter: (s) =>
        s.hits < s.hitsMax * criticalThreshold &&
        s.structureType !== STRUCTURE_WALL &&
        s.structureType !== STRUCTURE_RAMPART,
    });
    const pickMostDamaged = (arr: Structure[]) =>
      arr.reduce((a, b) => (a.hits / a.hitsMax < b.hits / b.hitsMax ? a : b));

    let target: Structure | null = null;
    if (critical.length) target = pickMostDamaged(critical);

    // EMERGENCY MODE CRITICAL: Repair containers and extensions before they decay completely
    if (!target && isEmergencyMode) {
      const emergencyCritical = creep.room.find(FIND_STRUCTURES, {
        filter: (s) =>
          (s.structureType === STRUCTURE_CONTAINER && s.hits < s.hitsMax * 0.5) ||
          (s.structureType === STRUCTURE_EXTENSION && s.hits < s.hitsMax * 0.5)
      });
      if (emergencyCritical.length) {
        target = pickMostDamaged(emergencyCritical);
      }
    }

    // 2) Defense structures (ramparts/walls) using intelligent prioritization
    // SKIP IN EMERGENCY MODE - ramparts/walls are energy sinks
    if (!target && !isEmergencyMode) {
      const defenseTargets = getDefenseRepairTargets(
        creep.room,
        defensePlan,
        10
      );
      if (defenseTargets.length > 0) {
        // Find closest defense target that needs repair
        target =
          creep.pos.findClosestByPath(defenseTargets) || defenseTargets[0];
      }
    }

    // 3) Containers - repair early to prevent decay (at 80%)
    // Skip in emergency mode - let them decay if needed
    if (!target && !isEmergencyMode) {
      const containers = creep.room.find(FIND_STRUCTURES, {
        filter: (s) =>
          s.structureType === STRUCTURE_CONTAINER && s.hits < s.hitsMax * 0.8,
      });
      if (containers.length) target = pickMostDamaged(containers);
    }

    // 4) Roads - only if significantly damaged (40% or less)
    // Skip in emergency mode
    // Roads decay constantly so we only repair when really needed
    if (!target && !isEmergencyMode) {
      const roads = creep.room.find(FIND_STRUCTURES, {
        filter: (s) =>
          s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax * 0.4,
      });
      if (roads.length) target = pickMostDamaged(roads);
    }

    // 5) Any other structure needing repair (excluding thick walls)
    // If towers are well-stocked, skip small top-offs and let towers handle emergencies
    if (!target && !towerHighEnergy) {
      const any = creep.room.find(FIND_STRUCTURES, {
        filter: (s) => s.hits < s.hitsMax && s.structureType !== STRUCTURE_WALL,
      });
      if (any.length) target = pickMostDamaged(any);
    }

    if (target) {
      const res = creep.repair(target);
      if (res === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { ...visualPath("repair") });
        CreepPersonality.speak(creep, "move");
      } else if (res === OK) {
        CreepPersonality.speak(creep, "repair");
      }
    } else {
      // Fallback: help with building or upgrading
      const site = creep.pos.findClosestByPath(
        RoomCache.constructionSites(creep.room)
      );
      if (site) {
        const res = creep.build(site as ConstructionSite);
        if (res === ERR_NOT_IN_RANGE)
          creep.moveTo(site, { ...visualPath("build") });
      } else if (creep.room.controller) {
        const res = creep.upgradeController(creep.room.controller);
        if (res === ERR_NOT_IN_RANGE)
          creep.moveTo(creep.room.controller, {
            ...visualPath("upgrade"),
          });
      }
    }
  }
}
