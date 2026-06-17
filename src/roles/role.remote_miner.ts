/**
 * Remote miner (outrider): travels to an assigned source in a foreign room, sits on
 * or adjacent to it, and harvests. If a container exists next to the source it
 * will fill it; otherwise energy drops for the remote hauler to collect.
 *
 * Assignment: creep.memory.homeRoom      = owning room name
 *             creep.memory.targetRoom    = room containing the source
 *             creep.memory.remoteSourceId = Id<Source> to harvest
 */

import { getThreatInfo, isInvaderCreep, isPlayerCreep, findInvaderCore } from "../services/services.combat";
import {
  isAssignedRemoteContested,
  flagRemoteInvader,
  flagRemotePlayer,
  clearRemoteInvader,
} from "../services/services.creep";

export function runRemoteMiner(creep: Creep) {
  const { targetRoom, homeRoom, remoteSourceId } = creep.memory;

  if (!targetRoom || !homeRoom || !remoteSourceId) {
    creep.suicide();
    return;
  }

  // Record any threat we can see so the room gets flagged (Invader → defender; player →
  // avoid), which is what stops us re-entering on later ticks. An Invader Core counts as an
  // Invader threat even with no creeps in sight — it must be destroyed to free the remote.
  const inTarget = creep.room.name === targetRoom;
  const threat = inTarget ? getThreatInfo(creep.room) : null;
  const core = inTarget ? findInvaderCore(creep.room) : null;
  if (core) flagRemoteInvader(creep);
  else if (threat && threat.score > 0) {
    if (threat.hostiles.some(isInvaderCreep)) flagRemoteInvader(creep);
    else if (threat.hostiles.some(isPlayerCreep)) flagRemotePlayer(creep);
  }

  // Stay home while the remote is contested. Don't ferry an unarmed outrider in to die — and
  // crucially don't ping-pong (in → attacked → flee → towers heal → back in), which drains
  // tower energy. Wait until the flag clears (Invader/core killed by a defender, or window lapses).
  if (isAssignedRemoteContested(creep) || (threat && threat.score > 0)) {
    if (creep.room.name !== homeRoom) moveToRoom(creep, homeRoom);
    return;
  }

  // In the room and safe — a defender cleared it (or the flag lapsed); let mining resume.
  // Don't lift the flag while a core still stands, or we'd march back in and re-flag in a loop.
  if (inTarget && !core) clearRemoteInvader(creep);

  // Travel to the target room
  if (creep.room.name !== targetRoom) {
    moveToRoom(creep, targetRoom);
    return;
  }

  // We're in the target room
  const source = Game.getObjectById(remoteSourceId) as Source | null;
  if (!source) {
    // Source ID no longer valid — wipe assignment and idle
    creep.memory.remoteSourceId = undefined;
    return;
  }

  // Check for a container adjacent to the source and update memory
  const container = findOrUpdateContainer(creep, source);

  if (container) {
    // Stand on the container
    if (!creep.pos.isEqualTo(container.pos)) {
      creep.moveTo(container, { reusePath: 30 });
      return;
    }
    // Repair container if decaying (WORK parts double as repair)
    if (container.hits < container.hitsMax * 0.5 && creep.store[RESOURCE_ENERGY] > 0) {
      creep.repair(container);
    }
    creep.harvest(source);
  } else {
    // No container — stand adjacent to source and harvest
    if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { reusePath: 30 });
    }
  }
}

function moveToRoom(creep: Creep, targetRoom: string) {
  const exit = creep.room.findExitTo(targetRoom);
  if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS) return;
  const exitPos = creep.pos.findClosestByRange(exit);
  if (exitPos) creep.moveTo(exitPos, { reusePath: 30 });
}

function findOrUpdateContainer(
  creep: Creep,
  source: Source
): StructureContainer | null {
  // Check cached container ID first
  if (creep.memory.assignedContainerId) {
    const cached = Game.getObjectById(
      creep.memory.assignedContainerId
    ) as StructureContainer | null;
    if (cached) return cached;
    creep.memory.assignedContainerId = undefined;
  }

  // Scan for container within 1 tile of the source
  const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
    filter: (s): s is StructureContainer =>
      s.structureType === STRUCTURE_CONTAINER,
  }) as StructureContainer[];

  if (containers.length === 0) return null;

  const container = containers[0];
  creep.memory.assignedContainerId = container.id;

  // Persist in home room's remote room data so haulers know where to collect
  updateRemoteContainerMemory(creep, source, container);

  return container;
}

function updateRemoteContainerMemory(
  creep: Creep,
  source: Source,
  container: StructureContainer
) {
  const homeMemory = Memory.rooms[creep.memory.homeRoom!];
  if (!homeMemory?.remoteRooms) return;

  const remoteEntry = homeMemory.remoteRooms.find(
    (r) => r.roomName === creep.room.name
  );
  if (!remoteEntry) return;

  const sourceEntry = remoteEntry.sources.find(
    (s) => s.sourceId === source.id
  );
  if (sourceEntry) sourceEntry.containerId = container.id;
}
