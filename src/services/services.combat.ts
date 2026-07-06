import { isAlly } from "./services.allies";

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
  // Pull the next queued compound into boostCompound once the current one is applied,
  // so a creep seeks each boost lab in turn (primary, then TOUGH).
  if (!creep.memory.boostCompound && creep.memory.boostQueue?.length) {
    creep.memory.boostCompound = creep.memory.boostQueue.shift();
    if (creep.memory.boostQueue.length === 0) delete creep.memory.boostQueue;
  }

  const compound = creep.memory.boostCompound as ResourceConstant | undefined;
  if (!compound) return false;

  // Creep starts at CREEP_LIFE_TIME (1500) and counts down.
  // If more than BOOST_TIMEOUT ticks have passed since spawn, give up.
  if ((creep.ticksToLive ?? 0) < 1500 - BOOST_TIMEOUT) {
    delete creep.memory.boostCompound;
    delete creep.memory.boostQueue;
    return false;
  }

  const ls = creep.room.memory.labSystem;
  if (!ls?.outputLabIds?.length) {
    delete creep.memory.boostCompound;
    delete creep.memory.boostQueue;
    return false;
  }

  const boostLab = ls.outputLabIds
    .map((id) => Game.getObjectById(id) as StructureLab | null)
    .filter((l): l is StructureLab => l !== null)
    .find((l) => (l.store.getUsedCapacity(compound) ?? 0) >= 30);

  if (!boostLab) {
    delete creep.memory.boostCompound;
    delete creep.memory.boostQueue;
    return false;
  }

  if (!creep.pos.isNearTo(boostLab)) {
    creep.moveTo(boostLab, { reusePath: 5 });
  }
  return true;
}

// Called after a lab successfully boosts the creep with its current boostCompound.
// Advances to the next queued compound (so the creep seeks the next lab), or marks
// the creep fully boosted when the queue is empty.
export function advanceBoost(creep: Creep): void {
  if (creep.memory.boostQueue?.length) {
    creep.memory.boostCompound = creep.memory.boostQueue.shift();
    if (creep.memory.boostQueue.length === 0) delete creep.memory.boostQueue;
  } else {
    creep.memory.boosted = true;
    delete creep.memory.boostCompound;
  }
}

export type ThreatSeverity = "none" | "low" | "medium" | "high";

// Thresholds derived from the boost-/EHP-aware score formula in getThreatInfo:
//   per creep ≈ 10 + (attackPower + rangedPower)/30 + healPower×0.10 + effectiveHp/1000
// An unboosted melee attacker (25 ATTACK) scores ≈ 40; a fully T3-boosted one ≈ 115.
// low (~1 weak creep), medium (~small unhealed squad ≈ 2 attackers),
// high (~healer-backed raid, or a boosted assault).
const SEVERITY_MEDIUM = 80;
const SEVERITY_HIGH   = 160;

export function getThreatSeverity(room: Room): ThreatSeverity {
  const { score } = getThreatInfo(room);
  if (score === 0) return "none";
  if (score < SEVERITY_MEDIUM) return "low";
  if (score < SEVERITY_HIGH) return "medium";
  return "high";
}

// ── Boost-aware threat scoring tables ────────────────────────────────────────────
//
// Each combat body part has an optional `.boost` resource when boosted. The official
// BOOSTS table multiplies that part's output by a tier-dependent factor (T1/T2/T3).
// We hard-code the relevant multipliers here (matching the game's BOOSTS constant) so
// the scoring is deterministic and unit-testable without a live Screeps runtime.
//
//   ATTACK damage:        UH ×2,   UH2O ×3,   XUH2O ×4
//   RANGED_ATTACK damage: KO ×2,   KHO2 ×3,   XKHO2 ×4
//   HEAL output:          LO ×2,   LHO2 ×3,   XLHO2 ×4
//   TOUGH damage taken:   GO ×0.7, GHO2 ×0.5, XGHO2 ×0.3  (lower = tankier)
//
// Unboosted parts default to ×1 (and TOUGH to ×1 damage taken).
const ATTACK_BOOST_MULT: Record<string, number> = { UH: 2, UH2O: 3, XUH2O: 4 };
const RANGED_BOOST_MULT: Record<string, number> = { KO: 2, KHO2: 3, XKHO2: 4 };
const HEAL_BOOST_MULT: Record<string, number> = { LO: 2, LHO2: 3, XLHO2: 4 };
const TOUGH_DAMAGE_MULT: Record<string, number> = { GO: 0.7, GHO2: 0.5, XGHO2: 0.3 };
// Dismantle boost (ZH ×2, ZH2O ×3, XZH2O ×4). A WORK part removes DISMANTLE_POWER (50)
// hits/tick from a structure; boosted dismantlers are the fastest wall-breakers in the game.
const DISMANTLE_BOOST_MULT: Record<string, number> = { ZH: 2, ZH2O: 3, XZH2O: 4 };

