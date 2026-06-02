import { ROLE_KNIGHT, ROLE_WIZARD, ROLE_CLERIC, ROLE_SIEGER } from "../config/config.roles";
import {
  getThreatInfo,
  selectHostileTarget,
  selectStructureTarget,
  formationOffset,
  evaluateRoomThreatLevel,
} from "../services/services.combat";

// ── Tunables ────────────────────────────────────────────────────────────────────
const REGROUP_HP_THRESHOLD = 0.85; // squad must heal to this avg before re-engaging
const RALLY_RANGE = 8;             // distance from spawn that counts as "rallied"
const CLEARED_TICKS_NEEDED = 10;   // ticks a room stays empty before the op completes
const FORMING_TIMEOUT = 1500;      // ticks to assemble a squad before aborting
const FRAGMENT_TIMEOUT = 300;      // ticks split across rooms before pulling back to regroup
const KITE_RANGE = 3;              // wizards hold the enemy at this range
const DEFEND_RADIUS = 3;           // defend tactic holds within this of the rally point
const CRITICAL_HP = 0.2;           // members below this break off to find a cleric
const WARCOUNCIL_SCAN_INTERVAL = 50;
const AUTO_ATTACK_INTERVAL = 1000; // min ticks between auto-launched attacks
const AUTO_ATTACK_MAX_THREAT = 4;  // auto-attack only rooms at or below this threat level
const AUTO_ATTACK_MAX_RANGE = 6;   // and within this map distance of an owned room

// Per-tactic auto-retreat threshold (avg squad HP). Raids pull back early to strike
// again; sieges grind on longer because retreating mid-breach wastes the approach.
const RETREAT_THRESHOLD: Record<SquadTactic, number> = {
  assault: 0.4,
  siege: 0.35,
  raid: 0.55,
  defend: 0.3,
  retreat: 1.1, // always "retreating"
};

// ── Main loop ─────────────────────────────────────────────────────────────────

export function loop(): void {
  runWarCouncil();

  const op = Memory.militaryOp;
  if (!op) return;

  // Normalize ops created before these fields existed (live-memory migration).
  op.formation = op.formation ?? "box";
  op.tactic = op.tactic ?? "assault";
  op.requiredSiegers = op.requiredSiegers ?? 0;

  const homeRoom = Game.rooms[op.homeRoom];
  if (!homeRoom?.controller?.my) return;

  const members = getSquadMembers(op);

  switch (op.phase) {
    case "forming":    runForming(op, members); break;
    case "rallying":   runRallying(op, homeRoom, members); break;
    case "attacking":  runAttacking(op, members); break;
    case "retreating": runRetreating(op, members); break;
  }
}

// ── Phase logic ───────────────────────────────────────────────────────────────

function runForming(op: MilitaryOp, members: Creep[]): void {
  if (Game.time - op.startedAt > FORMING_TIMEOUT) {
    console.log(`[Military] ${op.targetRoom}: Forming timeout — squad could not be assembled, aborting`);
    cancelOp();
    return;
  }

  if (squadMet(op, members)) {
    op.phase = "rallying";
    console.log(`[Military] ${op.targetRoom}: Squad formed (${members.length} creeps) — rallying at spawn`);
  }
}

function runRallying(op: MilitaryOp, homeRoom: Room, members: Creep[]): void {
  if (!squadMet(op, members)) {
    op.phase = "forming";
    console.log(`[Military] ${op.targetRoom}: Squad incomplete during rally — reforming`);
    return;
  }

  const spawn = homeRoom.find(FIND_MY_SPAWNS)[0];
  if (!spawn) return;

  const allRallied = members.every(
    (c) => c.room.name === op.homeRoom && c.pos.getRangeTo(spawn) <= RALLY_RANGE
  );

  if (allRallied) {
    op.phase = "attacking";
    console.log(`[Military] ${op.targetRoom}: Squad rallied — advancing in ${op.formation}/${op.tactic}!`);
  }
}

