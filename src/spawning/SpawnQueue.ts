/**
 * SpawnQueue - Priority-based Spawn Management
 * 
 * "The Hierarchs ordain, and new life is granted to serve the Great Journey"
 * 
 * Central spawn queue manager that handles all spawn requests for a colony.
 * Prioritizes critical spawns (defense, emergency) over routine spawns.
 * Optimizes body configurations based on available energy.
 * Balances load across multiple spawns.
 * 
 * Priority Levels:
 * 1. EMERGENCY - Colony survival (initial hauler, emergency defenders)
 * 2. DEFENSE - Active threats (defenders, healers)
 * 3. CRITICAL - Core economy (miners, haulers when none exist)
 * 4. ECONOMY - Normal operations (builders, upgraders, replacements)
 * 5. EXPANSION - Growth (pioneers, claimers)
 * 6. MILITARY - Offensive operations (attackers, scouts)
 */

import { HighCharity } from '../core/HighCharity';
import { RoleHelpers } from '../constants/Roles';

export enum SpawnPriority {
  EMERGENCY = 1,
  DEFENSE = 2,
  CRITICAL = 3,
  ECONOMY = 4,
  EXPANSION = 5,
  MILITARY = 6
}

export interface SpawnRequest {
  id: string;
  priority: SpawnPriority;
  body: BodyPartConstant[];
  name: string;
  memory: CreepMemory;
  arbiter: string;
  important: boolean;
  energyCost: number;
  tickRequested: number;
  replacingCreep?: string; // Name of creep being replaced
}

export interface SpawnQueueMemory {
  queue: SpawnRequest[];
  spawnedThisTick: number;
  totalSpawned: number;
  statistics: {
    byPriority: { [priority: number]: number };
    byArbiter: { [arbiter: string]: number };
    averageWaitTime: number;
  };
}

export class SpawnQueue {
  private colony: HighCharity;
  private queue: SpawnRequest[];
  private spawns: StructureSpawn[];
  
  constructor(colony: HighCharity) {
    this.colony = colony;
    this.queue = [];
    this.spawns = colony.spawns;
    this.initializeMemory();
    this.loadQueue();
  }

  /**
   * Initialize memory structure
   */
  private initializeMemory(): void {
    if (!this.colony.memory.spawnQueue) {
      this.colony.memory.spawnQueue = {
        queue: [],
        spawnedThisTick: 0,
        totalSpawned: 0,
        statistics: {
          byPriority: {},
          byArbiter: {},
          averageWaitTime: 0
        }
      };
    }
  }

  /**
   * Add spawn request to queue
   */
  public enqueue(request: SpawnRequest): void {
    // Check for duplicate requests
    const existingIndex = this.queue.findIndex(r => 
      r.name === request.name || 
      (r.arbiter === request.arbiter && r.replacingCreep === request.replacingCreep)
    );
    
    if (existingIndex !== -1) {
      // Update priority if higher
      if (request.priority < this.queue[existingIndex].priority) {
        this.queue[existingIndex] = request;
      }
      return;
    }
    
    this.queue.push(request);
    this.sortQueue();
  }

  /**
   * Sort queue by priority
   */
  private sortQueue(): void {
    this.queue.sort((a, b) => {
      // First by priority (lower number = higher priority)
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      
      // Then by important flag
      if (a.important !== b.important) {
        return a.important ? -1 : 1;
      }
      
      // Finally by request time (FIFO)
      return a.tickRequested - b.tickRequested;
    });
  }

  /**
   * Process spawn queue
   */
  public run(): void {
    this.colony.memory.spawnQueue!.spawnedThisTick = 0;
    
    // Refresh spawn references (colony.spawns updated during build phase)
    this.spawns = this.colony.spawns;
    
    
    // DEBUG: Log queue status
    if (this.queue.length > 0) {
      console.log(`🔱 ${this.colony.name}: Queue has ${this.queue.length} requests`);
      for (const req of this.queue.slice(0, 3)) {
        console.log(`  - ${req.name} (${req.memory.role}) Priority ${req.priority}, Cost: ${req.energyCost}, Available: ${this.colony.energyAvailable}`);
      }
    } else {
      console.log(`🔱 ${this.colony.name}: Spawn queue is empty. Creeps: ${this.colony.elites.length}`);
    }
    
    // Check for lifecycle spawns (creeps about to die)
    this.checkLifecycle();
    
    // Process queue for each available spawn
    for (const spawn of this.spawns) {
      if (spawn.spawning) continue;
      
      const request = this.getNextSpawnableRequest(spawn);
      if (request) {
        this.executeSpawn(spawn, request);
      }
    }
    
    // Save queue to memory
    this.saveQueue();
  }