// Score weights tuned so a unit's contribution tracks its real DPS + effective HP.
// See SEVERITY_MEDIUM/SEVERITY_HIGH for how these map onto severity thresholds.
const THREAT_BASE_PER_CREEP = 10;   // mere presence of a hostile
const DAMAGE_DIVISOR = 30;          // raw attack+ranged damage → score points
const HEAL_WEIGHT = 0.10;           // raw heal-per-tick → score points
const EHP_DIVISOR = 1000;           // effective HP → score points

// Cleared each tick so it never accumulates stale entries (and their dead
// game-object references) for every room ever scanned.
let threatCacheTick = -1;
const threatCache: Record<string, ThreatInfo> = {};

// Combat strength of a single creep, boost- and effective-HP-aware. Only live parts
// (hits > 0) contribute — a creep whose ATTACK parts are already chewed off is weaker.
function creepThreatScore(c: Creep): number {
  let attackPower = 0;   // melee damage per tick
  let rangedPower = 0;   // ranged damage per tick
  let dismantlePower = 0; // WORK dismantle damage per tick (structures/barriers)
  let healPower = 0;     // heal per tick
  let effectiveHp = 0;   // raw HP scaled up by TOUGH boosts

  for (const part of c.body) {
    if (part.hits <= 0) continue; // destroyed part: no output, no HP
    switch (part.type) {
      case ATTACK:
        attackPower += ATTACK_POWER * (part.boost ? ATTACK_BOOST_MULT[part.boost] ?? 1 : 1);
        effectiveHp += 100;
        break;
      case RANGED_ATTACK:
        rangedPower += RANGED_ATTACK_POWER * (part.boost ? RANGED_BOOST_MULT[part.boost] ?? 1 : 1);
        effectiveHp += 100;
        break;
      case WORK:
        // A WORK part can dismantle our ramparts/structures. Count its dismantle output so a
        // pure dismantler (no ATTACK/RANGED) still registers as a real threat instead of "low".
        dismantlePower += DISMANTLE_POWER * (part.boost ? DISMANTLE_BOOST_MULT[part.boost] ?? 1 : 1);
        effectiveHp += 100;
        break;
      case HEAL:
        healPower += HEAL_POWER * (part.boost ? HEAL_BOOST_MULT[part.boost] ?? 1 : 1);
        effectiveHp += 100;
        break;
      case TOUGH: {
        // TOUGH boost reduces damage taken, so it multiplies effective HP by 1/mult.
        const dmgMult = part.boost ? TOUGH_DAMAGE_MULT[part.boost] ?? 1 : 1;
        effectiveHp += 100 / dmgMult;
        break;
      }
      default:
        effectiveHp += 100; // MOVE/CARRY/CLAIM still soak 100 HP before dying
        break;
    }
  }

  return (
    THREAT_BASE_PER_CREEP +
    (attackPower + rangedPower + dismantlePower) / DAMAGE_DIVISOR +
    healPower * HEAL_WEIGHT +
    effectiveHp / EHP_DIVISOR
  );
}

// Raw boost-aware damage-per-tick that a set of hostiles can inflict on our STRUCTURES this
// tick — melee ATTACK, RANGED_ATTACK, and WORK dismantle summed over live parts. Unlike the
// calibrated threat SCORE (tuned for severity buckets and defender scaling), this is an
// absolute physical rate used by the safe-mode logic to answer "can this force actually
// destroy a spawn/wall fast?" regardless of how the severity thresholds classify it. This is
// what closes the gap where a lethal ranged or dismantle force scores below "high".
export function structureDamagePerTick(hostiles: Creep[]): number {
  let dps = 0;
  for (const c of hostiles) {
    for (const p of c.body) {
      if (p.hits <= 0) continue;
      if (p.type === ATTACK) dps += ATTACK_POWER * (p.boost ? ATTACK_BOOST_MULT[p.boost] ?? 1 : 1);
      else if (p.type === RANGED_ATTACK)
        dps += RANGED_ATTACK_POWER * (p.boost ? RANGED_BOOST_MULT[p.boost] ?? 1 : 1);
      else if (p.type === WORK)
        dps += DISMANTLE_POWER * (p.boost ? DISMANTLE_BOOST_MULT[p.boost] ?? 1 : 1);
    }
  }
  return dps;
}

