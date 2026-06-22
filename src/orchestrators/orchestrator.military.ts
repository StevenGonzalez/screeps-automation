import { ROLE_KNIGHT, ROLE_WIZARD, ROLE_CLERIC, ROLE_SIEGER } from "../config/config.roles";
import {
  getThreatInfo,
  getThreatSeverity,
  selectHostileTarget,
  selectStructureTarget,
  formationOffset,
  evaluateRoomThreatLevel,
  buildTowerCostMatrix,
  planBreach,
  assessTowers,
  towersAreDrained,
  type BreachPlan,
  type TowerStatus,
} from "../services/services.combat";
// READ-ONLY use of the offensive nuker: launchNukeFrom validates the nuker's loaded/ready
// state + range and fires it (same path the manual Game.arca.launchNuke uses). We only
// CALL it for auto nuke-then-assault; the nuker loading loop stays wholly in that file.
import { launchNukeFrom } from "./orchestrator.nuker";

// Additive memory augmentation (declaration-merged with the base interfaces in types.d.ts,
// which is out of scope to edit). These optional fields are owned entirely by the auto
// nuke-then-assault logic below; nothing else reads or writes them.
declare global {
  interface WarCouncilMemory {
    // Throttle so the auto-nuke path can't double-fire across ticks.
    lastAutoNukeTick?: number;
    // Targets we've auto-nuked, keyed by target room → the tick the nuke is modelled to
    // land (minus a lead so the squad arrives as it lands). While Game.time < this, we do
    // NOT auto-launch an assault squad at that room — a ground assault on the intact bunker
    // would just die before the nuke softens it. Once the tick passes the entry is dropped
    // and the normal auto-attack resumes (now against a freshly-cratered room). This is the
    // "launch + nukedUntil marker" model: see considerAutoNuke for the timing tradeoff.
    nukedUntil?: Record<string, number>;
  }
}

// ── Tunables ────────────────────────────────────────────────────────────────────
const REGROUP_HP_THRESHOLD = 0.85; // squad must heal to this avg before re-engaging
const RALLY_RANGE = 8;             // distance from spawn that counts as "rallied"
const CLEARED_TICKS_NEEDED = 10;   // ticks a room stays empty before the op completes
const INTEL_TTL = 6_000;           // drop intel for rooms not seen in this long. Kept short:
                                   // stale intel just bloats Memory (a per-tick serialize tax)
                                   // and is re-gathered cheaply by scouts when actually needed.
const FORMING_TIMEOUT = 1500;      // ticks to assemble a squad before aborting
const FRAGMENT_TIMEOUT = 300;      // ticks split across rooms before pulling back to regroup
const KITE_RANGE = 3;              // wizards hold the enemy at this range
const DEFEND_RADIUS = 3;           // defend tactic holds within this of the rally point
const CRITICAL_HP = 0.2;           // members below this break off to find a cleric
const WARCOUNCIL_SCAN_INTERVAL = 50;
const AUTO_ATTACK_INTERVAL = 1000; // min ticks between auto-launched attacks

