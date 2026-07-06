import {
  findEmptiestTower,
  findCoreFillTarget,
  getRoomStructures,
} from "../services/services.creep";
import { getThreatInfo } from "../services/services.combat";

export function runFiller(creep: Creep) {
  const storage = creep.room.storage;
  const underThreat = getThreatInfo(creep.room).hostiles.length > 0;

  const target =
    (underThreat ? findEmptiestTower(creep.room) : null) ?? findCoreFillTarget(creep);

  if (creep.store[RESOURCE_ENERGY] === 0) {
    if (!target) {
      if (storage && !creep.pos.isNearTo(storage)) {
        creep.moveTo(storage, { range: 1, reusePath: 20 });
      }
      return;
    }
    const source = findFillerSource(creep, storage);
    if (source) {
      if (creep.withdraw(source, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, { reusePath: 10 });
      }
    } else if (storage && !creep.pos.isNearTo(storage)) {
      creep.moveTo(storage, { range: 1, reusePath: 20 });
    }
    return;
  }

  if (target) {
    if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(target, { reusePath: 10 });
    }
    return;
  }

  if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(storage, { reusePath: 20 });
    }
  }
}

function findFillerSource(
  creep: Creep,
  storage: StructureStorage | undefined
): StructureLink | StructureStorage | StructureContainer | null {
  if (storage) {
    const link = getRoomStructures(creep.room).find(
      (s): s is StructureLink =>
        s.structureType === STRUCTURE_LINK &&
        s.pos.inRangeTo(storage.pos, 2) &&
        (s as StructureLink).store[RESOURCE_ENERGY] > 0
    ) as StructureLink | undefined;
    if (link) return link;
    if (storage.store[RESOURCE_ENERGY] > 0) return storage;
  }

  const upgradeId = creep.room.memory.upgradeContainerId;
  const containers = getRoomStructures(creep.room).filter(
    (s): s is StructureContainer =>
      s.structureType === STRUCTURE_CONTAINER &&
      s.id !== upgradeId &&
      (s as StructureContainer).store[RESOURCE_ENERGY] > 0
  );
  if (containers.length > 0) {
    return creep.pos.findClosestByPath(containers, { ignoreCreeps: true }) ?? null;
  }
  return null;
}
