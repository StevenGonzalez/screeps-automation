import { TOWN } from "../config/config.town";
import { wallsFunded } from "./services.treasury";
import { townBarrierTiles } from "./services.town";
import { keptRoadTiles } from "../planning/planner.blueprint";
import {
  closestByPath,
  getRoomStructures,
  getDangerPositions,
  isPositionSafe,
} from "./services.creep.room";

let criticalRepairCacheTick = -1;

// The repair candidates for each room this tick: one structure, or a band of
// barriers each repairer takes the nearest of.
const criticalRepairByRoom: Record<string, AnyStructure[]> = {};

let towerRepairCacheTick = -1;

const towerRepairByRoom: Record<string, AnyStructure | null> = {};

// A room whose towers found nothing to mend is not looked over again for this
// many ticks. Its roads and containers wear slowly, and looking every tick
// filtered all of Embercrag's 321 structures for nothing, about a seventh of a
// CPU a tick.
const TOWER_REPAIR_IDLE_TICKS = 10;

const towerRepairIdleUntil: Record<string, number> = {};

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
// left to decay. A wall off the ring is left from an older ring too, and gets
// 0. Until a room has a stored ring, every wall and bare rampart counts as
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
    if (!perimeterSet || perimeterSet.has(k)) return perimeter;
    if (s.structureType === STRUCTURE_WALL) return 0;
    if (coveredTiles().has(k) || k in nukeTiles) return onTop;
    return 0;
  };
}

function isDamaged(s: AnyStructure): boolean {
  return s.hits < s.hitsMax;
}

// A road, container or the like is worth a trip to mend below this share of
// its hits. Above it, a mason with nothing to build path-searched the keep
// every tick for roads a tick of decay had touched, a hundred hits at a time,
// and never got round to enchanting.
const WORN_FRACTION = 0.8;

// A room with a blueprint keeps up only the roads the plan wants; the rest
// are left to decay. Rooms without one (remotes) keep every road.
export function keptUp(room: Room): (s: AnyStructure) => boolean {
  const roads = keptRoadTiles(room);
  if (!roads) return () => true;
  return (s) => s.structureType !== STRUCTURE_ROAD || roads.has(`${s.pos.x},${s.pos.y}`);
}

