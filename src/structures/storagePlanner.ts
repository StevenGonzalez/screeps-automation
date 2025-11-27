// src/structures/storagePlanner.ts
import { MemoryManager } from '../memory/memoryManager';

interface StoragePlan {
  position: string | null;
  generatedAt: number;
  rcl: number;
}

export class StoragePlanner {
  planStorageForRoom(room: Room): StoragePlan | null {
    if (!room.controller || !room.controller.my) return null;
    if (room.controller.level < 4) return null;

    const planPath = `rooms.${room.name}.storagePlan`;
    const existingPlan = MemoryManager.get<StoragePlan>(planPath);

    if (existingPlan && existingPlan.rcl === room.controller.level) {
      return existingPlan;
    }

    const position = this.computeStoragePosition(room);
    
    const plan: StoragePlan = {
      position: position ? `${position.x},${position.y}` : null,
      generatedAt: Game.time,
      rcl: room.controller.level,
    };

    MemoryManager.set(planPath, plan);
    return plan;
  }

  private computeStoragePosition(room: Room): RoomPosition | null {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return null;

    const controller = room.controller;
    if (!controller) return null;

    const sources = room.find(FIND_SOURCES);
    const terrain = room.getTerrain();

    const existingStructures = room.find(FIND_STRUCTURES);
    const existingSites = room.find(FIND_CONSTRUCTION_SITES);
    const blockedPositions = new Set<string>();

    for (const s of existingStructures) {
      if (s.structureType === STRUCTURE_STORAGE) {
        return s.pos;
      }
      blockedPositions.add(`${s.pos.x},${s.pos.y}`);
    }
    for (const s of existingSites) {
      if (s.structureType === STRUCTURE_STORAGE) {
        return s.pos;
      }
      blockedPositions.add(`${s.pos.x},${s.pos.y}`);
    }

    // Block planned road positions
    const roadPlan = MemoryManager.get<{ positions: string[] }>(`rooms.${room.name}.roadPlan`);
    if (roadPlan?.positions) {
      for (const posStr of roadPlan.positions) {
        blockedPositions.add(posStr);
      }
    }

    const candidates: Array<{ pos: RoomPosition; score: number }> = [];

    for (let range = 2; range <= 6; range++) {
      const positions = this.getPositionsInRange(spawn.pos, range, room.name);
      
      for (const pos of positions) {
        const key = `${pos.x},${pos.y}`;
        if (blockedPositions.has(key)) continue;

        const terrainType = terrain.get(pos.x, pos.y);
        if (terrainType === TERRAIN_MASK_WALL) continue;

        if (!this.isValidStoragePosition(pos, terrain)) continue;

        const distToSpawn = pos.getRangeTo(spawn);
        const distToController = pos.getRangeTo(controller);
        
        let avgDistToSources = 0;
        for (const source of sources) {
          avgDistToSources += pos.getRangeTo(source);
        }
        avgDistToSources = sources.length > 0 ? avgDistToSources / sources.length : 0;

        const centralityScore = -(distToSpawn + distToController + avgDistToSources);
        const terrainScore = terrainType === 0 ? 10 : 0;
        const nearSpawnBonus = distToSpawn <= 3 ? 50 : 0;

        const score = centralityScore + terrainScore + nearSpawnBonus;
        candidates.push({ pos, score });
      }
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].pos;
  }

  private getPositionsInRange(center: RoomPosition, range: number, roomName: string): RoomPosition[] {
    const positions: RoomPosition[] = [];
    
    for (let x = Math.max(2, center.x - range); x <= Math.min(47, center.x + range); x++) {
      for (let y = Math.max(2, center.y - range); y <= Math.min(47, center.y + range); y++) {
        const dist = Math.max(Math.abs(x - center.x), Math.abs(y - center.y));
        if (dist === range) {
          positions.push(new RoomPosition(x, y, roomName));
        }
      }
    }
    
    return positions;
  }

  private isValidStoragePosition(pos: RoomPosition, terrain: RoomTerrain): boolean {
    if (pos.x < 2 || pos.x > 47 || pos.y < 2 || pos.y > 47) return false;

    let adjacentOpen = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        
        const terrainType = terrain.get(pos.x + dx, pos.y + dy);
        if (terrainType !== TERRAIN_MASK_WALL) {
          adjacentOpen++;
        }
      }
    }

    return adjacentOpen >= 6;
  }

  invalidatePlan(roomName: string) {
    MemoryManager.remove(`rooms.${roomName}.storagePlan`);
  }
}

export const storagePlanner = new StoragePlanner();
