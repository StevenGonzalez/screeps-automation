import { TOWN } from "../config/config.town";
import { townBarrierTiles } from "./services.town";
import {
  closestByPath,
  getRoomStructures,
  getDangerPositions,
  isPositionSafe,
} from "./services.creep.room";

let criticalRepairCacheTick = -1;

const criticalRepairByRoom: Record<string, AnyStructure | null> = {};

let towerRepairCacheTick = -1;

const towerRepairByRoom: Record<string, AnyStructure | null> = {};

let nukeTargetCacheTick = -1;

const nukeTargetByRoom: Record<string, StructureRampart | null> = {};

export function findClosestConstructionSite(
  creep: Creep
): ConstructionSite | null {
  const sites = creep.room.find(FIND_MY_CONSTRUCTION_SITES) as ConstructionSite[];
  if (!sites || sites.length === 0) return null;

  // Walk priority tiers best-first; return the closest reachable site in the
  // highest-priority tier that has one, so we never fall back to a low-value
  // structure (rampart, road) while a better site is still reachable.
  const ranked = sites
    .map((s) => ({ s, p: sitePriority(s) }))
    .sort((a, b) => a.p - b.p);

  let i = 0;
  while (i < ranked.length) {
    const tier = ranked[i].p;
    const group: ConstructionSite[] = [];
    while (i < ranked.length && ranked[i].p === tier) {
      group.push(ranked[i].s);
      i++;
    }
    const reachable = closestByPath(creep.pos, group);
    if (reachable) return reachable;
  }

  return null;
}

const SITE_BUILD_PRIORITY: Partial<Record<StructureConstant, number>> = {
  [STRUCTURE_SPAWN]: 0,
  [STRUCTURE_EXTENSION]: 1,
  [STRUCTURE_CONTAINER]: 2,
  [STRUCTURE_TOWER]: 3,
  [STRUCTURE_STORAGE]: 4,
  [STRUCTURE_TERMINAL]: 5,
  [STRUCTURE_LINK]: 6,
  [STRUCTURE_EXTRACTOR]: 6,
  [STRUCTURE_LAB]: 7,
  [STRUCTURE_FACTORY]: 8,
  [STRUCTURE_NUKER]: 9,
  [STRUCTURE_POWER_SPAWN]: 9,
  [STRUCTURE_OBSERVER]: 9,
  [STRUCTURE_RAMPART]: 10,
  [STRUCTURE_ROAD]: 11,
};

const SOURCE_CONTAINER_PRIORITY = 2;

const CONTROLLER_CONTAINER_PRIORITY = 4;

const MINERAL_CONTAINER_PRIORITY = 12;

function sitePriority(s: ConstructionSite): number {
  if (s.structureType === STRUCTURE_CONTAINER) {
    if (s.pos.findInRange(FIND_SOURCES, 1).length > 0) return SOURCE_CONTAINER_PRIORITY;
    if (s.pos.findInRange(FIND_MINERALS, 1).length > 0) return MINERAL_CONTAINER_PRIORITY;
    return CONTROLLER_CONTAINER_PRIORITY;
  }
  return SITE_BUILD_PRIORITY[s.structureType] ?? 11;
}

function isHigherBuildPriority(a: ConstructionSite, b: ConstructionSite): boolean {
  const pa = sitePriority(a);
  const pb = sitePriority(b);
  if (pa !== pb) return pa < pb;
  const ra = a.progress / a.progressTotal;
  const rb = b.progress / b.progressTotal;
  if (ra !== rb) return ra > rb;
  return a.id < b.id;
}

let buildTargetTick = -1;

const buildTargetByRoom: Record<string, Id<ConstructionSite> | null> = {};

export function isEnergyEmergency(room: Room): boolean {
  const cap = room.energyCapacityAvailable;
  if (cap === 0) return false;
  if (!room.storage) return room.energyAvailable / cap < 0.25;
  return room.energyAvailable / cap < 0.25 && room.storage.store[RESOURCE_ENERGY] < 50000;
}

