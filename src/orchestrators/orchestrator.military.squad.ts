import {
  ROLE_KNIGHT,
  ROLE_WIZARD,
  ROLE_CLERIC,
  ROLE_SIEGER,
  ROLE_DRAINER,
} from "../config/config.roles";
import {
  getThreatInfo,
  selectHostileTarget,
  selectStructureTarget,
  formationOffset,
  buildTowerCostMatrix,
  planBreach,
  assessTowers,
  towersAreDrained,
  type BreachPlan,
  type TowerStatus,
} from "../services/services.combat";
import {
  KITE_RANGE,
  towerFocus,
  meleeStrike,
  rangedStrike,
  fleeFrom,
} from "./orchestrator.military.defense";

export const RALLY_RANGE = 8;

const DEFEND_RADIUS = 3;

const CRITICAL_HP = 0.2;

const BOOST_GRACE_TICKS = 80;

const HOLD_FOR_DRAIN_MAX = 300;

interface SquadContext {
  members: Creep[];
  leader: Creep | null;
  slotById: Record<string, number>;
  avgHpPct: number;
  minHpPct: number;
  cohesive: boolean;
}

let squadContextTick = -1;

let squadContextKey = "";

let squadContextValue: SquadContext | null = null;

const SLOT_ORDER: Record<string, number> = {
  [ROLE_KNIGHT]: 0,
  [ROLE_SIEGER]: 1,
  [ROLE_CLERIC]: 2,
  [ROLE_WIZARD]: 3,
};

export function getSquadContext(op: MilitaryOp): SquadContext {
  const key = `${op.homeRoom}>${op.targetRoom}`;
  if (squadContextTick === Game.time && squadContextKey === key && squadContextValue) {
    return squadContextValue;
  }

  const members = getSquadMembers(op);

  const ordered = [...members].sort((a, b) => {
    const ra = SLOT_ORDER[a.memory.role] ?? 9;
    const rb = SLOT_ORDER[b.memory.role] ?? 9;
    if (ra !== rb) return ra - rb;
    return a.id < b.id ? -1 : 1;
  });

  const slotById: Record<string, number> = {};
  ordered.forEach((c, i) => (slotById[c.id] = i));

  const leader = ordered[0] ?? null;

  let hpSum = 0;
  let minHp = 1;
  for (const c of members) {
    const pct = c.hits / c.hitsMax;
    hpSum += pct;
    if (pct < minHp) minHp = pct;
  }
  const avgHpPct = members.length > 0 ? hpSum / members.length : 1;

  const cohesive = !leader || members.every((c) => c.room.name === leader.room.name);

  squadContextValue = { members, leader, slotById, avgHpPct, minHpPct: minHp, cohesive };
  squadContextTick = Game.time;
  squadContextKey = key;
  return squadContextValue;
}

const breachCache: Record<string, BreachPlan> = {};

function breachKey(op: MilitaryOp): string {
  return `${op.homeRoom}>${op.targetRoom}`;
}

function getBreachFocus(op: MilitaryOp, room: Room, fromPos: RoomPosition): AnyStructure | null {
  const key = breachKey(op);
  const cached = breachCache[key];
  if (cached) {
    const focus = Game.getObjectById(cached.focusId) as AnyStructure | null;
    if (focus && focus.room?.name === room.name && (focus as { hits?: number }).hits) {
      return focus;
    }
    delete breachCache[key];
  }

  const plan = planBreach(room, fromPos);
  if (!plan) return null;
  breachCache[key] = plan;
  return Game.getObjectById(plan.focusId) as AnyStructure | null;
}

export function clearBreachPlan(op: MilitaryOp): void {
  delete breachCache[breachKey(op)];
}

function attackStructureTarget(creep: Creep, op: MilitaryOp): AnyStructure | null {
  const breach = getBreachFocus(op, creep.room, creep.pos);
  if (breach) return breach;
  return selectStructureTarget(creep.room, creep.pos, op.tactic);
}

export function getSquadMembers(op: MilitaryOp): Creep[] {
  return Object.values(Game.creeps).filter(
    (c) =>
      c.memory.offensiveTarget === op.targetRoom &&
      c.memory.homeRoom === op.homeRoom &&
      c.memory.role !== ROLE_DRAINER
  );
}

export function squadMet(op: MilitaryOp, members: Creep[]): boolean {
  return (
    members.filter((c) => c.memory.role === ROLE_KNIGHT).length >= op.requiredMelee &&
    members.filter((c) => c.memory.role === ROLE_WIZARD).length >= op.requiredRanged &&
    members.filter((c) => c.memory.role === ROLE_CLERIC).length >= op.requiredHealers &&
    members.filter((c) => c.memory.role === ROLE_SIEGER).length >= op.requiredSiege
  );
}

