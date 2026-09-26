import { ROLE_KNIGHT, ROLE_WIZARD, ROLE_CLERIC, ROLE_SIEGER, ROLE_DRAINER } from "../config/config.roles";
import {
  getThreatInfo,
  getThreatSeverity,
  selectHostileTarget,
  selectStructureTarget,
  preferMassAttack,
  formationOffset,
  evaluateRoomThreatLevel,
  buildTowerCostMatrix,
  planBreach,
  assessTowers,
  towersAreDrained,
  isPlayerCreep,
  canDealDamage,
  allyInMassAttackRange,
  type BreachPlan,
  type TowerStatus,
} from "../services/services.combat";
import { launchNukeFrom } from "./orchestrator.nuker";
import { towersCanHold } from "../roles/role.tower";
import { getAllies, requestHelp } from "../services/services.allies";

declare global {
  interface WarCouncilMemory {
    lastAutoNukeTick?: number;
    nukedUntil?: Record<string, number>;
    // Owner (or room) -> tick until which auto-attack leaves it alone after a failed op.
    targetCooldown?: Record<string, number>;
    // Player -> last tick one of their armed creeps was seen in our rooms or remotes.
    hostilePlayers?: Record<string, number>;
  }

  interface MilitaryOp {
    attempts?: number;
    holdSince?: number;
  }
}

const REGROUP_HP_THRESHOLD = 0.85;
const RALLY_RANGE = 8;
const CLEARED_TICKS_NEEDED = 10;
const INTEL_TTL = 6_000;
const FORMING_TIMEOUT = 1500;
const FRAGMENT_TIMEOUT = 300;
const KITE_RANGE = 3;
const DEFEND_RADIUS = 3;
const CRITICAL_HP = 0.2;
const WARCOUNCIL_SCAN_INTERVAL = 50;
const AUTO_ATTACK_INTERVAL = 1000;

const BOOST_GRACE_TICKS = 80;

const DEFENSE_THREAT_SCORE = 150;
const DEFENSE_SCAN_INTERVAL = 2;
const DEFENSE_CLEAR_TICKS = 25;
const DEFENSE_HOLD_RADIUS = 6;
const DEFENSE_CHASE_RADIUS = 12;
const AUTO_ATTACK_MAX_THREAT = 4;
const AUTO_ATTACK_MAX_RANGE = 6;

const MAX_OP_ATTEMPTS = 2;
const FAILED_OP_COOLDOWN = 10_000;
const HOSTILE_MEMORY_TICKS = 20_000;
const HOLD_FOR_DRAIN_MAX = 300;

const RETREAT_THRESHOLD: Record<SquadTactic, number> = {
  assault: 0.4,
  siege: 0.35,
  raid: 0.55,
  defend: 0.3,
  retreat: 1.1,
};

let rampartCacheTick = -1;
const defensiveRampartCache: Record<string, StructureRampart[]> = {};

export function loop(): void {
  runWarCouncil();
  runDefenseCouncil();
  requestAllyDefense();
  cleanupDrainOps();

  migrateMilitaryOps();

  const ops = Memory.militaryOps;
  if (!ops) return;

  for (const homeRoomName in ops) {
    const op = ops[homeRoomName];

    op.formation = op.formation ?? "box";
    op.tactic = op.tactic ?? "assault";
    op.requiredSiege = op.requiredSiege ?? 0;
    op.requiredDrainers = op.requiredDrainers ?? 0;

    const homeRoom = Game.rooms[op.homeRoom];
    if (!homeRoom?.controller?.my) {
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

  advanceMilitaryQueue();
}

function migrateMilitaryOps(): void {
  if (!Memory.militaryOps) Memory.militaryOps = {};
  const legacy = Memory.militaryOp;
  if (legacy) {
    if (!Memory.militaryOps[legacy.homeRoom]) {
      Memory.militaryOps[legacy.homeRoom] = legacy;
    }
    delete Memory.militaryOp;
  }
}

function runForming(op: MilitaryOp, members: Creep[]): void {
  if (Game.time - op.startedAt > FORMING_TIMEOUT) {
    console.log(`[Military] ${op.targetRoom}: Forming timeout - squad could not be assembled, aborting`);
    removeOp(op);
    return;
  }

  if (squadMet(op, members)) {
    if (!squadBoostReady(members)) return;
    op.phase = "rallying";
    console.log(`[Military] ${op.targetRoom}: Squad formed (${members.length} creeps) - rallying at spawn`);
  }
}

function runRallying(op: MilitaryOp, homeRoom: Room, members: Creep[]): void {
  if (!squadMet(op, members)) {
    op.phase = "forming";
    op.startedAt = Game.time;
    console.log(`[Military] ${op.targetRoom}: Squad incomplete during rally - reforming`);
    return;
  }

  const spawn = homeRoom.find(FIND_MY_SPAWNS)[0];
  if (!spawn) return;

  const allRallied = members.every(
    (c) => c.room.name === op.homeRoom && c.pos.getRangeTo(spawn) <= RALLY_RANGE
  );

  if (allRallied && squadBoostReady(members)) {
    op.phase = "attacking";
    console.log(`[Military] ${op.targetRoom}: Squad rallied - advancing in ${op.formation}/${op.tactic}!`);
  }
}

function runAttacking(op: MilitaryOp, members: Creep[]): void {
  if (members.length === 0) {
    if (abandonAfterFailedAttempt(op, "All squad members lost")) return;
    op.phase = "forming";
    op.startedAt = Game.time;
    op.clearedSince = undefined;
    op.regroupSince = undefined;
    console.log(`[Military] ${op.targetRoom}: All squad members lost - reforming`);
    return;
  }

  const ctx = getSquadContext(op);

  if (!ctx.cohesive) {
    if (!op.regroupSince) op.regroupSince = Game.time;
    else if (Game.time - op.regroupSince > FRAGMENT_TIMEOUT) {
      op.phase = "retreating";
      op.regroupSince = undefined;
      op.clearedSince = undefined;
      console.log(`[Military] ${op.targetRoom}: Squad fragmented too long - pulling back to regroup`);
      return;
    }
  } else {
    op.regroupSince = undefined;
  }

  if (op.tactic !== "retreat" && ctx.avgHpPct < RETREAT_THRESHOLD[op.tactic]) {
    op.phase = "retreating";
    op.clearedSince = undefined;
    op.regroupSince = undefined;
    console.log(`[Military] ${op.targetRoom}: Squad at ${Math.round(ctx.avgHpPct * 100)}% - retreating to regroup`);
    return;
  }

  const targetRoom = Game.rooms[op.targetRoom];
  if (!targetRoom) {
    op.clearedSince = undefined;
    return;
  }

  if (targetRoom.controller?.safeMode) {
    console.log(`[Military] ${op.targetRoom}: Safe mode active - standing down`);
    removeOp(op);
    return;
  }

  if (op.tactic === "defend") return;

  const hostiles = getThreatInfo(targetRoom).hostiles;
  const ownedStructs = targetRoom.find(FIND_HOSTILE_STRUCTURES, {
    filter: (s) => s.structureType !== STRUCTURE_CONTROLLER && s.structureType !== STRUCTURE_RAMPART,
  });
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
      console.log(`[Military] ${op.targetRoom}: Objective complete - standing down.`);
      completeOp(op);
    }
  } else {
    op.clearedSince = undefined;
  }
}

