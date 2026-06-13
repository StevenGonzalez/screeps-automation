export function addTowerToMemory(room: Room, towerId: Id<StructureTower>) {
  if (!room.memory.towerIds) room.memory.towerIds = [];
  if (!room.memory.towerIds.includes(towerId)) {
    room.memory.towerIds.push(towerId);
  }
}

export function getCreepMemory(creep: Creep): CreepMemory {
  return creep.memory as CreepMemory;
}

export function getRoomMemory(room: Room): RoomMemory {
  return room.memory as RoomMemory;
}

export function removeContainerFromMemory(
  room: Room,
  containerId: Id<StructureContainer>
) {
  if (!room.memory.containerIds) return;
  room.memory.containerIds = room.memory.containerIds.filter(
    (id) => id !== containerId
  );
}

export function removeTowerFromMemory(room: Room, towerId: Id<StructureTower>) {
  if (!room.memory.towerIds) return;
  room.memory.towerIds = room.memory.towerIds.filter((id) => id !== towerId);
}
