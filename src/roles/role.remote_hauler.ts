import {
  putSurplusEnergyToWork,
  isAssignedRemoteContested,
  flagRemoteInvader,
  flagRemotePlayer,
  flagRemoteDamage,
  clearRemoteInvader,
  standsIn,
} from "../services/services.creep";
import { cryFarewell, cryFlight, cryHaul, settleFlight } from "../services/services.herald";
import { remoteThreats, isInvaderCreep, isPlayerCreep, findInvaderCore } from "../services/services.combat";
import { ROLE_REMOTE_MINER } from "../config/config.roles";
import { energyClaimedByOthers, setFillTarget } from "../services/services.coordination";
import { upgradingFunded } from "../services/services.treasury";
import { worksRemoteSource } from "../orchestrators/orchestrator.spawning.remote";

const REMOTE_DAMAGE_BACKOFF = 300;

export function runRemoteHauler(creep: Creep) {
  const { targetRoom, homeRoom } = creep.memory;

  if (!targetRoom || !homeRoom) {
    creep.suicide();
    return;
  }
  if (tooOldForTheRoad(creep)) {
    retire(creep, homeRoom);
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
    delete creep.memory.tripFrom;
    if (creep.store[RESOURCE_ENERGY] > 0) depositEnergy(creep, homeRoom);
    else if (!standsIn(creep, homeRoom)) moveToRoom(creep, homeRoom);
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
    delete creep.memory.tripFrom;
    if (creep.store[RESOURCE_ENERGY] > 0) {
      depositEnergy(creep, homeRoom);
    } else if (!standsIn(creep, homeRoom)) {
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
    setFillTarget(creep, undefined);
    if (timeTrip(creep)) {
      retire(creep, homeRoom);
      return;
    }
  } else if (
    !creep.memory.working &&
    (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0 ||
      (creep.store[RESOURCE_ENERGY] > 0 && (creep.ticksToLive ?? Infinity) < 150))
  ) {
    creep.memory.working = true;
    delete creep.memory.haulFromId;
  }

  if (!creep.memory.working) {
    collectEnergy(creep, targetRoom);
  } else {
    if (creep.room.name !== homeRoom) tendRemoteRoad(creep);
    depositEnergy(creep, homeRoom);
  }
}

// A merchant sets out again only with the days left for a round trip as long
// as its last. With no thought for the road back it walked out on its last
// days all the same: Wystan died on the road home from the Crow Glen with a
// full load, and a thousand gold rotted in his grave, while Amice died
// empty-handed by the container she had walked out to.
// One too old for the road goes home to the spawn and is recycled.
function timeTrip(creep: Creep): boolean {
  if (creep.memory.tripFrom !== undefined) creep.memory.trip = Game.time - creep.memory.tripFrom;
  creep.memory.tripFrom = Game.time;
  if (!tooOldForTheRoad(creep)) return false;
  cryFarewell(creep);
  return true;
}

function tooOldForTheRoad(creep: Creep): boolean {
  const { trip, tripFrom } = creep.memory;
  if (trip === undefined || tripFrom === undefined || creep.ticksToLive === undefined) return false;
  return creep.ticksToLive + Game.time - tripFrom < trip;
}

function retire(creep: Creep, homeRoom: string): void {
  if (creep.room.name !== homeRoom) {
    moveToRoom(creep, homeRoom);
    return;
  }
  const spawn = creep.pos.findClosestByRange(FIND_MY_SPAWNS);
  if (spawn && spawn.recycleCreep(creep) === ERR_NOT_IN_RANGE) creep.moveTo(spawn, { range: 1, reusePath: 20 });
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

  const container = pickupContainer(creep);
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
    // An empty container is waited at while its miner digs: it fills faster
    // than a merchant can walk to the next one.
    if (container.store[RESOURCE_ENERGY] === 0) {
      if (!creep.pos.isNearTo(container)) creep.moveTo(container, { range: 1, reusePath: 30 });
      return;
    }
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

// A merchant keeps to the container it set out for until it is full.
// Choosing the fullest container afresh every tick sent Grimford's merchants
// in the Bleak Vale back and forth across the room: its two containers stand
// on either side of a great rock, and each load one merchant took tipped the
// rest toward the other. They brought home one load in some 650 ticks.
// An emptied container is kept only while a peddler digs at it: one left
// over from a source no longer worked would hold its merchant forever.
function pickupContainer(creep: Creep): StructureContainer | null {
  const id = creep.memory.haulFromId;
  const held = id ? Game.getObjectById(id) : null;
  if (
    held &&
    held.pos.roomName === creep.room.name &&
    (held.store[RESOURCE_ENERGY] > 0 || minedContainers().has(held.id))
  ) {
    return held;
  }
  const chosen = chooseContainer(creep);
  creep.memory.haulFromId = chosen?.id;
  return chosen;
}

// Containers peddlers dig at, each mapped to the castle the peddler serves.
function minedContainers(): Map<string, string | undefined> {
  const mined = new Map<string, string | undefined>();
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.memory.role === ROLE_REMOTE_MINER && c.memory.assignedContainerId) {
      mined.set(c.memory.assignedContainerId, c.memory.homeRoom);
    }
  }
  return mined;
}

