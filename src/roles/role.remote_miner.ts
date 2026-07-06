import { getThreatInfo, isInvaderCreep, isPlayerCreep, findInvaderCore } from "../services/services.combat";
import {
  isAssignedRemoteContested,
  flagRemoteInvader,
  flagRemotePlayer,
  clearRemoteInvader,
} from "../services/services.creep";

const REMOTE_DAMAGE_BACKOFF = 300;

export function runRemoteMiner(creep: Creep) {
  const { targetRoom, homeRoom, remoteSourceId } = creep.memory;

  if (!targetRoom || !homeRoom || !remoteSourceId) {
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
    if (creep.room.name !== homeRoom) moveToRoom(creep, homeRoom);
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
    if (creep.room.name !== homeRoom) moveToRoom(creep, homeRoom);
    return;
  }

  if (inTarget && !core) clearRemoteInvader(creep);

  if (creep.room.name !== targetRoom) {
    moveToRoom(creep, targetRoom);
    return;
  }

  const source = Game.getObjectById(remoteSourceId) as Source | null;
  if (!source) {
    creep.memory.remoteSourceId = undefined;
    return;
  }

  const container = findOrUpdateContainer(creep, source);

  if (container) {
    if (!creep.pos.isEqualTo(container.pos)) {
      creep.moveTo(container, { reusePath: 30 });
      return;
    }
    if (container.hits < container.hitsMax * 0.5 && creep.store[RESOURCE_ENERGY] > 0) {
      creep.repair(container);
    }
    creep.harvest(source);
  } else {
    if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { reusePath: 30 });
    }
  }
}

function moveToRoom(creep: Creep, targetRoom: string) {
  creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 30, range: 20 });
}

function findOrUpdateContainer(
  creep: Creep,
  source: Source
): StructureContainer | null {
  if (creep.memory.assignedContainerId) {
    const cached = Game.getObjectById(
      creep.memory.assignedContainerId
    ) as StructureContainer | null;
    if (cached) return cached;
    creep.memory.assignedContainerId = undefined;
  }

  const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
    filter: (s): s is StructureContainer =>
      s.structureType === STRUCTURE_CONTAINER,
  }) as StructureContainer[];

  if (containers.length === 0) return null;

  const container = containers[0];
  creep.memory.assignedContainerId = container.id;

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