export function decayRescueFloor(s: AnyStructure): number {
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
  const kept = keptUp(creep.room);
  const repairTargets = getRoomStructures(creep.room).filter(
    (s): s is AnyStructure =>
      s.structureType !== STRUCTURE_WALL &&
      s.structureType !== STRUCTURE_RAMPART &&
      s.hits < s.hitsMax * WORN_FRACTION &&
      kept(s)
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

// Barriers within this many hits of the weakest count as weakest too, and a
// repairer takes the nearest of them. Taking the single weakest sent it across
// the base after every tick of work: on a ring of ramparts all within a few
// thousand hits of each other, one tick lifted its rampart past the next
// weakest, which could be anywhere. Blacksmiths spent most of their lives
// walking, a tick of repair to every ten or twenty of travel.
const BARRIER_REPAIR_BAND = 10_000;

// A barrier within a band of its goal counts as standing. Decay takes a
// rampart a band down in some 3,300 ticks, and one visit then raises it whole.
// Counting every hit short of the goal kept Grimford's two blacksmiths crossing
// the keep to top up whichever rampart had slipped under it, a tick of work a
// trip. A low goal keeps half of itself as the slack instead.
export function barrierWantsRaising(s: AnyStructure, goal: number): boolean {
  return s.hits < goal - Math.min(BARRIER_REPAIR_BAND, goal / 2);
}

/** The hits a blacksmith mends a structure to: a barrier's goal, else whole. */
export function repairGoal(room: Room, s: AnyStructure): number {
  const barrier = s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART;
  return barrier ? barrierTargetFn(room)(s) : s.hitsMax;
}

function weakestBand(barriers: AnyStructure[]): AnyStructure[] {
  const floor = barriers.reduce((min, b) => Math.min(min, b.hits), Infinity);
  return barriers.filter((b) => b.hits < floor + BARRIER_REPAIR_BAND);
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
  const candidates = criticalRepairByRoom[rn] ?? (criticalRepairByRoom[rn] = repairCandidates(creep.room));
  if (candidates.length <= 1) return candidates[0] ?? null;
  return candidates.reduce((a, b) => (creep.pos.getRangeTo(a) <= creep.pos.getRangeTo(b) ? a : b));
}

function repairCandidates(room: Room): AnyStructure[] {
  const targetOf = barrierTargetFn(room);
  const isBarrier = (st: AnyStructure) =>
    st.structureType === STRUCTURE_WALL || st.structureType === STRUCTURE_RAMPART;

  // Unplanned ramparts and roads get no repair at all, not even decay rescue.
  const kept = keptUp(room);
  const structures = getRoomStructures(room).filter(
    (st) => (!isBarrier(st) || targetOf(st) > 0) && kept(st)
  );

  const dying = structures.filter(
    (st): st is AnyStructure => {
      const floor = decayRescueFloor(st);
      return floor > 0 && st.hits < floor;
    }
  );
  if (dying.length > 0) return [dying.reduce((a, b) => (a.hits < b.hits ? a : b))];

  // Raising the walls waits on the treasury floor, the same as enchanting does,
  // unless the castle is under attack. Keeping them standing (above) never waits.
  const walls = wallsFunded(room) || getDangerPositions(room).length > 0;

  const criticalBarriers = walls
    ? structures.filter(
        (st): st is AnyStructure =>
          isBarrier(st) && st.hits < Math.min(BREACH_DANGER_FLOOR, targetOf(st) * 0.5)
      )
    : [];
  if (criticalBarriers.length > 0) return weakestBand(criticalBarriers);

  const nonDefensive = structures.filter(
    (st): st is AnyStructure =>
      st.structureType !== STRUCTURE_WALL &&
      st.structureType !== STRUCTURE_RAMPART &&
      st.hits < st.hitsMax * WORN_FRACTION
  );
  // Each blacksmith takes the nearest. Chasing the most worn sent both across
  // the keep whenever a tick of repair made a container at the far end the
  // more worn one. Anything worn badly enough to matter is rescued above.
  const nonRoad = nonDefensive.filter((st) => st.structureType !== STRUCTURE_ROAD);
  if (nonRoad.length > 0) return nonRoad;

  // Worn roads wait on the walls. A road takes a tick of work, and Grimford's
  // two blacksmiths left their rampart for one 25 tiles off and walked 32 back.
  // The towers mend a road below 40%, and the blacksmiths rescue it below 35%.
  if (walls) {
    const belowTarget = structures.filter(
      (st): st is AnyStructure => isBarrier(st) && barrierWantsRaising(st, targetOf(st))
    );
    if (belowTarget.length > 0) return weakestBand(belowTarget);
  }
  return nonDefensive;
}

export function findTowerRepairTarget(room: Room): AnyStructure | null {
  const nukeTarget = getNukeRampartTarget(room);
  if (nukeTarget) return nukeTarget;

  if (towerRepairCacheTick !== Game.time) {
    towerRepairCacheTick = Game.time;
    for (const k in towerRepairByRoom) delete towerRepairByRoom[k];
  }
  if (room.name in towerRepairByRoom) return towerRepairByRoom[room.name];
  if ((towerRepairIdleUntil[room.name] ?? 0) > Game.time) return null;

  const rcl = room.controller?.level ?? 0;
  const towerWallThreshold = Math.min(50_000, Math.max(5_000, getRampartTargetHP(rcl) * 0.05));

  const targetOf = barrierTargetFn(room);
  const kept = keptUp(room);
  const candidates = getRoomStructures(room).filter((st): st is AnyStructure => {
    if (!kept(st)) return false;
    if (st.structureType === STRUCTURE_RAMPART || st.structureType === STRUCTURE_WALL) {
      return st.hits < Math.min(towerWallThreshold, targetOf(st));
    }
    return st.hits < st.hitsMax * 0.4;
  });
  const result = candidates.length === 0
    ? null
    : candidates.reduce((a, b) => (a.hits < b.hits ? a : b));
  towerRepairByRoom[room.name] = result;
  if (!result) towerRepairIdleUntil[room.name] = Game.time + TOWER_REPAIR_IDLE_TICKS;
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
