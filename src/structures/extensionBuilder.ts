// src/structures/extensionBuilder.ts
import { MemoryManager } from '../memory/memoryManager';
import { extensionPlanner } from './extensionPlanner';

interface ExtensionBuildState {
  lastBuildCheck: number;
  lastCleanupCheck: number;
}

const BUILD_CHECK_INTERVAL = 20;
const CLEANUP_CHECK_INTERVAL = 100;
const MAX_SITES_PER_CHECK = 3;

export class ExtensionBuilder {
  buildExtensionsForRoom(room: Room) {
    if (!room.controller || !room.controller.my) return;

    const statePath = `rooms.${room.name}.extensionBuildState`;
    const state = MemoryManager.get<ExtensionBuildState>(statePath, { lastBuildCheck: 0, lastCleanupCheck: 0 });

    if (!state) return;

    if (Game.time - state.lastBuildCheck >= BUILD_CHECK_INTERVAL) {
      this.createExtensionSites(room);
      state.lastBuildCheck = Game.time;
      MemoryManager.set(statePath, state);
    }

    if (Game.time - state.lastCleanupCheck >= CLEANUP_CHECK_INTERVAL) {
      this.cleanupExtensions(room);
      state.lastCleanupCheck = Game.time;
      MemoryManager.set(statePath, state);
    }
  }

  private createExtensionSites(room: Room) {
    const plan = extensionPlanner.planExtensionsForRoom(room);
    if (!plan || plan.positions.length === 0) return;

    const existingExtensions = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_EXTENSION });
    const existingSites = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_EXTENSION });
    
    const existingPositions = new Set<string>();
    for (const ext of existingExtensions) {
      existingPositions.add(`${ext.pos.x},${ext.pos.y}`);
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

      const result = room.createConstructionSite(pos, STRUCTURE_EXTENSION);
      if (result === OK) {
        sitesCreated++;
      }
    }
  }

  private cleanupExtensions(room: Room) {
    const plan = extensionPlanner.planExtensionsForRoom(room);
    if (!plan) return;

    const plannedPositions = new Set<string>();
    for (const posStr of plan.positions) {
      const [x, y] = posStr.split(',').map(Number);
      plannedPositions.add(`${x},${y}`);
    }

    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return;

    const extensions = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_EXTENSION }) as StructureExtension[];
    
    for (const ext of extensions) {
      const key = `${ext.pos.x},${ext.pos.y}`;
      
      const hasBlockingStructure = ext.pos.lookFor(LOOK_STRUCTURES).some(s => 
        s.structureType !== STRUCTURE_EXTENSION && 
        s.structureType !== STRUCTURE_ROAD && 
        s.structureType !== STRUCTURE_RAMPART
      );
      
      if (hasBlockingStructure) {
        ext.destroy();
        continue;
      }

      if (!plannedPositions.has(key)) {
        const distToSpawn = ext.pos.getRangeTo(spawn);
        if (distToSpawn > 10) {
          ext.destroy();
        }
      }
    }

    const sites = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_EXTENSION });
    
    for (const site of sites) {
      const key = `${site.pos.x},${site.pos.y}`;
      
      const hasBlockingStructure = site.pos.lookFor(LOOK_STRUCTURES).some(s => 
        s.structureType !== STRUCTURE_ROAD && 
        s.structureType !== STRUCTURE_RAMPART
      );
      
      if (hasBlockingStructure) {
        site.remove();
        continue;
      }

      if (!plannedPositions.has(key)) {
        const distToSpawn = site.pos.getRangeTo(spawn);
        if (distToSpawn > 10) {
          site.remove();
        }
      }
    }
  }
}

export const extensionBuilder = new ExtensionBuilder();