// ── Boost deploy-gate tunables ────────────────────────────────────────────────────
// A forming/rallying squad must not march out half-boosted: a member that requested a
// boost should actually receive it before we commit (an unboosted assault into a
// fortified room is a wasted squad). But boosting is best-effort — if the labs can't
// supply the compound (none in stock, lab unreachable) the seekBoost pipeline gives up
// after ~BOOST_TIMEOUT (50) ticks and clears boostCompound. So the gate only HOLDS the
// advance while a member is still mid-boost AND recently spawned (within the grace
// window); once every member is boosted/gave up, or the window elapses, we proceed
// rather than deadlock forever on a permanently-unavailable boost.
//
// The window is measured from spawn via (CREEP_LIFE_TIME - ticksToLive). It is sized a
// little beyond seekBoost's own BOOST_TIMEOUT so the gate normally releases because the
// boost finished (or the pipeline gave up) — not because the clock ran out — while still
// guaranteeing the op can never freeze on missing labs.
const BOOST_GRACE_TICKS = 80;

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
    // Hold in forming while members that requested a boost are still mid-boost and within
    // the grace window — don't rally (and then march) a half-boosted squad. The grace
    // window guarantees a permanently-unavailable boost can't freeze us here.
    if (!squadBoostReady(members)) return;
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

  // Final abort-if-unboosted gate before committing to the attack: a member can still be
  // finishing its boost while the squad gathers at the rally point. Hold the advance until
  // every boost-requesting member is boosted/gave up, or has aged out of the grace window
  // (so a missing-lab boost never strands the squad at home indefinitely).
  if (allRallied && squadBoostReady(members)) {
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

// ── Breach planning (coordinated dismantle) ──────────────────────────────────────
//
// So siegers/attackers don't each chip at a different barrier, an op caches ONE breach
// plan per target room: a hits-weighted path to the room's core, whose first barrier is
// the shared focus. Everyone hits that focus until it dies, then we recompute (the next
// barrier on the path becomes the new focus). Cached in module state (not Memory) because
// it holds live RoomPosition/Id references and is cheap to rebuild on demand.

const breachCache: Record<string, BreachPlan> = {};

function breachKey(op: MilitaryOp): string {
  return `${op.homeRoom}>${op.targetRoom}`;
}

// Returns the shared focus barrier for an op's target room: the first barrier on the
// cheapest-to-break breach path. Recomputes when the cached focus has died (or no plan
// exists yet). Returns null when there are no barriers to breach. `fromPos` orients the
// breach toward the squad's approach side.
function getBreachFocus(op: MilitaryOp, room: Room, fromPos: RoomPosition): AnyStructure | null {
  const key = breachKey(op);
  const cached = breachCache[key];
  if (cached) {
    const focus = Game.getObjectById(cached.focusId) as AnyStructure | null;
    // Cached focus still standing and still in this room — keep concentrating fire on it.
    if (focus && focus.room?.name === room.name && (focus as { hits?: number }).hits) {
      return focus;
    }
    delete breachCache[key]; // focus fell (or stale) — recompute below
  }

  const plan = planBreach(room, fromPos);
  if (!plan) return null;
  breachCache[key] = plan;
  return Game.getObjectById(plan.focusId) as AnyStructure | null;
}

function clearBreachPlan(op: MilitaryOp): void {
  delete breachCache[breachKey(op)];
}

// The structure a squad member should attack/dismantle: the shared breach focus when one
// exists (concentrate the whole squad on cracking ONE barrier), else the standard
// tactic-driven structure priority. Keeps siege doctrine but adds focus-fire on barriers.
function attackStructureTarget(creep: Creep, op: MilitaryOp): AnyStructure | null {
  const breach = getBreachFocus(op, creep.room, creep.pos);
  if (breach) return breach;
  return selectStructureTarget(creep.room, creep.pos, op.tactic);
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

// ── Boost deploy gate ───────────────────────────────────────────────────────────
//
// A creep "needs a boost" while it still carries an unfinished boost request: either a
// current boostCompound it's seeking a lab for, or a boostQueue of further compounds to
// apply. The boost pipeline (seekBoost / advanceBoost in services.combat) clears both —
// setting memory.boosted — once fully boosted, AND clears them when it gives up (boost
// unavailable / timed out). So an empty boostCompound + empty boostQueue means "ready":
// boosted OR deliberately abandoned. Either way the creep won't seek a lab anymore, so
// holding the squad for it would be pointless.
function creepNeedsBoost(creep: Creep): boolean {
  return !!creep.memory.boostCompound || (creep.memory.boostQueue?.length ?? 0) > 0;
}

// True while a still-unboosted member is recent enough that holding for its boost is
// worthwhile. Measured from spawn: a creep starts at CREEP_LIFE_TIME and counts down, so
// (CREEP_LIFE_TIME - ticksToLive) is its age. A still-spawning creep (ticksToLive
// undefined) is treated as age 0 — freshly born, definitely within the window.
function withinBoostGrace(creep: Creep): boolean {
  const age = CREEP_LIFE_TIME - (creep.ticksToLive ?? CREEP_LIFE_TIME);
  return age <= BOOST_GRACE_TICKS;
}

// The gate for advancing a formed squad out of forming/rallying: hold (return false) while
// ANY member still needs a boost AND is young enough that the boost might still land. Once
// every member is ready (boosted or gave up), OR every still-unboosted member has aged past
// the grace window (a permanently-unavailable boost we won't wait on forever), the squad is
// clear to advance. This prevents marching in half-boosted without ever deadlocking on a
// missing lab.
function squadBoostReady(members: Creep[]): boolean {
  for (const c of members) {
    if (creepNeedsBoost(c) && withinBoostGrace(c)) return false;
  }
  return true;
}

// ── Post-kill controller neutralization (Task 5) ─────────────────────────────────
//
// Once a target room's hostiles AND hostile structures are gone, a razed enemy room can
// still respawn the moment we leave unless its controller is downgraded. Before releasing
// the squad we drive any CLAIM-capable member onto the controller to attackController it
// (downgrading / freeing the room). For a pure combat squad (no CLAIM parts) this is a
// safe no-op — the API mirrors role.conqueror.ts's attackController usage.

// True when the room is structurally cleared (no hostiles, no enemy structures) so it's
// safe/worthwhile to start neutralizing the controller.
function roomStructurallyCleared(room: Room): boolean {
  if (room.find(FIND_HOSTILE_CREEPS).length > 0) return false;
  return room.find(FIND_HOSTILE_STRUCTURES).length === 0;
}

// A hostile controller still worth downgrading: owned or reserved by someone who isn't us.
function hostileControllerToNeutralize(room: Room): StructureController | null {
  const ctrl = room.controller;
  if (!ctrl) return null;
  if (ctrl.my) return null;
  if (ctrl.owner || ctrl.reservation) return ctrl;
  return null;
}

// Drives a CLAIM-capable creep to attackController the target room's controller. Returns
// true when it handled the creep this tick (so callers skip their fallback movement).
function neutralizeController(creep: Creep, op: MilitaryOp): boolean {
  if (creep.room.name !== op.targetRoom) return false;
  if (!creep.body.some((p) => p.type === CLAIM && p.hits > 0)) return false; // no CLAIM: no-op
  if (!roomStructurallyCleared(creep.room)) return false;
  const ctrl = hostileControllerToNeutralize(creep.room);
  if (!ctrl) return false;

  if (creep.attackController(ctrl) === ERR_NOT_IN_RANGE) {
    creep.moveTo(ctrl, { range: 1, reusePath: 10 });
  }
  return true;
}

// An op finished its objective: release its squad, remove it, and pull the next
// queued target for the freed home room (the pipeline advances here).
function completeOp(op: MilitaryOp): void {
  // Final best-effort downgrade before the squad disbands: if the room is cleared and a
  // CLAIM-capable member is on hand, knock the controller down so the razed room can't
  // immediately respawn. Vision-guarded; a no-op for a pure combat squad.
  const room = Game.rooms[op.targetRoom];
  if (room && roomStructurallyCleared(room) && hostileControllerToNeutralize(room)) {
    const ctrl = hostileControllerToNeutralize(room)!;
    for (const c of getSquadMembers(op)) {
      if (c.room.name !== op.targetRoom) continue;
      if (!c.body.some((p) => p.type === CLAIM && p.hits > 0)) continue;
      if (c.attackController(ctrl) === ERR_NOT_IN_RANGE) c.moveTo(ctrl, { range: 1, reusePath: 5 });
      break; // one downgrade attempt per tick is enough
    }
  }
  removeOp(op);
}

// Tear down an op (completion OR abort): release its squad and remove the record.
// Squad release is filtered by BOTH target and home room so a sibling op against the
// same room (different home) keeps its creeps.
function removeOp(op: MilitaryOp): void {
  clearSquadTargets(op.targetRoom, op.homeRoom);
  clearBreachPlan(op);
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

  // Posture gate: hold the auto-pipeline while turtling/recovering. Queued targets stay
  // queued and start once posture eases. (Manual launchOp from the console is ungated.)
  const posture = Memory.empire?.posture;
  if (posture === "TURTLE" || posture === "RECOVER") return;

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
    recordRoomIntel(room);
  }

  // Prune stale intel so the map can't grow unbounded across the bot's lifetime (every
  // distinct room ever scouted/transited would otherwise accumulate toward the 2MB cap).
  for (const rn in Memory.intel) {
    if (Game.time - (Memory.intel[rn].lastSeen ?? 0) > INTEL_TTL) delete Memory.intel[rn];
  }

  rebuildPlayerModel();
}

// Records a full persistent intel snapshot for one currently-visible non-owned room into
// Memory.intel. Shared by the WarCouncil scan and the scout role (which calls it on arrival
// so freshly walked rooms update Memory.intel[*].lastSeen and feed the deep-scout BFS).
//
// Backward-compatible: every field the original shallow record carried is still written;
// the richer fields (positions, loot, barriers, mineral) are additive and optional.
export function recordRoomIntel(room: Room): void {
  if (!Memory.intel) Memory.intel = {};
  const rn = room.name;

  const pack = (p: RoomPosition): number => p.x * 50 + p.y;

  const towerStructs = room.find(FIND_HOSTILE_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_TOWER,
  }) as StructureTower[];
  const spawnStructs = room.find(FIND_HOSTILE_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_SPAWN,
  }) as StructureSpawn[];

  const { hostiles } = getThreatInfo(room);
  let combatParts = 0;
  let healParts = 0;
  for (const h of hostiles) {
    for (const p of h.body) {
      if (p.type === ATTACK || p.type === RANGED_ATTACK) combatParts++;
      if (p.type === HEAL) healParts++;
    }
  }

  const sources = room.find(FIND_SOURCES);
  const minerals = room.find(FIND_MINERALS);

  const storage = room.storage;
  const terminal = room.terminal;

  // Sum barrier hits in one pass; track the single toughest barrier (the breach point).
  let barrierTotal = 0;
  let barrierMax = 0;
  const barriers = room.find(FIND_STRUCTURES, {
    filter: (s) =>
      s.structureType === STRUCTURE_RAMPART || s.structureType === STRUCTURE_WALL,
  });
  for (const b of barriers) {
    barrierTotal += b.hits;
    if (b.hits > barrierMax) barrierMax = b.hits;
  }

  const nonEnergyLoad = (store: StoreDefinition): number => {
    let total = 0;
    for (const r in store) {
      if (r !== RESOURCE_ENERGY) total += store[r as ResourceConstant];
    }
    return total;
  };

  Memory.intel[rn] = {
    roomName: rn,
    lastSeen: Game.time,
    owner: room.controller?.owner?.username,
    reservedBy: room.controller?.reservation?.username,
    rcl: room.controller?.level ?? 0,
    towers: towerStructs.length,
    spawns: spawnStructs.length,
    hostileCreeps: hostiles.length,
    hostileCombatParts: combatParts,
    hostileHealParts: healParts,
    safeMode: room.controller?.safeMode,
    threatLevel: evaluateRoomThreatLevel(room),
    // ── persistent attack-planning fields ──
    controllerPos: room.controller ? pack(room.controller.pos) : undefined,
    spawnPos: spawnStructs.length > 0 ? spawnStructs.map((s) => pack(s.pos)) : undefined,
    towerPos: towerStructs.length > 0 ? towerStructs.map((t) => pack(t.pos)) : undefined,
    sourcePos: sources.length > 0 ? sources.map((s) => pack(s.pos)) : undefined,
    storagePos: storage ? pack(storage.pos) : undefined,
    storageEnergy: storage ? storage.store[RESOURCE_ENERGY] : undefined,
    storageMineral: storage ? nonEnergyLoad(storage.store) : undefined,
    terminalPos: terminal ? pack(terminal.pos) : undefined,
    terminalEnergy: terminal ? terminal.store[RESOURCE_ENERGY] : undefined,
    terminalMineral: terminal ? nonEnergyLoad(terminal.store) : undefined,
    barrierHpTotal: barriers.length > 0 ? barrierTotal : undefined,
    barrierHpMax: barriers.length > 0 ? barrierMax : undefined,
    mineralType: minerals.length > 0 ? minerals[0].mineralType : undefined,
  };
}