function runAttacking(op: MilitaryOp, members: Creep[]): void {
  if (members.length === 0) {
    op.phase = "forming";
    op.clearedSince = undefined;
    op.regroupSince = undefined;
    console.log(`[Military] ${op.targetRoom}: All squad members lost — reforming`);
    return;
  }

  const ctx = getSquadContext(op);

  // Watchdog: a squad split across rooms for too long (a straggler that can't path
  // up) pulls back home rather than stalling the leader forever.
  if (!ctx.cohesive) {
    if (!op.regroupSince) op.regroupSince = Game.time;
    else if (Game.time - op.regroupSince > FRAGMENT_TIMEOUT) {
      op.phase = "retreating";
      op.regroupSince = undefined;
      op.clearedSince = undefined;
      console.log(`[Military] ${op.targetRoom}: Squad fragmented too long — pulling back to regroup`);
      return;
    }
  } else {
    op.regroupSince = undefined;
  }

  // Auto-retreat on sustained casualties. This is a safety reflex and always active;
  // a manual "retreat" tactic already routes through the retreating branch below.
  if (op.tactic !== "retreat" && ctx.avgHpPct < RETREAT_THRESHOLD[op.tactic]) {
    op.phase = "retreating";
    op.clearedSince = undefined;
    op.regroupSince = undefined;
    console.log(`[Military] ${op.targetRoom}: Squad at ${Math.round(ctx.avgHpPct * 100)}% — retreating to regroup`);
    return;
  }

  // Completion check requires vision of the target room.
  const targetRoom = Game.rooms[op.targetRoom];
  if (!targetRoom) {
    op.clearedSince = undefined;
    return;
  }

  if (op.tactic === "defend") return; // a hold never self-completes

  const hostiles = targetRoom.find(FIND_HOSTILE_CREEPS);
  const ownedStructs = targetRoom.find(FIND_HOSTILE_STRUCTURES);
  const cleared =
    op.tactic === "raid"
      ? hostiles.length === 0 &&
        !ownedStructs.some(
          (s) => s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_TOWER
        )
      : hostiles.length === 0 && ownedStructs.length === 0;

  if (cleared) {
    if (!op.clearedSince) {
      op.clearedSince = Game.time;
    } else if (Game.time - op.clearedSince >= CLEARED_TICKS_NEEDED) {
      console.log(`[Military] ${op.targetRoom}: Objective complete — standing down.`);
      completeOp(op);
    }
  } else {
    op.clearedSince = undefined;
  }
}

function runRetreating(op: MilitaryOp, members: Creep[]): void {
  if (members.length === 0) {
    op.phase = "forming";
    return;
  }

  const allHome = members.every((c) => c.room.name === op.homeRoom);
  if (!allHome) return;

  const ctx = getSquadContext(op);
  if (ctx.avgHpPct < REGROUP_HP_THRESHOLD) return; // still licking wounds

  // A manually ordered retreat holds at home until the commander issues new orders.
  if (op.tactic === "retreat") return;

  if (squadMet(op, members)) {
    op.phase = "rallying";
    console.log(`[Military] ${op.targetRoom}: Regrouped — re-rallying for another push (${op.tactic})`);
  } else {
    op.phase = "forming";
    console.log(`[Military] ${op.targetRoom}: Squad depleted after retreat — reforming`);
  }
}

// ── Squad context (memoized per tick) ───────────────────────────────────────────

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

// Front-to-back ordering for formation slots: tanks lead, healers center, ranged back.
const SLOT_ORDER: Record<string, number> = {
  [ROLE_KNIGHT]: 0,
  [ROLE_SIEGER]: 1,
  [ROLE_CLERIC]: 2,
  [ROLE_WIZARD]: 3,
};

