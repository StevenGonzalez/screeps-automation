// src/structures/storageBuilder.ts
import { MemoryManager } from '../memory/memoryManager';
import { storagePlanner } from './storagePlanner';

interface StorageBuildState {
  lastBuildCheck: number;
  lastCleanupCheck: number;
}

const BUILD_CHECK_INTERVAL = 30;
const CLEANUP_CHECK_INTERVAL = 150;

export class StorageBuilder {
  buildStorageForRoom(room: Room) {
    if (!room.controller || !room.controller.my || room.controller.level < 4) return;

    const statePath = `rooms.${room.name}.storageBuildState`;
    const state = MemoryManager.get<StorageBuildState>(statePath, { lastBuildCheck: 0, lastCleanupCheck: 0 });

    if (!state) return;

    if (Game.time - state.lastBuildCheck >= BUILD_CHECK_INTERVAL) {
      this.createStorageSite(room);
      state.lastBuildCheck = Game.time;
      MemoryManager.set(statePath, state);
    }

    if (Game.time - state.lastCleanupCheck >= CLEANUP_CHECK_INTERVAL) {
      this.cleanupStorage(room);
      state.lastCleanupCheck = Game.time;
      MemoryManager.set(statePath, state);
    }
  }

  private createStorageSite(room: Room) {
    const existingStorage = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_STORAGE });
    if (existingStorage.length > 0) return;

    const existingSites = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_STORAGE });
    if (existingSites.length > 0) return;

    const plan = storagePlanner.planStorageForRoom(room);
    if (!plan || !plan.position) return;

    const [x, y] = plan.position.split(',').map(Number);
    const pos = new RoomPosition(x, y, room.name);

    const hasBlockingStructure = pos.lookFor(LOOK_STRUCTURES).some(s => 
      s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_RAMPART
    );
    
    if (hasBlockingStructure) return;

    room.createConstructionSite(pos, STRUCTURE_STORAGE);
  }

  private cleanupStorage(room: Room) {
    const plan = storagePlanner.planStorageForRoom(room);
    if (!plan || !plan.position) return;

    const [px, py] = plan.position.split(',').map(Number);
    const plannedPos = `${px},${py}`;

    const storage = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_STORAGE }) as StructureStorage[];
    
    for (const store of storage) {
      const key = `${store.pos.x},${store.pos.y}`;
      
      if (key !== plannedPos) {
        store.destroy();
      }
    }

    const sites = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_STORAGE });
    
    for (const site of sites) {
      const key = `${site.pos.x},${site.pos.y}`;
      
      if (key !== plannedPos) {
        site.remove();
      }
    }
  }
}

export const storageBuilder = new StorageBuilder();
