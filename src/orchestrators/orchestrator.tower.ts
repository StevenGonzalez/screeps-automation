import { runTower } from "../roles/role.tower";

export function loop() {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    const towers = room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_TOWER,
    }) as StructureTower[];
    for (const tower of towers) {
      runTower(tower);
    }
  }
}