export function getSquadContext(op: MilitaryOp): SquadContext {
  if (squadContextTick === Game.time && squadContextKey === op.targetRoom && squadContextValue) {
    return squadContextValue;
  }

  const members = getSquadMembers(op);

  // Deterministic slot assignment: order by formation role, then id.
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

  // Cohesion is room-based: the squad commits as one body and stages at each room
  // border, but a straggler lagging within the leader's room never stalls the push.
  const cohesive = !leader || members.every((c) => c.room.name === leader.room.name);

  squadContextValue = { members, leader, slotById, avgHpPct, minHpPct: minHp, cohesive };
  squadContextTick = Game.time;
  squadContextKey = op.targetRoom;
  return squadContextValue;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function getSquadMembers(op: MilitaryOp): Creep[] {
  return Object.values(Game.creeps).filter(
    (c) => c.memory.offensiveTarget === op.targetRoom && c.memory.homeRoom === op.homeRoom
  );
}

function squadMet(op: MilitaryOp, members: Creep[]): boolean {
  return (
    members.filter((c) => c.memory.role === ROLE_KNIGHT).length >= op.requiredKnights &&
    members.filter((c) => c.memory.role === ROLE_WIZARD).length >= op.requiredWizards &&
    members.filter((c) => c.memory.role === ROLE_CLERIC).length >= op.requiredClerics &&
    members.filter((c) => c.memory.role === ROLE_SIEGER).length >= op.requiredSiegers
  );
}

function completeOp(op: MilitaryOp): void {
  clearSquadTargets(op.targetRoom);
  delete Memory.militaryOp;
}

function clearSquadTargets(targetRoom: string): void {
  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.offensiveTarget === targetRoom) {
      delete creep.memory.offensiveTarget;
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function cancelOp(): void {
  const op = Memory.militaryOp;
  if (!op) return;
  clearSquadTargets(op.targetRoom);
  delete Memory.militaryOp;
}

// Builds a default squad composition scaled to the target's known defenses.
export function recommendComposition(
  targetRoom: string,
  tactic: SquadTactic
): { knights: number; wizards: number; clerics: number; siegers: number } {
  const intel = Memory.intel?.[targetRoom];
  const towers = intel?.towers ?? 0;
  const owned = !!intel?.owner;

  let knights = 2 + Math.min(2, towers);
  let wizards = 1;
  let clerics = Math.max(1, Math.min(3, towers));
  let siegers = 0;

  if (tactic === "siege" || (owned && towers >= 2)) siegers = 2;
  if (tactic === "raid") {
    knights = 2;
    wizards = 1;
    clerics = 1;
    siegers = 0;
  }

  return { knights, wizards, clerics, siegers };
}

// Launches an operation. Returns an error string, or null on success.
export function launchOp(
  targetRoom: string,
  formation: SquadFormation,
  tactic: SquadTactic,
  composition: { knights: number; wizards: number; clerics: number; siegers: number },
  homeRoom: string
): string | null {
  if (Memory.militaryOp) {
    return `already running op against ${Memory.militaryOp.targetRoom} (${Memory.militaryOp.phase})`;
  }
  const total =
    composition.knights + composition.wizards + composition.clerics + composition.siegers;
  if (total <= 0) return "squad must have at least one member";

  Memory.militaryOp = {
    targetRoom,
    homeRoom,
    phase: "forming",
    startedAt: Game.time,
    formation,
    tactic,
    requiredKnights: composition.knights,
    requiredWizards: composition.wizards,
    requiredClerics: composition.clerics,
    requiredSiegers: composition.siegers,
  };
  return null;
}

// Mid-battle formation/tactic changes from the console.
export function setFormation(formation: SquadFormation): boolean {
  const op = Memory.militaryOp;
  if (!op) return false;
  op.formation = formation;
  return true;
}

export function setTactic(tactic: SquadTactic): boolean {
  const op = Memory.militaryOp;
  if (!op) return false;
  op.tactic = tactic;
  if (tactic === "retreat") {
    op.phase = "retreating"; // fall back and hold until new orders
  } else if (op.phase === "retreating") {
    op.phase = "attacking"; // resume the offensive immediately
  }
  return true;
}

// ── WarCouncil: intel gathering + target ranking + optional auto-attack ─────────

function runWarCouncil(): void {
  if (!Memory.warCouncil) Memory.warCouncil = { autoAttack: false };
  const wc = Memory.warCouncil;

  if (Game.time - (wc.lastScan ?? 0) >= WARCOUNCIL_SCAN_INTERVAL) {
    scanIntel();
    wc.lastScan = Game.time;
  }

  if (wc.autoAttack && !Memory.militaryOp) {
    considerAutoAttack(wc);
  }
}

function scanIntel(): void {
  if (!Memory.intel) Memory.intel = {};
  for (const rn in Game.rooms) {
    const room = Game.rooms[rn];
    if (room.controller?.my) continue;

    const towers = room.find(FIND_HOSTILE_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_TOWER,
    }).length;
    const spawns = room.find(FIND_HOSTILE_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_SPAWN,
    }).length;
    const { hostiles } = getThreatInfo(room);
    let combatParts = 0;
    let healParts = 0;
    for (const h of hostiles) {
      for (const p of h.body) {
        if (p.type === ATTACK || p.type === RANGED_ATTACK) combatParts++;
        if (p.type === HEAL) healParts++;
      }
    }

    Memory.intel[rn] = {
      roomName: rn,
      lastSeen: Game.time,
      owner: room.controller?.owner?.username,
      reservedBy: room.controller?.reservation?.username,
      rcl: room.controller?.level ?? 0,
      towers,
      spawns,
      hostileCreeps: hostiles.length,
      hostileCombatParts: combatParts,
      hostileHealParts: healParts,
      safeMode: room.controller?.safeMode,
      threatLevel: evaluateRoomThreatLevel(room),
    };
  }
}

