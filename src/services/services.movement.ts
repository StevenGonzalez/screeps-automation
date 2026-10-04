import {
  ROLE_UPGRADER,
  ROLE_HAULER,
  ROLE_REMOTE_HAULER,
  ROLE_BUILDER,
  ROLE_FILLER,
  ROLE_HARVESTER,
  ROLE_MINER,
  ROLE_MINERAL_MINER,
  ROLE_MINSTREL,
  ROLE_REPAIRER,
} from "../config/config.roles";
import { getThreatInfo, isSourceKeeperRoom } from "./services.combat";
import { isAlly } from "./services.allies";
import { bedTiles, claimSpot, goToSpot, parseTile } from "./services.town";

const STUCK_THRESHOLD = 3;
const COSTMATRIX_TTL = 1000;

const originalMoveTo = Creep.prototype.moveTo as (
  this: Creep,
  ...args: unknown[]
) => ScreepsReturnCode;

const costMatrixCache: Record<string, { cm: CostMatrix; tick: number; structures: number }> = {};

interface StuckState {
  st: number;
  lp: number;
  lpr: string;
  t: number;
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
  const room = Game.rooms[roomName];
  if (!room) {
    if (cached && Game.time - cached.tick < COSTMATRIX_TTL) return cached.cm;
    return new PathFinder.CostMatrix();
  }

  // Rebuild early when a structure appears or disappears, so a freshly built
  // extension isn't treated as walkable for the rest of the TTL.
  const structures = room.find(FIND_STRUCTURES);
  if (
    cached &&
    Game.time - cached.tick < COSTMATRIX_TTL &&
    cached.structures === structures.length
  ) {
    return cached.cm;
  }

  const cm = new PathFinder.CostMatrix();
  for (const s of structures) {
    if (s.structureType === STRUCTURE_ROAD) {
      if (cm.get(s.pos.x, s.pos.y) === 0) cm.set(s.pos.x, s.pos.y, 1);
    } else if (s.structureType === STRUCTURE_RAMPART) {
      if (!(s as StructureRampart).my) cm.set(s.pos.x, s.pos.y, 255);
    } else if ((OBSTACLE_OBJECT_TYPES as string[]).includes(s.structureType)) {
      cm.set(s.pos.x, s.pos.y, 255);
    }
  }
  costMatrixCache[roomName] = { cm, tick: Game.time, structures: structures.length };
  return cm;
}

function structureCostCallback(roomName: string): CostMatrix {
  return getRoomCostMatrix(roomName);
}

const siteAwareCache: Record<string, CostMatrix> = {};
const creepAwareCache: Record<string, CostMatrix> = {};
let creepAwareTick = -1;

function freshCreepAware(): void {
  if (creepAwareTick === Game.time) return;
  creepAwareTick = Game.time;
  for (const k in siteAwareCache) delete siteAwareCache[k];
  for (const k in creepAwareCache) delete creepAwareCache[k];
}

// The structure matrix with our construction sites for walls and ramparts
// walled off too.
function siteCostMatrix(roomName: string): CostMatrix {
  freshCreepAware();
  const cached = siteAwareCache[roomName];
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
  siteAwareCache[roomName] = cm;
  return cm;
}

// Every creep in the room walled off, for a creep fleeing a few tiles.
function roadCostCallback(roomName: string): CostMatrix {
  freshCreepAware();
  const cached = creepAwareCache[roomName];
  if (cached) return cached;

  const sites = siteCostMatrix(roomName);
  const room = Game.rooms[roomName];
  if (!room) return sites;

  const cm = sites.clone();
  for (const c of room.find(FIND_CREEPS)) cm.set(c.pos.x, c.pos.y, 0xff);
  for (const pc of room.find(FIND_POWER_CREEPS)) cm.set(pc.pos.x, pc.pos.y, 0xff);
  creepAwareCache[roomName] = cm;
  return cm;
}

// A creep this close to the mover is an obstacle when its path is planned.
// One further off will likely have moved on by the time the mover gets there.
// Walling off every creep in the room sent Grimford's porters and merchants
// out by the east gate, 25 tiles out of their way, whenever another creep
// stood in the north gate. A creep that does stay put on the path is met by
// the stuck check, which plans again with it close.
const CREEP_OBSTACLE_RANGE = 3;