function runRetreating(op: MilitaryOp, members: Creep[]): void {
  if (members.length === 0) {
    // A manual retreat with nobody left is finished, not a reason to respawn.
    if (op.tactic === "retreat") {
      removeOp(op);
      return;
    }
    if (abandonAfterFailedAttempt(op, "All squad members lost")) return;
    op.phase = "forming";
    op.startedAt = Game.time;
    op.retreatSince = undefined;
    return;
  }

  if (!op.retreatSince) op.retreatSince = Game.time;
  const timedOut = Game.time - op.retreatSince > FRAGMENT_TIMEOUT;

  const allHome = members.every((c) => c.room.name === op.homeRoom);
  if (!allHome && !timedOut) return;

  const ctx = getSquadContext(op);
  if (ctx.avgHpPct < REGROUP_HP_THRESHOLD && !timedOut) return;

  if (op.tactic === "retreat") return;

  op.retreatSince = undefined;
  if (squadMet(op, members)) {
    op.phase = "rallying";
    console.log(`[Military] ${op.targetRoom}: Regrouped - re-rallying for another push (${op.tactic})`);
  } else {
    if (abandonAfterFailedAttempt(op, "Squad depleted after retreat")) return;
    op.phase = "forming";
    op.startedAt = Game.time;
    console.log(`[Military] ${op.targetRoom}: Squad depleted after retreat - reforming`);
  }
}

// Counts a lost push. After MAX_OP_ATTEMPTS the op is dropped and the target
// is put on cooldown so the war council doesn't pick it straight back up.
function abandonAfterFailedAttempt(op: MilitaryOp, reason: string): boolean {
  op.attempts = (op.attempts ?? 0) + 1;
  if (op.attempts < MAX_OP_ATTEMPTS) return false;
  console.log(`[Military] ${op.targetRoom}: ${reason} (${op.attempts} failed attempts) - abandoning op`);
  startTargetCooldown(op.targetRoom);
  removeOp(op);
  return true;
}

function startTargetCooldown(targetRoom: string): void {
  if (!Memory.warCouncil) Memory.warCouncil = { autoAttack: false };
  const wc = Memory.warCouncil;
  if (!wc.targetCooldown) wc.targetCooldown = {};
  const until = Game.time + FAILED_OP_COOLDOWN;
  wc.targetCooldown[targetRoom] = until;
  const owner =
    Game.rooms[targetRoom]?.controller?.owner?.username ?? Memory.intel?.[targetRoom]?.owner;
  if (owner) wc.targetCooldown[owner] = until;
}

function onTargetCooldown(wc: WarCouncilMemory, key: string | undefined): boolean {
  if (!key) return false;
  const until = wc.targetCooldown?.[key];
  return until !== undefined && Game.time < until;
}

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

function clearBreachPlan(op: MilitaryOp): void {
  delete breachCache[breachKey(op)];
}

