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
import { ROLE_UPGRADER } from "../config/config.roles";

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

function roadCostCallback(roomName: string): CostMatrix {
  return getRoomCostMatrix(roomName);
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
    if (sameRoom) tryShove(this, tpos);
    // Force a fresh path (reusePath: 0) that routes around the jam.
    effectiveOpts.reusePath = 0;
    return originalMoveTo.call(this, target as never, effectiveOpts as never);
  }

  return originalMoveTo.call(this, target as never, effectiveOpts as never);
};

// Nudge a non-working friendly creep off the next step toward the target.
function tryShove(creep: Creep, targetPos: RoomPosition): void {
  const dir = creep.pos.getDirectionTo(targetPos);
  const next = stepInDirection(creep.pos, dir);
  if (!next) return;

  const blocker = next.lookFor(LOOK_CREEPS).find((c) => c.my);
  if (!blocker || blocker.fatigue > 0) return;
  if (isOnWorkingPost(blocker)) return;

  // Step the blocker onto our tile; we take its tile via the repath that follows.
  originalMoveToDir(blocker, blocker.pos.getDirectionTo(creep.pos));
}

// True if the creep is standing somewhere it is presumably working and must not move.
function isOnWorkingPost(creep: Creep): boolean {
  if (creep.memory.working) return true; // mid-action (builder/repairer/etc.)
  const onContainer = creep.pos
    .lookFor(LOOK_STRUCTURES)
    .some((s) => s.structureType === STRUCTURE_CONTAINER);
  if (onContainer) return true;
  if (creep.pos.findInRange(FIND_SOURCES, 1).length > 0) return true;
  const ctrl = creep.room.controller;
  if (creep.memory.role === ROLE_UPGRADER && ctrl && creep.pos.inRangeTo(ctrl, 3)) return true;
  return false;
}

function stepInDirection(pos: RoomPosition, dir: DirectionConstant): RoomPosition | null {
  const deltas: Record<DirectionConstant, [number, number]> = {
    [TOP]: [0, -1],
    [TOP_RIGHT]: [1, -1],
    [RIGHT]: [1, 0],
    [BOTTOM_RIGHT]: [1, 1],
    [BOTTOM]: [0, 1],
    [BOTTOM_LEFT]: [-1, 1],
    [LEFT]: [-1, 0],
    [TOP_LEFT]: [-1, -1],
  };
  const [dx, dy] = deltas[dir];
  const x = pos.x + dx;
  const y = pos.y + dy;
  if (x < 0 || x > 49 || y < 0 || y > 49) return null;
  return new RoomPosition(x, y, pos.roomName);
}

// Issue the blocker's swap move via the original (non-wrapped) move so it isn't
// re-intercepted as a moveTo.
function originalMoveToDir(creep: Creep, dir: DirectionConstant): void {
  creep.move(dir);
}