// Rebuilds the per-player empire aggregates from the current room intel. Owned-room intel
// is keyed by owner; reserved-only rooms don't count as territory. Bounded: each player's
// room list is capped, and players unseen for INTEL_TTL are pruned. This feeds value-based
// target selection later — it does NOT select targets here.
function rebuildPlayerModel(): void {
  if (!Memory.intel) return;
  if (!Memory.players) Memory.players = {};

  // Accumulate fresh aggregates from owned-room intel.
  const fresh: Record<string, PlayerIntelData> = {};
  for (const rn in Memory.intel) {
    const intel: RoomIntelData = Memory.intel[rn];
    const owner = intel.owner;
    if (!owner) continue; // only actually-owned rooms count toward an empire

    const coords = parseRoomCoords(rn);
    if (!coords) continue;

    let p = fresh[owner];
    if (!p) {
      p = fresh[owner] = {
        username: owner,
        rooms: [],
        roomCount: 0,
        maxRcl: 0,
        totalTowers: 0,
        totalSpawns: 0,
        militaryStrength: 0,
        economicStrength: 0,
        centroidX: 0,
        centroidY: 0,
        lastSeen: 0,
      };
    }

    if (p.rooms.length < PLAYER_ROOM_CAP) p.rooms.push(rn);
    p.roomCount++;
    p.maxRcl = Math.max(p.maxRcl, intel.rcl);
    p.totalTowers += intel.towers;
    p.totalSpawns += intel.spawns;
    // Coarse, unitless estimates good enough for ranking targets by value/effort.
    p.militaryStrength +=
      intel.towers * 100 + Math.floor((intel.barrierHpMax ?? 0) / 100_000) * 50 + intel.rcl * 10;
    p.economicStrength +=
      Math.floor(((intel.storageEnergy ?? 0) + (intel.terminalEnergy ?? 0)) / 1000) +
      (intel.storageMineral ?? 0) + (intel.terminalMineral ?? 0);
    p.centroidX += coords.x;
    p.centroidY += coords.y;
    p.lastSeen = Math.max(p.lastSeen, intel.lastSeen);
  }

  // Finalize centroids (running sum → average over counted rooms).
  for (const u in fresh) {
    const p = fresh[u];
    if (p.roomCount > 0) {
      p.centroidX = Math.round(p.centroidX / p.roomCount);
      p.centroidY = Math.round(p.centroidY / p.roomCount);
    }
  }

  // Merge: replace re-seen players with fresh data, keep recently-seen ones whose rooms
  // are currently out of vision, and prune anyone stale.
  const players = Memory.players;
  for (const u in fresh) players[u] = fresh[u];
  for (const u in players) {
    if (fresh[u]) continue;
    if (Game.time - players[u].lastSeen > INTEL_TTL) delete players[u];
  }
}