// Returns a threat score for the room: 0 = no hostiles.
// Score scales with each hostile's real DPS (boost-weighted), heal output, and effective
// HP (TOUGH-boost-aware). Allied creeps are excluded — Screeps has no native ally concept,
// so FIND_HOSTILE_CREEPS also returns friends we must not count or shoot at.
// Cached per-tick so multiple callers (spawner, tower) share one room.find.
export function getThreatInfo(room: Room): ThreatInfo {
  if (threatCacheTick !== Game.time) {
    threatCacheTick = Game.time;
    for (const name in threatCache) delete threatCache[name];
  }
  const cached = threatCache[room.name];
  if (cached) return cached;

  const hostiles = room
    .find(FIND_HOSTILE_CREEPS)
    .filter((c) => !isAlly(c.owner?.username));
  let score = 0;
  for (const c of hostiles) {
    score += creepThreatScore(c);
  }

  const info: ThreatInfo = { hostiles, score };
  threatCache[room.name] = info;
  return info;
}

// ── Exit blockade detection ──────────────────────────────────────────────────────
//
// A common grief against a low-RCL room is to park armed creeps in the ROOMS ADJACENT to
// it, on the tiles by the shared border, so anything that leaves is killed on the way out.
// getThreatInfo only scans the home room, so it never sees these guards. Here we scan every
// adjacent room we currently have vision of for hostile PLAYER combat creeps sitting in the
// border band facing home, and arm a sticky flag (room.memory.blockade). The flag refreshes
// while a guard is seen and expires BLOCKADE_STICKY_TICKS after the last sighting — so once
// the griefer leaves, the room naturally resumes sending creeps out (the first probe re-arms
// it if they're still there). A manual override (Game.arca.lockdown) holds it on regardless.

// How long the blockade stays armed after the last confirmed guard sighting. ~one creep
// lifetime: long enough that we don't repeatedly bleed probe creeps into a standing siege,
// short enough that the room resumes normal outbound ops soon after the guards leave.
const BLOCKADE_STICKY_TICKS = 1500;
// A guard counts only if it sits within this many tiles of the border shared with home —
// a combatant deep in the adjacent room on its own business isn't camping our exit.
const BLOCKADE_BORDER_BAND = 3;

// Is a hostile creep an armed threat to a creep leaving the room? Pure movers (claimers,
// haulers, scouts) and lone healers can't kill on their own, so they don't count as guards.
function isArmedHostile(c: Creep): boolean {
  if (!isPlayerCreep(c)) return false; // NPC (SK/Invader) and allies handled elsewhere / never
  return c.body.some((p) => p.hits > 0 && (p.type === ATTACK || p.type === RANGED_ATTACK));
}

// Given the home-exit direction, is position (x,y) in the ADJACENT room within the border
// band on the side facing home? Home's TOP exit leads north; in that north room the shared
// edge is its BOTTOM (y≈49), so a guard there sits at high y. And so on for each direction.
function inBorderBandFacingHome(exitDir: string, x: number, y: number): boolean {
  const b = BLOCKADE_BORDER_BAND;
  switch (exitDir) {
    case "1": // FIND_EXIT_TOP → north room, its bottom edge
      return y >= 49 - b;
    case "5": // FIND_EXIT_BOTTOM → south room, its top edge
      return y <= b;
    case "3": // FIND_EXIT_RIGHT → east room, its left edge
      return x <= b;
    case "7": // FIND_EXIT_LEFT → west room, its right edge
      return x >= 49 - b;
    default:
      return false;
  }
}

