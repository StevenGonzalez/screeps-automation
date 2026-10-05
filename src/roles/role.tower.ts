import { findTowerRepairTarget, findTowerDefenseRepairTarget } from "../services/services.creep";
import { summarizeHostiles } from "../services/services.combat";

// Peacetime repair only spends the top of the tank, so a raid that arrives
// mid-repair still meets towers that can fire for a good while.
const TOWER_REPAIR_ENERGY_THRESHOLD = 0.7;
const TOWER_DEFENSE_REPAIR_MIN_ENERGY = 400;

const TWR_POWER_ATTACK   = 600;
const TWR_OPTIMAL_RANGE  = 5;
const TWR_FALLOFF_RANGE  = 20;
const TWR_FALLOFF        = 0.75;

const HEAL_RANGE         = 1;
const RANGED_HEAL_RANGE  = 3;
const ENGAGE_RANGE       = 3;

// Mirrors the boost tables in services.combat (not exported there).
const HEAL_BOOST_MULT: Record<string, number> = { LO: 2, LHO2: 3, XLHO2: 4 };
const TOUGH_DAMAGE_MULT: Record<string, number> = { GO: 0.7, GHO2: 0.5, XGHO2: 0.3 };

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

  // Our wounded are healed in peace as well as war. Healed only while a threat
  // stood in the room, a knight who came home from a raid short three TOUGH
  // parts stood watch at Grimford that way for over a thousand ticks, and
  // merchants came home from the same raid and left again short of CARRY.
  const wounded = tower.room.find(FIND_MY_CREEPS, {
    filter: (c) =>
      c.hits < c.hitsMax &&
      c.pos.x > 1 && c.pos.x < 48 && c.pos.y > 1 && c.pos.y < 48,
  });
  if (wounded.length > 0) {
    const target = tower.pos.findClosestByRange(wounded);
    if (target) {
      tower.heal(target);
      return;
    }
  }

  if (hasHostiles && tower.store[RESOURCE_ENERGY] >= TOWER_DEFENSE_REPAIR_MIN_ENERGY) {
    const barrier = findTowerDefenseRepairTarget(tower.room);
    if (barrier) {
      tower.repair(barrier);
      return;
    }
  }

  if (
    !hasHostiles &&
    tower.store[RESOURCE_ENERGY] / (tower.store.getCapacity(RESOURCE_ENERGY) ?? 1) >
      TOWER_REPAIR_ENERGY_THRESHOLD
  ) {
    const repairTarget = findTowerRepairTarget(tower.room);
    if (repairTarget) tower.repair(repairTarget);
  }
}

export function selectRoomAttackTarget(roomHostiles: Creep[], room?: Room): Creep | null {
  const hostiles = roomHostiles.filter((c) => inTowerReach(c, room));
  if (hostiles.length === 0) {
    if (room) delete room.memory.lastTowerTargetId;
    return null;
  }

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

  if (!isDamageable(best, hostiles, towers) && room) {
    // Nothing we can out-damage. Still shoot whichever hostile our fighters are
    // on or that is tearing into our structures (a dismantler in front of its
    // healer), rather than the healer the tiering prefers.
    const pressing = [best, ...hostiles.filter((c) => c !== best)].find((c) =>
      shouldKeepFiring(room, c)
    );
    if (!pressing) {
      delete room.memory.lastTowerTargetId;
      return null;
    }
    best = pressing;
  }

  if (room) room.memory.lastTowerTargetId = best.id;
  return best;
}

// A hostile on the two edge rows can step out of the room to heal, so firing
// at it mostly drains the towers. The exception is one working on our
// structures from there, such as a perimeter rampart two tiles in.
function inTowerReach(creep: Creep, room?: Room): boolean {
  if (creep.pos.x > 1 && creep.pos.x < 48 && creep.pos.y > 1 && creep.pos.y < 48) return true;
  return !!room && shouldKeepFiring(room, creep);
}

// Firing at a target that out-heals the towers only burns energy, unless our
// own fighters are on it (combined damage may break it) or it is tearing into
// our structures right now.
function shouldKeepFiring(room: Room, target: Creep): boolean {
  const engaged = room
    .find(FIND_MY_CREEPS)
    .some(
      (c) =>
        c.pos.getRangeTo(target) <= ENGAGE_RANGE &&
        c.body.some((p) => (p.type === ATTACK || p.type === RANGED_ATTACK) && p.hits > 0)
    );
  if (engaged) return true;
  const active = (type: BodyPartConstant) => target.body.some((p) => p.type === type && p.hits > 0);
  if (active(WORK) || active(ATTACK)) {
    if (target.pos.findInRange(FIND_STRUCTURES, 1).some(isOurs)) return true;
  }
  if (active(RANGED_ATTACK)) {
    if (target.pos.findInRange(FIND_STRUCTURES, 3).some(isOurs)) return true;
  }
  return false;
}

