/**
 * Traffic manager. Transparently wraps Creep.prototype.moveTo (preserving its
 * signature and return value) so every existing moveTo call benefits without any
 * role changes. Two additions:
 *
 *   1. Stuck detection → fresh repath. When a creep hasn't moved for several ticks
 *      (and isn't merely fatigued), it forces a fresh path so it routes AROUND the
 *      obstruction instead of grinding against the same blocked tile.
 *   2. Guarded shove. While stuck, it nudges a non-working neighbour off the next
 *      step (swapping tiles). It never dislodges a creep that is on a container, on
 *      a source, or parked at the controller — those are working posts.
 *
 * The route-around is the reliable win; the shove is a harmless best-effort bonus
 * (a neighbour that runs its own logic later may override it). Set
 * `Memory.trafficDisabled = true` to fall back to vanilla moveTo instantly.
 */
import {
  ROLE_UPGRADER,
  ROLE_HAULER,
  ROLE_REMOTE_HAULER,
  ROLE_REMOTE_MINER,
  ROLE_RESERVER,
} from "../config/config.roles";

const STUCK_THRESHOLD = 3; // ticks without moving (fatigue-free) before intervening
// Structure matrices are invalidated explicitly when a structure is destroyed/built (see
// invalidateCostMatrix, called from the memory orchestrator's event-log scan), so the TTL
// is only a backstop for changes we don't get an event for. It can therefore run long.
const COSTMATRIX_TTL = 1000;

const originalMoveTo = Creep.prototype.moveTo as (
  this: Creep,
  ...args: unknown[]
) => ScreepsReturnCode;

const costMatrixCache: Record<string, { cm: CostMatrix; tick: number }> = {};

// Per-creep stuck-tracking state, keyed by creep name. Deliberately kept in heap
// (not creep Memory) so it never touches RawMemory: writing _st/_lp/_lpr into every
// creep's JSON every tick inflated serialize cost (a top hidden CPU sink). Heap is
// wiped on a global reset, which only costs a few ticks of re-warming the counters.
// Stale entries for dead creeps are pruned lazily once per tick (see pruneStuckState).
interface StuckState {
  st: number; // consecutive ticks stuck (fatigue-free, hasn't moved)
  lp: number; // last position key (x * 50 + y)
  lpr: string; // last position's room name
}
const stuckState = new Map<string, StuckState>();
let stuckPruneTick = -1;

// Drop heap entries for creeps that no longer exist. Run once per tick on first access
// so the map can't grow unbounded across many creep generations.
function pruneStuckState(): void {
  if (stuckPruneTick === Game.time) return;
  stuckPruneTick = Game.time;
  for (const name of stuckState.keys()) {
    if (!Game.creeps[name]) stuckState.delete(name);
  }
}

/**
 * A road-aware structure cost matrix for a room, cached for COSTMATRIX_TTL ticks
 * (structures change slowly). Roads cost 1 so creeps prefer them, blocking
 * structures and enemy ramparts are impassable, and walkable structures keep the
 * default cost. Reused across every creep's pathing in the room.
 */
function getRoomCostMatrix(roomName: string): CostMatrix {
  const cached = costMatrixCache[roomName];
  if (cached && Game.time - cached.tick < COSTMATRIX_TTL) return cached.cm;

  const room = Game.rooms[roomName];
  if (!room) return new PathFinder.CostMatrix();

  const cm = new PathFinder.CostMatrix();
  for (const s of room.find(FIND_STRUCTURES)) {
    if (s.structureType === STRUCTURE_ROAD) {
      if (cm.get(s.pos.x, s.pos.y) === 0) cm.set(s.pos.x, s.pos.y, 1);
    } else if (s.structureType === STRUCTURE_RAMPART) {
      if (!(s as StructureRampart).my) cm.set(s.pos.x, s.pos.y, 255);
    } else if ((OBSTACLE_OBJECT_TYPES as string[]).includes(s.structureType)) {
      cm.set(s.pos.x, s.pos.y, 255);
    }
  }
  costMatrixCache[roomName] = { cm, tick: Game.time };
  return cm;
}

/**
 * Drop the cached structure matrix for a room so the next pathing call rebuilds it from
 * live structures. Called whenever a room's structures change (destroyed/built), which
 * lets the TTL above run long without ever pathing through a wall that's gone or around
 * a rampart that's new.
 */
export function invalidateCostMatrix(roomName: string): void {
  delete costMatrixCache[roomName];
}

// The structure matrix alone, for callers that want the "ideal" path ignoring creeps (the shove
// uses this to find the blocker on the path a creep WOULD take if no creeps were in the way).
function structureCostCallback(roomName: string): CostMatrix {
  return getRoomCostMatrix(roomName);
}