// The container with the most gold left once the merchants already bound for
// it have filled up, counting the pile spilt beside it.
function chooseContainer(creep: Creep): StructureContainer | null {
  const mined = minedContainers();
  const candidates = remoteContainers(creep, mined);
  if (candidates.length === 0) return null;

  const claimed = new Map<string, number>();
  for (const name in Game.creeps) {
    const other = Game.creeps[name];
    const id = other.memory.haulFromId;
    if (!id || other.name === creep.name || other.memory.working) continue;
    claimed.set(id, (claimed.get(id) ?? 0) + other.store.getFreeCapacity(RESOURCE_ENERGY));
  }
  const piles = creep.room.find(FIND_DROPPED_RESOURCES, {
    filter: (d) => d.resourceType === RESOURCE_ENERGY,
  });

  let best: StructureContainer | null = null;
  let bestLeft = -Infinity;
  for (const c of candidates) {
    let stock = c.store[RESOURCE_ENERGY];
    for (const d of piles) if (d.pos.inRangeTo(c, 1)) stock += d.amount;
    if (stock === 0 && !mined.has(c.id)) continue;
    const left = stock - (claimed.get(c.id) ?? 0);
    if (left > bestLeft || (left === bestLeft && best && creep.pos.getRangeTo(c) < creep.pos.getRangeTo(best))) {
      best = c;
      bestLeft = left;
    }
  }
  return best;
}

// A container another castle's peddler digs at is that castle's to haul from,
// unless this castle has taken the source back from it. In a remote two
// castles share, each castle raises merchants for the walk to its own source,
// and loading at the other's sent them on walks they were not raised for.
function remoteContainers(creep: Creep, mined: Map<string, string | undefined>): StructureContainer[] {
  const homeName = creep.memory.homeRoom!;
  const ours = (c: StructureContainer, sourceId: string) => {
    const digger = mined.get(c.id);
    if (digger === undefined || digger === homeName) return true;
    const home = Game.rooms[homeName];
    return !!home && worksRemoteSource(home, sourceId);
  };
  const homeMemory = Memory.rooms[homeName];
  const remoteEntry = homeMemory?.remoteRooms?.find(
    (r) => r.roomName === creep.room.name
  );

  const containers: StructureContainer[] = [];
  let recorded = false;
  for (const sourceData of remoteEntry?.sources ?? []) {
    if (!sourceData.containerId) continue;
    const c = Game.getObjectById(sourceData.containerId) as StructureContainer | null;
    if (!c) continue;
    recorded = true;
    if (ours(c, sourceData.sourceId)) containers.push(c);
  }
  if (recorded) return containers;

  for (const source of creep.room.find(FIND_SOURCES)) {
    const found = source.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: (s): s is StructureContainer => s.structureType === STRUCTURE_CONTAINER,
    }) as StructureContainer[];
    containers.push(...found.filter((c) => ours(c, source.id)));
  }
  return containers;
}

function depositEnergy(creep: Creep, homeRoom: string) {
  if (creep.room.name !== homeRoom) {
    moveToRoom(creep, homeRoom);
    return;
  }

  const throne = throneOnTheWay(creep);
  if (creep.memory.fillTargetId !== throne?.id) setFillTarget(creep, throne?.id);
  if (throne) {
    unload(creep, throne);
    return;
  }

  const storage = creep.room.storage;
  if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    unload(creep, storage);
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
    unload(creep, creep.pos.findClosestByRange(fillTargets)! as AnyStoreStructure);
    return;
  }

  const towers = creep.room.find(FIND_STRUCTURES, {
    filter: (s): s is StructureTower =>
      s.structureType === STRUCTURE_TOWER &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  }) as StructureTower[];
  if (towers.length > 0) {
    unload(creep, creep.pos.findClosestByRange(towers)!);
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
    unload(creep, upgradeContainer);
    return;
  }

  putSurplusEnergyToWork(creep);
}

// Until a link feeds the throne, gold put in storage reached the enchanters only
// on their own legs: the porters stock the throne's container with what the
// keep's own sources yield and no more. Grimford's merchants came in from the
// north and the west past that container, walked twenty-odd tiles on to its
// storage, and left it empty for the three enchanters beside it. A merchant
// that comes in nearer the throne than the storage unloads there while the
// treasury can spare the gold and the whole load fits, and once bound for it
// keeps to it while there is room.
function throneOnTheWay(creep: Creep): StructureContainer | null {
  const room = creep.room;
  const storage = room.storage;
  const id = room.memory.upgradeContainerId;
  if (!storage || !id || room.memory.controllerLinkIds?.length) return null;
  const throne = Game.getObjectById(id);
  if (!throne || room.memory.minerContainerIds?.includes(id)) return null;
  const free = throne.store.getFreeCapacity(RESOURCE_ENERGY);
  if (creep.memory.fillTargetId === id) return free > 0 ? throne : null;
  if (!upgradingFunded(room)) return null;
  if (free - energyClaimedByOthers(id, creep) < creep.store[RESOURCE_ENERGY]) return null;
  return creep.pos.getRangeTo(throne) < creep.pos.getRangeTo(storage) ? throne : null;
}

// Hands over the load and calls out the gold brought home once it lands. Only
// a load put in storage used to be called out and counted, so the merchants of
// a keep with no storage yet were never heard, and none of them could ever
// retire with the richest haul.
function unload(creep: Creep, target: AnyStoreStructure): void {
  const load = Math.min(creep.store[RESOURCE_ENERGY], target.store.getFreeCapacity(RESOURCE_ENERGY) ?? 0);
  const res = creep.transfer(target, RESOURCE_ENERGY);
  if (res === ERR_NOT_IN_RANGE) creep.moveTo(target, { reusePath: 50 });
  else if (res === OK) cryHaul(creep, load);
}

function moveToRoom(creep: Creep, targetRoom: string) {
  creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 30, range: 20 });
}
