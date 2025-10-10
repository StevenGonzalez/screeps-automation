import {
  getSpawnForRoom,
  shouldSpawnHarvester,
  spawnHarvester,
} from "../utils/spawnUtils";

export function loop() {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    processRoomSpawning(room);
  }
}

function processRoomSpawning(room: Room) {
  const spawn = getSpawnForRoom(room);
  if (!spawn) return;
  if (shouldSpawnHarvester(room)) {
    spawnHarvester(room, spawn);
  }
}