// Per-tick cache of the structure matrix with current creep positions overlaid as obstacles.
const creepAwareCache: Record<string, CostMatrix> = {};
let creepAwareTick = -1;

/**
 * The cost matrix moveTo actually paths with: the cached structure matrix CLONED and overlaid
 * with every creep's current tile as impassable. This is the whole point of the traffic manager
 * — without it, supplying a costCallback that returns a structure-only matrix REPLACES the
 * engine's built-in matrix (which marks creeps as obstacles), so pathing silently ignores every
 * creep and fixates on occupied tiles instead of routing around them. Rebuilt once per room per
 * tick (creeps move every tick, so it can't share the 100-tick structure cache) and reused by
 * every creep pathing in that room this tick.
 */
function roadCostCallback(roomName: string): CostMatrix {
  if (creepAwareTick !== Game.time) {
    creepAwareTick = Game.time;
    for (const k in creepAwareCache) delete creepAwareCache[k];
  }
  const cached = creepAwareCache[roomName];
  if (cached) return cached;

  const base = getRoomCostMatrix(roomName);
  const room = Game.rooms[roomName];
  if (!room) return base;

  const cm = base.clone();
  for (const c of room.find(FIND_CREEPS)) cm.set(c.pos.x, c.pos.y, 0xff);
  for (const pc of room.find(FIND_POWER_CREEPS)) cm.set(pc.pos.x, pc.pos.y, 0xff);
  creepAwareCache[roomName] = cm;
  return cm;
}

// ── Multi-room route caching ──────────────────────────────────────────────────
//
// Long-haul creeps (remote haulers/miners/reservers) repeatedly path the same
// owned-room → remote-room corridor. Every recompute, the engine's moveTo re-runs
// the whole multi-room PathFinder search, which is free to wander into off-route
// rooms before correcting. We add a heap cache of Game.map.findRoute results keyed
// by the from→to room pair: the route is a cheap whole-map BFS over room exits, and
// caching it lets us (a) avoid recomputing findRoute every call and (b) feed the set
// of on-route rooms into the costCallback so PathFinder won't expand into rooms the
// route doesn't use (returning `false` from roomCallback marks a room impassable).
//
// Kept in heap (not Memory) for the same reason as the stuck state: it never touches
// RawMemory. Wiped on global reset, which only costs a few re-computations.
//
// NOTE: the companion idea — a heap cache of serialized creep paths for cross-tick
// reuse — is deliberately NOT implemented. The engine's own reusePath (preserved
// untouched above) already caches the serialized path in creep Memory, and the
// traffic manager mutates reusePath on stuck creeps; a parallel heap path cache would
// have to mirror that invalidation exactly or it would feed stale paths back into
// stuck creeps and fight the route-around. The findRoute cache is the bigger win for
// many remote rooms and carries none of that risk, so we ship just that.

// How long a cached route stays valid. Room connectivity effectively never changes
// (only novel-room portals/walls would, which we don't path through), so this is a
// pure CPU/memory bound, not a correctness TTL.
const ROUTE_TTL = 1000;
// Roles whose pathing is worth biasing onto a cached cross-room route. Limiting it to
// long-haul roles keeps the findRoute calls (and the route-restricted costCallback)
// off the hot path for the swarm of in-room workers that never leave their room.
const LONG_HAUL_ROLES: ReadonlySet<string> = new Set([
  ROLE_REMOTE_HAULER,
  ROLE_REMOTE_MINER,
  ROLE_RESERVER,
]);

interface RouteCacheEntry {
  // Set of room names on the route (origin and destination included), used as an
  // allow-list in the costCallback. Empty/undefined route → no restriction.
  rooms: Set<string>;
  tick: number;
}
const routeCache: Map<string, RouteCacheEntry> = new Map();
let routePruneTick = -1;

// Drop expired route entries once per tick so the map can't grow unbounded as remote
// corridors come and go.
function pruneRouteCache(): void {
  if (routePruneTick === Game.time) return;
  routePruneTick = Game.time;
  for (const [key, entry] of routeCache) {
    if (Game.time - entry.tick >= ROUTE_TTL) routeCache.delete(key);
  }
}

// Return the set of rooms on the cached route from→to, computing (and caching) it via
// Game.map.findRoute on a miss. Returns undefined when no sensible route restriction
// applies (same room, or findRoute failed) so the caller falls back to unrestricted
// pathing rather than boxing the creep into an empty allow-list.
function getRouteRooms(from: string, to: string): Set<string> | undefined {
  if (from === to) return undefined;
  const key = `${from}->${to}`;
  const cached = routeCache.get(key);
  if (cached && Game.time - cached.tick < ROUTE_TTL) {
    return cached.rooms.size > 0 ? cached.rooms : undefined;
  }

  const route = Game.map.findRoute(from, to);
  const rooms = new Set<string>();
  if (route !== ERR_NO_PATH) {
    rooms.add(from);
    for (const step of route) rooms.add(step.room);
  }
  routeCache.set(key, { rooms, tick: Game.time });
  return rooms.size > 0 ? rooms : undefined;
}