function attackStructureTarget(creep: Creep, op: MilitaryOp): AnyStructure | null {
  const breach = getBreachFocus(op, creep.room, creep.pos);
  if (breach) return breach;
  return selectStructureTarget(creep.room, creep.pos, op.tactic);
}

function getSquadMembers(op: MilitaryOp): Creep[] {
  return Object.values(Game.creeps).filter(
    (c) =>
      c.memory.offensiveTarget === op.targetRoom &&
      c.memory.homeRoom === op.homeRoom &&
      c.memory.role !== ROLE_DRAINER
  );
}

function squadMet(op: MilitaryOp, members: Creep[]): boolean {
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

function squadBoostReady(members: Creep[]): boolean {
  for (const c of members) {
    if (creepNeedsBoost(c) && withinBoostGrace(c)) return false;
  }
  return true;
}

function roomStructurallyCleared(room: Room): boolean {
  if (getThreatInfo(room).hostiles.length > 0) return false;
  return (
    room.find(FIND_HOSTILE_STRUCTURES, {
      filter: (s) => s.structureType !== STRUCTURE_CONTROLLER && s.structureType !== STRUCTURE_RAMPART,
    }).length === 0
  );
}

function hostileControllerToNeutralize(room: Room): StructureController | null {
  const ctrl = room.controller;
  if (!ctrl) return null;
  if (ctrl.my) return null;
  if (ctrl.owner || ctrl.reservation) return ctrl;
  return null;
}

// Long enough to walk an RCL8 controller down with a relay of unclaimers.
const UNCLAIM_WINDOW = 100_000;

// Squads carry no CLAIM, so a cleared room with a live controller is handed to
// a relay of unclaimer creeps (see role.unclaimer) before the squad disbands.
function completeOp(op: MilitaryOp): void {
  const room = Game.rooms[op.targetRoom];
  if (room && roomStructurallyCleared(room) && hostileControllerToNeutralize(room)) {
    Memory.unclaimTargets = Memory.unclaimTargets ?? {};
    Memory.unclaimTargets[op.targetRoom] = { homeRoom: op.homeRoom, until: Game.time + UNCLAIM_WINDOW };
  }
  removeOp(op);
}

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

export function getOffensiveOp(targetRoom: string, homeRoom: string | undefined): MilitaryOp | undefined {
  if (!homeRoom) return undefined;
  const op = Memory.militaryOps?.[homeRoom];
  return op && op.targetRoom === targetRoom ? op : undefined;
}

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

const DRAIN_DEFAULT_COUNT = 1;
const DRAIN_MAX_COUNT = 4;

export function getDrainOp(targetRoom: string): DrainOp | undefined {
  return Memory.drainOps?.[targetRoom];
}

export function getDrainOpsForHome(homeRoom: string): DrainOp[] {
  const ops = Memory.drainOps;
  if (!ops) return [];
  return Object.values(ops).filter((o) => o.homeRoom === homeRoom);
}

export function launchDrain(targetRoom: string, homeRoom?: string, count = DRAIN_DEFAULT_COUNT): string | null {
  if (Game.rooms[targetRoom]?.controller?.my) return `${targetRoom} is your own room`;
  const allyErr = allyTargetError(targetRoom);
  if (allyErr) return allyErr;
  const drainers = Math.max(1, Math.min(DRAIN_MAX_COUNT, Math.floor(count)));

  let home = homeRoom;
  if (home) {
    const r = Game.rooms[home];
    if (!r?.controller?.my) return `${home} is not a room you own`;
  } else {
    let best: Room | undefined;
    let bestDist = Infinity;
    for (const rn in Game.rooms) {
      const room = Game.rooms[rn];
      if (!isCapableOffensiveHome(room)) continue;
      const d = Game.map.getRoomLinearDistance(rn, targetRoom);
      if (d < bestDist) { bestDist = d; best = room; }
    }
    home = best?.name;
  }
  if (!home) return "no capable home room to fund a drain";

  if (!Memory.drainOps) Memory.drainOps = {};
  Memory.drainOps[targetRoom] = {
    targetRoom,
    homeRoom: home,
    startedAt: Game.time,
    drainers,
  };
  return null;
}

export function stopDrain(targetRoom: string): boolean {
  if (!Memory.drainOps?.[targetRoom]) return false;
  delete Memory.drainOps[targetRoom];
  return true;
}

export function getDrainOps(): DrainOp[] {
  return Memory.drainOps ? Object.values(Memory.drainOps) : [];
}

function cleanupDrainOps(): void {
  const ops = Memory.drainOps;
  if (!ops) return;
  for (const targetRoom of Object.keys(ops)) {
    const op = ops[targetRoom];
    const home = Game.rooms[op.homeRoom];
    if (!home?.controller?.my || Game.rooms[targetRoom]?.controller?.my) {
      delete ops[targetRoom];
    }
  }
}

export function recommendComposition(
  targetRoom: string,
  tactic: SquadTactic
): { melee: number; ranged: number; healers: number; siege: number; drainers: number } {
  const intel = Memory.intel?.[targetRoom];
  const towers = intel?.towers ?? 0;
  const owned = !!intel?.owner;

  let melee = 2 + Math.min(2, towers);
  let ranged = 1;
  let healers = Math.max(1, Math.min(3, towers));
  let siege = 0;

  if (tactic === "siege" || (owned && towers >= 2)) siege = 2;
  if (tactic === "raid") {
    melee = 2;
    ranged = 1;
    healers = 1;
    siege = 0;
  }

  const drainers = siege > 0 && towers >= 2 ? 1 : 0;

  return { melee, ranged, healers, siege, drainers };
}

export function launchOp(
  targetRoom: string,
  formation: SquadFormation,
  tactic: SquadTactic,
  composition: { melee: number; ranged: number; healers: number; siege: number; drainers?: number },
  homeRoom: string
): string | null {
  const allyErr = allyTargetError(targetRoom);
  if (allyErr) return allyErr;
  if (!Memory.militaryOps) Memory.militaryOps = {};
  const existing = Memory.militaryOps[homeRoom];
  if (existing) {
    return `${homeRoom} already running op against ${existing.targetRoom} (${existing.phase})`;
  }
  const total =
    composition.melee + composition.ranged + composition.healers + composition.siege;
  if (total <= 0) return "squad must have at least one member";

  Memory.militaryOps[homeRoom] = {
    targetRoom,
    homeRoom,
    phase: "forming",
    startedAt: Game.time,
    formation,
    tactic,
    requiredMelee: composition.melee,
    requiredRanged: composition.ranged,
    requiredHealers: composition.healers,
    requiredSiege: composition.siege,
    requiredDrainers: composition.drainers ?? 0,
  };
  return null;
}

export function enqueueOp(
  targetRoom: string,
  formation: SquadFormation,
  tactic: SquadTactic,
  composition: { melee: number; ranged: number; healers: number; siege: number; drainers?: number },
  homeRoom?: string
): string | null {
  const total =
    composition.melee + composition.ranged + composition.healers + composition.siege;
  if (total <= 0) return "squad must have at least one member";
  const allyErr = allyTargetError(targetRoom);
  if (allyErr) return allyErr;
  if (!Memory.militaryQueue) Memory.militaryQueue = [];
  if (Memory.militaryQueue.some((q) => q.targetRoom === targetRoom)) {
    return `${targetRoom} is already queued`;
  }
  Memory.militaryQueue.push({
    targetRoom,
    homeRoom,
    formation,
    tactic,
    requiredMelee: composition.melee,
    requiredRanged: composition.ranged,
    requiredHealers: composition.healers,
    requiredSiege: composition.siege,
    requiredDrainers: composition.drainers ?? 0,
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

// Refuses rooms an ally owns or reserves, whether seen now or remembered in intel.
function allyTargetError(targetRoom: string): string | null {
  const ctrl = Game.rooms[targetRoom]?.controller;
  const intel = Memory.intel?.[targetRoom];
  const names = [ctrl?.owner?.username, ctrl?.reservation?.username, intel?.owner, intel?.reservedBy];
  const ally = names.find((u) => isAllyPlayer(u));
  return ally ? `${targetRoom} is held by ally ${ally}` : null;
}

export function getMilitaryQueue(): QueuedMilitaryOp[] {
  return Memory.militaryQueue ?? [];
}

function isCapableOffensiveHome(room: Room): boolean {
  if (!room.controller?.my) return false;
  if ((room.controller.level ?? 0) < 5) return false;
  if ((room.storage?.store[RESOURCE_ENERGY] ?? 0) < 50_000) return false;
  if (Memory.militaryOps?.[room.name]) return false;
  return true;
}

function advanceMilitaryQueue(): void {
  const queue = Memory.militaryQueue;
  if (!queue || queue.length === 0) return;

  const posture = Memory.empire?.posture;
  if (posture === "TURTLE" || posture === "RECOVER") return;

  for (let i = 0; i < queue.length; ) {
    const q = queue[i];

    const target = Game.rooms[q.targetRoom];
    if (target?.controller?.my || allyTargetError(q.targetRoom)) {
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

    if (!home) { i++; continue; }

    const err = launchOp(
      q.targetRoom, q.formation, q.tactic,
      {
        melee: q.requiredMelee, ranged: q.requiredRanged,
        healers: q.requiredHealers, siege: q.requiredSiege,
        drainers: q.requiredDrainers ?? 0,
      },
      home
    );
    if (err) { i++; continue; }
    queue.splice(i, 1);
    console.log(`[Military] Queue advanced -> ${home} attacking ${q.targetRoom} (${queue.length} still queued)`);
  }
}

function resolveOps(homeRoom?: string): MilitaryOp[] {
  const ops = Memory.militaryOps;
  if (!ops) return [];
  if (homeRoom) return ops[homeRoom] ? [ops[homeRoom]] : [];
  return Object.values(ops);
}

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
      op.phase = "retreating";
    } else if (op.phase === "retreating") {
      op.phase = "attacking";
    }
  }
  return ops.length;
}

export function getOffensiveOps(): MilitaryOp[] {
  return Memory.militaryOps ? Object.values(Memory.militaryOps) : [];
}

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
    if (room.controller?.my) {
      delete Memory.intel[rn];
      continue;
    }
    recordRoomIntel(room);
  }

  for (const rn in Memory.intel) {
    if (Game.time - (Memory.intel[rn].lastSeen ?? 0) > INTEL_TTL) delete Memory.intel[rn];
  }

  rebuildPlayerModel();
}

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

