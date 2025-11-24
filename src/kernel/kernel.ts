// src/kernel/kernel.ts
import { MemoryManager } from '../memory/memoryManager';
import { Scheduler } from './scheduler';
import { spawnManager } from '../spawning/spawnManager';
import { creepManager } from '../creeps/creepManager';

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
          console.log(`Diag ${r.name}: creeps=${creepCount}, spawnQueue=${q.length}`);
        }
      } catch (e) { console.log('Diagnostics error: ' + e); }
    }, 100);
  }

  tick() {
    MemoryManager.reset();

    try {
      this.runTick();
    } catch (err) {
      console.log('Kernel error: ' + err);
    }

    this.scheduler.run();

    MemoryManager.flush();
  }

  runTick() {
    spawnManager.run();
    creepManager.run();
  }
}

export const kernel = new Kernel();