(Creep.prototype as { moveTo: unknown }).moveTo = function (
  this: Creep,
  ...args: unknown[]
): ScreepsReturnCode {
  const target = args[0];
  // Pass through the moveTo(x, y, opts) numeric overload untouched, and when disabled.
  if (Memory.trafficDisabled || typeof target === "number") {
    return originalMoveTo.apply(this, args);
  }

  const opts = args[1] as MoveToOpts | undefined;
  const tpos = (target as { pos?: RoomPosition })?.pos ?? (target as RoomPosition);
  const sameRoom = tpos instanceof RoomPosition && tpos.roomName === this.pos.roomName;
  const range = (opts?.range as number | undefined) ?? 1;

  const effectiveOpts: MoveToOpts = { plainCost: 2, swampCost: 10, ...(opts ?? {}) };
  if (!effectiveOpts.costCallback) {
    // For a long-haul creep travelling between rooms, bias multi-room pathing onto the
    // cached findRoute corridor: rooms off the route return `false` (impassable) so the
    // engine can't wander off-route, and on-route rooms get the usual creep-aware matrix.
    // Falls back to the plain callback when there's no useful route (same room, or any
    // caller that already supplied its own costCallback above keeps full control).
    const routeRooms =
      tpos instanceof RoomPosition &&
      !sameRoom &&
      LONG_HAUL_ROLES.has(this.memory.role)
        ? getRouteRooms(this.pos.roomName, tpos.roomName)
        : undefined;

    if (routeRooms) {
      // Off-route rooms return `false` to mark the whole room impassable to PathFinder.
      // The engine's roomCallback honours a `false` return, but @types/screeps types
      // costCallback as returning only `void | CostMatrix`; the cast keeps us honest
      // about the engine behaviour we rely on without loosening the field's type.
      effectiveOpts.costCallback = ((roomName: string) =>
        routeRooms.has(roomName) ? roadCostCallback(roomName) : false) as MoveToOpts["costCallback"];
    } else {
      effectiveOpts.costCallback = roadCostCallback;
    }
  }

  pruneStuckState();
  pruneRouteCache();

  // Already parked within range — the creep isn't travelling, so it isn't "stuck".
  if (sameRoom && this.pos.getRangeTo(tpos) <= range) {
    stuckState.delete(this.name);
    return originalMoveTo.call(this, target as never, effectiveOpts as never);
  }

  const posKey = this.pos.x * 50 + this.pos.y;
  const prev = stuckState.get(this.name);
  let st = 0;
  if (prev && prev.lpr === this.pos.roomName && prev.lp === posKey && this.fatigue === 0) {
    st = prev.st + 1;
  }
  stuckState.set(this.name, { st, lp: posKey, lpr: this.pos.roomName });

  if (st >= STUCK_THRESHOLD) {
    stuckState.set(this.name, { st: 0, lp: posKey, lpr: this.pos.roomName });
    // Register a shove against whoever blocks our next step, resolved authoritatively
    // at end of tick (see resolveTraffic). We still force a fresh path here so we route
    // around the jam if an alternative exists.
    if (sameRoom) registerShove(this, tpos, range);
    effectiveOpts.reusePath = 0;
    return originalMoveTo.call(this, target as never, effectiveOpts as never);
  }

  return originalMoveTo.call(this, target as never, effectiveOpts as never);
};

// Shove intents collected this tick: a stuck creep paired with the creep directly
// blocking its next step. Resolved once, after every role has run, so our move()
// calls win the tick (a move issued mid-role gets overridden by the blocker's own
// later move). Reset lazily per tick.
interface ShoveReq {
  stuck: Creep;
  blocker: Creep;
}
let shoveTick = -1;
let pendingShoves: ShoveReq[] = [];

// Cap the fresh PathFinder.search calls a single room may spend on shove-routing each
// tick. A gridlocked lane stacks up many stuck creeps in one room, and each used to fire
// its own maxOps:1000 search — N pathfinds for one jam. Bounding it keeps the CPU spent
// on unjamming a room flat regardless of how many creeps pile up; the creeps over the cap
// simply don't register a shove this tick and retry next tick (they're still repathing).
const MAX_SHOVE_PATHFINDS_PER_ROOM = 3;
let shovePathfindTick = -1;
const shovePathfindsThisTick: Record<string, number> = {};

