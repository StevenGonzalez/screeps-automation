import { findTowerRepairTarget } from "../services/services.creep";

export function runTower(tower: StructureTower) {
  if (tower.store[RESOURCE_ENERGY] === 0) return;
  // Find hostiles not on edge tiles (baiters)
  const hostiles = tower.room.find(FIND_HOSTILE_CREEPS, {
    filter: (c: Creep) =>
      c.pos.x > 1 && c.pos.x < 48 && c.pos.y > 1 && c.pos.y < 48,
  });
  if (hostiles.length > 0) {
    const target = tower.pos.findClosestByPath(hostiles);
    if (target) {
      tower.attack(target);
      return;
    }
  }
  const repairTarget = findTowerRepairTarget(tower.room);
  if (repairTarget) {
    tower.repair(repairTarget);
  }
}