// Counts armed hostiles camping the exits of `room`, using only rooms we currently have
// vision of. Cheap: a handful of describeExits lookups + a find in each visible neighbour.
function countExitGuards(room: Room): number {
  const exits = Game.map.describeExits(room.name) ?? {};
  let guards = 0;
  for (const dir in exits) {
    const adjName = exits[dir as unknown as keyof ExitsInformation];
    if (!adjName) continue;
    const adj = Game.rooms[adjName];
    if (!adj) continue; // no vision of this neighbour this tick
    for (const c of adj.find(FIND_HOSTILE_CREEPS)) {
      if (isArmedHostile(c) && inBorderBandFacingHome(dir, c.pos.x, c.pos.y)) guards++;
    }
  }
  return guards;
}

// Arms / refreshes / expires the blockade flag for an owned room. Call once per tick per
// owned room (before spawning) so the sticky window and manual override stay current.
export function refreshBlockade(room: Room): void {
  const guards = countExitGuards(room);
  const existing = room.memory.blockade;

  if (guards > 0) {
    if (existing) {
      existing.until = Game.time + BLOCKADE_STICKY_TICKS;
      existing.guards = guards;
    } else {
      room.memory.blockade = {
        detectedAt: Game.time,
        until: Game.time + BLOCKADE_STICKY_TICKS,
        guards,
      };
      console.log(
        `[Blockade] ${room.name}: ${guards} hostile(s) camping the exits — suppressing all outbound roles`
      );
    }
    return;
  }

  // No guards seen this tick. Keep a manual lockdown; drop an auto flag once its sticky
  // window lapses (the griefer is gone — resume normal outbound operations).
  if (existing && !existing.manual && Game.time >= existing.until) {
    delete room.memory.blockade;
    console.log(`[Blockade] ${room.name}: exits clear — resuming outbound roles`);
  }
}