function rebuildPlayerModel(): void {
  if (!Memory.intel) return;
  if (!Memory.players) Memory.players = {};

  const fresh: Record<string, PlayerIntelData> = {};
  for (const rn in Memory.intel) {
    const intel: RoomIntelData = Memory.intel[rn];
    const owner = intel.owner;
    if (!owner) continue;

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
    p.militaryStrength += roomMilitaryStrength(intel.towers, intel.barrierHpMax ?? 0, intel.rcl);
    p.economicStrength +=
      Math.floor(((intel.storageEnergy ?? 0) + (intel.terminalEnergy ?? 0)) / 1000) +
      (intel.storageMineral ?? 0) + (intel.terminalMineral ?? 0);
    p.centroidX += coords.x;
    p.centroidY += coords.y;
    p.lastSeen = Math.max(p.lastSeen, intel.lastSeen);
  }

  for (const u in fresh) {
    const p = fresh[u];
    if (p.roomCount > 0) {
      p.centroidX = Math.round(p.centroidX / p.roomCount);
      p.centroidY = Math.round(p.centroidY / p.roomCount);
    }
  }

  const players = Memory.players;
  for (const u in fresh) players[u] = fresh[u];
  for (const u in players) {
    if (fresh[u]) continue;
    if (Game.time - players[u].lastSeen > INTEL_TTL) delete players[u];
  }
}