function creepNeedsBoost(creep: Creep): boolean {
  return !!creep.memory.boostCompound || (creep.memory.boostQueue?.length ?? 0) > 0;
}

function withinBoostGrace(creep: Creep): boolean {
  const age = CREEP_LIFE_TIME - (creep.ticksToLive ?? CREEP_LIFE_TIME);
  return age <= BOOST_GRACE_TICKS;
}

export function squadBoostReady(members: Creep[]): boolean {
  for (const c of members) {
    if (creepNeedsBoost(c) && withinBoostGrace(c)) return false;
  }
  return true;
}

export function runOffensiveKnight(creep: Creep, op: MilitaryOp): void {
  const ctx = getSquadContext(op);
  if (op.phase === "forming" || op.phase === "rallying") {
    strikeAdjacent(creep);
    parkNearHomeSpawn(creep, op.homeRoom);
    return;
  }
  if (op.phase === "retreating" || op.tactic === "retreat") {
    strikeAdjacent(creep);
    retreatToHome(creep, op.homeRoom);
    return;
  }

  const isLeader = ctx.leader?.id === creep.id;

  if (creep.hits < creep.hitsMax * CRITICAL_HP && !isLeader) {
    const healer = creep.pos.findClosestByRange(ctx.members, {
      filter: (c: Creep) => c.memory.role === ROLE_CLERIC,
    });
    strikeAdjacent(creep);
    if (healer && !creep.pos.isNearTo(healer)) {
      creep.moveTo(healer, { reusePath: 3 });
      return;
    }
  }

  if (creep.room.name !== op.targetRoom) {
    strikeAdjacent(creep);
    transitMove(creep, op, ctx, isLeader);
    return;
  }

  const hostiles = getThreatInfo(creep.room).hostiles;
  const target = selectHostileTarget(creep.pos, hostiles);

  if (target) {
    meleeStrike(creep, target, hostiles);
    if (op.tactic === "defend") {
      holdNearRally(creep, op, ctx, isLeader);
    } else if (isLeader) {
      leaderAdvance(creep, op, ctx, target.pos, 1);
    } else {
      moveKnightFollower(creep, op, ctx, hostiles);
    }
    return;
  }

  if (op.tactic === "defend") {
    holdNearRally(creep, op, ctx, isLeader);
    return;
  }

  const struct = attackStructureTarget(creep, op);
  if (struct) {
    if (creep.pos.isNearTo(struct)) creep.attack(struct);
    if (isLeader) leaderAdvance(creep, op, ctx, struct.pos, 1);
    else moveToSlot(creep, op, ctx);
    return;
  }

  regroup(creep, op, ctx, isLeader);
}

export function runOffensiveWizard(creep: Creep, op: MilitaryOp): void {
  const ctx = getSquadContext(op);
  if (op.phase === "forming" || op.phase === "rallying") {
    rangedSnapFire(creep);
    parkNearHomeSpawn(creep, op.homeRoom);
    return;
  }
  if (op.phase === "retreating" || op.tactic === "retreat") {
    rangedSnapFire(creep);
    retreatToHome(creep, op.homeRoom);
    return;
  }

  const isLeader = ctx.leader?.id === creep.id;

  if (creep.room.name !== op.targetRoom) {
    rangedSnapFire(creep);
    transitMove(creep, op, ctx, isLeader);
    return;
  }

  const hostiles = getThreatInfo(creep.room).hostiles;

  if (!rangedStrike(creep, selectHostileTarget(creep.pos, hostiles), hostiles) && op.tactic !== "defend") {
    const struct = attackStructureTarget(creep, op);
    if (struct && creep.pos.getRangeTo(struct) <= 3) creep.rangedAttack(struct);
  }

  const nearest = creep.pos.findClosestByRange(hostiles);
  if (nearest) {
    const range = creep.pos.getRangeTo(nearest);
    if (range < KITE_RANGE) {
      fleeFrom(creep, nearest.pos);
    } else if (range > KITE_RANGE) {
      if (op.tactic === "defend") holdNearRally(creep, op, ctx, isLeader);
      else if (isLeader) leaderAdvance(creep, op, ctx, nearest.pos, KITE_RANGE);
      else moveToSlot(creep, op, ctx);
    }
    return;
  }

  if (op.tactic === "defend") {
    holdNearRally(creep, op, ctx, isLeader);
    return;
  }

  const struct = attackStructureTarget(creep, op);
  if (struct) {
    if (isLeader) leaderAdvance(creep, op, ctx, struct.pos, KITE_RANGE);
    else moveToSlot(creep, op, ctx);
    return;
  }

  regroup(creep, op, ctx, isLeader);
}