const PLAYER_ROOM_CAP = 30; // bound a single player's stored room list

// Parses a room name (e.g. "W12N34") into signed sector-grid coordinates. W/N are negative
// so a centroid average is meaningful across the E/W and N/S axes.
function parseRoomCoords(roomName: string): { x: number; y: number } | null {
  const m = /^([WE])(\d+)([NS])(\d+)$/.exec(roomName);
  if (!m) return null;
  const x = m[1] === "W" ? -parseInt(m[2], 10) : parseInt(m[2], 10);
  const y = m[3] === "N" ? -parseInt(m[4], 10) : parseInt(m[4], 10);
  return { x, y };
}

// ── Value-based target ranking ───────────────────────────────────────────────────
//
// We no longer just attack the nearest-softest room. Each candidate is scored on its
// VALUE (loot, RCL, whether it belongs to a rival empire we want to break) divided by
// the EFFORT to crack it given our strength (towers, barriers, range). The best
// value-per-effort target wins — provided it's actually crackable. Safe-mode rooms and
// fortresses we can't commit enough force to are filtered out entirely.

// Minimum storage+terminal energy a home needs (in addition to the 50k bar) before we'll
// commit it to a long siege of a fortified target. Keeps the empire economy healthy.
const WAR_ECONOMY_ENERGY = 100_000;
// A target whose toughest barrier exceeds this is a "fortress" — only worth committing to
// when we have several capable homes (enough force) or it's exceptionally valuable.
const FORTRESS_BARRIER_HP = 5_000_000;

// ── Auto nuke-then-assault tunables ────────────────────────────────────────────────
//
// A turtled RCL8 — barriers so thick a ground assault can't crack them, behind multiple
// towers — is exactly the target our squads stall on. For that case (and ONLY that case)
// we soften it with the offensive nuker before committing the squad. The bar is set HIGH
// on purpose: nukes are expensive (300k energy + 5k ghodium) and slow (NUKE_LAND_TIME ≈
// 50000 ticks), so we never spend one on a room a squad could have cracked on its own.
//
// Fortification bar: toughest barrier must exceed this AND the room must have at least the
// tower count below. Tuned above FORTRESS_BARRIER_HP so we only nuke the genuinely
// uncrackable bunkers, not merely "hard" rooms.
const NUKE_BARRIER_HP = 8_000_000;
const NUKE_MIN_TOWERS = 3;
const NUKE_MIN_RCL = 7;                // a developed, owned bunker — not a soft outpost
// How many nukes to land on the cluster. A single nuke does NUKE_DAMAGE (10M at center,
// 5M to range-2 splash), enough to gut a bunker's core + drop most of one barrier stack.
// Two overlapping nukes flatten a turtled RCL8's center; capped to conserve ghodium.
const NUKE_MAX_LAUNCH = 2;
// Throttle between auto-nuke decisions (independent of AUTO_ATTACK_INTERVAL so a launch
// doesn't reset the attack clock or vice-versa).
const AUTO_NUKE_INTERVAL = 1000;
// Ticks before the modelled impact at which we let the squad commit, so it's arriving as
// the nuke lands rather than waiting out the full ~50k after it's already at the wall.
// Travel from a neighbouring home is a few hundred ticks, so we release the commit this
// far ahead of impact. (See the timing tradeoff note on the launch site.)
const NUKE_ASSAULT_LEAD = 600;

