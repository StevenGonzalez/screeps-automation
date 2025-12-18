/// <reference types="@types/screeps" />
import { ConstructionPlan, ConstructionTask } from "./construction";
import { getHotTrafficTiles } from "./traffic";

// Max construction sites per player is 100. Keep a buffer.
const GLOBAL_SITE_BUFFER = 5;
// Baseline per-room site budget; actual budget is computed dynamically
const BASE_SITES_PER_TICK = 2;

export function executeConstructionPlan(
  room: Room,
  plan: ConstructionPlan,
  intel: any
): void {
  if (!room.controller || !room.controller.my) return;
  if (!plan || !plan.queue?.length) return;

  // EMERGENCY MODE: Skip most construction during energy crisis
  // EXCEPTION: Allow source containers - they're critical for economy recovery
  const storage = room.storage;
  const energyStored = (storage?.store.energy || 0);
  const isEmergencyMode = energyStored < 20000 && intel.economy?.netFlow < 0;
  
  if (isEmergencyMode) {
    // Filter plan to only allow source containers and critical structures
    const sources = room.find(FIND_SOURCES);
    const allowedTasks = plan.queue.filter(task => {
      // Allow containers near sources (within 2 tiles)
      if (task.type === STRUCTURE_CONTAINER) {
        return sources.some(source => 
          task.pos.getRangeTo(source.pos) <= 2
        );
      }
      // Allow spawns/extensions if we have very few
      if (task.type === STRUCTURE_SPAWN) return true;
      const extensions = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_EXTENSION
      });
      if (task.type === STRUCTURE_EXTENSION && extensions.length < 3) return true;
      
      return false;
    });
    
    // Override the plan queue with filtered tasks
    plan = { ...plan, queue: allowedTasks };
    if (allowedTasks.length === 0) return;
  }

  // Respect global construction site cap
  const totalSites = Object.keys(Game.constructionSites).length;
  const remainingGlobal = Math.max(0, 100 - GLOBAL_SITE_BUFFER - totalSites);
  if (remainingGlobal <= 0) return;

  // Determine how many to place this tick in this room (dynamic pacing)
  let budget = Math.min(
    computeRoomSiteBudget(room, plan, intel),
    remainingGlobal
  );

  // Prioritize tasks based on plan.priorities (critical -> important -> normal -> deferred)
  const prioritized: ConstructionTask[] = [
    ...(plan.priorities?.critical || []),
    ...(plan.priorities?.important || []),
    ...(plan.priorities?.normal || []),
    ...(plan.priorities?.deferred || []),
  ];

  // Collect reserved structure tiles (non-road planned structures) to avoid placing roads there (core oscillation fix)
  const reservedForStructures = new Set<string>();
  for (const t of prioritized) {
    if (t.pos.roomName !== room.name) continue;
    if (t.type === STRUCTURE_ROAD || t.type === STRUCTURE_RAMPART) continue;
    reservedForStructures.add(`${t.pos.x}:${t.pos.y}`);
  }

  // Pre-scan: how many non-road tasks are actually placeable right now?
  let nonRoadPlaceableRemaining = 0;
  for (const t of prioritized) {
    if (t.pos.roomName !== room.name) continue;
    if (t.type === STRUCTURE_ROAD) continue;
    if (
      dependenciesSatisfied(room, t) &&
      withinRclLimits(room, t.type) &&
      isBuildable(room, t.pos, t.type) &&
      !alreadyBuiltOrQueued(room, t.pos, t.type)
    ) {
      nonRoadPlaceableRemaining++;
    }
  }

  // Compute how many road placements we allow this tick; focus on other structures first
  let roadQuota = computeRoadQuota(
    room,
    intel,
    budget,
    nonRoadPlaceableRemaining
  );
  let roadsUsed = 0;

  for (const task of prioritized) {
    if (budget <= 0) break;
    if (task.pos.roomName !== room.name) continue;

    // At low RCL, hard-block roads until essentials exist: at least one extension and source containers
    if (
      (task.type === STRUCTURE_ROAD || task.type === STRUCTURE_RAMPART) &&
      room.controller &&
      room.controller.level <= 3
    ) {
      const haveSomeExtensions =
        (getStructureCounts(room)[STRUCTURE_EXTENSION] || 0) > 0;
      const haveSourceContainers = room
        .find(FIND_SOURCES)
        .every((s) =>
          room
            .lookForAtArea(
              LOOK_STRUCTURES,
              s.pos.y - 1,
              s.pos.x - 1,
              s.pos.y + 1,
              s.pos.x + 1,
              true
            )
            .some((i) => i.structure.structureType === STRUCTURE_CONTAINER)
        );
      if (!haveSomeExtensions || !haveSourceContainers) {
        // Defer cosmetic/surface infrastructure until essentials exist
        continue;
      }
    }

    // If it's a road but we still have non-road tasks we can place and we've hit road quota, skip
    if (
      task.type === STRUCTURE_ROAD &&
      nonRoadPlaceableRemaining > 0 &&
      roadsUsed >= roadQuota
    ) {
      continue;
    }

    if (!dependenciesSatisfied(room, task)) continue;
    if (!withinRclLimits(room, task.type)) continue;
    if (!isBuildable(room, task.pos, task.type)) {
      // Special case: if placing a non-road/non-rampart structure and a road (structure or site) blocks it, remove it and retry later
      // Note: Ramparts can be placed on top of roads, so skip this logic for ramparts
      if (task.type !== STRUCTURE_ROAD && task.type !== STRUCTURE_RAMPART) {
        const structs = task.pos.lookFor(LOOK_STRUCTURES);
        const road = structs.find((s) => s.structureType === STRUCTURE_ROAD);
        if (road) {
          const res = road.destroy();
          if (res === OK) {
            continue;
          }
        }
        const sites = task.pos.lookFor(LOOK_CONSTRUCTION_SITES);
        const roadSite = sites.find((s) => s.structureType === STRUCTURE_ROAD);
        if (roadSite) {
          roadSite.remove();
          continue;
        }
      }
      continue;
    }
    if (alreadyBuiltOrQueued(room, task.pos, task.type)) continue;

    const result = room.createConstructionSite(task.pos, task.type);
    if (result === OK) {
      budget--;
      if (task.type === STRUCTURE_ROAD) {
        roadsUsed++;
      } else if (nonRoadPlaceableRemaining > 0) {
        nonRoadPlaceableRemaining--;
      }
      // Optional: log strategic placement
      // console.log(`📐 ${room.name}: Placed ${task.type} @ ${task.pos.x},${task.pos.y} (${task.reason})`);
    } else if (result === ERR_INVALID_TARGET || result === ERR_FULL) {
      continue;
    }
  }

  // After running planned tasks, try a tiny number of heatmap roads if we still have budget
  if (budget > 0) {
    const rcl = room.controller?.level || 0;
    const energyAvail =
      intel?.economy?.energyAvailable ?? room.energyAvailable ?? 0;
    const energyCap =
      intel?.economy?.energyCapacity ?? room.energyCapacityAvailable ?? 300;
    const stored =
      intel?.economy?.energyStored ??
      (room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) || 0);
    const energyRatio = Math.max(
      0,
      Math.min(1, energyAvail / Math.max(1, energyCap))
    );
    const wellStocked = stored > 10000 || energyRatio > 0.6;

    // Gate: don't place heat roads early or when economy is weak
    if (rcl >= 3 && wellStocked) {
      const maxHot = Math.min(5, budget); // Increased from 2 to 5 for faster coverage
      // Threshold scales with room level to avoid noise
      // Lower thresholds to catch more traffic patterns: 8 at RCL3, 12 at RCL5, 15 at RCL7
      const threshold = Math.max(6, Math.min(15, 5 + rcl * 1.5));
      const hot = getHotTrafficTiles(room, threshold, maxHot);

      for (const pos of hot) {
        if (budget <= 0) break;
        if (!withinRclLimits(room, STRUCTURE_ROAD)) break;
        // Skip heatmap road if tile reserved for a future structure
        if (reservedForStructures.has(`${pos.x}:${pos.y}`)) continue;
        if (!isBuildable(room, pos, STRUCTURE_ROAD)) continue;
        if (alreadyBuiltOrQueued(room, pos, STRUCTURE_ROAD)) continue;
        const res = room.createConstructionSite(pos, STRUCTURE_ROAD);
        if (res === OK) {
          budget--;
          console.log(
            `🛣️ ${room.name}: Placed heatmap road @ ${pos.x},${pos.y}`
          );
        }
      }
    }
  }
}

