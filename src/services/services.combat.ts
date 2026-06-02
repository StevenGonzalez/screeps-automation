export interface ThreatInfo {
  hostiles: Creep[];
  score: number;
}

// Ticks a freshly spawned creep gets to reach a boost lab before giving up.
const BOOST_TIMEOUT = 50;

// Move a creep toward a lab holding its assigned boost compound.
// Returns true while still seeking (caller should return early).
// Returns false (and clears boostCompound) when timed out or no lab found.
export function seekBoost(creep: Creep): boolean {
  const compound = creep.memory.boostCompound as ResourceConstant | undefined;
  if (!compound) return false;

  // Creep starts at CREEP_LIFE_TIME (1500) and counts down.
  // If more than BOOST_TIMEOUT ticks have passed since spawn, give up.
  if ((creep.ticksToLive ?? 0) < 1500 - BOOST_TIMEOUT) {
    delete creep.memory.boostCompound;
    return false;
  }

  const ls = creep.room.memory.labSystem;
  if (!ls?.outputLabIds?.length) {
    delete creep.memory.boostCompound;
    return false;
  }

  const boostLab = ls.outputLabIds
    .map((id) => Game.getObjectById(id) as StructureLab | null)
    .filter((l): l is StructureLab => l !== null)
    .find((l) => (l.store.getUsedCapacity(compound) ?? 0) >= 30);

  if (!boostLab) {
    delete creep.memory.boostCompound;
    return false;
  }

  if (!creep.pos.isNearTo(boostLab)) {
    creep.moveTo(boostLab, { reusePath: 5 });
  }
  return true;
}

export type ThreatSeverity = "none" | "low" | "medium" | "high";

// Thresholds derived from score formula: 10/creep + 5/ATTACK part + 5/RANGED_ATTACK part + 8/HEAL part
// low  (~1 weak creep), medium (~small unhealed squad), high (~healer-backed raid)
const SEVERITY_MEDIUM = 80;
const SEVERITY_HIGH   = 150;

export function getThreatSeverity(room: Room): ThreatSeverity {
  const { score } = getThreatInfo(room);
  if (score === 0) return "none";
  if (score < SEVERITY_MEDIUM) return "low";
  if (score < SEVERITY_HIGH) return "medium";
  return "high";
}

const threatCache: Record<string, { info: ThreatInfo; tick: number }> = {};

// Returns a threat score for the room: 0 = no hostiles.
// Score scales with hostile count, ATTACK/RANGED_ATTACK parts, and HEAL parts.
// Cached per-tick so multiple callers (spawner, tower) share one room.find.
export function getThreatInfo(room: Room): ThreatInfo {
  const cached = threatCache[room.name];
  if (cached && cached.tick === Game.time) return cached.info;

  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  let score = 0;
  for (const c of hostiles) {
    score += 10;
    for (const part of c.body) {
      if (part.type === ATTACK) score += 5;
      if (part.type === RANGED_ATTACK) score += 5;
      if (part.type === HEAL) score += 8;
    }
  }

  const info: ThreatInfo = { hostiles, score };
  threatCache[room.name] = { info, tick: Game.time };
  return info;
}

// ── Hostile creep target selection ─────────────────────────────────────────────
//
// All squad members concentrate fire by scoring hostiles consistently. Lower score
// = higher priority. Healers die first (they undo our damage), then the things that
// can actually hurt us, then soft targets. Within a tier we finish off whoever is
// closest and weakest so a creep dies per tick rather than many bleeding slowly.

function hostileCombatTier(creep: Creep): number {
  const hasHeal = creep.body.some((p) => p.type === HEAL && p.hits > 0);
  if (hasHeal) return 0; // healers: eliminate support first
  const hasRanged = creep.body.some((p) => p.type === RANGED_ATTACK && p.hits > 0);
  if (hasRanged) return 1; // ranged: dangerous at distance
  const hasAttack = creep.body.some((p) => p.type === ATTACK && p.hits > 0);
  if (hasAttack) return 1; // melee: equally a threat once adjacent
  const hasWork = creep.body.some((p) => p.type === WORK && p.hits > 0);
  if (hasWork) return 2; // dismantlers/workers
  return 3; // unarmed (claimers, haulers, scouts)
}