// Rough value of a target room for offensive ranking. Higher = more worth taking. Combines
// stored loot, controller level (a developed room is a strategic prize), and a bonus for
// belonging to a sizeable rival empire (breaking their key room hurts them most).
function targetValue(intel: RoomIntelData): number {
  let value = 0;
  // Loot: energy is cheap-per-unit, minerals/commodities are the real prize.
  value += Math.floor(((intel.storageEnergy ?? 0) + (intel.terminalEnergy ?? 0)) / 2_000);
  value += Math.floor(((intel.storageMineral ?? 0) + (intel.terminalMineral ?? 0)) / 200);
  // A developed room is strategically valuable to deny/take.
  value += intel.rcl * 8;
  // Breaking a key room of a larger rival empire is worth more.
  const player = intel.owner ? Memory.players?.[intel.owner] : undefined;
  if (player) value += Math.min(40, player.roomCount * 4 + player.maxRcl);
  return Math.max(1, value);
}

// Rough effort to crack a target: towers and barrier strength dominate, threatLevel and
// distance add to it. Higher = harder. Used as the denominator of value-per-effort.
function targetEffort(intel: RoomIntelData, dist: number): number {
  let effort = 1;
  effort += intel.towers * 6;
  effort += Math.floor((intel.barrierHpMax ?? 0) / 500_000);
  effort += intel.threatLevel * 3;
  effort += dist;
  return effort;
}

function considerAutoAttack(wc: WarCouncilMemory): void {
  if (Game.time - (wc.lastAutoAttackTick ?? 0) < AUTO_ATTACK_INTERVAL) return;
  if (!Memory.intel) return;

  // Maintain the campaign signal regardless of whether we launch this tick: a war target
  // whose room is dead/ours/safe-moded is cleared so strategy can drop WAR posture.
  maintainWarTarget();

  // Expire any inbound-nuke markers whose impact window has passed, re-opening those rooms
  // to the auto-attack pool (now softened by the nuke).
  maintainNukedTargets(wc);

  // Posture gate: never START a new offensive while turtling or recovering. In-progress
  // ops finish on their own; this only blocks fresh launches. Missing posture ⇒ EXPAND
  // (safe default), which permits launches.
  const posture = Memory.empire?.posture;
  if (posture === "TURTLE" || posture === "RECOVER") return;

  const ownedRooms = Object.values(Game.rooms).filter((r) => r.controller?.my);
  if (ownedRooms.length === 0) return;

  // Only free, capable homes are valid launch points (one offensive op per home).
  const freeHomes = ownedRooms.filter((r) => isCapableOffensiveHome(r));
  if (freeHomes.length === 0) return;

  // Our usernames (don't attack ourselves) and a coarse measure of committable force.
  const myNames = new Set(
    ownedRooms.map((r) => r.controller?.owner?.username).filter((u): u is string => !!u)
  );
  const capableHomeCount = freeHomes.length;

  let best: RoomIntelData | null = null;
  let bestHome = freeHomes[0].name;
  let bestRatio = 0;
  for (const rn in Memory.intel) {
    const intel = Memory.intel[rn];
    if (!intel.owner || myNames.has(intel.owner)) continue;
    if (isAllyPlayer(intel.owner)) continue;
    if (intel.safeMode) continue;                       // untouchable
    if (intel.threatLevel > AUTO_ATTACK_MAX_THREAT) continue;
    // A nuke is already inbound to this room — don't throw an assault squad at the intact
    // bunker; it would die before the nuke softens it. The room becomes a target again once
    // the impact window passes (the marker is dropped in maintainNukedTargets).
    if (nukeInbound(wc, rn)) continue;

    // Pick the closest free home to fund this target.
    const home = freeHomes.reduce((b, r) =>
      Game.map.getRoomLinearDistance(r.name, rn) < Game.map.getRoomLinearDistance(b.name, rn) ? r : b
    );
    const dist = Game.map.getRoomLinearDistance(home.name, rn);
    if (dist > AUTO_ATTACK_MAX_RANGE) continue;

    // Don't bite off a fortress we can't commit enough force to. We accept it only when we
    // have multiple free homes (so we can sustain the grind) or the home is energy-rich.
    const isFortress = (intel.barrierHpMax ?? 0) > FORTRESS_BARRIER_HP;
    if (isFortress) {
      const homeRoom = Game.rooms[home.name];
      const homeEnergy =
        (homeRoom?.storage?.store[RESOURCE_ENERGY] ?? 0) +
        (homeRoom?.terminal?.store[RESOURCE_ENERGY] ?? 0);
      if (capableHomeCount < 2 && homeEnergy < WAR_ECONOMY_ENERGY) continue;
    }

    // Value-per-effort: the crackable target that gives us the most for the least cost.
    const ratio = targetValue(intel) / targetEffort(intel, dist);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = intel;
      bestHome = home.name;
    }
  }

  if (!best) return;

  // Turtled-RCL8 path: if this target is genuinely uncrackable by a ground assault (very
  // thick barriers + multiple towers + owned/stationary) and a home in nuke range has a
  // loaded nuker, NUKE it now and DEFER the squad. considerAutoNuke records a nukedUntil
  // marker; while it's pending the selection loop above skips this room, so we don't launch
  // a squad until near impact (when the bunker is about to be cratered). If we can't
  // actually fire (no loaded nuker in range), it falls through and we siege it the old way.
  if (isNukeWorthyFortress(best) && considerAutoNuke(wc, best)) return;

  // A fortified target gets a siege; a soft one an assault. The composition scales to the
  // known defenses either way (recommendComposition reads tower intel).
  const fortified = best.towers >= 2 || (best.barrierHpMax ?? 0) > 1_000_000;
  const tactic: SquadTactic = fortified ? "siege" : "assault";
  const comp = recommendComposition(best.roomName, tactic);
  const err = launchOp(best.roomName, "box", tactic, comp, bestHome);
  if (!err) {
    wc.lastAutoAttackTick = Game.time;

    // Signal the strategy coordinator: this is now a war target (it flips posture to WAR
    // next tick). Only do so when the empire economy is healthy enough to sustain a war.
    if (empireEconomyHealthy()) {
      if (!Memory.empire) {
        Memory.empire = { posture: posture ?? "EXPAND", updatedAt: Game.time };
      }
      Memory.empire.warTargetRoom = best.roomName;
      Memory.empire.warTargetPlayer = best.owner;
    }
    console.log(
      `[WarCouncil] Auto-launch (${tactic}): ${bestHome} → ${best.roomName} ` +
        `(value/effort ${bestRatio.toFixed(2)}, owner ${best.owner})`
    );
  }
}

