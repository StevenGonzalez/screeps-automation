/// <reference types="@types/screeps" />
import { ConstructionPlan, ConstructionTask } from "./room.construction";

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

  // Respect global construction site cap
  const totalSites = Object.keys(Game.constructionSites).length;
  const remainingGlobal = Math.max(0, 100 - GLOBAL_SITE_BUFFER - totalSites);
  if (remainingGlobal <= 0) return;

  // Determine how many to place this tick in this room (dynamic pacing)
  let budget = Math.min(
    computeRoomSiteBudget(room, plan, intel),
    remainingGlobal
  );

  // Prioritize tasks based on plan.priorities (critical -> important -> normal)
  const prioritized: ConstructionTask[] = [
    ...(plan.priorities?.critical || []),
    ...(plan.priorities?.important || []),
    ...(plan.priorities?.normal || []),
  ];

  for (const task of prioritized) {
    if (budget <= 0) break;
    if (task.pos.roomName !== room.name) continue;

    if (!dependenciesSatisfied(room, task)) continue;
    if (!withinRclLimits(room, task.type)) continue;
    if (!isBuildable(room, task.pos, task.type)) continue;
    if (alreadyBuiltOrQueued(room, task.pos, task.type)) continue;

    const result = room.createConstructionSite(task.pos, task.type);
    if (result === OK) {
      budget--;
      // Optional: log strategic placement
      console.log(
        `📐 ${room.name}: Placed ${task.type} @ ${task.pos.x},${task.pos.y} (${task.reason})`
      );
    } else if (result === ERR_INVALID_TARGET || result === ERR_FULL) {
      // Skip bad target or local site limit reached
      continue;
    }
  }
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
  if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) return false;

  const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
  if (sites.length > 0) return false;

  const structs = pos.lookFor(LOOK_STRUCTURES);
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
