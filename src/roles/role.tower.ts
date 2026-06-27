import { findTowerRepairTarget } from "../services/services.creep";

const TOWER_REPAIR_ENERGY_THRESHOLD = 0.25;

// Official tower damage falloff: full TOWER_POWER_ATTACK at range <= TOWER_OPTIMAL_RANGE,
// dropping linearly by TOWER_FALLOFF (75%) out to TOWER_FALLOFF_RANGE, where it bottoms out.
const TWR_POWER_ATTACK   = 600;
const TWR_OPTIMAL_RANGE  = 5;
const TWR_FALLOFF_RANGE  = 20;
const TWR_FALLOFF        = 0.75;

// Heal output per HEAL part: full power within range 1, ranged power within range 3.
const HEAL_RANGE         = 1;
const RANGED_HEAL_RANGE  = 3;

// attackTarget is computed once per room by the orchestrator so all towers concentrate fire.
// healTarget is computed per-tower so each heals the closest friendly (no over-healing one creep).
// hasHostiles is the room's once-per-tick hostile scan (orchestrator.tower) — it gates both the
// heal and the repair branches so towers only spend energy on those when the room is calm/defended.
export function runTower(
  tower: StructureTower,
  attackTarget: Creep | null,
  hasHostiles: boolean
): void {
  if (tower.store[RESOURCE_ENERGY] === 0) return;

  if (attackTarget) {
    tower.attack(attackTarget);
    return;
  }

  // Heal ONLY during a genuine threat in THIS room, AND only creeps fighting in the interior —
  // never ones sitting on/next to a room edge. Creeps only lose HP to enemy fire, so a wounded
  // creep that's hugging the border is a raider/border fighter ping-ponging out to fight and back
  // in to "heal up" (an enemy parked at the edge keeps hasHostiles true even though towers can't
  // shoot it — see the edge filter in selectRoomAttackTarget). Healing those bleeds tower — and
  // therefore storage — energy into creeps that just walk back out and die, a slow leak that can
  // drain the whole economy. A genuine home defender fighting the intruder stands in the interior,
  // so it still gets topped up.
  if (hasHostiles) {
    const wounded = tower.room.find(FIND_MY_CREEPS, {
      filter: (c) =>
        c.hits < c.hitsMax &&
        c.pos.x > 2 && c.pos.x < 47 && c.pos.y > 2 && c.pos.y < 47,
    });
    if (wounded.length > 0) {
      const target = tower.pos.findClosestByRange(wounded);
      if (target) {
        tower.heal(target);
        return;
      }
    }
  }

  // Repair only when the room is calm AND energy is plentiful. Never bleed defensive energy into
  // walls during a fight or a tower-drain hold-fire (when attackTarget is null because the drainer
  // out-heals our shots, the room still has hostiles — so this stays gated off).
  if (
    !hasHostiles &&
    tower.store[RESOURCE_ENERGY] / (tower.store.getCapacity(RESOURCE_ENERGY) ?? 1) >
      TOWER_REPAIR_ENERGY_THRESHOLD
  ) {
    const repairTarget = findTowerRepairTarget(tower.room);
    if (repairTarget) tower.repair(repairTarget);
  }
}

// Selects the highest-priority target for the whole room.
// All towers should attack the same creep: kill one fast > tickle many.
// Takes the room's hostile list (scanned once by the orchestrator) and excludes
// edge tiles, where towers deal near-zero damage and the creep can flee a step.
export function selectRoomAttackTarget(roomHostiles: Creep[], room?: Room): Creep | null {
  const hostiles = roomHostiles.filter(
    (c) => c.pos.x > 1 && c.pos.x < 48 && c.pos.y > 1 && c.pos.y < 48
  );
  if (hostiles.length === 0) {
    if (room) delete room.memory.lastTowerTargetId;
    return null;
  }

  // Resolve the firing towers once (only those with energy can actually contribute damage).
  // The set is tiny, so summing per-tower falloff damage for each candidate is cheap.
  const towers = activeTowers(room);

  let best = hostiles[0];
  let bestScore = Infinity;
  for (const c of hostiles) {
    const score = targetScore(c, hostiles, towers);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }

  // Hysteresis: keep hammering the previously-focused creep as long as it's still a valid
  // hostile and ranks in the SAME priority band (damageable + tier) as the new best. Without
  // this, an enemy healer that tops two equal-tier targets back and forth makes the score
  // (which tracks live HP) flip every tick, splitting tower DPS so neither dies. Only switch
  // when the old target dies/leaves, drops out of the damageable set, or a strictly
  // higher-priority band appears.
  if (room?.memory.lastTowerTargetId) {
    const prev = hostiles.find((c) => c.id === room.memory.lastTowerTargetId);
    if (
      prev &&
      isDamageable(prev, hostiles, towers) === isDamageable(best, hostiles, towers) &&
      hostileTier(prev) === hostileTier(best)
    ) {
      best = prev;
    }
  }

  // Drain defence: if even the best target out-heals our combined tower damage, firing
  // makes zero progress and just feeds a drainer the energy it came for (10/shot/tower).
  // Hold fire — but only when towers are the SOLE damage source and nothing is being
  // breached. If we have fighters in the room their damage (not counted by isDamageable)
  // could finish the kill, and a hostile WORK part means an active siege where suppressing
  // fire still matters; in both cases keep shooting.
  if (!isDamageable(best, hostiles, towers) && room && !shouldKeepFiring(room, hostiles)) {
    delete room.memory.lastTowerTargetId;
    return null;
  }

  if (room) room.memory.lastTowerTargetId = best.id;
  return best;
}

