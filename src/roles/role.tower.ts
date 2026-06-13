import { findTowerRepairTarget } from "../services/services.creep";

const TOWER_REPAIR_ENERGY_THRESHOLD = 0.25;

// attackTarget is computed once per room by the orchestrator so all towers concentrate fire.
// healTarget is computed per-tower so each heals the closest friendly (no over-healing one creep).
export function runTower(tower: StructureTower, attackTarget: Creep | null): void {
  if (tower.store[RESOURCE_ENERGY] === 0) return;

  if (attackTarget) {
    tower.attack(attackTarget);
    return;
  }

  // Heal the nearest damaged friendly
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

  // Repair when energy is plentiful — only when no threats present
  if (
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

  let best = hostiles[0];
  let bestScore = Infinity;
  for (const c of hostiles) {
    // Tier × 10000 + current HP: lower score = higher priority.
    // Within the same tier, focus the creep closest to dying.
    const score = hostileTier(c) * 10_000 + c.hits;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }

  // Hysteresis: keep hammering the previously-focused creep as long as it's still a valid
  // hostile in the SAME priority tier as the new best. Without this, an enemy healer that
  // tops two equal-tier targets back and forth makes the score (which tracks live HP) flip
  // every tick, splitting tower DPS so neither dies. Only switch when the old target dies/
  // leaves, or a strictly higher-priority tier appears.
  if (room?.memory.lastTowerTargetId) {
    const prev = hostiles.find((c) => c.id === room.memory.lastTowerTargetId);
    if (prev && hostileTier(prev) === hostileTier(best)) best = prev;
  }
  if (room) room.memory.lastTowerTargetId = best.id;
  return best;
}

function hostileTier(creep: Creep): number {
  if (creep.body.some((p) => p.type === HEAL)) return 0;           // healers: must die first
  if (creep.body.some((p) => p.type === RANGED_ATTACK)) return 1;  // ranged: dangerous at distance
  if (creep.body.some((p) => p.type === ATTACK)) return 2;         // melee
  return 3;                                                          // support (dismantlers, etc.)
}
