// src/kernel/kernel.ts
import { MemoryManager } from '../memory/memoryManager';
import { Scheduler } from './scheduler';
import { spawnManager } from '../spawning/spawnManager';
import { creepManager } from '../creeps/creepManager';
import { structureManager } from '../structures/structureManager';
import { towerManager } from '../structures/towerManager';
import { pixelManager } from '../economy/pixelManager';
import * as haulerRole from '../creeps/roles/hauler';
import { RoomCache } from '../utils/roomCache';

export class Kernel {
  scheduler: Scheduler;

  constructor() {
    this.scheduler = new Scheduler();
    this.scheduler.schedule('diagnostics', () => {
      try {
        const rooms = Object.values(Game.rooms);
        for (const r of rooms) {
          const q = MemoryManager.get<any[]>(`rooms.${r.name}.spawnQueue`, []) || [];
          const creepCount = Object.values(Game.creeps).filter(c => c.room.name === r.name).length;
        }
      } catch (e) { console.log('Diagnostics error: ' + e); }
    }, 100);
  }

  tick() {
    MemoryManager.reset();
    
    // Clean up hauler reservations at start of tick
    haulerRole.cleanupReservations();
    
    // Clean up old room caches
    RoomCache.cleanup();

    try {
      this.runTick();
    } catch (err) {
      console.log('Kernel error: ' + err);
    }

    this.scheduler.run();

    MemoryManager.flush();
  }

  runTick() {
    pixelManager.run();
    towerManager.run();
    structureManager.run();
    spawnManager.run();
    creepManager.run();
  }
}

export const kernel = new Kernel();