function considerAutoAttack(wc: WarCouncilMemory): void {
  if (Game.time - (wc.lastAutoAttackTick ?? 0) < AUTO_ATTACK_INTERVAL) return;
  if (!Memory.intel) return;

  const ownedRooms = Object.values(Game.rooms).filter((r) => r.controller?.my);
  if (ownedRooms.length === 0) return;

  // Only attack from a room with the economy to sustain a squad.
  const capableHome = ownedRooms.find(
    (r) => (r.controller?.level ?? 0) >= 5 && (r.storage?.store[RESOURCE_ENERGY] ?? 0) >= 50_000
  );
  if (!capableHome) return;

  let best: RoomIntelData | null = null;
  let bestHome = capableHome.name;
  let bestScore = Infinity;
  for (const rn in Memory.intel) {
    const intel = Memory.intel[rn];
    if (!intel.owner || intel.owner === capableHome.controller?.owner?.username) continue;
    if (intel.safeMode) continue;
    if (intel.threatLevel > AUTO_ATTACK_MAX_THREAT) continue;

    const home = ownedRooms.reduce((b, r) =>
      Game.map.getRoomLinearDistance(r.name, rn) < Game.map.getRoomLinearDistance(b.name, rn) ? r : b
    );
    const dist = Game.map.getRoomLinearDistance(home.name, rn);
    if (dist > AUTO_ATTACK_MAX_RANGE) continue;

    const score = intel.threatLevel * 10 + dist;
    if (score < bestScore) {
      bestScore = score;
      best = intel;
      bestHome = home.name;
    }
  }

  if (!best) return;
  const comp = recommendComposition(best.roomName, "assault");
  const err = launchOp(best.roomName, "box", "assault", comp, bestHome);
  if (!err) {
    wc.lastAutoAttackTick = Game.time;
    console.log(`[WarCouncil] Auto-launch: ${bestHome} → ${best.roomName} (threat ${best.threatLevel})`);
  }
}

// ── Per-creep offensive behavior (called from role files) ─────────────────────