// Creeps are obstacles only near the mover, and so only in the room it stands
// in. One standing a room or two ahead will likely have moved on by the time
// the mover gets there, and counting it as a wall can leave no complete path
// at all: the mover then walks a partial path that changes every tick, which
// the stuck check (the same tile three ticks running) never sees.
function creepsNear(from: RoomPosition): (roomName: string) => CostMatrix {
  return (roomName) => {
    if (roomName !== from.roomName) return getRoomCostMatrix(roomName);
    const sites = siteCostMatrix(roomName);
    const room = Game.rooms[roomName];
    if (!room) return sites;

    let cm: CostMatrix | undefined;
    const block = (pos: RoomPosition): void => {
      if (Math.max(Math.abs(pos.x - from.x), Math.abs(pos.y - from.y)) > CREEP_OBSTACLE_RANGE) return;
      cm ??= sites.clone();
      cm.set(pos.x, pos.y, 0xff);
    };
    for (const c of room.find(FIND_CREEPS)) block(c.pos);
    for (const pc of room.find(FIND_POWER_CREEPS)) block(pc.pos);
    return cm ?? sites;
  };
}

const ROUTE_TTL = 500;
const DANGER_ROUTE_COST = 10;

const routeCache = new Map<string, { rooms: Set<string> | null; tick: number }>();
let routePruneTick = 0;
let blockedMatrix: CostMatrix | undefined;

let dangerTick = -1;
let myName: string | undefined;
const markedHostile = new Set<string>();

function refreshDangerContext(): void {
  if (dangerTick === Game.time) return;
  dangerTick = Game.time;
  myName = undefined;
  for (const rn in Game.rooms) {
    const ctrl = Game.rooms[rn].controller;
    if (ctrl?.my && ctrl.owner) {
      myName = ctrl.owner.username;
      break;
    }
  }
  markedHostile.clear();
  for (const rn in Memory.rooms) {
    for (const r of Memory.rooms[rn]?.remoteRooms ?? []) {
      if (r.hostile && (r.hostileUntil === undefined || r.hostileUntil > Game.time)) {
        markedHostile.add(r.roomName);
      }
    }
  }
}

function isHighwayRoom(roomName: string): boolean {
  const m = roomName.match(/^[WE](\d+)[NS](\d+)$/);
  if (!m) return false;
  return parseInt(m[1], 10) % 10 === 0 || parseInt(m[2], 10) % 10 === 0;
}

// Cost of passing through a room on the way to destRoom. Towered enemy rooms are
// impassable (with no tower count recorded, any enemy-owned room is); Source Keeper
// rooms, rooms someone else reserves and rooms we have flagged hostile are a last
// resort. The destination itself is always allowed, so SK ops and attacks can
// still reach their target.
export function routeRoomCost(roomName: string, destRoom: string): number {
  if (roomName === destRoom) return 1;
  refreshDangerContext();
  if (Game.rooms[roomName]?.controller?.my) return 1;
  const intel = Memory.intel?.[roomName];
  const owner = intel?.owner;
  if (intel && owner && owner !== myName && !isAlly(owner)) {
    if (intel.towers === undefined || intel.towers > 0) return Infinity;
    return DANGER_ROUTE_COST;
  }
  const reservedBy = intel?.reservedBy;
  if (reservedBy && reservedBy !== myName && !isAlly(reservedBy)) return DANGER_ROUTE_COST;
  if (isSourceKeeperRoom(roomName) || markedHostile.has(roomName)) return DANGER_ROUTE_COST;
  if (isHighwayRoom(roomName)) return 1;
  return 2;
}

// Rooms a creep may path through from `from` to `to`, cached per pair. Null means
// no safe route exists, and the caller falls back to unrestricted pathing rather
// than stranding the creep.
export function getRouteRooms(from: string, to: string): Set<string> | null {
  if (Game.time - routePruneTick >= ROUTE_TTL) {
    routePruneTick = Game.time;
    for (const [k, v] of routeCache) if (Game.time - v.tick >= ROUTE_TTL) routeCache.delete(k);
  }
  const key = `${from}:${to}`;
  const cached = routeCache.get(key);
  if (cached && Game.time - cached.tick < ROUTE_TTL) return cached.rooms;

  const route = Game.map.findRoute(from, to, { routeCallback: (rn) => routeRoomCost(rn, to) });
  const rooms = route === ERR_NO_PATH ? null : new Set([from, to, ...route.map((r) => r.room)]);
  routeCache.set(key, { rooms, tick: Game.time });
  return rooms;
}

function getBlockedMatrix(): CostMatrix {
  if (!blockedMatrix) {
    blockedMatrix = new PathFinder.CostMatrix();
    for (let x = 0; x < 50; x++) for (let y = 0; y < 50; y++) blockedMatrix.set(x, y, 0xff);
  }
  return blockedMatrix;
}

// Cross-room: keep the path inside the danger-aware room route. With no safe
// route the path is left unrestricted rather than stranding the creep.
function restrictToRoute(creep: Creep, tpos: RoomPosition, opts: MoveToOpts): void {
  if (!(tpos instanceof RoomPosition)) return;
  const allowed = getRouteRooms(creep.pos.roomName, tpos.roomName);
  if (!allowed) return;
  const inner = opts.costCallback;
  opts.costCallback = (roomName, cm) => {
    if (!allowed.has(roomName)) return getBlockedMatrix();
    return inner ? inner(roomName, cm) : cm;
  };
}