const PLAYER_ROOM_CAP = 30;

function roomMilitaryStrength(towers: number, barrierHpMax: number, rcl: number): number {
  return towers * 100 + Math.floor(barrierHpMax / 100_000) * 50 + rcl * 10;
}

// Our own strength on the same scale as Memory.players[*].militaryStrength.
function ownMilitaryStrength(): number {
  let total = 0;
  for (const rn in Game.rooms) {
    const room = Game.rooms[rn];
    if (!room.controller?.my) continue;
    const towers = room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_TOWER,
    }).length;
    let barrierMax = 0;
    for (const s of room.find(FIND_STRUCTURES)) {
      if (s.structureType !== STRUCTURE_RAMPART && s.structureType !== STRUCTURE_WALL) continue;
      if (s.hits > barrierMax) barrierMax = s.hits;
    }
    total += roomMilitaryStrength(towers, barrierMax, room.controller.level);
  }
  return total;
}

function parseRoomCoords(roomName: string): { x: number; y: number } | null {
  const m = /^([WE])(\d+)([NS])(\d+)$/.exec(roomName);
  if (!m) return null;
  const x = m[1] === "W" ? -parseInt(m[2], 10) : parseInt(m[2], 10);
  const y = m[3] === "N" ? -parseInt(m[4], 10) : parseInt(m[4], 10);
  return { x, y };
}

const WAR_ECONOMY_ENERGY = 100_000;
const FORTRESS_BARRIER_HP = 5_000_000;

const NUKE_BARRIER_HP = 8_000_000;
const NUKE_MIN_TOWERS = 3;
const NUKE_MIN_RCL = 7;
const NUKE_MAX_LAUNCH = 2;
const AUTO_NUKE_INTERVAL = 1000;
const NUKE_ASSAULT_LEAD = 600;