function isOurs(s: AnyStructure): boolean {
  if (s.structureType === STRUCTURE_WALL) return true;
  return "my" in s && s.my;
}

// Whether the towers alone will kill every hostile they can shoot: each one has
// to take more damage (after TOUGH) than the whole group could heal into it, and
// the towers need the energy to keep firing until the last one is dead. Edge
// tiles are left out unless the hostile is pressing us, as in
// selectRoomAttackTarget.
export function towersCanHold(room: Room, hostiles: Creep[]): boolean {
  const towers = activeTowers(room);
  if (towers.length === 0) return false;
  const groupHeal = summarizeHostiles(hostiles).heal;
  let ticks = 0;
  for (const c of hostiles) {
    if (!inTowerReach(c, room)) continue;
    const net = effectiveTowerDamage(c, towers) - groupHeal;
    if (net <= 0) return false;
    ticks += Math.ceil(c.hits / net);
  }
  let energy = 0;
  for (const t of towers) energy += t.store[RESOURCE_ENERGY];
  return energy >= ticks * towers.length * TOWER_ENERGY_COST;
}

function targetScore(creep: Creep, hostiles: Creep[], towers: StructureTower[]): number {
  const damageablePenalty = isDamageable(creep, hostiles, towers) ? 0 : 100_000;
  return damageablePenalty + hostileTier(creep) * 10_000 + creep.hits;
}

function isDamageable(creep: Creep, hostiles: Creep[], towers: StructureTower[]): boolean {
  return effectiveTowerDamage(creep, towers) > incomingHeal(creep, hostiles);
}

function effectiveTowerDamage(creep: Creep, towers: StructureTower[]): number {
  let total = 0;
  for (const tower of towers) total += towerDamageAtRange(tower.pos.getRangeTo(creep));
  return damageAfterTough(creep, total);
}

// Hits actually lost to `raw` damage: boosted TOUGH parts (first in the body,
// so hit first) soak damage at their boost multiplier until they break.
export function damageAfterTough(creep: Creep, raw: number): number {
  let remaining = raw;
  let dealt = 0;
  for (const part of creep.body) {
    if (remaining <= 0) break;
    if (part.hits <= 0) continue;
    const mult = part.type === TOUGH && part.boost ? TOUGH_DAMAGE_MULT[part.boost as string] ?? 1 : 1;
    const toBreak = part.hits / mult;
    if (remaining <= toBreak) {
      dealt += remaining * mult;
      remaining = 0;
    } else {
      dealt += part.hits;
      remaining -= toBreak;
    }
  }
  return dealt + remaining;
}

export function towerDamageAtRange(range: number): number {
  let effectiveRange = range;
  if (effectiveRange < TWR_OPTIMAL_RANGE) effectiveRange = TWR_OPTIMAL_RANGE;
  if (effectiveRange > TWR_FALLOFF_RANGE) effectiveRange = TWR_FALLOFF_RANGE;
  const falloff =
    ((effectiveRange - TWR_OPTIMAL_RANGE) / (TWR_FALLOFF_RANGE - TWR_OPTIMAL_RANGE)) * TWR_FALLOFF;
  return Math.floor(TWR_POWER_ATTACK * (1 - falloff));
}

function incomingHeal(creep: Creep, hostiles: Creep[]): number {
  let heal = 0;
  for (const ally of hostiles) {
    const range = ally.pos.getRangeTo(creep);
    if (range > RANGED_HEAL_RANGE) continue;
    const power = range <= HEAL_RANGE ? HEAL_POWER : RANGED_HEAL_POWER;
    for (const p of ally.body) {
      if (p.type !== HEAL || p.hits <= 0) continue;
      heal += power * (p.boost ? HEAL_BOOST_MULT[p.boost as string] ?? 1 : 1);
    }
  }
  return heal;
}

function activeTowers(room?: Room): StructureTower[] {
  if (!room) return [];
  const towerIds = room.memory.towerIds ?? [];
  const towers: StructureTower[] = [];
  for (const id of towerIds) {
    const tower = Game.getObjectById(id);
    if (tower && tower.store[RESOURCE_ENERGY] >= TOWER_ENERGY_COST) towers.push(tower);
  }
  return towers;
}

function hostileTier(creep: Creep): number {
  if (creep.body.some((p) => p.type === HEAL && p.hits > 0)) return 0;
  if (creep.body.some((p) => p.type === RANGED_ATTACK && p.hits > 0)) return 1;
  if (creep.body.some((p) => p.type === ATTACK && p.hits > 0)) return 2;
  if (creep.body.some((p) => p.type === WORK && p.hits > 0)) return 2;
  return 3;
}