function computeRoadQuota(
  room: Room,
  intel: any,
  budget: number,
  nonRoadPlaceableRemaining: number
): number {
  // If there are no non-road tasks, roads can take full budget
  if (nonRoadPlaceableRemaining <= 0) return budget;

  const energyAvail =
    intel?.economy?.energyAvailable ?? room.energyAvailable ?? 0;
  const energyCap =
    intel?.economy?.energyCapacity ?? room.energyCapacityAvailable ?? 300;
  const stored =
    intel?.economy?.energyStored ??
    (room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) || 0);
  const energyRatio = Math.max(
    0,
    Math.min(1, energyAvail / Math.max(1, energyCap))
  );
  const storedFactor = Math.max(0.5, Math.min(1.5, stored / 50000));

  // Base quota: small fraction of budget
  let quota = Math.floor(budget * 0.25);
  quota = Math.max(0, Math.min(quota, 2));

  // If economy is tight, halt road placements to focus on structures
  if (energyRatio < 0.5 && storedFactor < 1) return 0;

  // Ensure at least 1 road occasionally if we have budget
  return Math.max(1, quota);
}

function computeRoomSiteBudget(
  room: Room,
  plan: ConstructionPlan,
  intel: any
): number {
  const builders = (intel?.creeps?.byRole?.builder as number) || 0;
  const energyAvail =
    intel?.economy?.energyAvailable ?? room.energyAvailable ?? 0;
  const energyCap =
    intel?.economy?.energyCapacity ?? room.energyCapacityAvailable ?? 300;
  const stored =
    intel?.economy?.energyStored ??
    (room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) || 0);

  const energyRatio = Math.max(
    0,
    Math.min(1, energyAvail / Math.max(1, energyCap))
  );
  const storedFactor = Math.max(0.5, Math.min(1.5, stored / 50000)); // small boost if well-stocked

  // Start with baseline, add capacity with more builders
  let target = BASE_SITES_PER_TICK + Math.floor(builders / 2);
  // Scale by current energy availability and stock
  target = Math.floor(target * (0.5 + 0.5 * energyRatio) * storedFactor);

  // Keep within sane bounds
  if (room.controller) {
    const rcl = room.controller.level;
    const cap = rcl <= 3 ? 2 : rcl <= 5 ? 3 : 5;
    target = Math.min(target, cap);
  }
  return Math.max(1, target);
}

