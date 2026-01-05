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

// Version string - increment on deploy to clear stale queue
const CODE_VERSION = 'v2025.01.05.1';

// Maximum queue size to prevent CPU death spiral
const MAX_QUEUE_SIZE = 20;

export class SpawnQueue {
  private colony: HighCharity;
  private queue: SpawnRequest[];
  private spawns: StructureSpawn[];
  private requestMap: Map<string, number>; // Map of request ID/name to queue index for O(1) lookup
  private needsSort: boolean; // Defer sorting to run phase
  
  constructor(colony: HighCharity) {
    this.colony = colony;
    this.queue = [];
    this.spawns = colony.spawns;
    this.requestMap = new Map();
    this.needsSort = false;
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
    // CPU guard: skip if bucket is critically low
    // EXCEPT: Always allow EMERGENCY priority (colony survival)
    // EXCEPT: Always allow when no creeps exist (bootstrap situation)
    const totalCreeps = Object.keys(Game.creeps).length;
    if (Game.cpu.bucket < 500 && request.priority !== SpawnPriority.EMERGENCY && totalCreeps > 0) {
      return;
    }
    
    // Limit queue size to prevent CPU death spiral
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      // Only allow EMERGENCY priority when queue is full
      if (request.priority !== SpawnPriority.EMERGENCY) {
        return;
      }
      // Remove lowest priority item to make room for emergency
      const lowestPriorityIndex = this.queue.reduce((maxIdx, r, idx, arr) => 
        r.priority > arr[maxIdx].priority ? idx : maxIdx, 0);
      const removed = this.queue.splice(lowestPriorityIndex, 1)[0];
      this.requestMap.delete(removed.arbiter);
    }
    
    // Deduplicate by ARBITER - each arbiter should only have one pending request
    // This prevents queue bloat when arbiters request every tick with different names
    const existingIndex = this.requestMap.get(request.arbiter);
    
    if (existingIndex !== undefined && existingIndex < this.queue.length) {
      const existing = this.queue[existingIndex];
      // Verify the map is still accurate (defensive check)
      if (existing && existing.arbiter === request.arbiter) {
        // Update with newer request (fresher name, possibly different priority)
        // Always update to keep the request fresh and prevent stale cleanup
        this.queue[existingIndex] = request;
        if (request.priority !== existing.priority) {
          this.needsSort = true; // Mark for re-sorting if priority changed
        }
        return;
      }
    }
    
    // Add to queue and update map (keyed by arbiter)
    const newIndex = this.queue.length;
    this.queue.push(request);
    this.requestMap.set(request.arbiter, newIndex);
    this.needsSort = true; // Defer sorting to run phase
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
    // Always perform cleanup to prevent queue bloat
    this.cleanupStaleRequests();
    
    // CPU guard: minimal operation if bucket is critically low
    if (Game.cpu.bucket < 200) {
      // Just try to spawn the first emergency request if possible
      const spawn = this.spawns.find(s => !s.spawning);
      const emergency = this.queue.find(r => r.priority === SpawnPriority.EMERGENCY);
      if (spawn && emergency) {
        // Try with current body cost
        if (emergency.energyCost <= this.colony.energyAvailable) {
          this.executeSpawn(spawn, emergency);
        } else {
          // Emergency fallback: try minimal body
          const minimalBody = this.getMinimalBody(emergency);
          if (minimalBody) {
            const minimalCost = this.calculateBodyCost(minimalBody);
            if (minimalCost <= this.colony.energyAvailable) {
              emergency.body = minimalBody;
              emergency.energyCost = minimalCost;
              this.executeSpawn(spawn, emergency);
            }
          }
        }
      }
      this.saveQueue(); // Always save to persist removals
      return;
    }
    
    this.colony.memory.spawnQueue!.spawnedThisTick = 0;
    
    // CRITICAL: Get FRESH spawn references directly from room.find()
    // The cached colony.spawns has stale spawn.spawning data!
    this.spawns = this.colony.room.find(FIND_MY_SPAWNS);
    
    // BOOTSTRAP EMERGENCY: If no creeps exist, always try to spawn regardless of bucket
    const roomCreeps = this.colony.room.find(FIND_MY_CREEPS).length;
    if (roomCreeps === 0 && this.queue.length > 0) {
      const spawn = this.spawns.find(s => !s.spawning);
      if (spawn) {
        // Find any request with EMERGENCY priority, or fall back to first request
        const request = this.queue.find(r => r.priority === SpawnPriority.EMERGENCY) || this.queue[0];
        if (request) {
          // Try current body or minimal body
          if (request.energyCost <= this.colony.energyAvailable) {
            console.log(`🆘 BOOTSTRAP: Spawning ${request.name} with ${request.energyCost} energy`);
            this.executeSpawn(spawn, request);
            this.saveQueue();
            return;
          } else {
            const minimalBody = this.getMinimalBody(request);
            if (minimalBody) {
              const minimalCost = this.calculateBodyCost(minimalBody);
              if (minimalCost <= this.colony.energyAvailable) {
                console.log(`🆘 BOOTSTRAP: Spawning minimal ${request.name} with ${minimalCost} energy`);
                request.body = minimalBody;
                request.energyCost = minimalCost;
                this.executeSpawn(spawn, request);
                this.saveQueue();
                return;
              }
            }
          }
        }
      }
    }
    
