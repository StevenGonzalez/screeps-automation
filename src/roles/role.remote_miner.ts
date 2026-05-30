/**
 * Remote miner (outrider): travels to an assigned source in a foreign room, sits on
 * or adjacent to it, and harvests. If a container exists next to the source it
 * will fill it; otherwise energy drops for the remote hauler to collect.
 *
 * Assignment: creep.memory.homeRoom      = owning room name
 *             creep.memory.targetRoom    = room containing the source
 *             creep.memory.remoteSourceId = Id<Source> to harvest
 */

export function runRemoteMiner(creep: Creep) {
  const { targetRoom, homeRoom, remoteSourceId } = creep.memory;

  if (!targetRoom || !homeRoom || !remoteSourceId) {
    creep.suicide();
    return;
  }

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