function targetValue(intel: RoomIntelData): number {
  let value = 0;
  value += Math.floor(((intel.storageEnergy ?? 0) + (intel.terminalEnergy ?? 0)) / 2_000);
  value += Math.floor(((intel.storageMineral ?? 0) + (intel.terminalMineral ?? 0)) / 200);
  value += intel.rcl * 8;
  return Math.max(1, value);
}

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

  maintainWarTarget();

  maintainNukedTargets(wc);
  pruneExpired(wc.targetCooldown, (until) => Game.time >= until);
  pruneExpired(wc.hostilePlayers, (seen) => Game.time - seen > HOSTILE_MEMORY_TICKS);

  const posture = Memory.empire?.posture;
  if (posture === "TURTLE" || posture === "RECOVER") return;

  const ownedRooms = Object.values(Game.rooms).filter((r) => r.controller?.my);
  if (ownedRooms.length === 0) return;

  const freeHomes = ownedRooms.filter((r) => isCapableOffensiveHome(r));
  if (freeHomes.length === 0) return;

  const myNames = new Set(
    ownedRooms.map((r) => r.controller?.owner?.username).filter((u): u is string => !!u)
  );
  const capableHomeCount = freeHomes.length;
  let ourStrength: number | undefined;

  let best: RoomIntelData | null = null;
  let bestHome = freeHomes[0].name;
  let bestRatio = 0;
  for (const rn in Memory.intel) {
    const intel = Memory.intel[rn];
    if (!intel.owner || myNames.has(intel.owner)) continue;
    if (isAllyPlayer(intel.owner)) continue;
    if (onTargetCooldown(wc, rn) || onTargetCooldown(wc, intel.owner)) continue;
    // Outside of declared war, only strike players who have come at us first.
    if (posture !== "WAR" && !wasHostileToUs(wc, intel.owner)) continue;
    const theirStrength = Memory.players?.[intel.owner]?.militaryStrength ?? 0;
    ourStrength ??= ownMilitaryStrength();
    if (theirStrength > ourStrength) continue;
    if (intel.safeMode) continue;
    if (intel.threatLevel > AUTO_ATTACK_MAX_THREAT) continue;
    if (nukeInbound(wc, rn)) continue;

    const home = freeHomes.reduce((b, r) =>
      Game.map.getRoomLinearDistance(r.name, rn) < Game.map.getRoomLinearDistance(b.name, rn) ? r : b
    );
    const dist = Game.map.getRoomLinearDistance(home.name, rn);
    if (dist > AUTO_ATTACK_MAX_RANGE) continue;

    const isFortress = (intel.barrierHpMax ?? 0) > FORTRESS_BARRIER_HP;
    if (isFortress) {
      const homeRoom = Game.rooms[home.name];
      const homeEnergy =
        (homeRoom?.storage?.store[RESOURCE_ENERGY] ?? 0) +
        (homeRoom?.terminal?.store[RESOURCE_ENERGY] ?? 0);
      if (capableHomeCount < 2 && homeEnergy < WAR_ECONOMY_ENERGY) continue;
    }

    const ratio = targetValue(intel) / targetEffort(intel, dist);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = intel;
      bestHome = home.name;
    }
  }

  if (!best) return;

  if (isNukeWorthyFortress(best) && considerAutoNuke(wc, best)) return;

  const fortified = best.towers >= 2 || (best.barrierHpMax ?? 0) > 1_000_000;
  const tactic: SquadTactic = fortified ? "siege" : "assault";
  const comp = recommendComposition(best.roomName, tactic);
  const err = launchOp(best.roomName, "box", tactic, comp, bestHome);
  if (!err) {
    wc.lastAutoAttackTick = Game.time;

    if (empireEconomyHealthy()) {
      if (!Memory.empire) {
        Memory.empire = { posture: posture ?? "EXPAND", updatedAt: Game.time };
      }
      Memory.empire.warTargetRoom = best.roomName;
      Memory.empire.warTargetPlayer = best.owner;
    }
    console.log(
      `[WarCouncil] Auto-launch (${tactic}): ${bestHome} -> ${best.roomName} ` +
        `(value/effort ${bestRatio.toFixed(2)}, owner ${best.owner})`
    );
  }
}

function isNukeWorthyFortress(intel: RoomIntelData): boolean {
  if (!intel.owner) return false;
  if (intel.rcl < NUKE_MIN_RCL) return false;
  if (intel.towers < NUKE_MIN_TOWERS) return false;
  if ((intel.barrierHpMax ?? 0) < NUKE_BARRIER_HP) return false;
  return true;
}

function unpackIntelPos(packed: number, roomName: string): RoomPosition | null {
  const x = Math.floor(packed / 50);
  const y = packed % 50;
  if (x < 0 || x > 49 || y < 0 || y > 49) return null;
  return new RoomPosition(x, y, roomName);
}

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

function nukeInbound(wc: WarCouncilMemory, roomName: string): boolean {
  const until = wc.nukedUntil?.[roomName];
  return until !== undefined && Game.time < until;
}

function maintainNukedTargets(wc: WarCouncilMemory): void {
  const map = wc.nukedUntil;
  if (!map) return;
  for (const rn in map) {
    if (Game.time >= map[rn]) delete map[rn];
  }
}

function pruneExpired(map: Record<string, number> | undefined, expired: (v: number) => boolean): void {
  if (!map) return;
  for (const k in map) if (expired(map[k])) delete map[k];
}

function considerAutoNuke(wc: WarCouncilMemory, intel: RoomIntelData): boolean {
  try {
    if (nukeInbound(wc, intel.roomName)) return true;
    if (Game.time - (wc.lastAutoNukeTick ?? -AUTO_NUKE_INTERVAL) < AUTO_NUKE_INTERVAL) {
      return false;
    }

    const aimPoints = nukeAimPoints(intel);
    if (aimPoints.length === 0) return false;

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
            `[WarCouncil] Auto-NUKE: ${rn} -> ${intel.roomName} @${point.x},${point.y} ` +
              `(fortress: ${intel.towers} towers, barrier ${(intel.barrierHpMax ?? 0).toLocaleString()})`
          );
          break;
        }
      }
    }

    if (launched === 0) return false;

    wc.lastAutoNukeTick = Game.time;
    if (!wc.nukedUntil) wc.nukedUntil = {};
    const until = Game.time + Math.max(0, NUKE_LAND_TIME - NUKE_ASSAULT_LEAD);
    wc.nukedUntil[intel.roomName] = until;
    console.log(
      `[WarCouncil] ${intel.roomName}: ${launched} nuke(s) inbound - assault deferred until tick ${until}`
    );
    return true;
  } catch (e) {
    console.log(`[WarCouncil] Auto-nuke skipped (guarded error): ${String(e)}`);
    return false;
  }
}

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

function wasHostileToUs(wc: WarCouncilMemory, username: string): boolean {
  const seen = wc.hostilePlayers?.[username];
  return seen !== undefined && Game.time - seen <= HOSTILE_MEMORY_TICKS;
}