  /**
   * Get next spawnable request
   */
  private getNextSpawnableRequest(spawn: StructureSpawn): SpawnRequest | null {
    const availableEnergy = this.colony.energyAvailable;
    
    // Emergency spawns can use any energy
    for (const request of this.queue) {
      if (request.priority === SpawnPriority.EMERGENCY) {
        // Try to spawn with available energy, or scale down body
        if (request.energyCost <= availableEnergy) {
          return request;
        }
        
        // Emergency fallback: spawn minimal body
        const minimalBody = this.getMinimalBody(request);
        if (minimalBody) {
          request.body = minimalBody;
          request.energyCost = this.calculateBodyCost(minimalBody);
          return request;
        }
      }
    }
    
    // Defense spawns wait for 60% capacity
    const defenseThreshold = this.colony.energyCapacity * 0.6;
    for (const request of this.queue) {
      if (request.priority === SpawnPriority.DEFENSE && availableEnergy >= defenseThreshold) {
        if (request.energyCost <= availableEnergy) {
          return request;
        }
      }
    }
    
    // Critical/Economy spawns wait for 80% capacity (unless important)
    const economyThreshold = this.colony.energyCapacity * 0.8;
    for (const request of this.queue) {
      if (request.priority === SpawnPriority.CRITICAL || request.priority === SpawnPriority.ECONOMY) {
        if (request.important || availableEnergy >= economyThreshold) {
          if (request.energyCost <= availableEnergy) {
            return request;
          }
        }
      }
    }
    
    // Expansion/Military spawns wait for full capacity
    if (availableEnergy >= this.colony.energyCapacity) {
      for (const request of this.queue) {
        if (request.priority === SpawnPriority.EXPANSION || request.priority === SpawnPriority.MILITARY) {
          if (request.energyCost <= availableEnergy) {
            return request;
          }
        }
      }
    }
    
    return null;
  }

  /**
   * Execute spawn
   */
  private executeSpawn(spawn: StructureSpawn, request: SpawnRequest): void {
    const result = spawn.spawnCreep(request.body, request.name, { memory: request.memory });
    
    if (result === OK) {
      // Remove from queue
      this.queue = this.queue.filter(r => r.id !== request.id);
      
      // Update statistics
      const memory = this.colony.memory.spawnQueue!;
      memory.spawnedThisTick++;
      memory.totalSpawned++;
      
      if (!memory.statistics.byPriority[request.priority]) {
        memory.statistics.byPriority[request.priority] = 0;
      }
      memory.statistics.byPriority[request.priority]++;
      
      if (!memory.statistics.byArbiter[request.arbiter]) {
        memory.statistics.byArbiter[request.arbiter] = 0;
      }
      memory.statistics.byArbiter[request.arbiter]++;
      
      const waitTime = Game.time - request.tickRequested;
      memory.statistics.averageWaitTime = 
        (memory.statistics.averageWaitTime * (memory.totalSpawned - 1) + waitTime) / memory.totalSpawned;
      
      console.log(
        `✅ ${this.colony.name}: Spawned ${request.name} (Priority ${request.priority}, ` +
        `waited ${waitTime} ticks, ${this.queue.length} left in queue)`
      );
    } else if (result === ERR_NAME_EXISTS) {
      // Remove duplicate
      this.queue = this.queue.filter(r => r.id !== request.id);
      console.log(`⚠️ ${this.colony.name}: Removed duplicate spawn request ${request.name}`);
    } else if (result === ERR_NOT_ENOUGH_ENERGY) {
      // Keep in queue, will retry next tick
      console.log(`⏳ ${this.colony.name}: Not enough energy for ${request.name} (need ${request.energyCost}, have ${this.colony.energyAvailable})`);
    } else if (result === ERR_BUSY) {
      // Spawn is busy, will retry next tick
    } else {
      // Unknown error - log it and remove from queue to avoid infinite retries
      console.log(`❌ ${this.colony.name}: Failed to spawn ${request.name}, error: ${result}`);
      this.queue = this.queue.filter(r => r.id !== request.id);
    }
  }