// Pure read: is the room currently blockaded? Manual lockdown ignores the timer; an auto
// blockade holds until its sticky window expires. Used by spawning to gate outbound roles.
export function isBlockaded(room: Room): boolean {
  const b = room.memory.blockade;
  if (!b) return false;
  return b.manual === true || Game.time < b.until;
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

// Cleared each tick so it never accumulates stale entries (and their dead
// game-object references) for every room ever scanned.
let structureTargetCacheTick = -1;
const structureTargetCache: Record<string, AnyStructure[]> = {};

// Hostile + neutral-blocking structures in a room, scanned once per tick and shared.
function getAttackableStructures(room: Room): AnyStructure[] {
  if (structureTargetCacheTick !== Game.time) {
    structureTargetCacheTick = Game.time;
    for (const name in structureTargetCache) delete structureTargetCache[name];
  }
  const cached = structureTargetCache[room.name];
  if (cached) return cached;

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

  structureTargetCache[room.name] = list;
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
  // wreckers keep making progress instead of idling.
  const barriers = all.filter(
    (s) => s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART
  );
  if (barriers.length === 0) return null;
  return barriers.reduce((a, b) => (a.hits < b.hits ? a : b));
}

// ── Tower-fire cost matrix ───────────────────────────────────────────────────────
//
// A hostile tower deals falloff damage: full damage within TOWER_OPTIMAL_RANGE (5),
// scaling down linearly to TOWER_FALLOFF_RANGE (20). We model this as extra path cost
// so a coordinated block routes AROUND the worst tower-fire tiles instead of straight
// through them. Structures/terrain still set the base cost; with no towers present the
// matrix simply reflects obstacles. Costs are clamped well below 255 (impassable) so a
// path always exists — towers shape the route, they don't wall it off.

const TOWER_OPTIMAL_RANGE = 5;   // full tower damage at or within this range
const TOWER_FALLOFF_RANGE = 20;  // tower damage reaches its floor at this range
// Peak per-tower path penalty at point-blank. Tuned so a few towers visibly bend the
// path without exceeding the 255 wall threshold when several overlap.
const TOWER_MAX_PENALTY = 40;

// Tower damage falloff as a 0..1 fraction of max, by Chebyshev range to the tower.
function towerDamageFraction(range: number): number {
  if (range <= TOWER_OPTIMAL_RANGE) return 1;
  if (range >= TOWER_FALLOFF_RANGE) return 0.25; // game floor: towers still bite at long range
  // Linear interpolation between optimal (1.0) and falloff (0.25) edges.
  const span = TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE;
  return 1 - ((range - TOWER_OPTIMAL_RANGE) / span) * 0.75;
}

// Builds a CostMatrix for `room` that bakes in structure obstacles, roads, and — when
// `towers` are supplied — graduated tower-fire penalties around each hostile tower.
// Exported so the squad leader can path the whole block around heavy fire. Robust with
// zero towers (returns a plain obstacle matrix).
export function buildTowerCostMatrix(room: Room, towers: StructureTower[]): CostMatrix {
  const matrix = new PathFinder.CostMatrix();

  // Base layer: walls/obstacles impassable, roads cheap. Ramparts we don't own block.
  for (const s of room.find(FIND_STRUCTURES)) {
    if (s.structureType === STRUCTURE_ROAD) {
      if (matrix.get(s.pos.x, s.pos.y) === 0) matrix.set(s.pos.x, s.pos.y, 1);
    } else if (
      s.structureType === STRUCTURE_RAMPART
        ? !(s as StructureRampart).my
        : (OBSTACLE_OBJECT_TYPES as string[]).includes(s.structureType)
    ) {
      matrix.set(s.pos.x, s.pos.y, 255);
    }
  }

  // Tower-fire layer: add a falloff-weighted penalty to every interior tile in range of
  // any hostile tower. Penalties accumulate where multiple towers overlap (the killbox).
  if (towers.length > 0) {
    for (let x = 1; x < 49; x++) {
      for (let y = 1; y < 49; y++) {
        const base = matrix.get(x, y);
        if (base >= 255) continue; // already impassable — skip
        let penalty = 0;
        for (const t of towers) {
          const range = Math.max(Math.abs(t.pos.x - x), Math.abs(t.pos.y - y));
          if (range > TOWER_FALLOFF_RANGE) continue;
          penalty += Math.round(TOWER_MAX_PENALTY * towerDamageFraction(range));
        }
        if (penalty > 0) matrix.set(x, y, Math.min(254, (base || 1) + penalty));
      }
    }
  }

  return matrix;
}

// ── Min-cut / weakest-path breach planning ──────────────────────────────────────
//
// Against a fortified room, wreckers must concentrate on ONE breach tile rather than
// chipping at whichever barrier happens to be nearest. We compute the cheapest-to-break
// path from outside the wall ring to the room's highest-value structure (spawn, else
// controller, else any target) by running PathFinder with barrier tiles weighted by
// their hits — so the route naturally threads the thinnest walls/ramparts. The FIRST
// barrier on that path is the shared focus target; everyone hits it until it falls,
// then the caller recomputes. (getCutTiles in services.mincut models the DEFENSIVE
// problem; for OFFENSE a hits-weighted path is the pragmatic, cheap choice.)

export interface BreachPlan {
  // The first barrier (wall/rampart) on the cheapest breach path — the shared focus.
  focusId: Id<AnyStructure>;
  focusPos: RoomPosition;
  // All barrier positions along the path, in order, for diagnostics / progress display.
  pathBarriers: RoomPosition[];
}

// Picks the highest-value structure to breach toward: spawn first (stops respawns),
// then controller, then the standard structure priority, then any hostile structure.
function breachGoal(room: Room): AnyStructure | StructureController | null {
  const spawn = room.find(FIND_HOSTILE_SPAWNS)[0];
  if (spawn) return spawn;
  const target = selectStructureTarget(room, new RoomPosition(25, 25, room.name), "siege");
  // selectStructureTarget may return a barrier when only barriers remain; in that case
  // fall back to the controller as the goal so the path still aims at the room's core.
  if (target && target.structureType !== STRUCTURE_WALL && target.structureType !== STRUCTURE_RAMPART) {
    return target;
  }
  if (room.controller) return room.controller;
  return target;
}

// Computes a breach plan for `room`: the cheapest-to-break path to its core and the first
// barrier on it. Returns null when there's nothing to breach (no barriers between the
// squad's approach and the goal) or no goal/vision. `fromPos` anchors the path origin so
// the breach faces the side the squad is actually approaching from.
export function planBreach(room: Room, fromPos: RoomPosition): BreachPlan | null {
  const goal = breachGoal(room);
  if (!goal) return null;

  // Index this room's barriers by packed position for O(1) lookup along the path.
  const barrierAt = new Map<number, StructureWall | StructureRampart>();
  for (const s of room.find(FIND_STRUCTURES)) {
    if (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) {
      if ((s as StructureWall | StructureRampart).hits > 0) {
        barrierAt.set(s.pos.x * 50 + s.pos.y, s as StructureWall | StructureRampart);
      }
    }
  }
  if (barrierAt.size === 0) return null; // no barriers — nothing to focus-breach

  // Hits-weighted cost matrix: a barrier costs proportional to its hits (capped < 255 so
  // PathFinder will still route through it rather than treating it as an impassable wall),
  // so the cheapest path threads the weakest segment of the defenses.
  const matrix = new PathFinder.CostMatrix();
  for (const [packed, b] of barrierAt) {
    const x = Math.floor(packed / 50);
    const y = packed % 50;
    // Scale hits → cost. Capped at 250 so even a full wall stays passable to PathFinder.
    const cost = Math.min(250, 5 + Math.floor(b.hits / 200_000));
    matrix.set(x, y, cost);
  }

  const result = PathFinder.search(
    fromPos,
    { pos: goal.pos, range: 1 },
    {
      maxRooms: 1,
      plainCost: 2,
      swampCost: 5,
      roomCallback: (rn) => (rn === room.name ? matrix : false),
    }
  );
  if (result.path.length === 0 && !fromPos.isNearTo(goal.pos)) return null;

  // Walk the path and collect the barriers it passes through, in order.
  const pathBarriers: RoomPosition[] = [];
  let focus: StructureWall | StructureRampart | null = null;
  for (const pos of result.path) {
    const b = barrierAt.get(pos.x * 50 + pos.y);
    if (b) {
      if (!focus) focus = b;
      pathBarriers.push(pos);
    }
  }

  if (!focus) return null; // path found a barrier-free route — no breach needed
  return { focusId: focus.id, focusPos: focus.pos, pathBarriers };
}

// ── Tower-drain assessment ───────────────────────────────────────────────────────
//
// A heavily towered room can out-damage a squad on the approach. The drain tactic baits
// the towers (which fire on any hostile in range) until their energy runs low, THEN the
// main body commits while the towers can't shoot. This helper reports a room's hostile
// tower energy so the orchestrator can decide whether the towers are drained enough to
// assault. Bounded and vision-gated: with no vision it returns null (unknown).

export interface TowerStatus {
  count: number;        // number of hostile towers with vision
  totalEnergy: number;  // summed energy across them
  maxEnergy: number;    // theoretical full load (count × TOWER_CAPACITY)
}

export function assessTowers(room: Room): TowerStatus {
  const towers = room.find(FIND_HOSTILE_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_TOWER,
  }) as StructureTower[];
  let totalEnergy = 0;
  for (const t of towers) totalEnergy += t.store[RESOURCE_ENERGY];
  return {
    count: towers.length,
    totalEnergy,
    maxEnergy: towers.length * TOWER_CAPACITY,
  };
}

