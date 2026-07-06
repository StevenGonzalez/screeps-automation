import {
  findEmptiestTower,
  findCoreFillTarget,
  getRoomStructures,
} from "../services/services.creep";
import { getThreatInfo } from "../services/services.combat";

/**
 * Busboy (filler): distributes energy from the treasury (storage) out to the keep — spawn,
 * extensions, and towers. Decouples core-filling from the bagmen that restock storage, so the
 * spawn and defenses are fed from the always-stocked buffer instead of waiting on a hauler's
 * arrival. Only spawned once a room has storage to draw from (see getFillerPopulationTarget).
 *
 * Assignment: creep.memory.homeRoom = owning room name (it never leaves it).
 */
export function runFiller(creep: Creep) {
  const storage = creep.room.storage;
  const underThreat = getThreatInfo(creep.room).hostiles.length > 0;

  // Where energy needs to go this tick: emptiest tower first under attack (defense), otherwise
  // the closest spawn/extension/tower that needs topping up. Null when the core is full.
  const target =
    (underThreat ? findEmptiestTower(creep.room) : null) ?? findCoreFillTarget(creep);

  if (creep.store[RESOURCE_ENERGY] === 0) {
    // Nothing to deliver and we're empty — idle on the storage so we're ready the instant the
    // core needs filling (avoids a pointless storage→storage shuffle when the keep is full).
    if (!target) {
      if (storage && !creep.pos.isNearTo(storage)) {
        creep.moveTo(storage, { range: 1, reusePath: 20 });
      }
      return;
    }
    // Draw energy to deliver: a storage-adjacent link (fast top-up at RCL 5+), then storage,
    // then a digger container as a fallback when the buffer is momentarily dry.
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

  // Core is full but we're still holding energy — return it to the treasury rather than idle.
  if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(storage, { reusePath: 20 });
    }
  }
}

// Prefer a storage-adjacent link (kept fed by the link network at RCL 5+) so its energy is
// consumed and it stays clear to receive more; fall back to storage, then — only when the
// buffer is dry — a digger container so the core never starves. The upgrade container is left
// alone so upgraders keep their supply.
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
