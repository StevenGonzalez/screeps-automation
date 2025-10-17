import {
  getClosestContainerOrStorage,
  isCreepEmpty,
  acquireEnergy,
  transferEnergyTo,
} from "../services/services.creep";

export function runHauler(creep: Creep) {
  if (isCreepEmpty(creep)) {
    const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
      filter: (d) => d.resourceType === RESOURCE_ENERGY && d.amount > 50,
    }) as Resource | null;
    if (dropped) {
      if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
        creep.moveTo(dropped);
      }
      return;
    }

    acquireEnergy(creep);
    return;
  }

  const targets = creep.room.find(FIND_STRUCTURES, {
    filter: (s) =>
      (s.structureType === STRUCTURE_SPAWN ||
        s.structureType === STRUCTURE_EXTENSION ||
        s.structureType === STRUCTURE_TOWER) &&
      "store" in s &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  });
  if (targets.length > 0) {
    const target = creep.pos.findClosestByPath(targets);
    if (target) {
      transferEnergyTo(creep, target);
      return;
    }
  }

  const idle =
    getClosestContainerOrStorage(creep) || creep.room.find(FIND_MY_SPAWNS)[0];
  if (idle && !creep.pos.isNearTo(idle)) {
    creep.moveTo(idle);
  }
}