  /**
   * Check creep lifecycle and add replacement requests
   */
  private checkLifecycle(): void {
    const creeps = this.colony.elites;
    const threshold = 50; // Spawn replacement 50 ticks before death
    
    for (const creep of creeps) {
      if (!creep.ticksToLive) continue;
      if (creep.ticksToLive > threshold) continue;
      
      // Check if already in queue
      const inQueue = this.queue.some(r => r.replacingCreep === creep.name);
      if (inQueue) continue;
      
      // Request replacement from arbiter
      // Arbiters should handle this automatically, but we track it here
    }
  }

  /**
   * Get minimal emergency body
   */
  private getMinimalBody(request: SpawnRequest): BodyPartConstant[] | null {
    const availableEnergy = this.colony.energyAvailable;
    
    // Determine role from memory
    const role = request.memory.role || '';
    
    // Minimal bodies for different roles
    if (RoleHelpers.isGrunt(role)) {
      // Grunt: 1 work, 1 carry, 1 move (200)
      if (availableEnergy >= 200) {
        return [WORK, CARRY, MOVE];
      }
    }
    
    if (RoleHelpers.isHauler(role)) {
      // Minimal hauler: 1 carry, 1 move
      if (availableEnergy >= 100) {
        return [CARRY, MOVE];
      }
    }
    
    if (RoleHelpers.isMiner(role)) {
      // Minimal miner: 1 work, 1 move
      if (availableEnergy >= 150) {
        return [WORK, MOVE];
      }
    }
    
    if (RoleHelpers.isBuilder(role)) {
      // Minimal builder: 1 work, 1 carry, 1 move
      if (availableEnergy >= 200) {
        return [WORK, CARRY, MOVE];
      }
    }
    
    if (RoleHelpers.isUpgrader(role)) {
      // Minimal upgrader: 1 work, 1 carry, 1 move
      if (availableEnergy >= 200) {
        return [WORK, CARRY, MOVE];
      }
    }
    
    if (RoleHelpers.isDefender(role)) {
      // Minimal defender: 1 attack, 1 move
      if (availableEnergy >= 130) {
        return [ATTACK, MOVE];
      }
    }
    
    return null;
  }

  /**
   * Calculate body cost
   */
  private calculateBodyCost(body: BodyPartConstant[]): number {
    const costs: { [part: string]: number } = {
      [MOVE]: 50,
      [WORK]: 100,
      [CARRY]: 50,
      [ATTACK]: 80,
      [RANGED_ATTACK]: 150,
      [HEAL]: 250,
      [CLAIM]: 600,
      [TOUGH]: 10
    };
    
    return body.reduce((sum, part) => sum + (costs[part] || 0), 0);
  }

  /**
   * Save queue to memory
   */
  private saveQueue(): void {
    this.colony.memory.spawnQueue!.queue = this.queue;
  }

  /**
   * Load queue from memory
   */
  private loadQueue(): void {
    const saved = this.colony.memory.spawnQueue!.queue;
    if (saved && saved.length > 0) {
      this.queue = saved;
      
      // Clean up old requests (>500 ticks old)
      this.queue = this.queue.filter(r => Game.time - r.tickRequested < 500);
    }
  }

  /**
   * Get queue status
   */
  public getStatus(): {
    queueLength: number;
    byPriority: { [priority: number]: number };
    oldestRequest: number;
    availableSpawns: number;
  } {
    const byPriority: { [priority: number]: number } = {};
    let oldestTick = Game.time;
    
    for (const request of this.queue) {
      byPriority[request.priority] = (byPriority[request.priority] || 0) + 1;
      if (request.tickRequested < oldestTick) {
        oldestTick = request.tickRequested;
      }
    }
    
    return {
      queueLength: this.queue.length,
      byPriority,
      oldestRequest: Game.time - oldestTick,
      availableSpawns: this.spawns.filter(s => !s.spawning).length
    };
  }

  /**
   * Clear queue
   */
  public clear(): void {
    this.queue = [];
    this.saveQueue();
  }
}
