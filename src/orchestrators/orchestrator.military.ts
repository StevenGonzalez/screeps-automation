import { ROLE_KNIGHT, ROLE_WIZARD, ROLE_CLERIC, ROLE_SIEGER } from "../config/config.roles";
import {
  getThreatInfo,
  getThreatSeverity,
  selectHostileTarget,
  selectStructureTarget,
  formationOffset,
  evaluateRoomThreatLevel,
} from "../services/services.combat";

// ── Tunables ────────────────────────────────────────────────────────────────────
const REGROUP_HP_THRESHOLD = 0.85; // squad must heal to this avg before re-engaging
const RALLY_RANGE = 8;             // distance from spawn that counts as "rallied"
const CLEARED_TICKS_NEEDED = 10;   // ticks a room stays empty before the op completes
const INTEL_TTL = 20_000;          // drop intel for rooms not seen in this long (memory cap)
const FORMING_TIMEOUT = 1500;      // ticks to assemble a squad before aborting
const FRAGMENT_TIMEOUT = 300;      // ticks split across rooms before pulling back to regroup
const KITE_RANGE = 3;              // wizards hold the enemy at this range
const DEFEND_RADIUS = 3;           // defend tactic holds within this of the rally point
const CRITICAL_HP = 0.2;           // members below this break off to find a cleric
const WARCOUNCIL_SCAN_INTERVAL = 50;
const AUTO_ATTACK_INTERVAL = 1000; // min ticks between auto-launched attacks

// ── Standing defense tunables ────────────────────────────────────────────────────
// A defensive op is declared when a home room's threat score crosses this. The score
// is 10/creep + 5/ATTACK + 5/RANGED_ATTACK + 8/HEAL part, so this corresponds to a
// healer-backed raid that towers alone can't comfortably out-damage (SEVERITY_HIGH=150).
const DEFENSE_THREAT_SCORE = 150;
// Heavy threat re-evaluation is throttled; cheap per-creep behavior still runs each tick.
const DEFENSE_SCAN_INTERVAL = 5;
// Once the room has been clear of meaningful threats for this long, stand the squad down.
const DEFENSE_CLEAR_TICKS = 25;
// Defenders hold within this range of the threatened room's spawn cluster / rally point
// so they don't suicidally chase hostiles onto exit tiles.
const DEFENSE_HOLD_RADIUS = 6;
// Don't drift past this distance from the rally point chasing a fleeing hostile.
const DEFENSE_CHASE_RADIUS = 12;
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

let rampartCacheTick = -1;
const defensiveRampartCache: Record<string, StructureRampart[]> = {};

// ── Main loop ─────────────────────────────────────────────────────────────────

export function loop(): void {
  runWarCouncil();
  runDefenseCouncil();

  migrateMilitaryOps();

  const ops = Memory.militaryOps;
  if (!ops) return;

  // Drive every concurrent offensive op (one per home room). Each is wholly
  // independent: its own squad, phase, formation, and tactic.
  for (const homeRoomName in ops) {
    const op = ops[homeRoomName];

    // Normalize ops created before these fields existed (live-memory migration).
    op.formation = op.formation ?? "box";
    op.tactic = op.tactic ?? "assault";
    op.requiredSiegers = op.requiredSiegers ?? 0;

    const homeRoom = Game.rooms[op.homeRoom];
    if (!homeRoom?.controller?.my) {
      // Home room lost (downgraded/conquered) — tear the op down. Owned rooms always have
      // vision, so a missing/not-ours home means it's genuinely gone; leaving the op in
      // Memory.militaryOps would leak forever and permanently mark this home "busy",
      // blocking any future op or auto-attack if we ever re-acquire it.
      removeOp(op);
      continue;
    }

    const members = getSquadMembers(op);

    switch (op.phase) {
      case "forming":    runForming(op, members); break;
      case "rallying":   runRallying(op, homeRoom, members); break;
      case "attacking":  runAttacking(op, members); break;
      case "retreating": runRetreating(op, members); break;
    }
  }

  // After driving the active ops, fill any free home room from the queue.
  advanceMilitaryQueue();
}