// ── Auto nuke-then-assault ─────────────────────────────────────────────────────────
//
// True when a target is the kind a ground assault simply can't crack: a developed, OWNED
// bunker (RCL high, controller owned — a stationary fortress, not a mobile raiding force)
// behind very thick barriers AND several towers. This is the narrow case nukes exist for;
// everything softer is left to the squad so we never waste a nuke. Reads only persistent
// intel (no live room needed), so it works on a target we currently have no vision of.
function isNukeWorthyFortress(intel: RoomIntelData): boolean {
  if (!intel.owner) return false; // must be an owned, stationary bunker — not a mobile force
  if (intel.rcl < NUKE_MIN_RCL) return false;
  if (intel.towers < NUKE_MIN_TOWERS) return false;
  if ((intel.barrierHpMax ?? 0) < NUKE_BARRIER_HP) return false;
  return true;
}

// Unpack a packed position (x*50+y) into a RoomPosition in the target room. Guards the
// range so a corrupt intel value can never throw constructing the position.
function unpackIntelPos(packed: number, roomName: string): RoomPosition | null {
  const x = Math.floor(packed / 50);
  const y = packed % 50;
  if (x < 0 || x > 49 || y < 0 || y > 49) return null;
  return new RoomPosition(x, y, roomName);
}

// The aim points for a nuke strike, drawn from persistent intel: the tower positions first
// (knocking out defensive fire is the whole point), then spawns (stop respawns), then the
// controller as a fallback so we always have a center to hit. De-duplicated and capped to
// NUKE_MAX_LAUNCH so two nukes overlap on the core cluster.
function nukeAimPoints(intel: RoomIntelData): RoomPosition[] {
  const packed: number[] = [];
  for (const p of intel.towerPos ?? []) packed.push(p);
  for (const p of intel.spawnPos ?? []) packed.push(p);
  if (packed.length === 0 && intel.controllerPos !== undefined) packed.push(intel.controllerPos);

  const seen = new Set<number>();
  const out: RoomPosition[] = [];
  for (const p of packed) {
    if (seen.has(p)) continue;
    seen.add(p);
    const pos = unpackIntelPos(p, intel.roomName);
    if (pos) out.push(pos);
    if (out.length >= NUKE_MAX_LAUNCH) break;
  }
  return out;
}

// True while a nuke we auto-launched is still inbound to `roomName` (impact window not yet
// reached). Used to skip a room for assault until its bunker is about to be cratered.
function nukeInbound(wc: WarCouncilMemory, roomName: string): boolean {
  const until = wc.nukedUntil?.[roomName];
  return until !== undefined && Game.time < until;
}

// Drops nukedUntil markers whose impact window has passed, so the target re-enters the
// auto-attack pool (now as a softened room). Bounded: runs each WarCouncil tick and only
// touches the small map of pending nukes. Safe with no map present.
function maintainNukedTargets(wc: WarCouncilMemory): void {
  const map = wc.nukedUntil;
  if (!map) return;
  for (const rn in map) {
    if (Game.time >= map[rn]) delete map[rn];
  }
}

