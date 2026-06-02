/**
 * Remote hauler (courier): shuttles energy between a remote room's sources and
 * the home room's storage/spawn. Picks up dropped energy and withdraws from
 * containers near sources. Deposits to storage first, then spawn/extensions.
 *
 * Assignment: creep.memory.homeRoom   = owning room name
 *             creep.memory.targetRoom = remote room to collect from
 */

import { putSurplusEnergyToWork } from "../services/services.creep";

export function runRemoteHauler(creep: Creep) {
  const { targetRoom, homeRoom } = creep.memory;

  if (!targetRoom || !homeRoom) {
    creep.suicide();
    return;
  }

  if (creep.store[RESOURCE_ENERGY] === 0) {
    collectEnergy(creep, targetRoom);
  } else {
    depositEnergy(creep, homeRoom);
  }
}

// ── Collection phase ──────────────────────────────────────────────────────────

function collectEnergy(creep: Creep, targetRoom: string) {
  if (creep.room.name !== targetRoom) {
    moveToRoom(creep, targetRoom);
    return;
  }

  // Priority 1: withdraw from a miner container near a source
  const container = findBestContainer(creep);
  if (container) {
    const res = creep.withdraw(container, RESOURCE_ENERGY);
    if (res === ERR_NOT_IN_RANGE) creep.moveTo(container, { reusePath: 30 });
    return;
  }

  // Priority 2: pick up dropped energy (≥50 to avoid micro-trips)
  const dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
    filter: (d) => d.resourceType === RESOURCE_ENERGY && d.amount >= 50,
  }) as Resource | null;
  if (dropped) {
    const res = creep.pickup(dropped);
    if (res === ERR_NOT_IN_RANGE) creep.moveTo(dropped, { reusePath: 10 });
    return;
  }

  // Nothing to collect — wait near the first source
  const source = creep.room.find(FIND_SOURCES)[0];
  if (source && creep.pos.getRangeTo(source) > 3) {
    creep.moveTo(source, { reusePath: 30 });
  }
}

function findBestContainer(creep: Creep): StructureContainer | null {
  // Pull from home memory to find registered containers near sources
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

  // Fallback: scan for any container near a source
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

// ── Deposit phase ─────────────────────────────────────────────────────────────

function depositEnergy(creep: Creep, homeRoom: string) {
  if (creep.room.name !== homeRoom) {
    moveToRoom(creep, homeRoom);
    return;
  }

  // Priority 1: storage
  const storage = creep.room.storage;
  if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    const res = creep.transfer(storage, RESOURCE_ENERGY);
    if (res === ERR_NOT_IN_RANGE) creep.moveTo(storage, { reusePath: 50 });
    return;
  }

  // Priority 2: spawns and extensions that need energy
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

  // Priority 3: towers
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

  // Nowhere to deposit — put the carried energy to work (build, then repair,
  // then upgrade) rather than idling.
  putSurplusEnergyToWork(creep);
}

// ── Pathfinding ───────────────────────────────────────────────────────────────

function moveToRoom(creep: Creep, targetRoom: string) {
  const exit = creep.room.findExitTo(targetRoom);
  if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS) return;
  const exitPos = creep.pos.findClosestByRange(exit);
  if (exitPos) creep.moveTo(exitPos, { reusePath: 30 });
}
