// src/structures/extensionPlanner.ts
import { MemoryManager } from '../memory/memoryManager';

interface ExtensionPlan {
  positions: string[];
  generatedAt: number;
  rcl: number;
}

const EXTENSION_LIMITS: { [rcl: number]: number } = {
  0: 0, 1: 0, 2: 5, 3: 10, 4: 20, 5: 30, 6: 40, 7: 50, 8: 60
};

export class ExtensionPlanner {
  planExtensionsForRoom(room: Room): ExtensionPlan | null {
    if (!room.controller || !room.controller.my) return null;

    const planPath = `rooms.${room.name}.extensionPlan`;
    const existingPlan = MemoryManager.get<ExtensionPlan>(planPath);

    if (existingPlan && existingPlan.rcl === room.controller.level) {
      return existingPlan;
    }

    const positions = this.computeExtensionPositions(room);
    
    const plan: ExtensionPlan = {
      positions: positions.map(pos => `${pos.x},${pos.y}`),
      generatedAt: Game.time,
      rcl: room.controller.level,
    };

    MemoryManager.set(planPath, plan);
    return plan;
  }

  private computeExtensionPositions(room: Room): RoomPosition[] {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return [];

    const rcl = room.controller?.level || 0;
    const maxExtensions = EXTENSION_LIMITS[rcl] || 0;
    
    if (maxExtensions === 0) return [];

    const positions: RoomPosition[] = [];
    const anchor = spawn.pos;

    const existingStructures = room.find(FIND_STRUCTURES);
    const existingSites = room.find(FIND_CONSTRUCTION_SITES);
    const blockedPositions = new Set<string>();

    for (const s of existingStructures) {
      blockedPositions.add(`${s.pos.x},${s.pos.y}`);
    }
    for (const s of existingSites) {
      blockedPositions.add(`${s.pos.x},${s.pos.y}`);
    }

    this.blockReservedPositions(room, blockedPositions);

    const terrain = room.getTerrain();
    const candidates: Array<{ pos: RoomPosition; score: number }> = [];

    for (let range = 2; range <= 10 && positions.length < maxExtensions; range++) {
      const positionsAtRange = this.getPositionsInRange(anchor, range, room.name);
      
      for (const pos of positionsAtRange) {
        const key = `${pos.x},${pos.y}`;
        if (blockedPositions.has(key)) continue;
        
        const terrainType = terrain.get(pos.x, pos.y);
        if (terrainType === TERRAIN_MASK_WALL) continue;

        if (!this.isValidExtensionPosition(pos, blockedPositions, terrain)) continue;

        const distToSpawn = pos.getRangeTo(spawn);
        const adjacentPlains = this.countAdjacentPlains(pos, terrain);
        const nearRoad = this.isNearRoad(pos, existingStructures);

        const score = -distToSpawn * 10 + adjacentPlains * 5 + (nearRoad ? 20 : 0) + (terrainType === 0 ? 10 : 0);
        
        candidates.push({ pos, score });
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    for (let i = 0; i < Math.min(candidates.length, maxExtensions); i++) {
      positions.push(candidates[i].pos);
      blockedPositions.add(`${candidates[i].pos.x},${candidates[i].pos.y}`);
    }

    return positions;
  }

  private getPositionsInRange(center: RoomPosition, range: number, roomName: string): RoomPosition[] {
    const positions: RoomPosition[] = [];
    
    for (let x = Math.max(1, center.x - range); x <= Math.min(48, center.x + range); x++) {
      for (let y = Math.max(1, center.y - range); y <= Math.min(48, center.y + range); y++) {
        const dist = Math.max(Math.abs(x - center.x), Math.abs(y - center.y));
        if (dist === range) {
          positions.push(new RoomPosition(x, y, roomName));
        }
      }
    }
    
    return positions;
  }

  private isValidExtensionPosition(pos: RoomPosition, blockedPositions: Set<string>, terrain: RoomTerrain): boolean {
    if (pos.x < 2 || pos.x > 47 || pos.y < 2 || pos.y > 47) return false;

    let adjacentOpen = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        
        const nx = pos.x + dx;
        const ny = pos.y + dy;
        
        if (terrain.get(nx, ny) !== TERRAIN_MASK_WALL && !blockedPositions.has(`${nx},${ny}`)) {
          adjacentOpen++;
        }
      }
    }

    return adjacentOpen >= 3;
  }

  private countAdjacentPlains(pos: RoomPosition, terrain: RoomTerrain): number {
    let count = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        
        const terrainType = terrain.get(pos.x + dx, pos.y + dy);
        if (terrainType === 0) count++;
      }
    }
    return count;
  }

  private isNearRoad(pos: RoomPosition, structures: Structure[]): boolean {
    for (const s of structures) {
      if (s.structureType === STRUCTURE_ROAD && pos.getRangeTo(s.pos) <= 1) {
        return true;
      }
    }
    return false;
  }

  private blockReservedPositions(room: Room, blockedPositions: Set<string>) {
    const storagePlan = MemoryManager.get<{ position: string | null }>(`rooms.${room.name}.storagePlan`);
    if (storagePlan?.position) {
      const [x, y] = storagePlan.position.split(',').map(Number);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          blockedPositions.add(`${x + dx},${y + dy}`);
        }
      }
    }

    const towerPlan = MemoryManager.get<{ positions: string[] }>(`rooms.${room.name}.towerPlan`);
    if (towerPlan?.positions) {
      for (const posStr of towerPlan.positions) {
        const [x, y] = posStr.split(',').map(Number);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            blockedPositions.add(`${x + dx},${y + dy}`);
          }
        }
      }
    }
  }

  invalidatePlan(roomName: string) {
    MemoryManager.remove(`rooms.${roomName}.extensionPlan`);
  }
}

export const extensionPlanner = new ExtensionPlanner();
