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
import { ROLE_UPGRADER, ROLE_HAULER, ROLE_REMOTE_HAULER } from "../config/config.roles";

const STUCK_THRESHOLD = 3; // ticks without moving (fatigue-free) before intervening
const COSTMATRIX_TTL = 100;

const originalMoveTo = Creep.prototype.moveTo as (
  this: Creep,
  ...args: unknown[]
) => ScreepsReturnCode;

const costMatrixCache: Record<string, { cm: CostMatrix; tick: number }> = {};

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
  if (!effectiveOpts.costCallback) effectiveOpts.costCallback = roadCostCallback;

  // Already parked within range — the creep isn't travelling, so it isn't "stuck".
  if (sameRoom && this.pos.getRangeTo(tpos) <= range) {
    this.memory._st = 0;
    return originalMoveTo.call(this, target as never, effectiveOpts as never);
  }

  const mem = this.memory;
  const posKey = this.pos.x * 50 + this.pos.y;
  if (mem._lpr === this.pos.roomName && mem._lp === posKey && this.fatigue === 0) {
    mem._st = (mem._st ?? 0) + 1;
  } else {
    mem._st = 0;
  }
  mem._lp = posKey;
  mem._lpr = this.pos.roomName;

  if ((mem._st ?? 0) >= STUCK_THRESHOLD) {
    mem._st = 0;
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

function registerShove(creep: Creep, targetPos: RoomPosition, range: number): void {
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
