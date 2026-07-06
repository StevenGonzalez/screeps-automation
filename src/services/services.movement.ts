import {
  ROLE_UPGRADER,
  ROLE_HAULER,
  ROLE_REMOTE_HAULER,
} from "../config/config.roles";

const STUCK_THRESHOLD = 3;
const COSTMATRIX_TTL = 1000;

const originalMoveTo = Creep.prototype.moveTo as (
  this: Creep,
  ...args: unknown[]
) => ScreepsReturnCode;

const costMatrixCache: Record<string, { cm: CostMatrix; tick: number }> = {};

interface StuckState {
  st: number;
  lp: number;
  lpr: string;
}
const stuckState = new Map<string, StuckState>();
let stuckPruneTick = -1;

function pruneStuckState(): void {
  if (stuckPruneTick === Game.time) return;
  stuckPruneTick = Game.time;
  for (const name of stuckState.keys()) {
    if (!Game.creeps[name]) stuckState.delete(name);
  }
}

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

export function invalidateCostMatrix(roomName: string): void {
  delete costMatrixCache[roomName];
}

function structureCostCallback(roomName: string): CostMatrix {
  return getRoomCostMatrix(roomName);
}

const creepAwareCache: Record<string, CostMatrix> = {};
let creepAwareTick = -1;

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
  for (const s of room.find(FIND_MY_CONSTRUCTION_SITES)) {
    if ((OBSTACLE_OBJECT_TYPES as string[]).includes(s.structureType)) {
      cm.set(s.pos.x, s.pos.y, 0xff);
    }
  }
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
  if (Memory.trafficDisabled || typeof target === "number") {
    return originalMoveTo.apply(this, args);
  }

  const opts = args[1] as MoveToOpts | undefined;
  const tpos = (target as { pos?: RoomPosition })?.pos ?? (target as RoomPosition);
  const sameRoom = tpos instanceof RoomPosition && tpos.roomName === this.pos.roomName;
  const range = (opts?.range as number | undefined) ?? 1;

  const effectiveOpts: MoveToOpts = { plainCost: 2, swampCost: 10, ...(opts ?? {}) };
  if (!effectiveOpts.costCallback) {
    effectiveOpts.costCallback = roadCostCallback;
  }

  pruneStuckState();

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
    if (sameRoom) registerShove(this, tpos, range);
    effectiveOpts.reusePath = 0;
    return originalMoveTo.call(this, target as never, effectiveOpts as never);
  }

  return originalMoveTo.call(this, target as never, effectiveOpts as never);
};

interface ShoveReq {
  stuck: Creep;
  blocker: Creep;
}
let shoveTick = -1;
let pendingShoves: ShoveReq[] = [];

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

export function resolveTraffic(): void {
  if (Memory.trafficDisabled) return;
  if (shoveTick !== Game.time) return;

  const moved = new Set<string>();
  for (const { stuck, blocker } of pendingShoves) {
    if (moved.has(blocker.name)) continue;
    if (blocker.fatigue > 0) continue;
    if (isOnWorkingPost(blocker)) continue;
    const dir = blocker.pos.getDirectionTo(stuck.pos);
    if (!dir) continue;
    blocker.move(dir);
    moved.add(blocker.name);
  }
  pendingShoves = [];
}

function isOnWorkingPost(creep: Creep): boolean {
  const onContainer = creep.pos
    .lookFor(LOOK_STRUCTURES)
    .some((s) => s.structureType === STRUCTURE_CONTAINER);
  if (onContainer) return true;
  const isHauler =
    creep.memory.role === ROLE_HAULER || creep.memory.role === ROLE_REMOTE_HAULER;
  if (!isHauler && creep.pos.findInRange(FIND_SOURCES, 1).length > 0) return true;
  const ctrl = creep.room.controller;
  if (
    creep.memory.role === ROLE_UPGRADER &&
    creep.memory.working &&
    ctrl &&
    creep.pos.inRangeTo(ctrl, 3)
  )
    return true;
  return false;
}