(Creep.prototype as { moveTo: unknown }).moveTo = function (
  this: Creep,
  ...args: unknown[]
): ScreepsReturnCode {
  const target = args[0];
  if (typeof target === "number") {
    return originalMoveTo.apply(this, args);
  }

  const opts = args[1] as MoveToOpts | undefined;
  const tpos = (target as { pos?: RoomPosition })?.pos ?? (target as RoomPosition);
  const sameRoom = tpos instanceof RoomPosition && tpos.roomName === this.pos.roomName;
  const range = (opts?.range as number | undefined) ?? 1;
  // A walk to somewhere in this room stays in it. Left free, the path could cut
  // through a neighbour when that is shorter, and a home worker that steps out
  // takes up work in whatever room it lands in.
  const roomBound: MoveToOpts = sameRoom ? { maxRooms: 1 } : {};

  // Traffic handling can be switched off on its own; the danger-aware route
  // still applies, since walking into a towered room is never a traffic choice.
  if (Memory.trafficDisabled) {
    const plainOpts: MoveToOpts = { ...roomBound, ...(opts ?? {}) };
    if (!sameRoom) restrictToRoute(this, tpos, plainOpts);
    return originalMoveTo.call(this, target as never, plainOpts as never);
  }

  const effectiveOpts: MoveToOpts = { plainCost: 2, swampCost: 10, ...roomBound, ...(opts ?? {}) };
  if (!effectiveOpts.costCallback) {
    effectiveOpts.costCallback = creepsNear(this.pos);
  }
  if (!sameRoom) restrictToRoute(this, tpos, effectiveOpts);

  pruneStuckState();

  if (sameRoom && this.pos.getRangeTo(tpos) <= range) {
    stuckState.delete(this.name);
    return originalMoveTo.call(this, target as never, effectiveOpts as never);
  }

  const posKey = this.pos.x * 50 + this.pos.y;
  const prev = stuckState.get(this.name);
  // Count ticks, not calls: a second moveTo in the same tick changes nothing,
  // and a gap of more than one tick starts the count over.
  if (prev && prev.t === Game.time) {
    return originalMoveTo.call(this, target as never, effectiveOpts as never);
  }
  let st = 0;
  if (
    prev &&
    prev.t === Game.time - 1 &&
    prev.lpr === this.pos.roomName &&
    prev.lp === posKey &&
    this.fatigue === 0
  ) {
    st = prev.st + 1;
  }
  stuckState.set(this.name, { st, lp: posKey, lpr: this.pos.roomName, t: Game.time });

  if (st >= STUCK_THRESHOLD) {
    stuckState.set(this.name, { st: 0, lp: posKey, lpr: this.pos.roomName, t: Game.time });
    // Step straight into our blocker's tile; resolveTraffic moves it into ours, so they swap.
    const blocker = sameRoom ? registerShove(this, tpos, range) : null;
    if (blocker) return this.move(this.pos.getDirectionTo(blocker.pos));
    effectiveOpts.reusePath = 0;
    return originalMoveTo.call(this, target as never, effectiveOpts as never);
  }

  return originalMoveTo.call(this, target as never, effectiveOpts as never);
};

// Steps one tile away from every threat, aiming to end at least `range` from
// each. False when there is nowhere to go, so the caller can carry on instead.
function fleeFrom(creep: Creep, threats: RoomPosition[], range: number): boolean {
  const result = PathFinder.search(
    creep.pos,
    threats.map((pos) => ({ pos, range })),
    { flee: true, maxRooms: 1, plainCost: 2, swampCost: 10, roomCallback: roadCostCallback, maxOps: 500 }
  );
  const next = result.path[0];
  if (!next || next.roomName !== creep.pos.roomName) return false;
  return creep.move(creep.pos.getDirectionTo(next)) === OK;
}

// Home-economy roles that step away from armed hostiles. Military and remote
// roles already have their own handling.
const CIVILIAN_ROLES = new Set<string>([
  ROLE_HARVESTER,
  ROLE_MINER,
  ROLE_HAULER,
  ROLE_FILLER,
  ROLE_BUILDER,
  ROLE_REPAIRER,
  ROLE_UPGRADER,
  ROLE_MINERAL_MINER,
  ROLE_MINSTREL,
]);

// How close a hostile can get before it can hit us next tick: a ranged hostile
// steps once and fires at range 3, a melee one steps once and hits adjacent.
const RANGED_REACH = 4;
const MELEE_REACH = 2;
// How far a sheltering creep backs off.
const SHELTER_DISTANCE = 6;
// How far a civilian will run for a cottage bed, and how much further off the
// danger must be before it comes back out.
const BED_SHELTER_RANGE = 12;
const BED_LINGER_RANGE = 3;