// True when a room's towers can no longer meaningfully punish an assault: either no towers,
// or their summed energy has fallen below the cost of ~a few full-power volleys. Used to
// hold the main assault until a drain pair has emptied the towers.
export function towersAreDrained(status: TowerStatus): boolean {
  if (status.count === 0) return true;
  // One tower volley at optimal range costs TOWER_ENERGY_COST (10). Below ~10 volleys of
  // collective energy the towers can't sustain fire through an assault — commit.
  return status.totalEnergy < status.count * TOWER_ENERGY_COST * 10;
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

export function isInvaderCreep(creep: Creep): boolean {
  return creep.owner?.username === "Invader";
}

// The NPC Invader Core structure, if one is present. In a remote/reserved room a core
// reserves the controller for "Invader" (blocking ours) and periodically spawns defender
// creeps — so killing only the creeps leaves the core to re-reserve and re-spawn forever.
// A defender must destroy the core itself to free the remote.
export function findInvaderCore(room: Room): StructureInvaderCore | null {
  const cores = room.find(FIND_HOSTILE_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_INVADER_CORE,
  });
  return (cores[0] as StructureInvaderCore | undefined) ?? null;
}

// A rival player's creep — anything that isn't NPC (Source Keeper / Invader) and isn't
// an ally (allies are friends we never target, even though the game lists them as hostile).
export function isPlayerCreep(creep: Creep): boolean {
  const u = creep.owner?.username;
  return u !== undefined && u !== "Source Keeper" && u !== "Invader" && !isAlly(u);
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
