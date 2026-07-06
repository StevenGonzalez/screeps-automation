import { getThreatInfo } from "../services/services.combat";
import { pickSignature } from "../config/signatures";

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
    if (homeRoom && homeRoom !== targetRoom) {
      moveToRoom(creep, homeRoom);
    } else {
      const exits = creep.room.find(FIND_EXIT);
      const exit = creep.pos.findClosestByRange(exits);
      if (exit) creep.moveTo(exit, { reusePath: 5 });
    }
    return;
  }

  if (creep.room.name !== targetRoom) {
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

  const site = creep.pos.findClosestByRange(FIND_CONSTRUCTION_SITES);
  if (site) {
    if (creep.build(site) === ERR_NOT_IN_RANGE) {
      creep.moveTo(site, { reusePath: 10 });
    }
    return;
  }

  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn && spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(spawn, { reusePath: 20 });
    }
    return;
  }

  const ctrl = creep.room.controller;
  if (ctrl) {
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
}

function harvest(creep: Creep) {
  const source = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
  if (!source) {
    const ctrl = creep.room.controller;
    if (ctrl && !creep.pos.isNearTo(ctrl)) creep.moveTo(ctrl, { reusePath: 20 });
    return;
  }
  if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
    creep.moveTo(source, { reusePath: 10 });
  }
}

function moveToRoom(creep: Creep, roomName: string) {
  const exit = creep.room.findExitTo(roomName);
  if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS) {
    creep.suicide();
    return;
  }
  creep.moveTo(new RoomPosition(25, 25, roomName), { reusePath: 50, range: 20 });
}