// Auto-nukes a genuinely uncrackable fortress and DEFERS the assault until impact. Returns
// true when a nuke was launched (so the caller skips launching a squad this round); false
// when we couldn't/shouldn't nuke (caller proceeds with a normal siege).
//
// SAFE and conservative by construction:
//   (a) only reached when autoAttack is enabled (caller gated on wc.autoAttack);
//   (b) caller pre-checks isNukeWorthyFortress, so this only fires on owned, stationary,
//       multi-tower, very-thick-barrier bunkers — never a soft room or a mobile force;
//   (c) launchNukeFrom fires ONLY a fully-loaded, off-cooldown nuker that's in range (the
//       exact validation the manual Game.arca.launchNuke uses) — an unready/out-of-range
//       nuker is a silent no-op, and with no nuker available we return false and siege;
//   (d) throttled by AUTO_NUKE_INTERVAL and skipped while a nuke is already inbound.
// Everything is wrapped so a thrown game-API error can never break the WarCouncil tick.
//
// TIMING TRADEOFF: a nuke lands ~NUKE_LAND_TIME (≈50000) ticks after launch — far longer
// than a combat creep's 1500-tick lifetime, so we CANNOT keep a real squad loitering until
// impact (it would die and the op would FORMING_TIMEOUT-abort long before the nuke lands).
// So instead of choreographing a squad to arrive at the same tick, we record a nukedUntil
// marker for the room and simply DON'T auto-launch an assault there until NUKE_ASSAULT_LEAD
// ticks before impact. At that point the room re-enters the auto-attack pool and a fresh
// squad is raised against the about-to-be-cratered (and then cratered) bunker — arriving as
// or just after the nuke lands. This is the "launch + nukedUntil marker" model: correct and
// safe, accepting that the squad is raised near impact rather than babysat for ~50k ticks.
function considerAutoNuke(wc: WarCouncilMemory, intel: RoomIntelData): boolean {
  try {
    if (nukeInbound(wc, intel.roomName)) return true; // already softened — keep deferring
    if (Game.time - (wc.lastAutoNukeTick ?? -AUTO_NUKE_INTERVAL) < AUTO_NUKE_INTERVAL) {
      return false;
    }

    const aimPoints = nukeAimPoints(intel);
    if (aimPoints.length === 0) return false; // no known cluster to hit

    // Try each owned home for a loaded nuker in range; launchNukeFrom validates ready+range
    // and returns an error string if it can't fire. Land up to NUKE_MAX_LAUNCH nukes, one
    // per cluster tile so they overlap on the core.
    let launched = 0;
    for (const point of aimPoints) {
      if (launched >= NUKE_MAX_LAUNCH) break;
      for (const rn in Game.rooms) {
        const home = Game.rooms[rn];
        if (!home.controller?.my) continue;
        const fireErr = launchNukeFrom(rn, point);
        if (!fireErr) {
          launched++;
          console.log(
            `[WarCouncil] Auto-NUKE: ${rn} → ${intel.roomName} @${point.x},${point.y} ` +
              `(fortress: ${intel.towers} towers, barrier ${(intel.barrierHpMax ?? 0).toLocaleString()})`
          );
          break; // this aim point is covered; move to the next cluster tile
        }
      }
    }

    if (launched === 0) return false; // no loaded nuker in range — fall back to a siege

    wc.lastAutoNukeTick = Game.time;
    if (!wc.nukedUntil) wc.nukedUntil = {};
    // Model the impact tick; release the assault NUKE_ASSAULT_LEAD ticks early so the squad
    // we raise then arrives as the nuke lands.
    const until = Game.time + Math.max(0, NUKE_LAND_TIME - NUKE_ASSAULT_LEAD);
    wc.nukedUntil[intel.roomName] = until;
    console.log(
      `[WarCouncil] ${intel.roomName}: ${launched} nuke(s) inbound — assault deferred until tick ${until}`
    );
    return true;
  } catch (e) {
    // Never let a nuke-launch hiccup break the WarCouncil. Diagnostics only.
    console.log(`[WarCouncil] Auto-nuke skipped (guarded error): ${String(e)}`);
    return false;
  }
}

// The empire can afford a war when at least one home has a comfortable energy buffer beyond
// the base squad-funding bar. Conservative so we don't declare WAR while economically fragile.
function empireEconomyHealthy(): boolean {
  for (const rn in Game.rooms) {
    const room = Game.rooms[rn];
    if (!room.controller?.my) continue;
    const energy =
      (room.storage?.store[RESOURCE_ENERGY] ?? 0) + (room.terminal?.store[RESOURCE_ENERGY] ?? 0);
    if (energy >= WAR_ECONOMY_ENERGY) return true;
  }
  return false;
}

// Allies are friends we never attack even though the game lists their creeps as hostile.
// Mirror that for empire-level targeting via the player intel model's owner names.
function isAllyPlayer(username: string | undefined): boolean {
  if (!username) return false;
  const allies = (Memory as unknown as { allies?: string[] }).allies;
  return Array.isArray(allies) && allies.includes(username);
}