    // Sort queue if needed (deferred from enqueue calls)
    if (this.needsSort) {
      this.sortQueue();
      this.needsSort = false;
      this.rebuildRequestMap(); // Rebuild map after sort changes indices
    }
    
    // Check for lifecycle spawns (creeps about to die) - skip if CPU is low
    if (Game.cpu.bucket > 1000) {
      this.checkLifecycle();
    }
    
    // Process queue for each available spawn
    for (const spawn of this.spawns) {
      if (spawn.spawning) {
        continue;
      }
      
      // Spawn is available - try to spawn something
      const request = this.getNextSpawnableRequest(spawn);
      if (request) {
        console.log(`🎯 SpawnQueue: Spawning ${request.name} (priority: ${request.priority}, cost: ${request.energyCost})`);
        this.executeSpawn(spawn, request);
      }
    }
    
    // Periodic queue status log (every 50 ticks)
    if (Game.time % 50 === 0 && this.queue.length > 0) {
      const status = this.getStatus();
      console.log(`📋 SpawnQueue [${this.colony.name}]: ${status.queueLength} items, oldest: ${status.oldestRequest} ticks, spawns available: ${status.availableSpawns}`);
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
      // Remove from queue and map
      this.removeFromQueue(request.id);
      console.log(`✅ Spawned ${request.name} (queue: ${this.queue.length} remaining)`);
      
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
    } else if (result === ERR_NAME_EXISTS) {
      // Remove duplicate
      this.removeFromQueue(request.id);
    } else if (result === ERR_NOT_ENOUGH_ENERGY) {
      // Keep in queue, will retry next tick
    } else if (result === ERR_BUSY) {
      // Spawn is busy, will retry next tick
    } else {
      // Unknown error - remove from queue to avoid infinite retries
      this.removeFromQueue(request.id);
    }
  }
  
  /**
   * Remove request from queue and update map
   */
  private removeFromQueue(requestId: string): void {
    const index = this.queue.findIndex(r => r.id === requestId);
    if (index !== -1) {
      const removed = this.queue.splice(index, 1)[0];
      this.requestMap.delete(removed.arbiter);
      // Note: we don't rebuild the entire map here for performance
      // The map may have stale indices but we validate in enqueue()
    }
  }
  
  /**
   * Clean up stale requests - runs every tick during run()
   */
  private cleanupStaleRequests(): void {
    const initialLength = this.queue.length;
    
    this.queue = this.queue.filter(r => {
      const age = Game.time - r.tickRequested;
      
      // Remove if older than 30 ticks
      if (age > 30) return false;
      
      // Remove if creep with this name already exists (was spawned)
      if (Game.creeps[r.name]) return false;
      
      // Remove if replacing a creep that no longer exists and we have other creeps of that role
      // (the creep died but others exist, so not an emergency anymore)
      
      return true;
    });
    
    const removed = initialLength - this.queue.length;
    if (removed > 0) {
      // Rebuild map after cleanup
      this.rebuildRequestMap();
      
      // Log cleanup if significant
      if (removed >= 3 || Game.time % 100 === 0) {
        console.log(`🧹 SpawnQueue cleanup: removed ${removed} stale requests, ${this.queue.length} remaining`);
      }
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
    const memory = this.colony.memory.spawnQueue!;
    
    // Check for code version change - clear stale queue on redeploy
    if ((memory as any).codeVersion !== CODE_VERSION) {
      console.log(`🔄 SpawnQueue: Code version changed, clearing stale queue`);
      this.queue = [];
      (memory as any).codeVersion = CODE_VERSION;
      memory.queue = [];
      return;
    }
    
    const saved = memory.queue;
    if (saved && saved.length > 0) {
      this.queue = saved;
      
      // AGGRESSIVE CLEANUP: Remove old/stale requests
      this.queue = this.queue.filter(r => {
        const age = Game.time - r.tickRequested;
        
        // Remove if older than 30 ticks (reduced from 50 for faster cleanup)
        if (age > 30) return false;
        
        // Remove if creep with this name already exists
        if (Game.creeps[r.name]) return false;
        
        return true;
      });
      
      // Rebuild the request map from loaded queue
      this.rebuildRequestMap();
    }
  }
  
  /**
   * Rebuild request map from queue (after sorting or loading)
   */
  private rebuildRequestMap(): void {
    this.requestMap.clear();
    for (let i = 0; i < this.queue.length; i++) {
      const request = this.queue[i];
      this.requestMap.set(request.arbiter, i);
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
    this.requestMap.clear();
    this.saveQueue();
  }
}