function dependenciesSatisfied(room: Room, task: ConstructionTask): boolean {
  if (!task.dependencies || task.dependencies.length === 0) return true;
  const existing = getStructureCounts(room);
  for (const dep of task.dependencies) {
    switch (dep) {
      case "storage":
        if ((existing[STRUCTURE_STORAGE] || 0) === 0) return false;
        break;
      case "terminal":
        if ((existing[STRUCTURE_TERMINAL] || 0) === 0) return false;
        break;
      default:
        // Unknown dependency label, ignore
        break;
    }
  }
  return true;
}

function withinRclLimits(
  room: Room,
  type: BuildableStructureConstant
): boolean {
  const rcl = room.controller?.level || 0;
  const limits: Partial<Record<StructureConstant, number>> = {
    [STRUCTURE_SPAWN]: rcl < 7 ? 1 : rcl < 8 ? 2 : 3,
    [STRUCTURE_EXTENSION]: [0, 0, 5, 10, 20, 30, 40, 50, 60][rcl] || 0,
    [STRUCTURE_TOWER]:
      rcl < 3 ? 0 : rcl < 5 ? 1 : rcl < 7 ? 2 : rcl < 8 ? 3 : 6,
    [STRUCTURE_LINK]: rcl < 5 ? 0 : rcl < 6 ? 2 : rcl < 7 ? 3 : rcl < 8 ? 4 : 6,
    [STRUCTURE_LAB]: rcl < 6 ? 0 : rcl < 7 ? 3 : rcl < 8 ? 6 : 10,
    [STRUCTURE_STORAGE]: rcl >= 4 ? 1 : 0,
    [STRUCTURE_TERMINAL]: rcl >= 6 ? 1 : 0,
    [STRUCTURE_FACTORY]: rcl >= 7 ? 1 : 0,
    [STRUCTURE_POWER_SPAWN]: rcl >= 8 ? 1 : 0,
    [STRUCTURE_CONTAINER]: 5, // soft cap; game allows many but we control via planner
    [STRUCTURE_ROAD]: 2500, // practical large limit
    [STRUCTURE_RAMPART]: 300,
    [STRUCTURE_EXTRACTOR]: rcl >= 6 ? 1 : 0,
  };

  const limit = limits[type] ?? 0;
  if (limit === 0)
    return type === STRUCTURE_ROAD || type === STRUCTURE_RAMPART ? true : false;

  const counts = getStructureCounts(room);
  const existing = counts[type] || 0;
  const queued = countQueued(room, type);
  return existing + queued < limit;
}