export function getRoomBuildTarget(room: Room): ConstructionSite | null {
  if (buildTargetTick !== Game.time) {
    buildTargetTick = Game.time;
    for (const k of Object.keys(buildTargetByRoom)) delete buildTargetByRoom[k];
  }
  if (buildTargetByRoom[room.name] === undefined) {
    let best: ConstructionSite | null = null;
    for (const s of room.find(FIND_MY_CONSTRUCTION_SITES) as ConstructionSite[]) {
      if (!isPositionSafe(room, s.pos)) continue;
      if (!best || isHigherBuildPriority(s, best)) best = s;
    }
    buildTargetByRoom[room.name] = best ? best.id : null;
  }
  const id = buildTargetByRoom[room.name];
  return id ? Game.getObjectById(id) : null;
}

const RAMPART_TARGET_HP: Record<number, number> = {
  2:        10_000,
  3:        20_000,
  4:        50_000,
  5:       100_000,
  6:       300_000,
  7:     1_000_000,
  8:    10_000_000,
};

export function getRampartTargetHP(rcl: number): number {
  return RAMPART_TARGET_HP[Math.min(8, Math.max(2, rcl))] ?? 10_000;
}

// Ramparts laid over a structure inside the base only need to outlast a raid
// that already got past the perimeter, so they stop well short of it.
const ON_TOP_RAMPART_TARGET_HP: Record<number, number> = {
  2:  10_000,
  3:  20_000,
  4:  50_000,
  5: 100_000,
  6: 150_000,
  7: 200_000,
  8: 300_000,
};

// The perimeter only climbs past this once storage has energy to spare.
const PERIMETER_SOFT_CAP_HP = 1_000_000;

const PERIMETER_FULL_TARGET_STORAGE = 100_000;

// Repair goal for a wall or rampart. A rampart over another structure is
// on-top; one on the stored perimeter ring gets the perimeter goal; any other
// rampart (a stale ring from an older plan, a hand-placed one) gets 0 and is
// left to decay. Until a room has a stored ring, every bare rampart counts as
// perimeter so nothing is dropped by mistake. The town's walls and ramparts
// (cottages, fountain, watch posts) are kept at a low goal of their own; they
// are homes, not fortifications.
export function barrierTargetFn(room: Room): (s: AnyStructure) => number {
  const rcl = room.controller?.level ?? 0;
  let perimeter = getRampartTargetHP(rcl);
  if ((room.storage?.store[RESOURCE_ENERGY] ?? 0) <= PERIMETER_FULL_TARGET_STORAGE) {
    perimeter = Math.min(perimeter, PERIMETER_SOFT_CAP_HP);
  }
  const onTop = Math.min(perimeter, ON_TOP_RAMPART_TARGET_HP[Math.min(8, Math.max(2, rcl))]);

  const ring = room.memory.perimeterTiles;
  const perimeterSet = ring ? new Set(ring) : undefined;
  const nukeTiles = room.memory.nukeDefense?.tiles ?? {};
  let covered: Set<string> | undefined;
  const coveredTiles = (): Set<string> => {
    if (!covered) {
      covered = new Set();
      for (const s of room.find(FIND_STRUCTURES)) {
        const t = s.structureType;
        if (t === STRUCTURE_RAMPART || t === STRUCTURE_ROAD || t === STRUCTURE_WALL) continue;
        covered.add(`${s.pos.x},${s.pos.y}`);
      }
    }
    return covered;
  };

  const town = townBarrierTiles(room.memory.town);
  const townTarget = Math.min(perimeter, TOWN.barrierHits);

  return (s) => {
    if (s.structureType !== STRUCTURE_WALL && s.structureType !== STRUCTURE_RAMPART) return 0;
    const k = `${s.pos.x},${s.pos.y}`;
    if (town.has(k)) return townTarget;
    if (s.structureType === STRUCTURE_WALL) return perimeter;
    if (!perimeterSet || perimeterSet.has(k)) return perimeter;
    if (coveredTiles().has(k) || k in nukeTiles) return onTop;
    return 0;
  };
}

function isDamaged(s: AnyStructure): boolean {
  return s.hits < s.hitsMax;
}

function decayRescueFloor(s: AnyStructure): number {
  switch (s.structureType) {
    case STRUCTURE_RAMPART:
      return 2000;
    case STRUCTURE_ROAD:
      return s.hitsMax * 0.35;
    case STRUCTURE_CONTAINER:
      return s.hitsMax * 0.1;
    default:
      return 0;
  }
}