export function runOffensiveKnight(creep: Creep, op: MilitaryOp): void {
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

  // Critically injured: break off toward a cleric so it isn't lost.
  if (creep.hits < creep.hitsMax * CRITICAL_HP && !isLeader) {
    const cleric = creep.pos.findClosestByRange(ctx.members, {
      filter: (c: Creep) => c.memory.role === ROLE_CLERIC,
    });
    const adjacent = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 1)[0];
    if (adjacent) creep.attack(adjacent);
    if (cleric && !creep.pos.isNearTo(cleric)) {
      creep.moveTo(cleric, { reusePath: 3 });
      return;
    }
  }

  if (creep.room.name !== op.targetRoom) {
    const adjacent = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 1)[0];
    if (adjacent) creep.attack(adjacent);
    transitMove(creep, op, ctx, isLeader);
    return;
  }

  const hostiles = getThreatInfo(creep.room).hostiles;
  const target = selectHostileTarget(creep.pos, hostiles);

  if (target) {
    if (creep.pos.isNearTo(target)) creep.attack(target);
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

  const struct = selectStructureTarget(creep.room, creep.pos, op.tactic);
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

  // Fire: mass attack when swarmed, otherwise focus the squad's priority target.
  const inMass = creep.pos.findInRange(hostiles, KITE_RANGE);
  if (inMass.length >= 3) {
    creep.rangedMassAttack();
  } else {
    const target = selectHostileTarget(creep.pos, hostiles);
    if (target && creep.pos.getRangeTo(target) <= 3) {
      creep.rangedAttack(target);
    } else if (op.tactic !== "defend") {
      const struct = selectStructureTarget(creep.room, creep.pos, op.tactic);
      if (struct && creep.pos.getRangeTo(struct) <= 3) creep.rangedAttack(struct);
    }
  }

  // Movement: kite hostiles when present; otherwise hold the formation / press structures.
  const nearest = creep.pos.findClosestByRange(hostiles);
  if (nearest) {
    const range = creep.pos.getRangeTo(nearest);
    if (range < KITE_RANGE) {
      fleeFrom(creep, nearest.pos);
    } else if (range > KITE_RANGE + 1) {
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

  const struct = selectStructureTarget(creep.room, creep.pos, op.tactic);
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
    parkNearHomeSpawn(creep, op.homeRoom);
    return;
  }
  if (op.phase === "retreating" || op.tactic === "retreat") {
    healBest(creep, ctx);
    retreatToHome(creep, op.homeRoom);
    return;
  }

  const isLeader = ctx.leader?.id === creep.id;
  const healTarget = healBest(creep, ctx);

  if (creep.room.name !== op.targetRoom) {
    transitMove(creep, op, ctx, isLeader);
    return;
  }

  // Move to reach a wounded ally just out of range; otherwise hold formation.
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

  const struct = selectStructureTarget(creep.room, creep.pos, op.tactic);
  if (struct) {
    if (creep.pos.isNearTo(struct)) creep.dismantle(struct);
    else if (isLeader) leaderAdvance(creep, op, ctx, struct.pos, 1);
    else moveToSlot(creep, op, ctx);
    return;
  }

  regroup(creep, op, ctx, isLeader);
}

// ── Movement & combat helpers ────────────────────────────────────────────────

// Heals the most wounded squad member in range (self included). Returns the chosen
// ally even when out of melee range so the caller can close the distance.
function healBest(creep: Creep, ctx: SquadContext): Creep | null {
  // ctx.members includes the cleric itself, so self-healing is covered here too.
  const wounded = ctx.members.filter((c) => c.hits < c.hitsMax);
  if (wounded.length === 0) return null;
  const target = wounded.reduce((a, b) => (a.hits / a.hitsMax < b.hits / b.hitsMax ? a : b));
  const range = creep.pos.getRangeTo(target);
  if (range <= 1) creep.heal(target);
  else if (range <= 3) creep.rangedHeal(target);
  return target;
}

function rangedSnapFire(creep: Creep): void {
  const inRange = creep.pos.findInRange(FIND_HOSTILE_CREEPS, KITE_RANGE);
  if (inRange.length >= 3) creep.rangedMassAttack();
  else if (inRange.length > 0) creep.rangedAttack(inRange[0]);
}

// Kite away from a threat using a flee path so the wizard rounds obstacles instead
// of pinning itself against a wall, with a raw-direction fallback.
function fleeFrom(creep: Creep, threat: RoomPosition): void {
  const result = PathFinder.search(
    creep.pos,
    { pos: threat, range: KITE_RANGE + 1 },
    { flee: true, maxRooms: 1, plainCost: 2, swampCost: 5 }
  );
  if (result.path.length > 0) {
    creep.move(creep.pos.getDirectionTo(result.path[0]));
  } else {
    creep.move(threat.getDirectionTo(creep.pos));
  }
}

// Followers path to their formation slot relative to the leader; this is what keeps
// the squad in formation and, across room borders, drags stragglers to the leader.
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

// Melee follower: engage a nearby hostile directly, else fall back into formation.
function moveKnightFollower(creep: Creep, op: MilitaryOp, ctx: SquadContext, hostiles: Creep[]): void {
  const nearest = creep.pos.findClosestByRange(hostiles);
  if (nearest) {
    const range = creep.pos.getRangeTo(nearest);
    if (range === 1) return; // already engaged — hold and keep swinging
    if (range <= 3) {
      creep.moveTo(nearest, { range: 1, reusePath: 1 });
      return;
    }
  }
  moveToSlot(creep, op, ctx);
}

// The leader only advances when the squad is together, so the group commits as one.
function leaderAdvance(
  creep: Creep,
  _op: MilitaryOp,
  ctx: SquadContext,
  dest: RoomPosition,
  range: number
): void {
  if (!ctx.cohesive) return; // hold and let stragglers form up
  if (creep.pos.inRangeTo(dest, range)) return;
  creep.moveTo(dest, { range, reusePath: 3 });
}

// Transit toward the target room. Leader leads (and waits when fragmented); the rest
// converge on their formation slots, which closes the gap room by room.
function transitMove(creep: Creep, op: MilitaryOp, ctx: SquadContext, isLeader: boolean): void {
  if (isLeader || !ctx.leader) {
    // Leader advances toward the target only when the squad is together; otherwise it
    // holds at the room border so stragglers can form up before the next crossing.
    if (ctx.cohesive || !ctx.leader) {
      creep.moveTo(new RoomPosition(25, 25, op.targetRoom), { reusePath: 10 });
    }
    return;
  }
  // A follower in another room closes on the leader directly (cheap multi-room path);
  // once in the leader's room it slots into formation.
  if (creep.room.name !== ctx.leader.room.name) {
    creep.moveTo(ctx.leader.pos, { range: 1, reusePath: 10 });
    return;
  }
  moveToSlot(creep, op, ctx);
}

// Defend tactic: hold within DEFEND_RADIUS of the target room centre.
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

// No targets left: leader drifts to room centre, followers hold formation.
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
