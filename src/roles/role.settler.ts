import { getThreatInfo } from "../services/services.combat";
import { pickSignature } from "../config/signatures";

const RETREAT_HOLD_TICKS = 50;

export function runSettler(creep: Creep) {
  const targetRoom = creep.memory.targetRoom;
  if (!targetRoom) { creep.suicide(); return; }

  const exp = Memory.expansion;
  if (exp && exp.roomName === targetRoom && exp.phase === "established") {
    creep.suicide();
    return;
  }

  const homeRoom = creep.memory.homeRoom ?? exp?.homeRoom;
  if (creep.room.name === targetRoom && getThreatInfo(creep.room).score > 0) {
    creep.memory.retreatUntil = Game.time + RETREAT_HOLD_TICKS;
    if (homeRoom && homeRoom !== targetRoom) {
      moveToRoom(creep, homeRoom);
    } else {
      const exits = creep.room.find(FIND_EXIT);
      const exit = creep.pos.findClosestByRange(exits);
      if (exit) creep.moveTo(exit, { reusePath: 5 });
    }
    return;
  }

  if (creep.room.name !== targetRoom && (creep.memory.retreatUntil ?? 0) > Game.time) {
    holdAwayFromEdge(creep);
    return;
  }

  if (creep.room.name !== targetRoom) {
    if (creep.room.name === homeRoom && takeProvisions(creep)) return;
    moveToRoom(creep, targetRoom);
    return;
  }

  if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
    creep.memory.working = false;
  } else if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
    creep.memory.working = true;
  }

  if (!creep.memory.working) {
    harvest(creep);
    return;
  }

  const spawnSite = creep.room
    .find(FIND_MY_CONSTRUCTION_SITES)
    .find((s) => s.structureType === STRUCTURE_SPAWN);
  if (spawnSite) {
    if (creep.build(spawnSite) === ERR_NOT_IN_RANGE) {
      creep.moveTo(spawnSite, { reusePath: 10 });
    }
    return;
  }

  // Level 2 is only CONTROLLER_LEVELS[1] gold away and opens the extensions, so
  // it comes before the containers and roads. Grimford's pilgrims built a
  // 5,000-gold container first, with the barracks held to 300 gold meanwhile.
  const ctrl = creep.room.controller;
  if (ctrl?.my && ctrl.level === 1) {
    tendThrone(creep, ctrl);
    return;
  }

  const site = creep.pos.findClosestByRange(FIND_CONSTRUCTION_SITES);
  if (site) {
    if (creep.build(site) === ERR_NOT_IN_RANGE) {
      creep.moveTo(site, { reusePath: 10 });
    }
    return;
  }

  // The extensions as well as the barracks: the keep sizes its own creeps by
  // what both hold, and only the barracks refills by itself.
  const store = creep.pos.findClosestByRange(FIND_MY_STRUCTURES, {
    filter: (s) =>
      (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  });
  if (store) {
    if (creep.transfer(store, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(store, { reusePath: 20 });
    }
    return;
  }

  if (ctrl) tendThrone(creep, ctrl);
}

// Sign the new keep's throne once, then upgrade it.
function tendThrone(creep: Creep, ctrl: StructureController): void {
  const exp = Memory.expansion;
  const shouldSign =
    exp &&
    exp.roomName === creep.room.name &&
    exp.phase === "bootstrapping" &&
    creep.room.memory.lastSigned === undefined;
  if (shouldSign) {
    try {
      const sig = pickSignature(creep.room.name);
      const sres = creep.signController(ctrl, sig);
      if (sres === OK) {
        if (!Memory.rooms) Memory.rooms = {} as any;
        if (!Memory.rooms[creep.room.name]) Memory.rooms[creep.room.name] = {} as any;
        Memory.rooms[creep.room.name].lastSigned = Game.time;
      }
    } catch (e) {}
  }
  if (creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
    creep.moveTo(ctrl, { reusePath: 20 });
  }
}

// Smaller stocks are not worth the walk over harvesting.
const MIN_STOCK = 100;

// A treasury holding less than this keeps its gold for its own castle: well
// clear of the 25,000 below which it stops raising pilgrims at all.
const PROVISION_FLOOR = 30_000;

// A pilgrim setting out fills its packs from the treasury first. The new
// keep's sources are shared by every pilgrim and run dry long before the
// barracks is built, so a full load carried in is building it starts on at once
// instead of a wait at the source.
function takeProvisions(creep: Creep): boolean {
  const storage = creep.room.storage;
  if (!storage?.my || storage.store[RESOURCE_ENERGY] < PROVISION_FLOOR) return false;
  if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) return false;
  if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(storage, { reusePath: 10 });
  return true;
}

function harvest(creep: Creep) {
  // A keep founded on a remote inherits the vendors' container and whatever
  // they dropped; taking that is far quicker than harvesting by hand.
  const pile = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
    filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount >= MIN_STOCK,
  });
  if (pile) {
    if (creep.pickup(pile) === ERR_NOT_IN_RANGE) creep.moveTo(pile, { reusePath: 10 });
    return;
  }
  const container = creep.pos.findClosestByRange(FIND_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] >= MIN_STOCK,
  });
  if (container) {
    if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(container, { reusePath: 10 });
    }
    return;
  }

  const source = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
  if (!source) {
    // Every source is dry until it regenerates: build with what is carried
    // rather than stand by the throne holding it.
    if (creep.store[RESOURCE_ENERGY] > 0) {
      creep.memory.working = true;
      return;
    }
    const ctrl = creep.room.controller;
    if (ctrl && !creep.pos.isNearTo(ctrl)) creep.moveTo(ctrl, { reusePath: 20 });
    return;
  }
  if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
    creep.moveTo(source, { reusePath: 10 });
  }
}

function holdAwayFromEdge(creep: Creep) {
  const { x, y } = creep.pos;
  if (x > 2 && x < 47 && y > 2 && y < 47) return;
  creep.moveTo(new RoomPosition(25, 25, creep.room.name), { range: 20, reusePath: 20 });
}

function moveToRoom(creep: Creep, roomName: string) {
  const exit = creep.room.findExitTo(roomName);
  if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS) {
    creep.suicide();
    return;
  }
  creep.moveTo(new RoomPosition(25, 25, roomName), { reusePath: 50, range: 20 });
}