export function findClosestRepairTarget(creep: Creep): AnyStructure | null {
  const repairTargets = getRoomStructures(creep.room).filter(
    (s): s is AnyStructure =>
      s.structureType !== STRUCTURE_WALL &&
      s.structureType !== STRUCTURE_RAMPART &&
      isDamaged(s)
  );
  if (repairTargets.length === 0) return null;
  return closestByPath(creep.pos, repairTargets) || null;
}

export function findClosestDamagedRampart(
  creep: Creep
): StructureRampart | null {
  const ramparts = getRoomStructures(creep.room).filter(
    (s): s is StructureRampart =>
      s.structureType === STRUCTURE_RAMPART && isDamaged(s)
  );
  if (ramparts.length === 0) return null;
  return closestByPath(creep.pos, ramparts) || null;
}

const CRITICAL_DEFENSE_HITS = 1000;

const BREACH_DANGER_FLOOR = 50_000;

const TOWER_DEFENSE_REPAIR_FLOOR = 300_000;

export function findCriticalDefenseTarget(creep: Creep): AnyStructure | null {
  // Only preempt construction to repair defenses when the room is actually
  // under threat. In peacetime a freshly built rampart sits at 1 HP and would
  // otherwise pull every builder off construction to top it up; the repairer
  // role maintains ramparts and walls instead.
  if (getDangerPositions(creep.room).length === 0) return null;
  const critical = getRoomStructures(creep.room).filter(
    (s): s is AnyStructure =>
      (s.structureType === STRUCTURE_RAMPART || s.structureType === STRUCTURE_WALL) &&
      s.hits < CRITICAL_DEFENSE_HITS
  );
  if (critical.length === 0) return null;
  return closestByPath(creep.pos, critical) || null;
}

export function getNukeRampartTarget(room: Room): StructureRampart | null {
  if (nukeTargetCacheTick !== Game.time) {
    nukeTargetCacheTick = Game.time;
    for (const k in nukeTargetByRoom) delete nukeTargetByRoom[k];
  }
  if (!(room.name in nukeTargetByRoom)) {
    nukeTargetByRoom[room.name] = computeNukeRampartTarget(room);
  }
  return nukeTargetByRoom[room.name];
}

function computeNukeRampartTarget(room: Room): StructureRampart | null {
  const def = room.memory.nukeDefense;
  if (!def) return null;
  let worst: StructureRampart | null = null;
  let worstDeficit = 0;
  for (const key in def.tiles) {
    const required = def.tiles[key];
    const [x, y] = key.split(",").map(Number);
    const rampart = room
      .lookForAt(LOOK_STRUCTURES, x, y)
      .find((s) => s.structureType === STRUCTURE_RAMPART) as StructureRampart | undefined;
    if (!rampart) continue;
    // A rampart can't exceed its RCL hitsMax; once there, more repair is wasted.
    const deficit = Math.min(required, rampart.hitsMax) - rampart.hits;
    if (deficit > worstDeficit) {
      worstDeficit = deficit;
      worst = rampart;
    }
  }
  return worst;
}

