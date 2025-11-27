// src/structures/towerPlanner.ts
import { MemoryManager } from '../memory/memoryManager';

interface TowerPlan {
  positions: string[];
  generatedAt: number;
  rcl: number;
}

const TOWER_LIMITS: { [rcl: number]: number } = {
  0: 0, 1: 0, 2: 0, 3: 1, 4: 1, 5: 2, 6: 2, 7: 3, 8: 6
};

const TOWER_RANGE = 20;

export class TowerPlanner {
  planTowersForRoom(room: Room): TowerPlan | null {
    if (!room.controller || !room.controller.my) return null;

    const planPath = `rooms.${room.name}.towerPlan`;
    const existingPlan = MemoryManager.get<TowerPlan>(planPath);

    if (existingPlan && existingPlan.rcl === room.controller.level) {
      return existingPlan;
    }

    const positions = this.computeTowerPositions(room);
    
    const plan: TowerPlan = {
      positions: positions.map(pos => `${pos.x},${pos.y}`),
      generatedAt: Game.time,
      rcl: room.controller.level,
    };

    MemoryManager.set(planPath, plan);
    return plan;
  }

  private computeTowerPositions(room: Room): RoomPosition[] {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return [];

    const rcl = room.controller?.level || 0;
    const maxTowers = TOWER_LIMITS[rcl] || 0;
    
    if (maxTowers === 0) return [];

    const terrain = room.getTerrain();
    const existingStructures = room.find(FIND_STRUCTURES);
    const existingSites = room.find(FIND_CONSTRUCTION_SITES);
    const blockedPositions = new Set<string>();

    for (const s of existingStructures) {
      blockedPositions.add(`${s.pos.x},${s.pos.y}`);
    }
    for (const s of existingSites) {
      blockedPositions.add(`${s.pos.x},${s.pos.y}`);
    }

    // Block planned road positions
    const roadPlan = MemoryManager.get<{ positions: string[] }>(`rooms.${room.name}.roadPlan`);
    if (roadPlan?.positions) {
      for (const posStr of roadPlan.positions) {
        blockedPositions.add(posStr);
      }
    }

    const storage = this.getStoragePosition(room, existingStructures, existingSites);
    const controller = room.controller;
    const sources = room.find(FIND_SOURCES);

    const keyPositions: RoomPosition[] = [spawn.pos];
    if (storage) keyPositions.push(storage);
    if (controller) keyPositions.push(controller.pos);
    for (const source of sources) keyPositions.push(source.pos);

    const exitTiles = this.getExitTiles(room);

    const candidates: Array<{ pos: RoomPosition; score: number }> = [];

    for (let x = 3; x <= 46; x++) {
      for (let y = 3; y <= 46; y++) {
        const pos = new RoomPosition(x, y, room.name);
        const key = `${x},${y}`;
        
        if (blockedPositions.has(key)) continue;

        const terrainType = terrain.get(x, y);
        if (terrainType === TERRAIN_MASK_WALL) continue;

        if (!this.isValidTowerPosition(pos, terrain)) continue;

        const coverageScore = this.calculateCoverageScore(pos, keyPositions, exitTiles);
        const centralityScore = this.calculateCentralityScore(pos, spawn.pos, storage);
        const terrainScore = terrainType === 0 ? 10 : 0;

        const score = coverageScore + centralityScore + terrainScore;
        candidates.push({ pos, score });
      }
    }

    if (candidates.length === 0) return [];

    candidates.sort((a, b) => b.score - a.score);

    const selectedPositions: RoomPosition[] = [];
    const selectedSet = new Set<string>();

    for (const candidate of candidates) {
      if (selectedPositions.length >= maxTowers) break;

      const hasOverlap = this.hasGoodOverlapWithExisting(candidate.pos, selectedPositions);
      
      if (selectedPositions.length === 0 || hasOverlap) {
        selectedPositions.push(candidate.pos);
        selectedSet.add(`${candidate.pos.x},${candidate.pos.y}`);
        blockedPositions.add(`${candidate.pos.x},${candidate.pos.y}`);
      }
    }

    return selectedPositions;
  }

  private getStoragePosition(room: Room, structures: Structure[], sites: ConstructionSite[]): RoomPosition | null {
    for (const s of structures) {
      if (s.structureType === STRUCTURE_STORAGE) return s.pos;
    }
    for (const s of sites) {
      if (s.structureType === STRUCTURE_STORAGE) return s.pos;
    }

    const storagePlan = MemoryManager.get<{ position: string | null }>(`rooms.${room.name}.storagePlan`);
    if (storagePlan?.position) {
      const [x, y] = storagePlan.position.split(',').map(Number);
      return new RoomPosition(x, y, room.name);
    }

    return null;
  }

  private getExitTiles(room: Room): RoomPosition[] {
    const exits: RoomPosition[] = [];
    
    for (let x = 0; x <= 49; x++) {
      exits.push(new RoomPosition(x, 0, room.name));
      exits.push(new RoomPosition(x, 49, room.name));
    }
    for (let y = 1; y <= 48; y++) {
      exits.push(new RoomPosition(0, y, room.name));
      exits.push(new RoomPosition(49, y, room.name));
    }
    
    return exits;
  }

  private calculateCoverageScore(pos: RoomPosition, keyPositions: RoomPosition[], exitTiles: RoomPosition[]): number {
    let score = 0;

    for (const kp of keyPositions) {
      const dist = pos.getRangeTo(kp);
      if (dist <= TOWER_RANGE) {
        score += Math.max(0, 50 - dist * 2);
      }
    }

    let nearestExitDist = Infinity;
    for (const exit of exitTiles) {
      const dist = pos.getRangeTo(exit);
      if (dist < nearestExitDist) nearestExitDist = dist;
    }
    
    if (nearestExitDist <= TOWER_RANGE) {
      score += Math.max(0, 30 - nearestExitDist);
    }

    return score;
  }

  private calculateCentralityScore(pos: RoomPosition, spawn: RoomPosition, storage: RoomPosition | null): number {
    const distToSpawn = pos.getRangeTo(spawn);
    let score = -distToSpawn * 5;

    if (storage) {
      const distToStorage = pos.getRangeTo(storage);
      score += -distToStorage * 3;
    }

    if (distToSpawn >= 3 && distToSpawn <= 6) {
      score += 20;
    }

    return score;
  }

  private hasGoodOverlapWithExisting(pos: RoomPosition, existing: RoomPosition[]): boolean {
    if (existing.length === 0) return true;

    for (const existingPos of existing) {
      const dist = pos.getRangeTo(existingPos);
      if (dist >= 4 && dist <= 10) {
        return true;
      }
    }

    return false;
  }

  private isValidTowerPosition(pos: RoomPosition, terrain: RoomTerrain): boolean {
    if (pos.x < 3 || pos.x > 46 || pos.y < 3 || pos.y > 46) return false;

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

    return adjacentOpen >= 5;
  }

  invalidatePlan(roomName: string) {
    MemoryManager.remove(`rooms.${roomName}.towerPlan`);
  }
}

export const towerPlanner = new TowerPlanner();
