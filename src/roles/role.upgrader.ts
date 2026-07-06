import {
  isCreepEmpty,
  isCreepFull,
  upgradeController,
  withdrawFromContainer,
  acquireEnergy,
} from "../services/services.creep";
import { seekBoost } from "../services/services.combat";

export function runUpgrader(creep: Creep) {
  if (creep.memory.working === undefined) creep.memory.working = false;

  // Get boosted (XGH2O, +100% upgrade per WORK) before working. seekBoost returns true while
  // still travelling to / waiting on a lab and clears the request on timeout, so this never
  // blocks upgrading forever — once boosted (or given up) it returns false and we proceed.
  if ((creep.memory.boostCompound || creep.memory.boostQueue?.length) && seekBoost(creep)) return;

  if (creep.memory.working && isCreepEmpty(creep)) {
    creep.memory.working = false;
  }
  if (!creep.memory.working && isCreepFull(creep)) {
    creep.memory.working = true;
  }

  if (creep.memory.working) {
    upgradeController(creep);
    return;
  }

  // Priority 1: link adjacent to controller (fed by link routing system)
  const controllerLink = findControllerLink(creep);
  if (controllerLink && controllerLink.store[RESOURCE_ENERGY] > 0) {
    const res = creep.withdraw(controllerLink, RESOURCE_ENERGY);
    if (res === ERR_NOT_IN_RANGE) {
      creep.moveTo(controllerLink, { reusePath: 50 });
    }
    if (res === OK || res === ERR_NOT_IN_RANGE) return;
  }

  // Priority 2: dedicated controller container
  const upgradeId = creep.room.memory.upgradeContainerId;
  if (upgradeId) {
    const upgradeCont = Game.getObjectById(upgradeId) as StructureContainer | null;
    if (upgradeCont && upgradeCont.store[RESOURCE_ENERGY] > 0) {
      if (withdrawFromContainer(creep, upgradeCont)) return;
    }
  }

  // Priority 3: storage
  const storage = creep.room.storage;
  if (storage && storage.store[RESOURCE_ENERGY] > 0) {
    if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(storage, { reusePath: 50 });
    }
    return;
  }

  // Last resort: general acquire. Like the other non-essential consumers, leave the digger
  // containers + dropped piles for the bagmen (tower/core supply) and draw only from the storage
  // buffer — UNLESS the controller is about to downgrade, when saving the room outranks the bagman
  // priority and the upgrader may take whatever it can reach (matches the spawn-side downgrade rescue).
  const ctrl = creep.room.controller;
  const nearDowngrade = !!ctrl && ctrl.my && ctrl.ticksToDowngrade < 5000;
  acquireEnergy(creep, { bufferOnly: !!creep.room.storage && !nearDowngrade });
}

const CONTROLLER_LINK_SCAN_TTL = 200;

function findControllerLink(creep: Creep): StructureLink | null {
  const room = creep.room;
  const controller = room.controller;
  if (!controller) return null;

  if (
    !room.memory.controllerLinkIds ||
    Game.time - (room.memory.controllerLinkScanTick ?? 0) > CONTROLLER_LINK_SCAN_TTL
  ) {
    const found = controller.pos.findInRange(FIND_MY_STRUCTURES, 3, {
      filter: (s): s is StructureLink => s.structureType === STRUCTURE_LINK,
    }) as StructureLink[];
    room.memory.controllerLinkIds = found.map((l) => l.id);
    room.memory.controllerLinkScanTick = Game.time;
  }

  const links = room.memory.controllerLinkIds!
    .map((id) => Game.getObjectById(id))
    .filter(Boolean) as StructureLink[];
  if (links.length === 0) return null;
  return links.reduce((a, b) =>
    a.store[RESOURCE_ENERGY] > b.store[RESOURCE_ENERGY] ? a : b
  );
}
