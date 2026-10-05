import {
  isCreepEmpty,
  isCreepFull,
  withdrawFromContainer,
  acquireEnergy,
  upgradeController,
} from "../services/services.creep";
import { seekBoost } from "../services/services.combat";
import { nearDowngrade, upgradingFunded } from "../services/services.treasury";
import { energyClaimedByOthers } from "../services/services.coordination";

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
    topUp(creep);
    takeSeat(creep);
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
    // An enchanter that walked off whenever this container ran dry turned back
    // each time a porter refilled it, and spent its life on the road: in a keep
    // with no storage to a miner container, and at Grimford to a storage twenty
    // tiles from the throne. While a porter is bringing gold here, wait for it.
    if (upgradeCont && energyClaimedByOthers(upgradeCont.id, creep) > 0) {
      if (creep.pos.getRangeTo(upgradeCont) > 1) creep.moveTo(upgradeCont, { range: 1, reusePath: 20 });
      else takeSeat(creep);
      return;
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

// An enchanter that ran dry spent the next tick on the withdraw alone, one tick
// in every load lost to the controller. One about to run dry takes its next
// load from the link or container beside it in the same tick it upgrades.
function topUp(creep: Creep): void {
  if (creep.store[RESOURCE_ENERGY] > creep.getActiveBodyparts(WORK)) return;
  const link = findControllerLink(creep);
  const upgradeId = creep.room.memory.upgradeContainerId;
  const cont = upgradeId ? (Game.getObjectById(upgradeId) as StructureContainer | null) : null;
  const from = [link, cont].find((s) => s && s.store[RESOURCE_ENERGY] > 0 && creep.pos.getRangeTo(s) <= 1);
  if (from) creep.withdraw(from, RESOURCE_ENERGY);
}

// Tiles beside the throne container an enchanter can upgrade from, nearest the
// throne first. At Grimford the enchanters stood on the three plain tiles the
// porters came in by: a porter with a load circled for a way in, or stepped
// onto the swamp beside the container and stood ten ticks spent.
type Seat = { x: number; y: number; range: number };
const SEAT_TTL = 1000;
const seatsByContainer: Record<string, { tick: number; seats: Seat[] }> = {};

function throneSeats(room: Room, cont: StructureContainer, controller: StructureController): Seat[] {
  const known = seatsByContainer[cont.id];
  if (known && Game.time - known.tick < SEAT_TTL) return known.seats;
  const terrain = room.getTerrain();
  const seats: Seat[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const x = cont.pos.x + dx;
      const y = cont.pos.y + dy;
      if ((dx === 0 && dy === 0) || x < 1 || x > 48 || y < 1 || y > 48) continue;
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      const range = Math.max(Math.abs(x - controller.pos.x), Math.abs(y - controller.pos.y));
      if (range > 3) continue;
      const blocked = room
        .lookForAt(LOOK_STRUCTURES, x, y)
        .some((st) => (OBSTACLE_OBJECT_TYPES as string[]).includes(st.structureType));
      if (!blocked) seats.push({ x, y, range });
    }
  }
  seats.sort((a, b) => a.range - b.range);
  seatsByContainer[cont.id] = { tick: Game.time, seats };
  return seats;
}

// An enchanter beside the throne container moves up to a free seat nearer the
// throne, leaving the outer ones to the porters. Not where a link feeds the
// throne: there it keeps to the link.
function takeSeat(creep: Creep): void {
  const controller = creep.room.controller;
  const upgradeId = creep.room.memory.upgradeContainerId;
  const cont = upgradeId ? (Game.getObjectById(upgradeId) as StructureContainer | null) : null;
  if (!controller || !cont) return;
  const { x, y } = creep.pos;
  if (Math.max(Math.abs(x - cont.pos.x), Math.abs(y - cont.pos.y)) > 1) return;
  if (findControllerLink(creep)) return;
  const mine = Math.max(Math.abs(x - controller.pos.x), Math.abs(y - controller.pos.y));
  for (const seat of throneSeats(creep.room, cont, controller)) {
    if (seat.range >= mine) return;
    if (creep.room.lookForAt(LOOK_CREEPS, seat.x, seat.y).length > 0) continue;
    creep.moveTo(seat.x, seat.y);
    return;
  }
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
