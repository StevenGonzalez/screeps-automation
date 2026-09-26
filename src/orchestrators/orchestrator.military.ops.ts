import { getThreatInfo } from "../services/services.combat";
import { clearBreachPlan } from "./orchestrator.military.squad";

const MAX_OP_ATTEMPTS = 2;

const FAILED_OP_COOLDOWN = 10_000;

// Counts a lost push. After MAX_OP_ATTEMPTS the op is dropped and the target
// is put on cooldown so the war council doesn't pick it straight back up.
export function abandonAfterFailedAttempt(op: MilitaryOp, reason: string): boolean {
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

export function onTargetCooldown(wc: WarCouncilMemory, key: string | undefined): boolean {
  if (!key) return false;
  const until = wc.targetCooldown?.[key];
  return until !== undefined && Game.time < until;
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
export function completeOp(op: MilitaryOp): void {
  const room = Game.rooms[op.targetRoom];
  if (room && roomStructurallyCleared(room) && hostileControllerToNeutralize(room)) {
    Memory.unclaimTargets = Memory.unclaimTargets ?? {};
    Memory.unclaimTargets[op.targetRoom] = { homeRoom: op.homeRoom, until: Game.time + UNCLAIM_WINDOW };
  }
  removeOp(op);
}

export function removeOp(op: MilitaryOp): void {
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

export function cleanupDrainOps(): void {
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

export function isCapableOffensiveHome(room: Room): boolean {
  if (!room.controller?.my) return false;
  if ((room.controller.level ?? 0) < 5) return false;
  if ((room.storage?.store[RESOURCE_ENERGY] ?? 0) < 50_000) return false;
  if (Memory.militaryOps?.[room.name]) return false;
  return true;
}

export function advanceMilitaryQueue(): void {
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

export function isAllyPlayer(username: string | undefined): boolean {
  if (!username) return false;
  const allies = (Memory as unknown as { allies?: string[] }).allies;
  return Array.isArray(allies) && allies.includes(username);
}
