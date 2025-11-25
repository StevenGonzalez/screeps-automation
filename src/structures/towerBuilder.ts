// src/structures/towerBuilder.ts
import { MemoryManager } from '../memory/memoryManager';
import { towerPlanner } from './towerPlanner';

interface TowerBuildState {
  lastBuildCheck: number;
  lastCleanupCheck: number;
}

const BUILD_CHECK_INTERVAL = 25;
const CLEANUP_CHECK_INTERVAL = 120;
const MAX_SITES_PER_CHECK = 2;

export class TowerBuilder {
  buildTowersForRoom(room: Room) {
    if (!room.controller || !room.controller.my) return;

    const statePath = `rooms.${room.name}.towerBuildState`;
    const state = MemoryManager.get<TowerBuildState>(statePath, { lastBuildCheck: 0, lastCleanupCheck: 0 });

    if (!state) return;

    if (Game.time - state.lastBuildCheck >= BUILD_CHECK_INTERVAL) {
      this.createTowerSites(room);
      state.lastBuildCheck = Game.time;
      MemoryManager.set(statePath, state);
    }

    if (Game.time - state.lastCleanupCheck >= CLEANUP_CHECK_INTERVAL) {
      this.cleanupTowers(room);
      state.lastCleanupCheck = Game.time;
      MemoryManager.set(statePath, state);
    }
  }

  private createTowerSites(room: Room) {
    const plan = towerPlanner.planTowersForRoom(room);
    if (!plan || plan.positions.length === 0) return;

    const existingTowers = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER });
    const existingSites = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_TOWER });
    
    const existingPositions = new Set<string>();
    for (const tower of existingTowers) {
      existingPositions.add(`${tower.pos.x},${tower.pos.y}`);
    }
    for (const site of existingSites) {
      existingPositions.add(`${site.pos.x},${site.pos.y}`);
    }

    let sitesCreated = 0;

    for (const posStr of plan.positions) {
      if (sitesCreated >= MAX_SITES_PER_CHECK) break;
      
      const [x, y] = posStr.split(',').map(Number);
      const key = `${x},${y}`;
      
      if (existingPositions.has(key)) continue;

      const pos = new RoomPosition(x, y, room.name);
      
      const hasBlockingStructure = pos.lookFor(LOOK_STRUCTURES).some(s => 
        s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_RAMPART
      );
      
      if (hasBlockingStructure) continue;

      const result = room.createConstructionSite(pos, STRUCTURE_TOWER);
      if (result === OK) {
        sitesCreated++;
      }
    }
  }

  private cleanupTowers(room: Room) {
    const plan = towerPlanner.planTowersForRoom(room);
    if (!plan) return;

    const plannedPositions = new Set<string>();
    for (const posStr of plan.positions) {
      const [x, y] = posStr.split(',').map(Number);
      plannedPositions.add(`${x},${y}`);
    }

    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return;

    const towers = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }) as StructureTower[];
    
    for (const tower of towers) {
      const key = `${tower.pos.x},${tower.pos.y}`;
      
      if (!plannedPositions.has(key)) {
        const distToSpawn = tower.pos.getRangeTo(spawn);
        if (distToSpawn > 15) {
          tower.destroy();
        }
      }
    }

    const sites = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_TOWER });
    
    for (const site of sites) {
      const key = `${site.pos.x},${site.pos.y}`;
      
      if (!plannedPositions.has(key)) {
        site.remove();
      }
    }
  }
}

export const towerBuilder = new TowerBuilder();