// Keeps Memory.empire.warTargetRoom honest: clears it once the campaign is over — the
// target became ours, was safe-moded, dropped out of intel (razed/lost vision long-term),
// or no offensive op is targeting it anymore (the squad stood down / completed). The
// strategy coordinator reads this to drop WAR posture when the campaign ends.
function maintainWarTarget(): void {
  const empire = Memory.empire;
  const warRoom = empire?.warTargetRoom;
  if (!empire || !warRoom) return;

  // Still actively assaulting it? Keep the signal alive.
  const opActive = Memory.militaryOps
    ? Object.values(Memory.militaryOps).some((op) => op.targetRoom === warRoom)
    : false;
  if (opActive) return;

  // The op has stood down. Decide whether the campaign succeeded or simply ended.
  const room = Game.rooms[warRoom];
  const intel = Memory.intel?.[warRoom];
  const tookIt = room?.controller?.my === true;
  const safeNow = (room?.controller?.safeMode ?? intel?.safeMode) ? true : false;

  if (tookIt || safeNow || !intel) {
    delete empire.warTargetRoom;
    delete empire.warTargetPlayer;
    console.log(`[WarCouncil] War campaign against ${warRoom} ended — clearing war target.`);
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

  const struct = attackStructureTarget(creep, op);
  if (struct) {
    if (creep.pos.isNearTo(struct)) creep.attack(struct);
    if (isLeader) leaderAdvance(creep, op, ctx, struct.pos, 1);
    else moveToSlot(creep, op, ctx);
    return;
  }

  // Room structurally cleared: downgrade the controller so it can't immediately respawn
  // defenses while we hold (Task 5). Only a CLAIM-bearing member can; for a pure combat
  // squad this is a no-op and the creep just regroups.
  if (neutralizeController(creep, op)) return;

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
      const struct = attackStructureTarget(creep, op);
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

  // Tower-drain hold: against a still-towered siege target, don't grind into live tower
  // fire. Hold at the breach approach until the towers are drained (a drain pair baits
  // them, or they simply run dry), THEN commit to dismantling. See shouldHoldForDrain.
  if (op.tactic === "siege" && shouldHoldForDrain(creep.room)) {
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

// ── Tower-aware coordinated block movement ───────────────────────────────────────
//
// Inside the target room the leader paths the WHOLE block around tower fire using a
// CostMatrix that adds graduated cost near hostile towers (buildTowerCostMatrix). It
// only steps forward when the block is in formation, so the squad moves as one cohesive
// mass through the killbox rather than dribbling in one creep at a time. Followers keep
// stepping toward their leader-relative slots (moveToSlot) in lockstep. With no towers
// the matrix is just obstacles and this degrades to a normal cohesive advance.

// Per-tick cache of the tower cost matrix, keyed by room. Rebuilding scans the whole room
// so we compute it at most once per room per tick and share it across all squad members.
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

// How far a follower may sit from its ideal slot before the block counts as "broken" and
// the leader pauses to let it close up. A small slack absorbs fatigue desync without
// stalling the advance on every minor jostle.
const FORMATION_SLOT_SLACK = 2;

// True when every follower is in (or near) its formation slot relative to the leader — the
// gate for the leader to take its next step so cohesion holds through tower fire.
function blockInFormation(op: MilitaryOp, ctx: SquadContext): boolean {
  const leader = ctx.leader;
  if (!leader) return true;
  for (const c of ctx.members) {
    if (c.id === leader.id) continue;
    if (c.room.name !== leader.room.name) return false; // a straggler in another room
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

// The leader only advances when the squad is together, so the group commits as one. Inside
// the target room it routes the block around the worst tower-fire tiles and additionally
// waits until the block is in formation (not just same-room) before each step.
function leaderAdvance(
  creep: Creep,
  op: MilitaryOp,
  ctx: SquadContext,
  dest: RoomPosition,
  range: number
): void {
  if (!ctx.cohesive) return; // hold and let stragglers form up across rooms
  if (creep.pos.inRangeTo(dest, range)) return;

  // In the target room, hold the leader still while the block is broken so followers can
  // catch up — this is what keeps the formation tight through a tower killbox. Fatigued
  // creeps simply lag a tick; the slack tolerance keeps that from desyncing the advance.
  if (creep.room.name === op.targetRoom && !blockInFormation(op, ctx)) return;

  // Tower-aware pathing inside the target room: bend the route around tower fire.
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
    // No path through the matrix (fully walled): fall through to a plain moveTo so the
    // leader at least closes on the breach barrier the siegers are cutting.
  }

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

// ── Tower-drain tactic (minimal version) ─────────────────────────────────────────
//
// Against a heavily-towered siege target we don't want the whole squad grinding a wall
// while loaded towers shred them. The drain doctrine: edge into tower range to bait their
// fire until their energy runs low, THEN commit the dismantle. This minimal version skips
// a dedicated bait squad — the siegers themselves hold at the breach approach (just in/near
// tower range, healed by the clerics) which IS the bait: the towers spend energy on them
// each tick. Once assessTowers reports the towers drained below the commit threshold, the
// hold releases and the dismantle begins. Bounded: only triggers for genuinely fortified
// rooms (2+ towers still loaded), and a full drain is inevitable as long as we hold.

// True when a siege should hold for a drain rather than dismantle: the room still has
// multiple towers with enough collective energy to punish a committed assault.
function shouldHoldForDrain(room: Room): boolean {
  const status: TowerStatus = assessTowers(room);
  if (status.count < 2) return false;       // not fortified enough to bother draining
  return !towersAreDrained(status);         // hold while towers can still bite
}

// Hold the squad at the breach approach (just inside tower range) to bait/drain the towers
// without grinding the wall. Followers hold formation on the leader; the leader edges toward
// the breach focus but stops at DEFEND_RADIUS so the block soaks fire as one healed mass.
function holdAtBreachApproach(creep: Creep, op: MilitaryOp, ctx: SquadContext, isLeader: boolean): void {
  const focus = getBreachFocus(op, creep.room, creep.pos);
  const anchor = focus ? focus.pos : new RoomPosition(25, 25, op.targetRoom);
  if (isLeader || !ctx.leader) {
    // Edge toward the breach but hold a few tiles back — close enough to draw tower fire,
    // far enough not to start chipping the wall before the towers are dry.
    if (!creep.pos.inRangeTo(anchor, DEFEND_RADIUS)) {
      leaderAdvance(creep, op, ctx, anchor, DEFEND_RADIUS);
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