// Fold a legacy singular Memory.militaryOp (deployed before concurrency) into the
// keyed Memory.militaryOps map, then drop it. Safe to run every tick.
function migrateMilitaryOps(): void {
  if (!Memory.militaryOps) Memory.militaryOps = {};
  const legacy = Memory.militaryOp;
  if (legacy) {
    // Only adopt it if that home room isn't already running an op.
    if (!Memory.militaryOps[legacy.homeRoom]) {
      Memory.militaryOps[legacy.homeRoom] = legacy;
    }
    delete Memory.militaryOp;
  }
}

// ── Phase logic ───────────────────────────────────────────────────────────────

function runForming(op: MilitaryOp, members: Creep[]): void {
  if (Game.time - op.startedAt > FORMING_TIMEOUT) {
    console.log(`[Military] ${op.targetRoom}: Forming timeout — squad could not be assembled, aborting`);
    removeOp(op);
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
    op.startedAt = Game.time; // restart the forming clock so a long-lived op doesn't instantly hit FORMING_TIMEOUT on reform
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
    op.startedAt = Game.time; // restart the forming clock so a long-lived op doesn't instantly hit FORMING_TIMEOUT on reform
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
    op.startedAt = Game.time; // restart the forming clock so a long-lived op doesn't instantly hit FORMING_TIMEOUT on reform
    op.retreatSince = undefined;
    return;
  }

  // Bound how long we wait for the squad to make it home. A straggler that can't path
  // back (body-blocked, no route) must not strand the whole op — and the home room — forever.
  if (!op.retreatSince) op.retreatSince = Game.time;
  const timedOut = Game.time - op.retreatSince > FRAGMENT_TIMEOUT;

  const allHome = members.every((c) => c.room.name === op.homeRoom);
  if (!allHome && !timedOut) return;

  const ctx = getSquadContext(op);
  if (ctx.avgHpPct < REGROUP_HP_THRESHOLD && !timedOut) return; // still licking wounds

  // A manually ordered retreat holds at home until the commander issues new orders.
  if (op.tactic === "retreat") return;

  op.retreatSince = undefined;
  if (squadMet(op, members)) {
    op.phase = "rallying";
    console.log(`[Military] ${op.targetRoom}: Regrouped — re-rallying for another push (${op.tactic})`);
  } else {
    op.phase = "forming";
    op.startedAt = Game.time; // restart the forming clock so a long-lived op doesn't instantly hit FORMING_TIMEOUT on reform
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
  const key = `${op.homeRoom}>${op.targetRoom}`;
  if (squadContextTick === Game.time && squadContextKey === key && squadContextValue) {
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
  squadContextKey = key;
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

// An op finished its objective: release its squad, remove it, and pull the next
// queued target for the freed home room (the pipeline advances here).
function completeOp(op: MilitaryOp): void {
  removeOp(op);
}

// Tear down an op (completion OR abort): release its squad and remove the record.
// Squad release is filtered by BOTH target and home room so a sibling op against the
// same room (different home) keeps its creeps.
function removeOp(op: MilitaryOp): void {
  clearSquadTargets(op.targetRoom, op.homeRoom);
  if (Memory.militaryOps) delete Memory.militaryOps[op.homeRoom];
}

function clearSquadTargets(targetRoom: string, homeRoom: string): void {
  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.offensiveTarget === targetRoom && creep.memory.homeRoom === homeRoom) {
      delete creep.memory.offensiveTarget;
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

// Look up the active offensive op a creep belongs to. Roles match by targetRoom +
// homeRoom (the creep's memory carries both), which uniquely identifies an op.
export function getOffensiveOp(targetRoom: string, homeRoom: string | undefined): MilitaryOp | undefined {
  if (!homeRoom) return undefined;
  const op = Memory.militaryOps?.[homeRoom];
  return op && op.targetRoom === targetRoom ? op : undefined;
}

// Cancel the offensive op funded by `homeRoom` (or, when omitted, every op). Returns
// the number of ops stood down.
export function cancelOp(homeRoom?: string): number {
  const ops = Memory.militaryOps;
  if (!ops) return 0;
  if (homeRoom) {
    const op = ops[homeRoom];
    if (!op) return 0;
    removeOp(op);
    return 1;
  }
  let count = 0;
  for (const hr of Object.keys(ops)) {
    removeOp(ops[hr]);
    count++;
  }
  return count;
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

// Launches an operation. Returns an error string, or null on success. Concurrency is
// keyed by home room: a given home room runs at most one offensive op at a time (it
// can't fund two squads), but different home rooms can each run their own.
export function launchOp(
  targetRoom: string,
  formation: SquadFormation,
  tactic: SquadTactic,
  composition: { knights: number; wizards: number; clerics: number; siegers: number },
  homeRoom: string
): string | null {
  if (!Memory.militaryOps) Memory.militaryOps = {};
  const existing = Memory.militaryOps[homeRoom];
  if (existing) {
    return `${homeRoom} already running op against ${existing.targetRoom} (${existing.phase})`;
  }
  const total =
    composition.knights + composition.wizards + composition.clerics + composition.siegers;
  if (total <= 0) return "squad must have at least one member";

  Memory.militaryOps[homeRoom] = {
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

// ── Offensive target queue ──────────────────────────────────────────────────────
//
// Targets queued here auto-start against the next free home room once one is idle and
// can afford a squad. This pipelines manual offensives the same way the expansion
// queue does: line up several targets, and they run one-after-another per home room.

// Enqueue an offensive target. Returns an error string, or null on success.
export function enqueueOp(
  targetRoom: string,
  formation: SquadFormation,
  tactic: SquadTactic,
  composition: { knights: number; wizards: number; clerics: number; siegers: number },
  homeRoom?: string
): string | null {
  const total =
    composition.knights + composition.wizards + composition.clerics + composition.siegers;
  if (total <= 0) return "squad must have at least one member";
  if (!Memory.militaryQueue) Memory.militaryQueue = [];
  if (Memory.militaryQueue.some((q) => q.targetRoom === targetRoom)) {
    return `${targetRoom} is already queued`;
  }
  Memory.militaryQueue.push({
    targetRoom,
    homeRoom,
    formation,
    tactic,
    requiredKnights: composition.knights,
    requiredWizards: composition.wizards,
    requiredClerics: composition.clerics,
    requiredSiegers: composition.siegers,
    queuedAt: Game.time,
  });
  return null;
}

export function dequeueOp(targetRoom: string): boolean {
  const queue = Memory.militaryQueue;
  if (!queue) return false;
  const before = queue.length;
  Memory.militaryQueue = queue.filter((q) => q.targetRoom !== targetRoom);
  return Memory.militaryQueue.length !== before;
}

export function getMilitaryQueue(): QueuedMilitaryOp[] {
  return Memory.militaryQueue ?? [];
}

// A home room that can fund a squad: owned, RCL 5+, decent storage, and not already
// running an offensive op. Mirrors the auto-attack capability bar.
function isCapableOffensiveHome(room: Room): boolean {
  if (!room.controller?.my) return false;
  if ((room.controller.level ?? 0) < 5) return false;
  if ((room.storage?.store[RESOURCE_ENERGY] ?? 0) < 50_000) return false;
  if (Memory.militaryOps?.[room.name]) return false; // already busy
  return true;
}

// Start queued targets against any free, capable home rooms. Honours an explicit
// homeRoom only when it's free + capable; otherwise picks the closest capable home.
function advanceMilitaryQueue(): void {
  const queue = Memory.militaryQueue;
  if (!queue || queue.length === 0) return;

  for (let i = 0; i < queue.length; ) {
    const q = queue[i];

    // Already ours? Drop it.
    const target = Game.rooms[q.targetRoom];
    if (target?.controller?.my) {
      queue.splice(i, 1);
      continue;
    }

    let home: string | undefined;
    if (q.homeRoom) {
      const room = Game.rooms[q.homeRoom];
      if (room && isCapableOffensiveHome(room)) home = q.homeRoom;
    } else {
      let best: Room | undefined;
      let bestDist = Infinity;
      for (const rn in Game.rooms) {
        const room = Game.rooms[rn];
        if (!isCapableOffensiveHome(room)) continue;
        const d = Game.map.getRoomLinearDistance(rn, q.targetRoom);
        if (d < bestDist) { bestDist = d; best = room; }
      }
      home = best?.name;
    }

    if (!home) { i++; continue; } // no free home for this one yet — leave it queued

    const err = launchOp(
      q.targetRoom, q.formation, q.tactic,
      {
        knights: q.requiredKnights, wizards: q.requiredWizards,
        clerics: q.requiredClerics, siegers: q.requiredSiegers,
      },
      home
    );
    if (err) { i++; continue; }
    queue.splice(i, 1);
    console.log(`[Military] Queue advanced → ${home} attacking ${q.targetRoom} (${queue.length} still queued)`);
  }
}

// Resolve which active ops a console command applies to: a specific home room, or —
// when omitted — all active ops (the common single-op case targets the only one).
function resolveOps(homeRoom?: string): MilitaryOp[] {
  const ops = Memory.militaryOps;
  if (!ops) return [];
  if (homeRoom) return ops[homeRoom] ? [ops[homeRoom]] : [];
  return Object.values(ops);
}

// Mid-battle formation/tactic changes from the console. Returns ops affected.
export function setFormation(formation: SquadFormation, homeRoom?: string): number {
  const ops = resolveOps(homeRoom);
  for (const op of ops) op.formation = formation;
  return ops.length;
}

export function setTactic(tactic: SquadTactic, homeRoom?: string): number {
  const ops = resolveOps(homeRoom);
  for (const op of ops) {
    op.tactic = tactic;
    if (tactic === "retreat") {
      op.phase = "retreating"; // fall back and hold until new orders
    } else if (op.phase === "retreating") {
      op.phase = "attacking"; // resume the offensive immediately
    }
  }
  return ops.length;
}

// Active offensive ops as a flat list (for console status).
export function getOffensiveOps(): MilitaryOp[] {
  return Memory.militaryOps ? Object.values(Memory.militaryOps) : [];
}

// ── WarCouncil: intel gathering + target ranking + optional auto-attack ─────────

function runWarCouncil(): void {
  if (!Memory.warCouncil) Memory.warCouncil = { autoAttack: false };
  const wc = Memory.warCouncil;

  if (Game.time - (wc.lastScan ?? 0) >= WARCOUNCIL_SCAN_INTERVAL) {
    scanIntel();
    wc.lastScan = Game.time;
  }

  if (wc.autoAttack) {
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

  // Prune stale intel so the map can't grow unbounded across the bot's lifetime (every
  // distinct room ever scouted/transited would otherwise accumulate toward the 2MB cap).
  for (const rn in Memory.intel) {
    if (Game.time - (Memory.intel[rn].lastSeen ?? 0) > INTEL_TTL) delete Memory.intel[rn];
  }
}

function considerAutoAttack(wc: WarCouncilMemory): void {
  if (Game.time - (wc.lastAutoAttackTick ?? 0) < AUTO_ATTACK_INTERVAL) return;
  if (!Memory.intel) return;

  const ownedRooms = Object.values(Game.rooms).filter((r) => r.controller?.my);
  if (ownedRooms.length === 0) return;

  // Only attack from a room with the economy to sustain a squad AND not already
  // running an offensive op (concurrency is one op per home room).
  const capableHome = ownedRooms.find(
    (r) =>
      (r.controller?.level ?? 0) >= 5 &&
      (r.storage?.store[RESOURCE_ENERGY] ?? 0) >= 50_000 &&
      !Memory.militaryOps?.[r.name]
  );
  if (!capableHome) return;

  // Only free, capable homes are valid launch points (one offensive op per home).
  const freeHomes = ownedRooms.filter((r) => isCapableOffensiveHome(r));
  if (freeHomes.length === 0) return;

  let best: RoomIntelData | null = null;
  let bestHome = capableHome.name;
  let bestScore = Infinity;
  for (const rn in Memory.intel) {
    const intel = Memory.intel[rn];
    if (!intel.owner || intel.owner === capableHome.controller?.owner?.username) continue;
    if (intel.safeMode) continue;
    if (intel.threatLevel > AUTO_ATTACK_MAX_THREAT) continue;

    const home = freeHomes.reduce((b, r) =>
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

// ── DefenseCouncil: automatic threat-driven standing defense ───────────────────
//
// Runs alongside the WarCouncil but is wholly separate from the manual offensive
// Memory.militaryOp. Each owned room is its own theatre: when a meaningful hostile
// threat appears (one towers + safe-mode can't comfortably handle), a DefenseOp is
// declared and the spawn orchestrator raises knights/clerics/wizards (see
// shouldSpawnDefender / spawnNextDefender). Those defenders rally in-room and fight
// here via runDefensive*. The op stands down once the room stays clear.
//
// Interaction with safe-mode: this layer fights BEFORE and ALONGSIDE safe mode. Towers
// (orchestrator.tower.ts) still trigger safe mode as a last resort if the spawn is in
// danger; a standing squad buys time and may end the fight outright so safe mode never
// has to be burned. We never trigger or cancel safe mode here.

function runDefenseCouncil(): void {
  if (Game.time % DEFENSE_SCAN_INTERVAL !== 0) return;
  if (!Memory.defenseOps) Memory.defenseOps = {};
  const ops = Memory.defenseOps;

  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my) continue;

    const { score } = getThreatInfo(room);
    const severity = getThreatSeverity(room);
    const existing = ops[roomName];

    // A meaningful threat is one that warrants a standing squad: a high-severity raid
    // (healer-backed / out-damages towers). Lower threats are left to towers alone.
    const meaningful = severity === "high" || score >= DEFENSE_THREAT_SCORE;

    if (meaningful) {
      if (existing) {
        existing.lastThreatTick = Game.time;
        existing.threatScore = score;
        Object.assign(existing, recommendDefense(score));
      } else {
        ops[roomName] = {
          room: roomName,
          startedAt: Game.time,
          lastThreatTick: Game.time,
          threatScore: score,
          ...recommendDefense(score),
        };
        console.log(`[Defense] ${roomName}: threat detected (score ${score}) — raising defenders`);
      }
    } else if (existing && Game.time - existing.lastThreatTick >= DEFENSE_CLEAR_TICKS) {
      console.log(`[Defense] ${roomName}: threat cleared — standing down defenders`);
      clearDefenseOp(roomName);
    }
  }

  // Drop ops for rooms we've lost vision of for a long time or that are no longer ours.
  for (const roomName in ops) {
    const room = Game.rooms[roomName];
    if (room?.controller?.my) continue;
    if (!room && Game.time - ops[roomName].lastThreatTick < DEFENSE_CLEAR_TICKS) continue;
    clearDefenseOp(roomName);
  }
}

// Scales defender composition to the threat score. Knights are the backbone; clerics
// scale with the fight's intensity; a wizard is added to counter ranged-heavy raids.
function recommendDefense(score: number): {
  requiredKnights: number;
  requiredWizards: number;
  requiredClerics: number;
} {
  const requiredKnights = Math.min(4, 2 + Math.floor((score - DEFENSE_THREAT_SCORE) / 80));
  const requiredClerics = Math.min(2, 1 + Math.floor((score - DEFENSE_THREAT_SCORE) / 120));
  const requiredWizards = score >= DEFENSE_THREAT_SCORE + 60 ? 1 : 0;
  return { requiredKnights, requiredWizards, requiredClerics };
}

function clearDefenseOp(roomName: string): void {
  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.defensiveTarget === roomName) delete creep.memory.defensiveTarget;
  }
  if (Memory.defenseOps) delete Memory.defenseOps[roomName];
}

// ── Public API for the spawn orchestrator ──────────────────────────────────────

export function getDefenseOp(roomName: string): DefenseOp | undefined {
  return Memory.defenseOps?.[roomName];
}

// Defenders assigned to a room's standing-defense op (filtered by creep memory).
export function getDefenders(roomName: string): Creep[] {
  return Object.values(Game.creeps).filter((c) => c.memory.defensiveTarget === roomName);
}

// ── Per-creep defensive behavior (called from role files) ──────────────────────
//
// Defenders fight only inside their own threatened room. They focus-fire with the same
// selectHostileTarget priority as the offensive squad (healers first), clerics keep the
// line alive, and crucially they refuse to chase hostiles onto room-edge exit tiles —
// holding near the rally point instead so a kiting raider can't peel them off the room.

function defenseRallyPoint(roomName: string): RoomPosition {
  const room = Game.rooms[roomName];
  const spawn = room?.find(FIND_MY_SPAWNS)[0];
  if (spawn) return spawn.pos;
  return new RoomPosition(25, 25, roomName);
}

// True when a position is on (or one tile from) a room exit — chasing onto these tiles
// risks being pulled out of the room, so defenders never engage there.
function isNearEdge(pos: RoomPosition): boolean {
  return pos.x <= 1 || pos.x >= 48 || pos.y <= 1 || pos.y >= 48;
}

// Returns the best hostile to engage that won't drag the defender to the room edge,
// preferring the standard focus-fire priority. Hostiles loitering on exit tiles are
// ignored unless they're the only threat and already adjacent.
function selectDefenseTarget(creep: Creep, rally: RoomPosition, hostiles: Creep[]): Creep | null {
  const engageable = hostiles.filter(
    (h) => !isNearEdge(h.pos) && rally.getRangeTo(h) <= DEFENSE_CHASE_RADIUS
  );
  const target = selectHostileTarget(creep.pos, engageable);
  if (target) return target;
  // Fall back to finishing an adjacent edge-hugger rather than ignoring it entirely.
  return creep.pos.findInRange(hostiles, 1)[0] ?? null;
}

// Moves to engage `target` at `range` without straying past the chase radius or onto a
// room edge; otherwise drifts back toward the rally point.
function defenseMoveToward(creep: Creep, rally: RoomPosition, target: Creep, range: number): void {
  const toTarget = creep.pos.getRangeTo(target);
  if (toTarget <= range) {
    // Already in range — only reposition off an edge tile.
    if (isNearEdge(creep.pos)) creep.moveTo(rally, { range: DEFENSE_HOLD_RADIUS, reusePath: 5 });
    return;
  }
  if (rally.getRangeTo(target) > DEFENSE_CHASE_RADIUS) {
    defenseHold(creep, rally);
    return;
  }
  creep.moveTo(target, { range, reusePath: 1 });
}

// Hold a loose ring around the rally point when there's nothing safe to chase.
function defenseHold(creep: Creep, rally: RoomPosition): void {
  if (creep.pos.getRangeTo(rally) > DEFENSE_HOLD_RADIUS || isNearEdge(creep.pos)) {
    creep.moveTo(rally, { range: DEFENSE_HOLD_RADIUS, reusePath: 5 });
  }
}

function getDefensiveRamparts(room: Room): StructureRampart[] {
  if (rampartCacheTick !== Game.time) {
    rampartCacheTick = Game.time;
    for (const k in defensiveRampartCache) delete defensiveRampartCache[k];
  }
  if (!defensiveRampartCache[room.name]) {
    const terrain = room.getTerrain();
    defensiveRampartCache[room.name] = room.find(FIND_MY_STRUCTURES, {
      filter: (s): s is StructureRampart =>
        s.structureType === STRUCTURE_RAMPART &&
        !isNearEdge(s.pos) &&
        terrain.get(s.pos.x, s.pos.y) !== TERRAIN_MASK_WALL,
    }) as StructureRampart[];
  }
  return defensiveRampartCache[room.name];
}

function rampartIsStandable(rampart: StructureRampart, self: Creep): boolean {
  const blocked = rampart.pos
    .lookFor(LOOK_STRUCTURES)
    .some(
      (s) =>
        s.structureType !== STRUCTURE_RAMPART &&
        (OBSTACLE_OBJECT_TYPES as string[]).includes(s.structureType)
    );
  if (blocked) return false;
  return !rampart.pos.lookFor(LOOK_CREEPS).some((c) => c.name !== self.name);
}

function isOnRampart(creep: Creep): boolean {
  return creep.pos
    .lookFor(LOOK_STRUCTURES)
    .some((s) => s.structureType === STRUCTURE_RAMPART);
}

// Stand on the rampart nearest `anchorPos` (within `range` if possible) so the defender
// fights from cover. Returns false when the room has no usable rampart, letting the
// caller fall back to open-field positioning at low RCL.
function anchorOnRampart(creep: Creep, anchorPos: RoomPosition, range: number): boolean {
  const ramparts = getDefensiveRamparts(creep.room);
  if (ramparts.length === 0) return false;

  if (isOnRampart(creep) && creep.pos.getRangeTo(anchorPos) <= range) return true;

  let best: StructureRampart | null = null;
  let bestDist = Infinity;
  for (const r of ramparts) {
    if (!rampartIsStandable(r, creep)) continue;
    const d = r.pos.getRangeTo(anchorPos);
    if (d < bestDist) {
      bestDist = d;
      best = r;
    }
  }
  if (!best) return isOnRampart(creep);
  // For an active heal/fire/melee anchor (range > 0), don't commit to a rampart that
  // sits outside the effective range of the target — that would strand the defender on
  // cover but out of heal/fire range and the caller's `return` skips closing in. Leave
  // cover and let the caller engage. (range 0 is idle positioning at the rally, where
  // taking the nearest rampart is still correct.)
  if (range > 0 && bestDist > range) return false;
  if (!creep.pos.isEqualTo(best.pos)) creep.moveTo(best, { range: 0, reusePath: 5 });
  return true;
}

export function runDefensiveKnight(creep: Creep, roomName: string): void {
  const rally = defenseRallyPoint(roomName);
  if (creep.room.name !== roomName) {
    creep.moveTo(rally, { range: DEFENSE_HOLD_RADIUS, reusePath: 10 });
    return;
  }

  const { hostiles } = getThreatInfo(creep.room);
  const target = selectDefenseTarget(creep, rally, hostiles);
  if (target) {
    if (creep.pos.isNearTo(target)) creep.attack(target);
    // Fight from a rampart adjacent to the target; open-field advance if no ramparts.
    if (!anchorOnRampart(creep, target.pos, 1)) {
      defenseMoveToward(creep, rally, target, 1);
    }
    return;
  }
  if (!anchorOnRampart(creep, rally, 0)) defenseHold(creep, rally);
}

export function runDefensiveWizard(creep: Creep, roomName: string): void {
  const rally = defenseRallyPoint(roomName);
  if (creep.room.name !== roomName) {
    creep.moveTo(rally, { range: DEFENSE_HOLD_RADIUS, reusePath: 10 });
    return;
  }

  const { hostiles } = getThreatInfo(creep.room);

  // Fire: mass-attack a cluster, else focus the priority target within range.
  // If the priority target is out of range, still fire at the closest hostile
  // that is in range — a ranged shot costs nothing and shouldn't be wasted.
  const inMass = creep.pos.findInRange(hostiles, KITE_RANGE);
  if (inMass.length >= 3) {
    creep.rangedMassAttack();
  } else {
    const target = selectDefenseTarget(creep, rally, hostiles);
    if (target && creep.pos.getRangeTo(target) <= 3) creep.rangedAttack(target);
    else if (inMass.length > 0) creep.rangedAttack(creep.pos.findClosestByRange(inMass)!);
  }

  // Movement: fire from a rampart within range of the threat; if the room has no
  // ramparts, kite the nearest hostile in the open instead.
  const nearest = creep.pos.findClosestByRange(
    hostiles.filter((h) => !isNearEdge(h.pos) && rally.getRangeTo(h) <= DEFENSE_CHASE_RADIUS)
  );
  if (nearest) {
    if (anchorOnRampart(creep, nearest.pos, 3)) return;
    const range = creep.pos.getRangeTo(nearest);
    if (range < KITE_RANGE) {
      fleeFrom(creep, nearest.pos);
    } else if (range > KITE_RANGE) {
      // Close whenever past KITE_RANGE. `> KITE_RANGE` (not `+ 1`) removes the range-4
      // dead zone where the wizard could neither fire (ranged max 3) nor advance.
      defenseMoveToward(creep, rally, nearest, KITE_RANGE);
    } else if (isNearEdge(creep.pos)) {
      defenseHold(creep, rally);
    }
    return;
  }
  if (!anchorOnRampart(creep, rally, 0)) defenseHold(creep, rally);
}

export function runDefensiveCleric(creep: Creep, roomName: string): void {
  const rally = defenseRallyPoint(roomName);

  // Heal the most wounded defender (self included) wherever the squad is.
  const allies = getDefenders(roomName).filter((c) => c.room.name === creep.room.name);
  const wounded = allies.filter((c) => c.hits < c.hitsMax);
  let healTarget: Creep | null = null;
  if (wounded.length > 0) {
    healTarget = wounded.reduce((a, b) => (a.hits / a.hitsMax < b.hits / b.hitsMax ? a : b));
    const range = creep.pos.getRangeTo(healTarget);
    if (range <= 1) creep.heal(healTarget);
    else if (range <= 3) creep.rangedHeal(healTarget);
  } else if (creep.hits < creep.hitsMax) {
    creep.heal(creep);
  }

  if (creep.room.name !== roomName) {
    creep.moveTo(rally, { range: DEFENSE_HOLD_RADIUS, reusePath: 10 });
    return;
  }

  // Position: heal from a rampart near the squad; if no ramparts, close on the wounded.
  const anchorPos = healTarget ? healTarget.pos : rally;
  if (anchorOnRampart(creep, anchorPos, 3)) return;
  if (healTarget && creep.pos.getRangeTo(healTarget) > 1 && !isNearEdge(healTarget.pos)) {
    creep.moveTo(healTarget, { range: 1, reusePath: 1 });
    return;
  }
  defenseHold(creep, rally);
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
  // Fall back to the closest in-range hostile (then a structure) so the free
  // ranged shot is never wasted when the priority target is out of range.
  const inMass = creep.pos.findInRange(hostiles, KITE_RANGE);
  if (inMass.length >= 3) {
    creep.rangedMassAttack();
  } else {
    const target = selectHostileTarget(creep.pos, hostiles);
    if (target && creep.pos.getRangeTo(target) <= 3) {
      creep.rangedAttack(target);
    } else if (inMass.length > 0) {
      creep.rangedAttack(creep.pos.findClosestByRange(inMass)!);
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
    } else if (range > KITE_RANGE) {
      // Close whenever we've drifted past KITE_RANGE. `> KITE_RANGE` (not `+ 1`) avoids a
      // dead zone at exactly range 4 where the wizard could neither fire (ranged max 3)
      // nor advance, letting a hostile sit one tile out and neutralize it.
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
  // Don't chase a hostile sitting on a room-edge tile — moving to range 1 of it would put
  // the follower on the exit and warp it out of the room, breaking squad cohesion. Ignore
  // such a kiter and hold formation until it commits to a non-edge tile.
  const engageable = hostiles.filter(
    (h) => h.pos.x > 1 && h.pos.x < 48 && h.pos.y > 1 && h.pos.y < 48
  );
  const nearest = creep.pos.findClosestByRange(engageable);
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