// Remembers which players have sent armed creeps into our rooms or remotes.
function recordHostilePlayers(hostiles: Creep[], ownRoom: boolean): void {
  const wc = Memory.warCouncil;
  if (!wc) return;
  for (const c of hostiles) {
    if (!isPlayerCreep(c)) continue;
    const armed = c.body.some(
      (p) => p.hits > 0 && (p.type === ATTACK || p.type === RANGED_ATTACK || p.type === CLAIM)
    );
    if (!armed && !(ownRoom && canDealDamage(c))) continue;
    if (!wc.hostilePlayers) wc.hostilePlayers = {};
    wc.hostilePlayers[c.owner.username] = Game.time;
  }
}

function isAllyPlayer(username: string | undefined): boolean {
  if (!username) return false;
  const allies = (Memory as unknown as { allies?: string[] }).allies;
  return Array.isArray(allies) && allies.includes(username);
}

function maintainWarTarget(): void {
  const empire = Memory.empire;
  const warRoom = empire?.warTargetRoom;
  if (!empire || !warRoom) return;

  const opActive = Memory.militaryOps
    ? Object.values(Memory.militaryOps).some((op) => op.targetRoom === warRoom)
    : false;
  if (opActive) return;

  const room = Game.rooms[warRoom];
  const intel = Memory.intel?.[warRoom];
  const tookIt = room?.controller?.my === true;
  const safeNow = (room?.controller?.safeMode ?? intel?.safeMode) ? true : false;

  if (tookIt || safeNow || !intel) {
    delete empire.warTargetRoom;
    delete empire.warTargetPlayer;
    console.log(`[WarCouncil] War campaign against ${warRoom} ended - clearing war target.`);
  }
}

function runDefenseCouncil(): void {
  if (Game.time % DEFENSE_SCAN_INTERVAL !== 0) return;
  if (!Memory.defenseOps) Memory.defenseOps = {};
  const ops = Memory.defenseOps;

  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my) continue;

    const { score, hostiles } = getThreatInfo(room);
    const severity = getThreatSeverity(room);
    const existing = ops[roomName];
    recordHostilePlayers(hostiles, true);
    for (const remote of room.memory.remoteRooms ?? []) {
      const r = Game.rooms[remote.roomName];
      if (r) recordHostilePlayers(getThreatInfo(r).hostiles, false);
    }

    const controllerAttacker = hostiles.some((c) => c.body.some((p) => p.type === CLAIM));

    // Towers that will kill the lot on their own need no creeps beside them.
    const meaningful =
      (severity === "high" || score >= DEFENSE_THREAT_SCORE || controllerAttacker) &&
      !towersCanHold(room, hostiles);

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
        console.log(`[Defense] ${roomName}: threat detected (score ${score}) - raising defenders`);
      }
    } else if (existing && Game.time - existing.lastThreatTick >= DEFENSE_CLEAR_TICKS) {
      console.log(`[Defense] ${roomName}: threat cleared - standing down defenders`);
      clearDefenseOp(roomName);
    }
  }

  for (const roomName in ops) {
    const room = Game.rooms[roomName];
    if (room?.controller?.my) continue;
    if (!room && Game.time - ops[roomName].lastThreatTick < DEFENSE_CLEAR_TICKS) continue;
    clearDefenseOp(roomName);
  }
}

// Ask allies for help every tick a room is under a defense-op-sized threat.
// runAllies publishes these at the start of next tick.
function requestAllyDefense(): void {
  const ops = Memory.defenseOps;
  if (!ops || getAllies().length === 0) return;
  for (const roomName in ops) {
    const op = ops[roomName];
    if (op.threatScore < DEFENSE_THREAT_SCORE) continue;
    if (Game.time - op.lastThreatTick > DEFENSE_SCAN_INTERVAL) continue;
    requestHelp({
      type: "defense",
      roomName,
      priority: Math.min(1, op.threatScore / (DEFENSE_THREAT_SCORE * 4)),
    });
  }
}

function recommendDefense(score: number): {
  requiredMelee: number;
  requiredRanged: number;
  requiredHealers: number;
} {
  const requiredMelee = Math.max(1, Math.min(6, 2 + Math.floor((score - DEFENSE_THREAT_SCORE) / 70)));
  const requiredHealers = Math.max(0, Math.min(3, 1 + Math.floor((score - DEFENSE_THREAT_SCORE) / 110)));
  const requiredRanged =
    score >= DEFENSE_THREAT_SCORE + 60
      ? Math.min(2, 1 + Math.floor((score - DEFENSE_THREAT_SCORE - 60) / 150))
      : 0;
  return { requiredMelee, requiredRanged, requiredHealers };
}

function clearDefenseOp(roomName: string): void {
  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.defensiveTarget === roomName) delete creep.memory.defensiveTarget;
  }
  if (Memory.defenseOps) delete Memory.defenseOps[roomName];
}

export function getDefenseOp(roomName: string): DefenseOp | undefined {
  return Memory.defenseOps?.[roomName];
}

export function getDefenders(roomName: string): Creep[] {
  return Object.values(Game.creeps).filter((c) => c.memory.defensiveTarget === roomName);
}

function defenseRallyPoint(roomName: string): RoomPosition {
  const room = Game.rooms[roomName];
  const spawn = room?.find(FIND_MY_SPAWNS)[0];
  if (spawn) return spawn.pos;
  return new RoomPosition(25, 25, roomName);
}