/**
 * Moves a civilian out of reach of any armed hostile that could hit it next
 * tick. A creep standing on one of our ramparts stays put. Returns true when
 * the creep spent its tick moving away.
 */
export function shelterFromHostiles(creep: Creep): boolean {
  if (!CIVILIAN_ROLES.has(creep.memory.role)) return false;
  const { hostiles } = getThreatInfo(creep.room);
  if (hostiles.length === 0) return false;
  if (creep.room.controller?.my && creep.room.controller.safeMode) return false;

  // A creep already barred in a cottage bed waits a little longer before it
  // comes out, or it would step out and straight back in.
  const here = `${creep.pos.x},${creep.pos.y}`;
  const beds = creep.room.controller?.my ? bedTiles(creep.room.memory.town) : [];
  const inBed = creep.memory.townSpot === here && beds.includes(here);
  const margin = inBed ? BED_LINGER_RANGE : 0;

  const threats: RoomPosition[] = [];
  for (const h of hostiles) {
    const reach =
      h.getActiveBodyparts(RANGED_ATTACK) > 0
        ? RANGED_REACH
        : h.getActiveBodyparts(ATTACK) > 0
          ? MELEE_REACH
          : 0;
    if (reach > 0 && creep.pos.inRangeTo(h.pos, reach + margin)) threats.push(h.pos);
  }
  if (threats.length === 0) return false;

  if (inBed) {
    claimSpot(creep, [here]);
    return true;
  }

  const onRampart = creep.pos
    .lookFor(LOOK_STRUCTURES)
    .some((s) => s.structureType === STRUCTURE_RAMPART && (s as StructureRampart).my);
  if (onRampart) return false;

  // A free bed close by, and not toward the danger, beats open ground.
  const bed = shelterBed(creep, beds, threats);
  if (bed) {
    goToSpot(creep, bed);
    return true;
  }

  return fleeFrom(creep, threats, SHELTER_DISTANCE);
}

/**
 * Walks a home-economy creep back to the castle that raised it if it has
 * strayed into another room, say off an exit tile. Returns true while it is on
 * its way.
 */
export function walkHome(creep: Creep): boolean {
  const home = creep.memory.homeRoom;
  if (!home || creep.room.name === home || !CIVILIAN_ROLES.has(creep.memory.role)) return false;
  creep.moveTo(new RoomPosition(25, 25, home), { range: 20 });
  return true;
}

function shelterBed(creep: Creep, beds: string[], threats: RoomPosition[]): string | null {
  if (beds.length === 0) return null;
  const nearestThreat = (x: number, y: number): number =>
    Math.min(...threats.map((t) => Math.max(Math.abs(t.x - x), Math.abs(t.y - y))));
  const mine = nearestThreat(creep.pos.x, creep.pos.y);
  const usable = beds.filter((k) => {
    const { x, y } = parseTile(k);
    const far = Math.max(Math.abs(creep.pos.x - x), Math.abs(creep.pos.y - y));
    return far <= BED_SHELTER_RANGE && nearestThreat(x, y) >= mine;
  });
  return usable.length > 0 ? claimSpot(creep, usable) : null;
}

interface ShoveReq {
  stuck: Creep;
  blocker: Creep;
}
let shoveTick = -1;
let pendingShoves: ShoveReq[] = [];

const MAX_SHOVE_PATHFINDS_PER_ROOM = 3;
let shovePathfindTick = -1;
const shovePathfindsThisTick: Record<string, number> = {};

function registerShove(creep: Creep, targetPos: RoomPosition, range: number): Creep | null {
  const roomName = creep.pos.roomName;
  if (shovePathfindTick !== Game.time) {
    shovePathfindTick = Game.time;
    for (const k in shovePathfindsThisTick) delete shovePathfindsThisTick[k];
  }
  if ((shovePathfindsThisTick[roomName] ?? 0) >= MAX_SHOVE_PATHFINDS_PER_ROOM) return null;
  shovePathfindsThisTick[roomName] = (shovePathfindsThisTick[roomName] ?? 0) + 1;

  const result = PathFinder.search(
    creep.pos,
    { pos: targetPos, range },
    { roomCallback: structureCostCallback, plainCost: 2, swampCost: 10, maxOps: 1000 }
  );
  const next = result.path[0];
  if (!next || next.roomName !== creep.pos.roomName) return null;
  const blocker = next.lookFor(LOOK_CREEPS).find((c) => c.my);
  // A blocker that can't move this tick won't swap; let the caller path around it.
  if (!blocker || blocker.fatigue > 0 || isOnWorkingPost(blocker)) return null;

  if (shoveTick !== Game.time) {
    shoveTick = Game.time;
    pendingShoves = [];
  }
  pendingShoves.push({ stuck: creep, blocker });
  return blocker;
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