function getStructureCounts(
  room: Room
): Partial<Record<StructureConstant, number>> {
  const all = room.find(FIND_STRUCTURES);
  const counts: Partial<Record<StructureConstant, number>> = {};
  for (const s of all)
    counts[s.structureType] = (counts[s.structureType] || 0) + 1;
  return counts;
}

function countQueued(room: Room, type: BuildableStructureConstant): number {
  const sites = room.find(FIND_CONSTRUCTION_SITES);
  return sites.filter((s) => s.structureType === type).length;
}

function isBuildable(
  room: Room,
  pos: RoomPosition,
  type: BuildableStructureConstant
): boolean {
  // Avoid walls, respect bounds, and avoid blocking controller/exit tiles
  if (pos.x <= 0 || pos.x >= 49 || pos.y <= 0 || pos.y >= 49) return false;
  const terrain = room.getTerrain();
  const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
  if (sites.length > 0) return false;

  const structs = pos.lookFor(LOOK_STRUCTURES);
  if (type === STRUCTURE_EXTRACTOR) {
    // Allow extractor on wall terrain if mineral is present and no structure/site exists
    const mineral = pos.lookFor(LOOK_MINERALS)[0];
    if (!mineral) return false;
    if (structs.length > 0) return false;
    return true;
  }
  if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) return false;
  if (type === STRUCTURE_RAMPART) {
    // Ramparts may be placed over existing structures to protect them
    return true;
  }
  if (type === STRUCTURE_ROAD) {
    // Allow road if there's no blocking non-road structure
    return !structs.some(
      (s) =>
        s.structureType !== STRUCTURE_ROAD &&
        s.structureType !== STRUCTURE_RAMPART
    );
  }
  // For other structures, tile must be empty
  return structs.length === 0;
}

function alreadyBuiltOrQueued(
  room: Room,
  pos: RoomPosition,
  type: BuildableStructureConstant
): boolean {
  const structs = pos.lookFor(LOOK_STRUCTURES);
  if (structs.some((s) => s.structureType === type)) return true;
  const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
  if (sites.some((s) => s.structureType === type)) return true;
  return false;
}
