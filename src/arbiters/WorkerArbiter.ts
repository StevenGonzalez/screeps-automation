/**
 * WORKER ARBITER - Controller Upgrading Manager
 * 
 * "For the glory of the Prophets"
 * 
 * Manages worker Elites that upgrade the room controller.
 * Critical for RCL progression and maintaining downgrade timer.
 */

/// <reference types="@types/screeps" />

import { Arbiter, ArbiterPriority } from './Arbiter';
import { HighCharity } from '../core/HighCharity';
import { Elite } from '../elites/Elite';

/**
 * Worker Arbiter - Manages controller upgrading
 */
export class WorkerArbiter extends Arbiter {
  workers: Elite[];
  
  constructor(highCharity: HighCharity) {
    super(highCharity, 'worker', ArbiterPriority.economy.upgrading);
    this.workers = [];
  }
  
  init(): void {
    this.refresh();
    
    // Request workers if needed
    const desiredWorkers = this.calculateDesiredWorkers();
    const currentWorkers = this.workers.length;
    
    if (currentWorkers < desiredWorkers) {
      this.requestWorker();
    }
  }
  
  run(): void {
    for (const worker of this.workers) {
      this.runWorker(worker);
    }
  }
  
  private runWorker(worker: Elite): void {
    const controller = this.room.controller;
    if (!controller) return;
    
    // State machine: harvesting → upgrading
    if (worker.memory.upgrading && worker.needsEnergy) {
      worker.memory.upgrading = false;
    }
    if (!worker.memory.upgrading && worker.isFull) {
      worker.memory.upgrading = true;
    }
    
    if (worker.memory.upgrading) {
      // Upgrade the controller
      const result = worker.upgradeController();
      if (result === OK) {
        worker.say('⚡');
      }
    } else {
      // Get energy
      this.getEnergy(worker);
    }
  }
  
  private getEnergy(worker: Elite): void {
    // Priority: Containers > Storage > Harvest directly
    
    // Find nearby container with energy
    const container = worker.pos.findClosestByPath(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
                     s.store.getUsedCapacity(RESOURCE_ENERGY) > 50
    }) as StructureContainer | null;
    
    if (container) {
      worker.withdrawFrom(container);
      worker.say('🔋');
      return;
    }
    
    // Use storage if available and we're high RCL
    if (this.highCharity.storage && 
        this.highCharity.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 5000) {
      worker.withdrawFrom(this.highCharity.storage);
      worker.say('🏦');
      return;
    }
    
    // Find dropped resources
    const dropped = worker.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
      filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50
    });
    
    if (dropped) {
      if (worker.pos.isNearTo(dropped)) {
        worker.pickup(dropped);
      } else {
        worker.goTo(dropped);
      }
      worker.say('💎');
      return;
    }
    
    // Last resort: Harvest directly (early game)
    const source = worker.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (source) {
      worker.harvestSource(source);
      worker.say('⛏️');
    }
  }
  
  private calculateDesiredWorkers(): number {
    const phase = this.highCharity.memory.phase;
    const controller = this.room.controller;
    
    if (!controller) return 0;
    
    // Adjust based on downgrade timer
    const ticksToDowngrade = controller.ticksToDowngrade || 0;
    const urgentUpgrade = ticksToDowngrade < 5000;
    
    // Bootstrap: 1-2 workers
    if (phase === 'bootstrap') {
      return urgentUpgrade ? 2 : 1;
    }
    
    // Developing: 2-3 workers
    if (phase === 'developing') {
      return urgentUpgrade ? 3 : 2;
    }
    
    // Mature: 2-4 workers (push for RCL 8)
    if (phase === 'mature') {
      return urgentUpgrade ? 4 : 3;
    }
    
    // Powerhouse: 1-2 workers (just maintain)
    return urgentUpgrade ? 2 : 1;
  }
  
  private requestWorker(): void {
    const body = this.calculateWorkerBody();
    const name = `worker_${Game.time}`;
    
    this.requestSpawn(body, name, {
      role: 'elite_worker', // Covenant themed role
      upgrading: false
    } as any);
  }
  
  private calculateWorkerBody(): BodyPartConstant[] {
    const energy = this.highCharity.energyCapacity;
    
    // Early game: Small worker
    if (energy < 400) {
      return [WORK, CARRY, MOVE, MOVE];
    }
    
    // Mid game: Balanced worker
    if (energy < 800) {
      return [WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE];
    }
    
    // Late game: Large worker (3 WORK per CARRY for efficiency)
    const pattern: BodyPartConstant[] = [WORK, WORK, WORK, CARRY, MOVE, MOVE];
    return this.calculateBody(pattern, 5);
  }
  
  protected getCreepsForRole(): Creep[] {
    return this.room.find(FIND_MY_CREEPS, {
      filter: (creep) => 
        creep.memory.arbiter === this.ref ||
        creep.memory.role === 'worker' ||
        creep.memory.role === 'upgrader'
    });
  }
}
