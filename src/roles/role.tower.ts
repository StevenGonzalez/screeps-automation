import { findTowerRepairTarget } from "../services/services.creep";

const TOWER_REPAIR_ENERGY_THRESHOLD = 0.5; // only repair when above 50% energy

export function runTower(tower: StructureTower) {
  if (tower.store[RESOURCE_ENERGY] === 0) return;

  // Priority 1: attack hostiles (use range — towers don't need path)
  const hostiles = tower.room.find(FIND_HOSTILE_CREEPS, {
    filter: (c) => c.pos.x > 1 && c.pos.x < 48 && c.pos.y > 1 && c.pos.y < 48,
  });
  if (hostiles.length > 0) {
    // Target the hostile with the fewest hits (finish them off faster)
    const target = hostiles.reduce((a, b) => (a.hits < b.hits ? a : b));
    tower.attack(target);
    return;
  }

  // Priority 2: heal damaged friendly creeps
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
