import { findTowerRepairTarget } from "../services/services.creep";

const TOWER_REPAIR_ENERGY_THRESHOLD = 0.5;

export function runTower(tower: StructureTower) {
  if (tower.store[RESOURCE_ENERGY] === 0) return;

  // Priority 1: attack hostiles — healers first (they sustain enemy squads),
  // then ranged attackers, then finish off the weakest.
  const hostiles = tower.room.find(FIND_HOSTILE_CREEPS, {
    filter: (c) => c.pos.x > 1 && c.pos.x < 48 && c.pos.y > 1 && c.pos.y < 48,
  });
  if (hostiles.length > 0) {
    tower.attack(selectTowerTarget(hostiles));
    return;
  }

  // Priority 2: heal damaged friendly creeps (closest first for efficiency)
  const wounded = tower.room.find(FIND_MY_CREEPS, {
    filter: (c) => c.hits < c.hitsMax,
  });
  if (wounded.length > 0) {
    const target = tower.pos.findClosestByRange(wounded);
    if (target) {
      tower.heal(target);
      return;
    }
  }

  // Priority 3: repair critical structures (only when energy is plentiful)
  if (
    tower.store[RESOURCE_ENERGY] / tower.store.getCapacity(RESOURCE_ENERGY) >
    TOWER_REPAIR_ENERGY_THRESHOLD
  ) {
    const repairTarget = findTowerRepairTarget(tower.room);
    if (repairTarget) {
      tower.repair(repairTarget);
    }
  }
}

function selectTowerTarget(hostiles: Creep[]): Creep {
  let best = hostiles[0];
  let bestScore = Infinity;
  for (const c of hostiles) {
    // Tier × 10000 + current HP: lower score = higher priority.
    // Within the same tier, we finish off whatever is closest to dying.
    const score = hostileTier(c) * 10000 + c.hits;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function hostileTier(creep: Creep): number {
  if (creep.body.some((p) => p.type === HEAL)) return 0;           // healers: kill first
  if (creep.body.some((p) => p.type === RANGED_ATTACK)) return 1;  // ranged: dangerous at range
  if (creep.body.some((p) => p.type === ATTACK)) return 2;         // melee
  return 3;                                                          // other (dismantlers, etc.)
}