export function runOffensiveCleric(creep: Creep, op: MilitaryOp): void {
  const ctx = getSquadContext(op);
  if (op.phase === "forming" || op.phase === "rallying") {
    if (creep.hits < creep.hitsMax) creep.heal(creep);
    else healBest(creep, ctx, false);
    parkNearHomeSpawn(creep, op.homeRoom);
    return;
  }
  if (op.phase === "retreating" || op.tactic === "retreat") {
    healBest(creep, ctx, false);
    retreatToHome(creep, op.homeRoom);
    return;
  }

  const isLeader = ctx.leader?.id === creep.id;
  const healTarget = healBest(creep, ctx);

  if (creep.room.name !== op.targetRoom) {
    transitMove(creep, op, ctx, isLeader);
    return;
  }

  if (healTarget && creep.pos.getRangeTo(healTarget) > 1 && creep.pos.getRangeTo(healTarget) <= 5) {
    creep.moveTo(healTarget, { range: 1, reusePath: 1 });
    return;
  }

  if (op.tactic === "defend") {
    holdNearRally(creep, op, ctx, isLeader);
    return;
  }

  if (isLeader) regroup(creep, op, ctx, isLeader);
  else moveToSlot(creep, op, ctx);
}

export function runOffensiveSieger(creep: Creep, op: MilitaryOp): void {
  const ctx = getSquadContext(op);
  if (op.phase === "forming" || op.phase === "rallying") {
    parkNearHomeSpawn(creep, op.homeRoom);
    return;
  }
  if (op.phase === "retreating" || op.tactic === "retreat") {
    retreatToHome(creep, op.homeRoom);
    return;
  }

  const isLeader = ctx.leader?.id === creep.id;

  if (creep.room.name !== op.targetRoom) {
    transitMove(creep, op, ctx, isLeader);
    return;
  }

  if (op.tactic === "defend") {
    holdNearRally(creep, op, ctx, isLeader);
    return;
  }

  if (op.tactic === "siege" && shouldHoldForDrain(op, creep.room)) {
    holdAtBreachApproach(creep, op, ctx, isLeader);
    return;
  }

  const struct = attackStructureTarget(creep, op);
  if (struct) {
    if (creep.pos.isNearTo(struct)) creep.dismantle(struct);
    else if (isLeader) leaderAdvance(creep, op, ctx, struct.pos, 1);
    else moveToSlot(creep, op, ctx);
    return;
  }

  regroup(creep, op, ctx, isLeader);
}

function healBest(creep: Creep, ctx: SquadContext, preHeal = true): Creep | null {
  const wounded = ctx.members.filter((c) => c.hits < c.hitsMax);
  if (wounded.length === 0) {
    // Nobody hurt: pre-heal the front creep so incoming damage is offset this tick.
    // Returns null so the cleric keeps its formation slot instead of chasing.
    const front = ctx.leader;
    if (preHeal && front) {
      const range = creep.pos.getRangeTo(front);
      if (range <= 1) creep.heal(front);
      else if (range <= 3) creep.rangedHeal(front);
    }
    return null;
  }
  const target = wounded.reduce((a, b) => (a.hits / a.hitsMax < b.hits / b.hitsMax ? a : b));
  const range = creep.pos.getRangeTo(target);
  if (range <= 1) creep.heal(target);
  else if (range <= 3) creep.rangedHeal(target);
  return target;
}

function rangedSnapFire(creep: Creep): void {
  const hostiles = getThreatInfo(creep.room).hostiles;
  rangedStrike(creep, towerFocus(creep, hostiles, KITE_RANGE), hostiles);
}

// Hit a hostile that is already adjacent without leaving the current post.
function strikeAdjacent(creep: Creep): void {
  const hostiles = getThreatInfo(creep.room).hostiles;
  const target =
    towerFocus(creep, hostiles, 1) ?? selectHostileTarget(creep.pos, creep.pos.findInRange(hostiles, 1));
  if (target) creep.attack(target);
}

function moveToSlot(creep: Creep, op: MilitaryOp, ctx: SquadContext): void {
  const leader = ctx.leader;
  if (!leader) return;
  if (leader.id === creep.id) return;
  const slot = ctx.slotById[creep.id] ?? 0;
  const [dx, dy] = formationOffset(op.formation, slot);
  const x = Math.min(48, Math.max(1, leader.pos.x + dx));
  const y = Math.min(48, Math.max(1, leader.pos.y + dy));
  const dest = new RoomPosition(x, y, leader.room.name);
  if (creep.pos.roomName === dest.roomName && creep.pos.getRangeTo(dest) === 0) return;
  creep.moveTo(dest, { reusePath: 1 });
}

