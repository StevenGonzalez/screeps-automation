/**
 * ARBITER - Creep Controller Base Class
 * 
 * "They are the will of the Prophets"
 * 
 * Arbiters are responsible for managing groups of Elites (creeps) to accomplish
 * specific tasks. Each Arbiter specializes in a particular role (mining, building,
 * defense, logistics, etc.)
 * 
 * Based on Overmind's Overlord pattern but with unique COVENANT theming.
 */

/// <reference types="@types/screeps" />

import { HighCharity } from '../core/HighCharity';
import { Elite } from '../elites/Elite';

export interface ArbiterMemory {
  role: string;
  arbiter?: string;
  highCharity?: string;
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
    scout: 501
  }
};

/**
 * Base class for all Arbiters
 */
export abstract class Arbiter {
  highCharity: HighCharity;
  name: string;
  ref: string; // Unique reference for this Arbiter
  priority: number;
  room: Room;
  pos: RoomPosition;
  
  memory: ArbiterMemory;
  elites: Elite[];
  
  constructor(
    highCharity: HighCharity,
    name: string,
    priority: number = ArbiterPriority.support.worker
  ) {
    this.highCharity = highCharity;
    this.name = name;
    this.priority = priority;
    this.room = highCharity.room;
    this.pos = highCharity.room.controller?.pos || new RoomPosition(25, 25, highCharity.name);
    this.ref = `${highCharity.name}:${name}`;
    
    // Initialize memory
    if (!Memory.rooms[highCharity.name]) {
      Memory.rooms[highCharity.name] = {} as any;
    }
    const roomMem: any = Memory.rooms[highCharity.name];
    if (!roomMem.arbiters) {
      roomMem.arbiters = {};
    }
    if (!roomMem.arbiters[name]) {
      roomMem.arbiters[name] = {};
    }
    this.memory = roomMem.arbiters[name];
    
    this.elites = [];
    
    // Register with High Charity
    highCharity.arbiters[name] = this;
    
    // Register with Covenant
    const cov = (Game as any).cov;
    if (cov) {
      cov.registerArbiter(this);
    }
  }
  
  /**
   * Refresh creep references and wrap them as Elites
   */
  refresh(): void {
    this.elites = this.getCreepsForRole().map(creep => new Elite(creep, this));
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
   * Request to spawn a creep with specific body parts
   */
  protected requestSpawn(
    body: BodyPartConstant[],
    name: string,
    memory: CreepMemory = {} as any
  ): void {
    const spawn = this.highCharity.primarySpawn;
    if (!spawn) {
      if (Game.time % 50 === 0) {
        console.log(`⚠️ ${this.print}: No spawn available`);
      }
      return;
    }
    
    if (spawn.spawning) return;
    
    // Add Arbiter reference to memory
    const spawnMemory: any = {
      ...memory,
      arbiter: this.ref,
      highCharity: this.highCharity.name
    };
    
    const result = spawn.spawnCreep(body, name, { memory: spawnMemory });
    
    if (result === OK) {
      console.log(`✨ ${this.print}: Spawning ${name} [${memory.role}]`);
    } else if (result === ERR_NOT_ENOUGH_ENERGY && Game.time % 100 === 0) {
      console.log(`⚡ ${this.print}: Need ${this.highCharity.energyAvailable}/${this.highCharity.energyCapacity} energy for ${name}`);
    } else if (result < 0 && Game.time % 100 === 0) {
      console.log(`❌ ${this.print}: Spawn failed for ${name} - Error ${result}`);
    }
  }
  
  /**
   * Calculate optimal body parts based on available energy
   */
  protected calculateBody(
    pattern: BodyPartConstant[],
    maxRepeats: number = 10
  ): BodyPartConstant[] {
    const energy = this.highCharity.energyCapacity;
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
