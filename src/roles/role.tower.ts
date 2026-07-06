import { findTowerRepairTarget, findTowerDefenseRepairTarget } from "../services/services.creep";

const TOWER_REPAIR_ENERGY_THRESHOLD = 0.25;
const TOWER_DEFENSE_REPAIR_MIN_ENERGY = 400;

const TWR_POWER_ATTACK   = 600;
const TWR_OPTIMAL_RANGE  = 5;
const TWR_FALLOFF_RANGE  = 20;
const TWR_FALLOFF        = 0.75;

const HEAL_RANGE         = 1;
const RANGED_HEAL_RANGE  = 3;

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

  if (hasHostiles) {
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
  const hostiles = roomHostiles.filter(
    (c) => c.pos.x > 1 && c.pos.x < 48 && c.pos.y > 1 && c.pos.y < 48
  );
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

  if (!isDamageable(best, hostiles, towers) && room && !shouldKeepFiring(room, hostiles)) {
    delete room.memory.lastTowerTargetId;
    return null;
  }

  if (room) room.memory.lastTowerTargetId = best.id;
  return best;
}

function shouldKeepFiring(room: Room, hostiles: Creep[]): boolean {
  const haveFighters = room
    .find(FIND_MY_CREEPS)
    .some((c) => c.body.some((p) => p.type === ATTACK || p.type === RANGED_ATTACK));
  if (haveFighters) return true;
  return hostiles.some((c) =>
    c.body.some((p) => (p.type === WORK || p.type === ATTACK) && p.hits > 0)
  );
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
  return total;
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
    const healParts = ally.body.filter((p) => p.type === HEAL && p.hits > 0).length;
    if (healParts === 0) continue;
    heal += healParts * (range <= HEAL_RANGE ? HEAL_POWER : RANGED_HEAL_POWER);
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