function moveKnightFollower(creep: Creep, op: MilitaryOp, ctx: SquadContext, hostiles: Creep[]): void {
  const engageable = hostiles.filter(
    (h) => h.pos.x > 1 && h.pos.x < 48 && h.pos.y > 1 && h.pos.y < 48
  );
  const nearest = creep.pos.findClosestByRange(engageable);
  if (nearest) {
    const range = creep.pos.getRangeTo(nearest);
    if (range === 1) return;
    if (range <= 3) {
      creep.moveTo(nearest, { range: 1, reusePath: 1 });
      return;
    }
  }
  moveToSlot(creep, op, ctx);
}

let towerMatrixTick = -1;

const towerMatrixCache: Record<string, CostMatrix> = {};

function getTowerMatrix(room: Room): CostMatrix {
  if (towerMatrixTick !== Game.time) {
    towerMatrixTick = Game.time;
    for (const k in towerMatrixCache) delete towerMatrixCache[k];
  }
  let m = towerMatrixCache[room.name];
  if (!m) {
    const towers = room.find(FIND_HOSTILE_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_TOWER,
    }) as StructureTower[];
    m = buildTowerCostMatrix(room, towers);
    towerMatrixCache[room.name] = m;
  }
  return m;
}

const FORMATION_SLOT_SLACK = 2;

function blockInFormation(op: MilitaryOp, ctx: SquadContext): boolean {
  const leader = ctx.leader;
  if (!leader) return true;
  for (const c of ctx.members) {
    if (c.id === leader.id) continue;
    if (c.room.name !== leader.room.name) return false;
    const slot = ctx.slotById[c.id] ?? 0;
    const [dx, dy] = formationOffset(op.formation, slot);
    const sx = Math.min(48, Math.max(1, leader.pos.x + dx));
    const sy = Math.min(48, Math.max(1, leader.pos.y + dy));
    if (c.pos.getRangeTo(new RoomPosition(sx, sy, leader.room.name)) > FORMATION_SLOT_SLACK) {
      return false;
    }
  }
  return true;
}

function leaderAdvance(
  creep: Creep,
  op: MilitaryOp,
  ctx: SquadContext,
  dest: RoomPosition,
  range: number
): void {
  if (!ctx.cohesive) return;
  if (creep.pos.inRangeTo(dest, range)) return;

  if (creep.room.name === op.targetRoom && !blockInFormation(op, ctx)) return;

  if (creep.room.name === op.targetRoom) {
    const matrix = getTowerMatrix(creep.room);
    const result = PathFinder.search(
      creep.pos,
      { pos: dest, range },
      {
        maxRooms: 1,
        plainCost: 2,
        swampCost: 5,
        roomCallback: (rn) => (rn === creep.room.name ? matrix : false),
      }
    );
    if (result.path.length > 0) {
      creep.move(creep.pos.getDirectionTo(result.path[0]));
      return;
    }
  }

  creep.moveTo(dest, { range, reusePath: 3 });
}

function transitMove(creep: Creep, op: MilitaryOp, ctx: SquadContext, isLeader: boolean): void {
  if (isLeader || !ctx.leader) {
    if (ctx.cohesive || !ctx.leader) {
      creep.moveTo(new RoomPosition(25, 25, op.targetRoom), { reusePath: 10 });
    }
    return;
  }
  if (creep.room.name !== ctx.leader.room.name) {
    creep.moveTo(ctx.leader.pos, { range: 1, reusePath: 10 });
    return;
  }
  moveToSlot(creep, op, ctx);
}

function holdNearRally(creep: Creep, op: MilitaryOp, ctx: SquadContext, isLeader: boolean): void {
  if (creep.room.name !== op.targetRoom) {
    transitMove(creep, op, ctx, isLeader);
    return;
  }
  const rally = new RoomPosition(25, 25, op.targetRoom);
  if (creep.pos.getRangeTo(rally) > DEFEND_RADIUS) {
    creep.moveTo(rally, { range: DEFEND_RADIUS, reusePath: 5 });
  }
}

function regroup(creep: Creep, op: MilitaryOp, ctx: SquadContext, isLeader: boolean): void {
  if (isLeader || !ctx.leader) {
    const center = new RoomPosition(25, 25, op.targetRoom);
    if (creep.room.name !== op.targetRoom || !creep.pos.inRangeTo(center, 5)) {
      creep.moveTo(center, { range: 5, reusePath: 10 });
    }
    return;
  }
  moveToSlot(creep, op, ctx);
}

