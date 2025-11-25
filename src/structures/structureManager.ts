// src/structures/structureManager.ts
import { roadPlanner } from './roadPlanner';
import { roadBuilder } from './roadBuilder';
import { containerPlanner } from './containerPlanner';
import { containerBuilder } from './containerBuilder';

export class StructureManager {
  run() {
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;

      this.manageRoomStructures(room);
    }
  }

  private manageRoomStructures(room: Room) {
    this.planRoads(room);
    this.buildRoads(room);
    this.planContainers(room);
    this.buildContainers(room);
  }

  private planRoads(room: Room) {
    roadPlanner.planRoadsForRoom(room);
  }

  private buildRoads(room: Room) {
    roadBuilder.buildRoadsForRoom(room);
  }

  private planContainers(room: Room) {
    containerPlanner.planContainersForRoom(room);
  }

  private buildContainers(room: Room) {
    containerBuilder.buildContainersForRoom(room);
  }

  invalidateRoomPlans(roomName: string) {
    roadPlanner.invalidatePlan(roomName);
    containerPlanner.invalidatePlan(roomName);
  }
}

export const structureManager = new StructureManager();
