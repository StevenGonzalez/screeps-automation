// src/economy/pixelManager.ts

export class PixelManager {
  run() {
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;

      this.managePixelGeneration(room);
    }
  }

  private managePixelGeneration(room: Room) {
    const controller = room.controller;
    if (!controller) return;

    if (Game.cpu.bucket === 10000 && Game.cpu.generatePixel) {
      Game.cpu.generatePixel();
    }
  }
}

export const pixelManager = new PixelManager();