// When no hostile is killable by towers alone, we normally hold fire (see drain defence
// above). Override and keep firing if either: we have combat creeps in the room whose
// damage could tip a kill, or any hostile is dismantling structures (a WORK part) — a real
// siege rather than a lone kiter, where suppressing fire is still worthwhile.
function shouldKeepFiring(room: Room, hostiles: Creep[]): boolean {
  const haveFighters = room
    .find(FIND_MY_CREEPS)
    .some((c) => c.body.some((p) => p.type === ATTACK || p.type === RANGED_ATTACK));
  if (haveFighters) return true;
  return hostiles.some((c) => c.body.some((p) => p.type === WORK && p.hits > 0));
}

// Lower score = higher priority. Ordering, most significant first:
//   1. damageable targets (effective tower damage beats incoming heal) before un-killable ones
//   2. healer-first tier doctrine within each group
//   3. the creep closest to dying within a tier
// Un-damageable targets aren't ignored — they just sink below anything we can actually hurt,
// so towers stop wasting energy out-healed shots when a winnable target exists.
function targetScore(creep: Creep, hostiles: Creep[], towers: StructureTower[]): number {
  const damageablePenalty = isDamageable(creep, hostiles, towers) ? 0 : 100_000;
  return damageablePenalty + hostileTier(creep) * 10_000 + creep.hits;
}

// A target is "damageable" this tick when the combined effective tower damage strictly
// exceeds the heal it's receiving — i.e. the shot makes net progress toward a kill.
function isDamageable(creep: Creep, hostiles: Creep[], towers: StructureTower[]): boolean {
  return effectiveTowerDamage(creep, towers) > incomingHeal(creep, hostiles);
}

// Sum of each firing tower's range-adjusted damage against the target.
function effectiveTowerDamage(creep: Creep, towers: StructureTower[]): number {
  let total = 0;
  for (const tower of towers) total += towerDamageAtRange(tower.pos.getRangeTo(creep));
  return total;
}

// Official tower damage falloff: 600 at range <= 5, scaling down by 75% out to range 20.
export function towerDamageAtRange(range: number): number {
  let effectiveRange = range;
  if (effectiveRange < TWR_OPTIMAL_RANGE) effectiveRange = TWR_OPTIMAL_RANGE;
  if (effectiveRange > TWR_FALLOFF_RANGE) effectiveRange = TWR_FALLOFF_RANGE;
  const falloff =
    ((effectiveRange - TWR_OPTIMAL_RANGE) / (TWR_FALLOFF_RANGE - TWR_OPTIMAL_RANGE)) * TWR_FALLOFF;
  return Math.floor(TWR_POWER_ATTACK * (1 - falloff));
}

// Estimated HP the target can recover this tick from nearby hostile healers. A healer in
// melee range applies full HEAL_POWER per HEAL part; from 2–3 tiles it applies the weaker
// RANGED_HEAL_POWER. A self-healing creep counts itself.
function incomingHeal(creep: Creep, hostiles: Creep[]): number {
  let heal = 0;
  for (const ally of hostiles) {
    const range = ally.pos.getRangeTo(creep);
    if (range > RANGED_HEAL_RANGE) continue;
    const healParts = ally.body.filter((p) => p.type === HEAL && p.hits > 0).length;
    if (healParts === 0) continue;
    heal += healParts * (range <= HEAL_RANGE ? HEAL_POWER : RANGED_HEAL_POWER);
  }
  return heal;
}

// The room's towers that still have energy to fire. Drained towers add no damage, so
// excluding them keeps the effective-damage estimate honest.
function activeTowers(room?: Room): StructureTower[] {
  if (!room) return [];
  const towerIds = room.memory.towerIds ?? [];
  const towers: StructureTower[] = [];
  for (const id of towerIds) {
    const tower = Game.getObjectById(id);
    if (tower && tower.store[RESOURCE_ENERGY] > 0) towers.push(tower);
  }
  return towers;
}

function hostileTier(creep: Creep): number {
  if (creep.body.some((p) => p.type === HEAL)) return 0;           // healers: must die first
  if (creep.body.some((p) => p.type === RANGED_ATTACK)) return 1;  // ranged: dangerous at distance
  if (creep.body.some((p) => p.type === ATTACK)) return 2;         // melee
  return 3;                                                          // support (dismantlers, etc.)
}
