/**
 * Remote hauler (courier): shuttles energy between a remote room's sources and
 * the home room's storage/spawn. Picks up dropped energy and withdraws from
 * containers near sources. Deposits to storage first, then spawn/extensions.
 *
 * Assignment: creep.memory.homeRoom   = owning room name
 *             creep.memory.targetRoom = remote room to collect from
 */

import {
  putSurplusEnergyToWork,
  isAssignedRemoteContested,
  flagRemoteInvader,
  flagRemotePlayer,
  clearRemoteInvader,
} from "../services/services.creep";
import { getThreatInfo, isInvaderCreep, isPlayerCreep, findInvaderCore } from "../services/services.combat";

// Ticks a peddler waits at home after taking damage in a foreign room before re-probing the
// remote — see role.remote_miner.ts for the rationale (breaks the heal→re-enter tower drain).
const REMOTE_DAMAGE_BACKOFF = 300;

export function runRemoteHauler(creep: Creep) {
  const { targetRoom, homeRoom } = creep.memory;

  if (!targetRoom || !homeRoom) {
    creep.suicide();
    return;
  }

  // Damage-triggered retreat. The per-remote hostile flag below only catches threats we can see
  // standing IN our target room; a creep camping the border of a transit room is invisible to it,
  // so without this we'd heal-and-re-enter forever, draining tower energy. Deliver any load on the
  // way home, then wait out the cooldown — regardless of where the attacker sits.
  const tookDamage = creep.memory._hp !== undefined && creep.hits < creep.memory._hp;
  creep.memory._hp = creep.hits;
  if (tookDamage && creep.room.name !== homeRoom) {
    creep.memory.remoteBackoffUntil = Game.time + REMOTE_DAMAGE_BACKOFF;
    flagRemotePlayer(creep); // abandon the remote too, so the spawner stops feeding haulers in
  }
  if (creep.memory.remoteBackoffUntil && creep.memory.remoteBackoffUntil > Game.time) {
    if (creep.store[RESOURCE_ENERGY] > 0) depositEnergy(creep, homeRoom);
    else if (creep.room.name !== homeRoom) moveToRoom(creep, homeRoom);
    return;
  }

  // Record any visible threat so the room gets flagged (Invader → defender; player → avoid).
  // An Invader Core is an Invader threat in its own right — flag it so a defender is raised.
  const inTarget = creep.room.name === targetRoom;
  const threat = inTarget ? getThreatInfo(creep.room) : null;
  const core = inTarget ? findInvaderCore(creep.room) : null;
  if (core) flagRemoteInvader(creep);
  else if (threat && threat.score > 0) {
    if (threat.hostiles.some(isInvaderCreep)) flagRemoteInvader(creep);
    else if (threat.hostiles.some(isPlayerCreep)) flagRemotePlayer(creep);
  }

  // Stay home while the remote is contested. Deliver any load we're carrying, then wait —
  // don't loiter by a source under fire, and don't ping-pong in and out draining tower energy.
  if (isAssignedRemoteContested(creep) || (threat && threat.score > 0)) {
    if (creep.store[RESOURCE_ENERGY] > 0) {
      depositEnergy(creep, homeRoom);
    } else if (creep.room.name !== homeRoom) {
      moveToRoom(creep, homeRoom);
    }
    return;
  }

  // In the room and safe again — let collection resume and stop the defender spawns. Hold the
  // flag while a core still stands so the defender keeps working until the room is truly clear.
  if (inTarget && !core) clearRemoteInvader(creep);

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
  // Route toward the target room centre via PathFinder's multi-room pathing rather than
  // findExitTo + findClosestByRange(exit). That older pattern aims at a bare edge tile chosen
  // by straight-line range (often a corner or a wall-blocked tile), and moveTo to a bare border
  // tile doesn't reliably cross — the creep parks on the edge or corner-drifts into the wrong
  // neighbour, whose findExitTo points straight back, bouncing between two rooms forever.
  creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 30, range: 20 });
}