function registerShove(creep: Creep, targetPos: RoomPosition, range: number): void {
  const roomName = creep.pos.roomName;
  if (shovePathfindTick !== Game.time) {
    shovePathfindTick = Game.time;
    for (const k in shovePathfindsThisTick) delete shovePathfindsThisTick[k];
  }
  if ((shovePathfindsThisTick[roomName] ?? 0) >= MAX_SHOVE_PATHFINDS_PER_ROOM) return;
  shovePathfindsThisTick[roomName] = (shovePathfindsThisTick[roomName] ?? 0) + 1;

  // Find the creep on our ACTUAL next path step, not the straight-line direction to the
  // final target. moveTo routes around static obstacles, so the real next tile is usually
  // not the one getDirectionTo(target) points at — shoving by straight line displaces an
  // innocent bystander and leaves the true blocker in place (the exact failure that keeps
  // single-file roads jammed). A short road-aware pathfind (the same cost matrix moveTo
  // uses) yields the genuine next step.
  const result = PathFinder.search(
    creep.pos,
    { pos: targetPos, range },
    { roomCallback: structureCostCallback, plainCost: 2, swampCost: 10, maxOps: 1000 }
  );
  const next = result.path[0];
  if (!next || next.roomName !== creep.pos.roomName) return;
  const blocker = next.lookFor(LOOK_CREEPS).find((c) => c.my);
  if (!blocker) return;

  if (shoveTick !== Game.time) {
    shoveTick = Game.time;
    pendingShoves = [];
  }
  pendingShoves.push({ stuck: creep, blocker });
}

/**
 * Resolve this tick's shove intents. Called once at the end of the creep loop, after
 * every role has issued its own moves, so the swaps here are the final intent and win.
 *
 * Each shove swaps the stuck creep with its blocker: the stuck creep is already moving
 * into the blocker's tile (its own moveTo this tick), so pushing the blocker onto the
 * stuck creep's tile exchanges the two in a single tick — exactly what unjams a
 * single-file road where the blocker would otherwise never move (idle, or queued behind
 * its own obstruction). Genuine working posts are left alone.
 */
export function resolveTraffic(): void {
  if (Memory.trafficDisabled) return;
  if (shoveTick !== Game.time) return;

  const moved = new Set<string>();
  for (const { stuck, blocker } of pendingShoves) {
    if (moved.has(blocker.name)) continue;
    if (blocker.fatigue > 0) continue;
    if (isOnWorkingPost(blocker)) continue;
    // Don't fight a blocker that is itself already leaving toward a different tile.
    const dir = blocker.pos.getDirectionTo(stuck.pos);
    if (!dir) continue;
    blocker.move(dir);
    moved.add(blocker.name);
  }
  pendingShoves = [];
}

// True if the creep is standing somewhere it is presumably working and must not move.
function isOnWorkingPost(creep: Creep): boolean {
  // NOTE: do NOT pin on `creep.memory.working` alone. That flag stays true for the
  // whole time a builder/upgrader/repairer carries energy — including while merely
  // walking to its target — so pinning on it makes every full worker an immovable
  // obstacle. A line of them then mutually blocks a single-file road and gridlocks
  // until one dies. The genuine stationary posts (miner on a container, harvester at a
  // source, upgrader at the controller) are pinned by the specific checks below.
  const onContainer = creep.pos
    .lookFor(LOOK_STRUCTURES)
    .some((s) => s.structureType === STRUCTURE_CONTAINER);
  if (onContainer) return true;
  // Adjacency to a source pins the miner and harvesting peasants who actually work
  // there — but NOT haulers, which only transit through to withdraw. Protecting
  // haulers here gridlocks the single-file road to the source: a full hauler trying
  // to leave can't shove the empty hauler queued behind it, so the line freezes and
  // the container overflows onto the ground.
  const isHauler =
    creep.memory.role === ROLE_HAULER || creep.memory.role === ROLE_REMOTE_HAULER;
  if (!isHauler && creep.pos.findInRange(FIND_SOURCES, 1).length > 0) return true;
  const ctrl = creep.room.controller;
  // Pin an upgrader only while it is actually upgrading (working === true) AND in range of
  // the controller — NOT while it is fetching energy and merely transiting past. Pinning
  // every upgrader within range 3 (up to 48 tiles) turned passing/queued upgraders into
  // immovable blockers and gridlocked the single-file approach to the controller.
  if (
    creep.memory.role === ROLE_UPGRADER &&
    creep.memory.working &&
    ctrl &&
    creep.pos.inRangeTo(ctrl, 3)
  )
    return true;
  return false;
}
