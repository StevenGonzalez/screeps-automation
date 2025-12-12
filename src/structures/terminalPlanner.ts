// src/structures/terminalPlanner.ts
import { MemoryManager } from '../memory/memoryManager';

interface TerminalPlan {
  position: string | null;
  generatedAt: number;
  rcl: number;
}

export class TerminalPlanner {
  planTerminalForRoom(room: Room): TerminalPlan | null {
    if (!room.controller || !room.controller.my) return null;
    if (room.controller.level < 6) return null;

    const planPath = `rooms.${room.name}.terminalPlan`;
    const existingPlan = MemoryManager.get<TerminalPlan>(planPath);

    if (existingPlan && existingPlan.rcl === room.controller.level) {
      return existingPlan;
    }

    const position = this.computeTerminalPosition(room);
    
    const plan: TerminalPlan = {
      position: position ? `${position.x},${position.y}` : null,
      generatedAt: Game.time,
      rcl: room.controller.level,
    };

    MemoryManager.set(planPath, plan);
    return plan;
  }

  private computeTerminalPosition(room: Room): RoomPosition | null {
    const storage = room.storage;
    if (!storage) {
      // If no storage exists yet, try to use the storage plan
      const storagePlan = MemoryManager.get<{ position: string }>(`rooms.${room.name}.storagePlan`);
      if (storagePlan?.position) {
        const [sx, sy] = storagePlan.position.split(',').map(Number);
        return this.findPositionNearStorage(new RoomPosition(sx, sy, room.name), room);
      }
      
      // Fallback to spawn if no storage plan
      const spawn = room.find(FIND_MY_SPAWNS)[0];
      if (!spawn) return null;
      return this.findPositionNearStorage(spawn.pos, room);
    }

    return this.findPositionNearStorage(storage.pos, room);
  }

  private findPositionNearStorage(storagePos: RoomPosition, room: Room): RoomPosition | null {
    const terrain = room.getTerrain();
    const existingStructures = room.find(FIND_STRUCTURES);
    const existingSites = room.find(FIND_CONSTRUCTION_SITES);
    const blockedPositions = new Set<string>();

    // Check for existing terminal
    for (const s of existingStructures) {
      if (s.structureType === STRUCTURE_TERMINAL) {
        return s.pos;
      }
      blockedPositions.add(`${s.pos.x},${s.pos.y}`);
    }
    for (const s of existingSites) {
      if (s.structureType === STRUCTURE_TERMINAL) {
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

    // Search in expanding rings around storage (range 1-4)
    for (let range = 1; range <= 4; range++) {
      const positions = this.getPositionsInRange(storagePos, range, room.name);
      
      for (const pos of positions) {
        const key = `${pos.x},${pos.y}`;
        if (blockedPositions.has(key)) continue;

        const terrainType = terrain.get(pos.x, pos.y);
        if (terrainType === TERRAIN_MASK_WALL) continue;

        if (!this.isValidTerminalPosition(pos, terrain)) continue;

        // Prefer positions closest to storage
        const distToStorage = pos.getRangeTo(storagePos);
        
        // Bonus for being on plains vs swamp
        const terrainScore = terrainType === 0 ? 10 : 0;
        
        // Strong preference for being adjacent to storage (range 1)
        const adjacencyBonus = distToStorage === 1 ? 100 : 0;
        
        const score = -distToStorage * 10 + terrainScore + adjacencyBonus;
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

  private isValidTerminalPosition(pos: RoomPosition, terrain: RoomTerrain): boolean {
    // Must not be on edge tiles
    if (pos.x < 2 || pos.x > 47 || pos.y < 2 || pos.y > 47) return false;

    // Need at least some adjacent open tiles for access
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

    // Terminal needs reasonable access
    return adjacentOpen >= 6;
  }

  invalidatePlan(roomName: string) {
    MemoryManager.remove(`rooms.${roomName}.terminalPlan`);
  }
}

export const terminalPlanner = new TerminalPlanner();