// Siegers wait for drainers to empty the towers, but not forever: give up if
// no drainer is alive or the towers have been kept topped up for too long.
export function shouldHoldForDrain(op: MilitaryOp, room: Room): boolean {
  const status: TowerStatus = assessTowers(room);
  if (status.count < 2 || towersAreDrained(status)) {
    delete op.holdSince;
    return false;
  }
  const drainerAlive = Object.values(Game.creeps).some(
    (c) => c.memory.role === ROLE_DRAINER && c.memory.offensiveTarget === op.targetRoom
  );
  if (!drainerAlive) return false;
  if (op.holdSince === undefined) op.holdSince = Game.time;
  return Game.time - op.holdSince < HOLD_FOR_DRAIN_MAX;
}

function holdAtBreachApproach(creep: Creep, op: MilitaryOp, ctx: SquadContext, isLeader: boolean): void {
  const focus = getBreachFocus(op, creep.room, creep.pos);
  const anchor = focus ? focus.pos : new RoomPosition(25, 25, op.targetRoom);
  if (isLeader || !ctx.leader) {
    if (!creep.pos.inRangeTo(anchor, DEFEND_RADIUS)) {
      leaderAdvance(creep, op, ctx, anchor, DEFEND_RADIUS);
    }
    return;
  }
  moveToSlot(creep, op, ctx);
}

const DRAIN_RETREAT_HP = 0.45;

const DRAIN_RESUME_HP = 0.95;

const DRAIN_BAIT_RANGE = 18;

function drainTarget(creep: Creep, targetRoom: string): void {
  if (creep.hits < creep.hitsMax) creep.heal(creep);

  const hpPct = creep.hits / creep.hitsMax;
  if (hpPct <= DRAIN_RETREAT_HP) creep.memory.drainRetreat = true;
  else if (hpPct >= DRAIN_RESUME_HP) creep.memory.drainRetreat = false;
  const recovering = creep.memory.drainRetreat === true;

  if (creep.room.name !== targetRoom) {
    if (recovering && hpPct < DRAIN_RESUME_HP) return;
    creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 20 });
    return;
  }

  if (recovering) {
    const exit = creep.pos.findClosestByRange(FIND_EXIT);
    if (exit) creep.moveTo(exit, { reusePath: 5 });
    return;
  }

  const towers = creep.room.find(FIND_HOSTILE_STRUCTURES, {
    filter: (s) =>
      s.structureType === STRUCTURE_TOWER && (s as StructureTower).store[RESOURCE_ENERGY] > 0,
  }) as StructureTower[];
  const tower = creep.pos.findClosestByRange(towers);
  if (!tower) {
    const exit = creep.pos.findClosestByRange(FIND_EXIT);
    if (exit && creep.pos.getRangeTo(exit) > 3) creep.moveTo(exit, { range: 3, reusePath: 10 });
    return;
  }

  const range = creep.pos.getRangeTo(tower);
  if (range > DRAIN_BAIT_RANGE) {
    creep.moveTo(tower, { range: DRAIN_BAIT_RANGE, reusePath: 5 });
  } else if (range < DRAIN_BAIT_RANGE - 3) {
    fleeFrom(creep, tower.pos);
  }
}

export function runOffensiveDrainer(creep: Creep, op: MilitaryOp): void {
  if (op.phase === "retreating" || op.tactic === "retreat") {
    if (creep.hits < creep.hitsMax) creep.heal(creep);
    retreatToHome(creep, op.homeRoom);
    return;
  }
  drainTarget(creep, op.targetRoom);
}

export function runStandaloneDrainer(creep: Creep, op: DrainOp): void {
  drainTarget(creep, op.targetRoom);
}

function parkNearHomeSpawn(creep: Creep, homeRoomName: string): void {
  if (creep.room.name !== homeRoomName) {
    creep.moveTo(new RoomPosition(25, 25, homeRoomName), { reusePath: 10 });
    return;
  }
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn && creep.pos.getRangeTo(spawn) > RALLY_RANGE) {
    creep.moveTo(spawn, { reusePath: 20 });
  }
}

function retreatToHome(creep: Creep, homeRoomName: string): void {
  if (creep.room.name !== homeRoomName) {
    creep.moveTo(new RoomPosition(25, 25, homeRoomName), { reusePath: 5 });
    return;
  }
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn && !creep.pos.isNearTo(spawn)) {
    creep.moveTo(spawn, { reusePath: 20 });
  }
}
