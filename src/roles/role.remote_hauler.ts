import {
  putSurplusEnergyToWork,
  isAssignedRemoteContested,
  flagRemoteInvader,
  flagRemotePlayer,
  flagRemoteDamage,
  clearRemoteInvader,
} from "../services/services.creep";
import { cryFlight, cryHaul, settleFlight } from "../services/services.herald";
import { remoteThreats, isInvaderCreep, isPlayerCreep, findInvaderCore } from "../services/services.combat";

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
    // Damage taken passing through another room says nothing about the remote.
    if (creep.room.name === targetRoom) flagRemoteDamage(creep);
  }
  if (creep.memory.remoteBackoffUntil && creep.memory.remoteBackoffUntil > Game.time) {
    if (creep.store[RESOURCE_ENERGY] > 0) depositEnergy(creep, homeRoom);
    else if (creep.room.name !== homeRoom) moveToRoom(creep, homeRoom);
    return;
  }

  const inTarget = creep.room.name === targetRoom;
  const threats = inTarget ? remoteThreats(creep.room) : [];
  const core = inTarget ? findInvaderCore(creep.room) : null;
  if (core) flagRemoteInvader(creep);
  else if (threats.some(isInvaderCreep)) flagRemoteInvader(creep);
  else if (threats.some(isPlayerCreep)) flagRemotePlayer(creep);

  if (isAssignedRemoteContested(creep) || threats.length > 0) {
    cryFlight(creep);
    if (creep.store[RESOURCE_ENERGY] > 0) {
      depositEnergy(creep, homeRoom);
    } else if (creep.room.name !== homeRoom) {
      moveToRoom(creep, homeRoom);
    }
    return;
  }

  settleFlight(creep);
  if (inTarget && !core) clearRemoteInvader(creep);

  // Fill up before the trip home: deciding on "empty vs not" sent haulers back
  // across rooms with a few dozen energy from a near-empty container. Near death,
  // bring home whatever is carried rather than let it die with the load.
  if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
    creep.memory.working = false;
  } else if (
    !creep.memory.working &&
    (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0 ||
      (creep.store[RESOURCE_ENERGY] > 0 && (creep.ticksToLive ?? Infinity) < 150))
  ) {
    creep.memory.working = true;
  }

  if (!creep.memory.working) {
    collectEnergy(creep, targetRoom);
  } else {
    if (creep.room.name !== homeRoom) tendRemoteRoad(creep);
    depositEnergy(creep, homeRoom);
  }
}

// Remote roads have no builder or repairer of their own: a hauler with a WORK
// part keeps them up from the load it is carrying home, without stopping. It
// patches the road under it first, otherwise puts a tick into a road site in
// reach. The home room's roads are the home repairer's.
const ROAD_REPAIR_THRESHOLD = 0.8;

function tendRemoteRoad(creep: Creep) {
  if (creep.store[RESOURCE_ENERGY] === 0) return;
  if (!creep.body.some((p) => p.type === WORK && p.hits > 0)) return;

  const road = creep.pos
    .lookFor(LOOK_STRUCTURES)
    .find((s) => s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax * ROAD_REPAIR_THRESHOLD);
  if (road) {
    creep.repair(road);
    return;
  }
  const site = creep.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 3, {
    filter: (s) => s.structureType === STRUCTURE_ROAD,
  })[0];
  if (site) creep.build(site);
}

function collectEnergy(creep: Creep, targetRoom: string) {
  if (creep.room.name !== targetRoom) {
    moveToRoom(creep, targetRoom);
    return;
  }

  const container = findBestContainer(creep);
  // A miner on a full container drops its harvest on the ground, where it
  // decays, while the container's own store keeps. Take the pile by the
  // container first.
  const dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
    filter: (d) =>
      d.resourceType === RESOURCE_ENERGY &&
      d.amount >= 50 &&
      (!container || d.pos.inRangeTo(container, 1)),
  }) as Resource | null;
  if (container && !dropped) {
    const res = creep.withdraw(container, RESOURCE_ENERGY);
    if (res === ERR_NOT_IN_RANGE) creep.moveTo(container, { reusePath: 30 });
    return;
  }

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
    const load = Math.min(creep.store[RESOURCE_ENERGY], storage.store.getFreeCapacity(RESOURCE_ENERGY));
    const res = creep.transfer(storage, RESOURCE_ENERGY);
    if (res === ERR_NOT_IN_RANGE) creep.moveTo(storage, { reusePath: 50 });
    else if (res === OK) cryHaul(creep, load);
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

  // A keep with no storage yet feeds its enchanters through the container by
  // the throne. A merchant has no WORK to build or upgrade with, so with the
  // spawn, extensions and towers full it had nowhere to unload: Grimford's
  // stood by the spawn holding their loads while that container stood empty,
  // and the gold at their remotes spilt from full containers meanwhile.
  const upgradeId = creep.room.memory.upgradeContainerId;
  const upgradeContainer = upgradeId ? Game.getObjectById(upgradeId) : null;
  if (upgradeContainer && upgradeContainer.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    if (creep.transfer(upgradeContainer, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(upgradeContainer, { reusePath: 50 });
    }
    return;
  }

  putSurplusEnergyToWork(creep);
}

function moveToRoom(creep: Creep, targetRoom: string) {
  creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 30, range: 20 });
}