export function findMostCriticalRepairTarget(
  creep: Creep
): AnyStructure | null {
  const nukeTarget = getNukeRampartTarget(creep.room);
  if (nukeTarget) return nukeTarget;

  if (criticalRepairCacheTick !== Game.time) {
    criticalRepairCacheTick = Game.time;
    for (const k in criticalRepairByRoom) delete criticalRepairByRoom[k];
  }
  const rn = creep.room.name;
  if (rn in criticalRepairByRoom) return criticalRepairByRoom[rn];

  const targetOf = barrierTargetFn(creep.room);
  const isBarrier = (st: AnyStructure) =>
    st.structureType === STRUCTURE_WALL || st.structureType === STRUCTURE_RAMPART;

  // Unplanned ramparts get no repair at all, not even decay rescue.
  const structures = getRoomStructures(creep.room).filter(
    (st) => !isBarrier(st) || targetOf(st) > 0
  );

  const dying = structures.filter(
    (st): st is AnyStructure => {
      const floor = decayRescueFloor(st);
      return floor > 0 && st.hits < floor;
    }
  );
  if (dying.length > 0) {
    const result = dying.reduce((a, b) => (a.hits < b.hits ? a : b));
    criticalRepairByRoom[rn] = result;
    return result;
  }

  const criticalBarriers = structures.filter(
    (st): st is AnyStructure =>
      isBarrier(st) && st.hits < Math.min(BREACH_DANGER_FLOOR, targetOf(st) * 0.5)
  );
  if (criticalBarriers.length > 0) {
    const result = criticalBarriers.reduce((a, b) => (a.hits < b.hits ? a : b));
    criticalRepairByRoom[rn] = result;
    return result;
  }

  const nonDefensive = structures.filter(
    (st): st is AnyStructure =>
      st.structureType !== STRUCTURE_WALL &&
      st.structureType !== STRUCTURE_RAMPART &&
      st.hits < st.hitsMax * 0.8
  );
  if (nonDefensive.length > 0) {
    const isRoad = (st: AnyStructure) => st.structureType === STRUCTURE_ROAD;
    const lowestFraction = (a: AnyStructure, b: AnyStructure) =>
      a.hits / a.hitsMax < b.hits / b.hitsMax ? a : b;
    const nonRoad = nonDefensive.filter((st) => !isRoad(st));
    const tier = nonRoad.length > 0 ? nonRoad : nonDefensive;
    const result = tier.reduce(lowestFraction);
    criticalRepairByRoom[rn] = result;
    return result;
  }

  const belowTarget = structures.filter(
    (st): st is AnyStructure => isBarrier(st) && st.hits < targetOf(st)
  );
  const result = belowTarget.length > 0
    ? belowTarget.reduce((a, b) => (a.hits < b.hits ? a : b))
    : null;

  criticalRepairByRoom[rn] = result;
  return result;
}

export function findTowerRepairTarget(room: Room): AnyStructure | null {
  const nukeTarget = getNukeRampartTarget(room);
  if (nukeTarget) return nukeTarget;

  if (towerRepairCacheTick !== Game.time) {
    towerRepairCacheTick = Game.time;
    for (const k in towerRepairByRoom) delete towerRepairByRoom[k];
  }
  if (room.name in towerRepairByRoom) return towerRepairByRoom[room.name];

  const rcl = room.controller?.level ?? 0;
  const towerWallThreshold = Math.min(50_000, Math.max(5_000, getRampartTargetHP(rcl) * 0.05));

  const targetOf = barrierTargetFn(room);
  const candidates = getRoomStructures(room).filter((st): st is AnyStructure => {
    if (st.structureType === STRUCTURE_RAMPART || st.structureType === STRUCTURE_WALL) {
      return st.hits < Math.min(towerWallThreshold, targetOf(st));
    }
    return st.hits < st.hitsMax * 0.4;
  });
  const result = candidates.length === 0
    ? null
    : candidates.reduce((a, b) => (a.hits < b.hits ? a : b));
  towerRepairByRoom[room.name] = result;
  return result;
}

export function findTowerDefenseRepairTarget(
  room: Room
): StructureRampart | StructureWall | null {
  const rcl = room.controller?.level ?? 0;
  const floor = Math.min(TOWER_DEFENSE_REPAIR_FLOOR, getRampartTargetHP(rcl));
  // Barriers within reach of a hostile that can actually break them come
  // first; the weakest barrier anywhere is only the fallback.
  const breakers = room
    .find(FIND_HOSTILE_CREEPS)
    .filter((c) => c.body.some((p) => (p.type === ATTACK || p.type === WORK) && p.hits > 0));
  let worst: StructureRampart | StructureWall | null = null;
  let worstThreatened: StructureRampart | StructureWall | null = null;
  for (const s of getRoomStructures(room)) {
    if (s.structureType !== STRUCTURE_RAMPART && s.structureType !== STRUCTURE_WALL) continue;
    if (s.hits >= floor) continue;
    const barrier = s as StructureRampart | StructureWall;
    if (!worst || s.hits < worst.hits) worst = barrier;
    if (!breakers.some((c) => c.pos.getRangeTo(s.pos) <= 3)) continue;
    if (!worstThreatened || s.hits < worstThreatened.hits) worstThreatened = barrier;
  }
  return worstThreatened ?? worst;
}
