// src/structures/structureManager.ts
import { roadPlanner } from './roadPlanner';
import { roadBuilder } from './roadBuilder';
import { containerPlanner } from './containerPlanner';
import { containerBuilder } from './containerBuilder';
import { extensionPlanner } from './extensionPlanner';
import { extensionBuilder } from './extensionBuilder';
import { storagePlanner } from './storagePlanner';
import { storageBuilder } from './storageBuilder';
import { towerPlanner } from './towerPlanner';
import { towerBuilder } from './towerBuilder';
import { buildRamparts } from './rampartBuilder';

export class StructureManager {
  run() {
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;

      this.manageRoomStructures(room);
    }
  }

  private manageRoomStructures(room: Room) {
    // Plan everything first
    this.planContainers(room);
    this.planRoads(room);
    this.planStorage(room);
    this.planTowers(room);
    this.planExtensions(room);
    
    // Build infrastructure (roads) before extensions
    // This ensures extensions can be placed along roads
    this.buildStorage(room);
    this.buildTowers(room);
    this.buildContainers(room);
    this.buildRoads(room);
    this.buildExtensions(room);
    
    // Build ramparts last to protect completed structures
    this.buildRamparts(room);
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

  private planExtensions(room: Room) {
    extensionPlanner.planExtensionsForRoom(room);
  }

  private buildExtensions(room: Room) {
    extensionBuilder.buildExtensionsForRoom(room);
  }

  private planStorage(room: Room) {
    storagePlanner.planStorageForRoom(room);
  }

  private buildStorage(room: Room) {
    storageBuilder.buildStorageForRoom(room);
  }

  private planTowers(room: Room) {
    towerPlanner.planTowersForRoom(room);
  }

  private buildTowers(room: Room) {
    towerBuilder.buildTowersForRoom(room);
  }

  private buildRamparts(room: Room) {
    buildRamparts(room);
  }

  invalidateRoomPlans(roomName: string) {
    roadPlanner.invalidatePlan(roomName);
    containerPlanner.invalidatePlan(roomName);
    extensionPlanner.invalidatePlan(roomName);
    storagePlanner.invalidatePlan(roomName);
    towerPlanner.invalidatePlan(roomName);
  }
}

export const structureManager = new StructureManager();
