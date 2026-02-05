/**
 * ARBITER - Creep Controller Base Class
 * 
 * "They are the will of the Prophets"
 * 
 * Arbiters are responsible for managing groups of Warriors (creeps) to accomplish
 * specific tasks. Each Arbiter specializes in a particular role (mining, building,
 * defense, logistics, etc.)
 */

/// <reference types="@types/screeps" />

import { Nexus } from '../core/Nexus';
import { Warrior } from '../Warriors/Warrior';
import { SpawnPriority, SpawnRequest } from '../spawning/SpawnQueue';

export interface ArbiterMemory {
  role: string;
  arbiter?: string;
  Nexus?: string;
  [key: string]: any;
}

/**
 * Priority levels for Arbiters
 */
export const ArbiterPriority = {
  emergency: {
    bootstrap: 0
  },
  core: {
    spawning: 100,
    queen: 101
  },
  defense: {
    tower: 200,
    melee: 201,
    ranged: 202
  },
  economy: {
    mining: 300,
    hauling: 301,
    upgrading: 302
  },
  support: {
    worker: 400,
    builder: 401,
    repairer: 402
  },
  expansion: {
    claimer: 500,
    scout: 501,
    ranger: 501
  }
};

/**
 * Base class for all Arbiters
 */
export abstract class Arbiter {
  Nexus: Nexus;
  name: string;
  ref: string; // Unique reference for this Arbiter
  priority: number;
  room: Room;
  pos: RoomPosition;
  
  memory: ArbiterMemory;
  warriors: Warrior[];
  
  constructor(
    Nexus: Nexus,
    name: string,
    priority: number = ArbiterPriority.support.worker
  ) {
    this.Nexus = Nexus;
    this.name = name;
    this.priority = priority;
    this.room = Nexus.room;
    this.pos = Nexus.room.controller?.pos || new RoomPosition(25, 25, Nexus.name);
    this.ref = `${Nexus.name}:${name}`;
    
    // Initialize memory
    if (!Memory.rooms[Nexus.name]) {
      Memory.rooms[Nexus.name] = {} as any;
    }
    const roomMem: any = Memory.rooms[Nexus.name];
    if (!roomMem.arbiters) {
      roomMem.arbiters = {};
    }
    if (!roomMem.arbiters[name]) {
      roomMem.arbiters[name] = {};
    }
    this.memory = roomMem.arbiters[name];
    
    this.warriors = [];
    
    // Register with Nexus
    Nexus.arbiters[name] = this;
    
    // Register with KHALA
    const cov = (Game as any).cov;
    if (cov) {
      cov.registerArbiter(this);
    }
  }
  
  /**
   * Refresh creep references and wrap them as Warriors
   */
  refresh(): void {
    this.warriors = this.getCreepsForRole().map(creep => new Warrior(creep, this));
  }
  
  /**
   * Get all creeps assigned to this Arbiter
   * Override in child classes for specific filtering
   */
  protected getCreepsForRole(): Creep[] {
    return this.room.find(FIND_MY_CREEPS, {
      filter: (creep) => creep.memory.arbiter === this.ref
    });
  }
  
  /**
   * Initialize phase - called once per tick before run()
   * Override in child classes
   */
  abstract init(): void;
  
  /**
   * Run phase - execute the Arbiter's logic
   * Override in child classes
   */
  abstract run(): void;
  
  /**
   * Request to spawn a creep with specific body parts (via SpawnQueue)
   */
  protected requestSpawn(
    body: BodyPartConstant[],
    name: string,
    memory: CreepMemory = {} as any,
    priority: SpawnPriority = SpawnPriority.ECONOMY,
    important: boolean = false
  ): void {
    const spawnQueue = this.Nexus.spawnQueue;
    if (!spawnQueue) {
      if (Game.time % 50 === 0) {
        console.log(`⚠️ ${this.print}: No SpawnQueue available`);
      }
      return;
    }
    
    // Add Arbiter reference to memory
    const spawnMemory: any = {
      ...memory,
      arbiter: this.ref,
      Nexus: this.Nexus.name
    };
    
    // Calculate energy cost
    const energyCost = body.reduce((sum, part) => sum + BODYPART_COST[part], 0);
    
    // Create spawn request
    const request: SpawnRequest = {
      id: `${this.ref}_${name}_${Game.time}`,
      priority,
      body,
      name,
      memory: spawnMemory,
      arbiter: this.ref,  // Use full ref for proper deduplication per arbiter instance
      important,
      energyCost,
      tickRequested: Game.time
    };
    
    // Add to queue
    spawnQueue.enqueue(request);
  }
  
  /**
   * Calculate optimal body parts based on available energy
   */
  protected calculateBody(
    pattern: BodyPartConstant[],
    maxRepeats: number = 10
  ): BodyPartConstant[] {
    const energy = this.Nexus.energyCapacity;
    const patternCost = pattern.reduce((sum, part) => sum + BODYPART_COST[part], 0);
    const repeats = Math.min(maxRepeats, Math.floor(energy / patternCost));
    
    const body: BodyPartConstant[] = [];
    for (let i = 0; i < repeats; i++) {
      body.push(...pattern);
    }
    
    return body;
  }
  
  /**
   * Get the print representation of this Arbiter
   */
  get print(): string {
    return `<a href="#!/room/${Game.shard.name}/${this.room.name}">[${this.name}]</a>`;
  }
}
