import {
  isCreepEmpty,
  isCreepFull,
  withdrawFromContainer,
  acquireEnergy,
  upgradeController,
} from "../services/services.creep";
import { seekBoost } from "../services/services.combat";

export const UPGRADER_STORAGE_FLOOR = 10_000;

const UPGRADER_DOWNGRADE_GUARD = 5000;

function nearDowngrade(room: Room): boolean {
  const ctrl = room.controller;
  return !!ctrl && ctrl.my && ctrl.ticksToDowngrade < UPGRADER_DOWNGRADE_GUARD;
}

/**
 * Whether the room can afford to spend energy on upgrading: it has no storage
 * yet, storage is above the floor, or the controller is close to downgrading.
 * Every route energy takes to the controller checks this, the controller link
 * included, so no route slips past the floor.
 */
export function upgradingFunded(room: Room): boolean {
  const storage = room.storage;
  if (!storage) return true;
  return storage.store[RESOURCE_ENERGY] > UPGRADER_STORAGE_FLOOR || nearDowngrade(room);
}

export function runUpgrader(creep: Creep) {
  if (creep.memory.working === undefined) creep.memory.working = false;

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

  const controllerLink = findControllerLink(creep);
  if (controllerLink && controllerLink.store[RESOURCE_ENERGY] > 0) {
    const res = creep.withdraw(controllerLink, RESOURCE_ENERGY);
    if (res === ERR_NOT_IN_RANGE) {
      creep.moveTo(controllerLink, { reusePath: 50 });
    }
    if (res === OK || res === ERR_NOT_IN_RANGE) return;
  }

  const upgradeId = creep.room.memory.upgradeContainerId;
  if (upgradeId) {
    const upgradeCont = Game.getObjectById(upgradeId) as StructureContainer | null;
    if (upgradeCont && upgradeCont.store[RESOURCE_ENERGY] > 0) {
      if (withdrawFromContainer(creep, upgradeCont)) return;
    }
  }

  // The population target stops adding upgraders when storage runs low, but the
  // ones already alive kept drawing on it for the rest of their 1500 ticks and
  // took it to zero. Leave a floor. Upgrading is the most
  // deferrable consumer in the room - except when the controller is about to
  // downgrade, which costs more than the energy does.
  const storage = creep.room.storage;
  if (storage && upgradingFunded(creep.room) && storage.store[RESOURCE_ENERGY] > 0) {
    if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(storage, { reusePath: 50 });
    }
    return;
  }

  // Below the floor the upgrader waits. The buffer it used to fall back on
  // included storage itself and the source links, so the floor held nothing
  // back and the room's income went to the controller instead of the spawn.
  // Near a downgrade it takes energy from anywhere.
  if (storage && !nearDowngrade(creep.room)) return;

  acquireEnergy(creep);
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