// Returns the best hostile creep to focus, or null if none worth engaging.
// `hostiles` should be the shared per-tick scan from getThreatInfo().
export function selectHostileTarget(fromPos: RoomPosition, hostiles: Creep[]): Creep | null {
  if (hostiles.length === 0) return null;

  let best: Creep | null = null;
  let bestScore = Infinity;
  for (const c of hostiles) {
    let tier = hostileCombatTier(c);
    // A nearly-dead threat is worth finishing regardless of class.
    if (c.hits < c.hitsMax * 0.3) tier = Math.max(0, tier - 1);
    const range = fromPos.getRangeTo(c);
    // tier dominates; then proximity (×100); then remaining HP as a fine tie-break.
    const score = tier * 1_000_000 + range * 1_000 + c.hits;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// ── Hostile structure target selection ─────────────────────────────────────────
//
// Priority follows the campaign doctrine: cut reinforcements and defensive fire
// first, then sever the economy. Lower number = struck first. Siege flips towers
// ahead of spawns since surviving the approach matters more than stopping respawns.

const STRUCTURE_ATTACK_PRIORITY: Partial<Record<StructureConstant, number>> = {
  [STRUCTURE_SPAWN]: 10,
  [STRUCTURE_TOWER]: 15,
  [STRUCTURE_NUKER]: 20,
  [STRUCTURE_TERMINAL]: 25,
  [STRUCTURE_LAB]: 30,
  [STRUCTURE_STORAGE]: 35,
  [STRUCTURE_POWER_SPAWN]: 40,
  [STRUCTURE_OBSERVER]: 45,
  [STRUCTURE_EXTENSION]: 60,
  [STRUCTURE_LINK]: 70,
  [STRUCTURE_EXTRACTOR]: 80,
  [STRUCTURE_CONTAINER]: 90,
};

const structureTargetCache: Record<string, { list: AnyStructure[]; tick: number }> = {};

// Hostile + neutral-blocking structures in a room, scanned once per tick and shared.
function getAttackableStructures(room: Room): AnyStructure[] {
  const cached = structureTargetCache[room.name];
  if (cached && cached.tick === Game.time) return cached.list;

  const list = room.find(FIND_STRUCTURES, {
    filter: (s) => {
      if (s.structureType === STRUCTURE_CONTROLLER) return false;
      if (s.structureType === STRUCTURE_KEEPER_LAIR) return false;
      if (s.structureType === STRUCTURE_POWER_BANK) return false;
      // Walls and ramparts are obstacles handled separately (only when blocking a target).
      if (s.structureType === STRUCTURE_WALL) return true;
      if (s.structureType === STRUCTURE_RAMPART) return (s as StructureRampart).hits > 0;
      // Owned structures: only enemy ones are targets. Neutral non-barrier structures
      // (roads, unowned containers) are never worth attacking.
      const owned = (s as OwnedStructure).owner;
      if (owned) return !(s as OwnedStructure).my;
      return false;
    },
  }) as AnyStructure[];

  structureTargetCache[room.name] = { list, tick: Game.time };
  return list;
}

// Returns the best structure to attack/dismantle, accounting for tactic and for
// ramparts shielding a high-value target (break the shield first).
export function selectStructureTarget(
  room: Room,
  fromPos: RoomPosition,
  tactic: SquadTactic
): AnyStructure | null {
  const all = getAttackableStructures(room);
  if (all.length === 0) return null;

  const priorityOf = (s: AnyStructure): number => {
    if (s.structureType === STRUCTURE_TOWER && tactic === "siege") return 0;
    return STRUCTURE_ATTACK_PRIORITY[s.structureType] ?? 999;
  };

  // Pick the highest-priority non-barrier structure; tie-break by proximity.
  const valuable = all.filter(
    (s) => s.structureType !== STRUCTURE_WALL && s.structureType !== STRUCTURE_RAMPART
  );

  let chosen: AnyStructure | null = null;
  if (valuable.length > 0) {
    let bestScore = Infinity;
    for (const s of valuable) {
      const score = priorityOf(s) * 10_000 + fromPos.getRangeTo(s);
      if (score < bestScore) {
        bestScore = score;
        chosen = s;
      }
    }
  }

  // If the chosen target sits under a rampart, the rampart must fall first.
  // (`chosen` is never a rampart — barriers are filtered out of `valuable`.)
  if (chosen) {
    const shield = chosen.pos
      .lookFor(LOOK_STRUCTURES)
      .find((s) => s.structureType === STRUCTURE_RAMPART) as StructureRampart | undefined;
    if (shield && shield.hits > 0) return shield;
    return chosen;
  }

  // No valuable structures exposed — only barriers remain. Break the weakest so
  // siegers keep making progress instead of idling.
  const barriers = all.filter(
    (s) => s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART
  );
  if (barriers.length === 0) return null;
  return barriers.reduce((a, b) => (a.hits < b.hits ? a : b));
}

// ── Formation geometry ──────────────────────────────────────────────────────────
//
// Offsets are relative to the squad leader (slot 0). The squad reorients naturally
// as the leader advances, so offsets are kept in plain grid space. Members are
// assigned slots front-to-back by role, so each formation produces its doctrine:
// box = layered block, line = wide row, wedge = V with the point forward, scatter =
// dispersed to blunt splash/tower fire.

const FORMATION_LAYOUTS: Record<SquadFormation, Array<[number, number]>> = {
  box: [
    [0, 0], [1, 0], [-1, 0],
    [0, 1], [1, 1], [-1, 1],
    [0, 2], [1, 2], [-1, 2],
  ],
  line: [
    [0, 0], [1, 0], [-1, 0], [2, 0], [-2, 0], [3, 0], [-3, 0], [4, 0], [-4, 0],
  ],
  wedge: [
    [0, 0], [1, 1], [-1, 1], [2, 2], [-2, 2], [3, 3], [-3, 3], [0, 2], [0, 4],
  ],
  scatter: [
    [0, 0], [2, 0], [-2, 0], [0, 2], [2, 2], [-2, 2], [0, -2], [2, -2], [-2, -2],
  ],
};

export function formationOffset(formation: SquadFormation, slot: number): [number, number] {
  const layout = FORMATION_LAYOUTS[formation] ?? FORMATION_LAYOUTS.box;
  if (slot < layout.length) return layout[slot];
  // Beyond the template, stack further back so large squads still cohere.
  const extra = slot - layout.length;
  return [extra % 2 === 0 ? 1 : -1, 3 + Math.floor(extra / 2)];
}

// ── Source Keeper helpers ───────────────────────────────────────────────────────

// SK rooms occupy the 3×3 cluster (coords 4–6) at the centre of each 10-room sector,
// minus the exact centre (5,5) which is the sector's central/portal room.
export function isSourceKeeperRoom(roomName: string): boolean {
  const m = roomName.match(/^[WE](\d+)[NS](\d+)$/);
  if (!m) return false;
  const x = parseInt(m[1], 10) % 10;
  const y = parseInt(m[2], 10) % 10;
  const inCluster = x >= 4 && x <= 6 && y >= 4 && y <= 6;
  const isCentre = x === 5 && y === 5;
  return inCluster && !isCentre;
}

export function isSourceKeeper(creep: Creep): boolean {
  return creep.owner?.username === "Source Keeper";
}

// ── Room threat evaluation (WarCouncil) ─────────────────────────────────────────
//
// Scores a non-owned room 0 (trivial) … 10 (fortress) for offensive target ranking.
export function evaluateRoomThreatLevel(room: Room): number {
  let level = 0;

  if (room.controller?.safeMode) return 10; // untouchable while safe mode holds

  const towers = room.find(FIND_HOSTILE_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_TOWER,
  }).length;
  level += towers * 2;

  const rcl = room.controller?.level ?? 0;
  if (room.controller?.owner) level += Math.min(3, Math.ceil(rcl / 3));

  const { score } = getThreatInfo(room);
  level += Math.min(3, Math.floor(score / 100));

  return Math.min(10, level);
}