function isNearEdge(pos: RoomPosition): boolean {
  return pos.x <= 1 || pos.x >= 48 || pos.y <= 1 || pos.y >= 48;
}

// The creep the towers last fired on, if it's within this creep's reach.
function towerFocus(creep: Creep, hostiles: Creep[], reach: number): Creep | null {
  if (!creep.room.controller?.my) return null;
  const id = creep.room.memory?.lastTowerTargetId;
  if (!id) return null;
  const focus = hostiles.find((h) => h.id === id);
  return focus && creep.pos.getRangeTo(focus) <= reach ? focus : null;
}

function selectDefenseTarget(
  creep: Creep,
  rally: RoomPosition,
  hostiles: Creep[],
  reach: number
): Creep | null {
  const focus = towerFocus(creep, hostiles, reach);
  if (focus) return focus;
  const engageable = hostiles.filter(
    (h) => !isNearEdge(h.pos) && rally.getRangeTo(h) <= DEFENSE_CHASE_RADIUS
  );
  const target = selectHostileTarget(creep.pos, engageable);
  if (target) return target;
  return creep.pos.findInRange(hostiles, 1)[0] ?? null;
}

function defenseMoveToward(creep: Creep, rally: RoomPosition, target: Creep, range: number): void {
  const toTarget = creep.pos.getRangeTo(target);
  if (toTarget <= range) {
    if (isNearEdge(creep.pos)) creep.moveTo(rally, { range: DEFENSE_HOLD_RADIUS, reusePath: 5 });
    return;
  }
  if (rally.getRangeTo(target) > DEFENSE_CHASE_RADIUS) {
    defenseHold(creep, rally);
    return;
  }
  creep.moveTo(target, { range, reusePath: 1 });
}

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
  if (range > 0 && bestDist > range) return false;
  if (!creep.pos.isEqualTo(best.pos)) creep.moveTo(best, { range: 0, reusePath: 5 });
  return true;
}

function isBreaching(room: Room, hostile: Creep): boolean {
  return room
    .find(FIND_MY_STRUCTURES)
    .some((s) => s.structureType !== STRUCTURE_RAMPART && hostile.pos.getRangeTo(s) <= 1);
}

export function runDefensiveKnight(creep: Creep, roomName: string): void {
  const rally = defenseRallyPoint(roomName);
  if (creep.room.name !== roomName) {
    creep.moveTo(rally, { range: DEFENSE_HOLD_RADIUS, reusePath: 10 });
    return;
  }

  const { hostiles } = getThreatInfo(creep.room);
  const target = selectDefenseTarget(creep, rally, hostiles, 1);
  if (target) {
    meleeStrike(creep, target, hostiles);
    if (!anchorOnRampart(creep, target.pos, 1)) {
      // No rampart next to the target. Only leave cover for an attacker already
      // at work on our base (a breach); one outside the wall is bait.
      if (getDefensiveRamparts(creep.room).length === 0 || isBreaching(creep.room, target)) {
        defenseMoveToward(creep, rally, target, 1);
      } else {
        anchorOnRampart(creep, target.pos, 0);
      }
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

  rangedStrike(creep, selectDefenseTarget(creep, rally, hostiles, KITE_RANGE), hostiles);

  const nearest = creep.pos.findClosestByRange(
    hostiles.filter((h) => !isNearEdge(h.pos) && rally.getRangeTo(h) <= DEFENSE_CHASE_RADIUS)
  );
  if (nearest) {
    if (anchorOnRampart(creep, nearest.pos, 3)) return;
    const range = creep.pos.getRangeTo(nearest);
    if (range < KITE_RANGE) {
      fleeFrom(creep, nearest.pos);
    } else if (range > KITE_RANGE) {
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

  const anchorPos = healTarget ? healTarget.pos : rally;
  if (anchorOnRampart(creep, anchorPos, 3)) return;
  if (healTarget && creep.pos.getRangeTo(healTarget) > 1 && !isNearEdge(healTarget.pos)) {
    creep.moveTo(healTarget, { range: 1, reusePath: 1 });
    return;
  }
  defenseHold(creep, rally);
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

function meleeStrike(creep: Creep, preferred: Creep, hostiles: Creep[]): void {
  if (creep.pos.isNearTo(preferred)) {
    creep.attack(preferred);
    return;
  }
  const fallback = selectHostileTarget(creep.pos, creep.pos.findInRange(hostiles, 1));
  if (fallback) creep.attack(fallback);
}

function rangedStrike(creep: Creep, preferred: Creep | null, hostiles: Creep[]): boolean {
  const inRange = creep.pos.findInRange(hostiles, KITE_RANGE);
  if (inRange.length === 0) return false;
  if (preferMassAttack(creep.pos, inRange) && !allyInMassAttackRange(creep.pos)) {
    creep.rangedMassAttack();
    return true;
  }
  const target =
    preferred && creep.pos.getRangeTo(preferred) <= KITE_RANGE
      ? preferred
      : selectHostileTarget(creep.pos, inRange);
  if (target) creep.rangedAttack(target);
  return true;
}

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
