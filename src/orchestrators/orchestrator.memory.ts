export function loop() {
  cleanupDeadCreeps();
  initializeMemory();
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    processRoomMemory(room);
  }
}

function cleanupDeadCreeps() {
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) {
      delete Memory.creeps[name];
    }
  }
}

function initializeMemory() {
  if (!Memory.uuid) {
    Memory.uuid = 0;
  }
}

function processRoomMemory(room: Room) {
  if (!room.controller || !room.controller.my) return;
  if (!room.memory.lastScan || Game.time - room.memory.lastScan > 100) {
    const spawns = room.find(FIND_MY_SPAWNS);
    room.memory.spawnId = spawns.length > 0 ? spawns[0].id : undefined;

    const sources = room.find(FIND_SOURCES);
    room.memory.sourceIds = sources.map((s) => s.id);

    const minerals = room.find(FIND_MINERALS);
    room.memory.mineralId = minerals.length > 0 ? minerals[0].id : undefined;

    const containers = room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    });
    room.memory.containerIds = containers.map((c) => c.id);

    // Record miner-adjacent containers (within range 1 of a source) so haulers
    // can target them specifically for withdrawals.
    const sourceList = room.find(FIND_SOURCES) as Source[];
    const minerContainerIds: string[] = [];
    for (const c of containers) {
      for (const s of sourceList) {
        if (c.pos.getRangeTo(s.pos) <= 1) {
          minerContainerIds.push(c.id);
          break;
        }
      }
    }
    // allow storing extra memory key without extending RoomMemory types here
    (room.memory as any).minerContainerIds = minerContainerIds;

    const towers = room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_TOWER,
    });
    room.memory.towerIds = towers.map((t) => t.id);

    room.memory.lastScan = Game.time;
  }
}
