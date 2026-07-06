import {
  putSurplusEnergyToWork,
  isAssignedRemoteContested,
  flagRemoteInvader,
  flagRemotePlayer,
  clearRemoteInvader,
} from "../services/services.creep";
import { getThreatInfo, isInvaderCreep, isPlayerCreep, findInvaderCore } from "../services/services.combat";

const REMOTE_DAMAGE_BACKOFF = 300;

export function runRemoteHauler(creep: Creep) {
  const { targetRoom, homeRoom } = creep.memory;

  if (!targetRoom || !homeRoom) {
    creep.suicide();
    return;
  }

  const tookDamage = creep.memory._hp !== undefined && creep.hits < creep.memory._hp;
  creep.memory._hp = creep.hits;
  if (tookDamage && creep.room.name !== homeRoom) {
    creep.memory.remoteBackoffUntil = Game.time + REMOTE_DAMAGE_BACKOFF;
    flagRemotePlayer(creep);
  }
  if (creep.memory.remoteBackoffUntil && creep.memory.remoteBackoffUntil > Game.time) {
    if (creep.store[RESOURCE_ENERGY] > 0) depositEnergy(creep, homeRoom);
    else if (creep.room.name !== homeRoom) moveToRoom(creep, homeRoom);
    return;
  }

  const inTarget = creep.room.name === targetRoom;
  const threat = inTarget ? getThreatInfo(creep.room) : null;
  const core = inTarget ? findInvaderCore(creep.room) : null;
  if (core) flagRemoteInvader(creep);
  else if (threat && threat.score > 0) {
    if (threat.hostiles.some(isInvaderCreep)) flagRemoteInvader(creep);
    else if (threat.hostiles.some(isPlayerCreep)) flagRemotePlayer(creep);
  }

  if (isAssignedRemoteContested(creep) || (threat && threat.score > 0)) {
    if (creep.store[RESOURCE_ENERGY] > 0) {
      depositEnergy(creep, homeRoom);
    } else if (creep.room.name !== homeRoom) {
      moveToRoom(creep, homeRoom);
    }
    return;
  }

  if (inTarget && !core) clearRemoteInvader(creep);

  if (creep.store[RESOURCE_ENERGY] === 0) {
    collectEnergy(creep, targetRoom);
  } else {
    depositEnergy(creep, homeRoom);
  }
}

function collectEnergy(creep: Creep, targetRoom: string) {
  if (creep.room.name !== targetRoom) {
    moveToRoom(creep, targetRoom);
    return;
  }

  const container = findBestContainer(creep);
  if (container) {
    const res = creep.withdraw(container, RESOURCE_ENERGY);
    if (res === ERR_NOT_IN_RANGE) creep.moveTo(container, { reusePath: 30 });
    return;
  }

  const dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
    filter: (d) => d.resourceType === RESOURCE_ENERGY && d.amount >= 50,
  }) as Resource | null;
  if (dropped) {
    const res = creep.pickup(dropped);
    if (res === ERR_NOT_IN_RANGE) creep.moveTo(dropped, { reusePath: 10 });
    return;
  }

  const source = creep.room.find(FIND_SOURCES)[0];
  if (source && creep.pos.getRangeTo(source) > 3) {
    creep.moveTo(source, { reusePath: 30 });
  }
}

function findBestContainer(creep: Creep): StructureContainer | null {
  const homeMemory = Memory.rooms[creep.memory.homeRoom!];
  const remoteEntry = homeMemory?.remoteRooms?.find(
    (r) => r.roomName === creep.room.name
  );

  if (remoteEntry) {
    const candidates: StructureContainer[] = [];
    for (const sourceData of remoteEntry.sources) {
      if (!sourceData.containerId) continue;
      const c = Game.getObjectById(sourceData.containerId) as StructureContainer | null;
      if (c && c.store[RESOURCE_ENERGY] > 0) candidates.push(c);
    }
    if (candidates.length > 0) {
      return candidates.reduce((a, b) =>
        a.store[RESOURCE_ENERGY] > b.store[RESOURCE_ENERGY] ? a : b
      );
    }
  }

  const sources = creep.room.find(FIND_SOURCES);
  for (const source of sources) {
    const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: (s): s is StructureContainer =>
        s.structureType === STRUCTURE_CONTAINER &&
        (s as StructureContainer).store[RESOURCE_ENERGY] > 0,
    }) as StructureContainer[];
    if (containers.length > 0) return containers[0];
  }

  return null;
}

function depositEnergy(creep: Creep, homeRoom: string) {
  if (creep.room.name !== homeRoom) {
    moveToRoom(creep, homeRoom);
    return;
  }

  const storage = creep.room.storage;
  if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    const res = creep.transfer(storage, RESOURCE_ENERGY);
    if (res === ERR_NOT_IN_RANGE) creep.moveTo(storage, { reusePath: 50 });
    return;
  }

  const fillTargets = creep.room.find(FIND_STRUCTURES, {
    filter: (s) =>
      (s.structureType === STRUCTURE_SPAWN ||
        s.structureType === STRUCTURE_EXTENSION) &&
      "store" in s &&
      (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  });
  if (fillTargets.length > 0) {
    const target = creep.pos.findClosestByRange(fillTargets)!;
    const res = creep.transfer(target, RESOURCE_ENERGY);
    if (res === ERR_NOT_IN_RANGE) creep.moveTo(target, { reusePath: 50 });
    return;
  }

  const towers = creep.room.find(FIND_STRUCTURES, {
    filter: (s): s is StructureTower =>
      s.structureType === STRUCTURE_TOWER &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  }) as StructureTower[];
  if (towers.length > 0) {
    const tower = creep.pos.findClosestByRange(towers)!;
    const res = creep.transfer(tower, RESOURCE_ENERGY);
    if (res === ERR_NOT_IN_RANGE) creep.moveTo(tower, { reusePath: 50 });
    return;
  }

  putSurplusEnergyToWork(creep);
}

function moveToRoom(creep: Creep, targetRoom: string) {
  creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 30, range: 20 });
}
