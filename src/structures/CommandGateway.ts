/**
 * COMMAND Gateway - Colony Command Center
 * 
 * "The heart of the Nexus beats here"
 * 
 * A Command Gateway manages the core colony structures:
 * - Primary spawn
 * - Storage
 * - Terminal
 * - Links (for energy distribution)
 * - Power Spawn
 */

/// <reference types="@types/screeps" />

import { Gateway } from './Gateway';
import { Nexus } from '../core/Nexus';

interface SpawnRequest {
  priority: number;
  name: string;
  body: BodyPartConstant[];
  memory: CreepMemory;
  arbiter: string;
}

/**
 * Command Gateway - Manages core colony structures
 */
export class CommandGateway extends Gateway {
  spawn: StructureSpawn | null;
  storage: StructureStorage | null;
  terminal: StructureTerminal | null;
  powerSpawn: StructurePowerSpawn | null;
  links: StructureLink[];
  spawnQueue: SpawnRequest[];
  
  constructor(Nexus: Nexus) {
    // Center on primary spawn or storage
    const anchor = Nexus.primarySpawn || Nexus.storage;
    const pos = anchor?.pos || new RoomPosition(25, 25, Nexus.name);
    
    super(Nexus, pos);
    
    this.spawn = null;
    this.storage = null;
    this.terminal = null;
    this.powerSpawn = null;
    this.links = [];
    this.spawnQueue = [];
  }
  
  init(): void {
    // Gather references to key structures
    this.spawn = this.Nexus.primarySpawn || null;
    this.storage = this.Nexus.storage || null;
    this.terminal = this.Nexus.terminal || null;
    
    // Find power spawn
    const powerSpawns = this.room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_POWER_SPAWN
    }) as StructurePowerSpawn[];
    this.powerSpawn = powerSpawns[0] || null;
    
    // Find central links
    if (this.storage) {
      this.links = this.storage.pos.findInRange(FIND_MY_STRUCTURES, 2, {
        filter: (s) => s.structureType === STRUCTURE_LINK
      }) as StructureLink[];
    }
  }
  
  run(): void {
    // Process spawn queue
    this.processSpawnQueue();
    
    // Link operations
    this.manageLinks();
    
    // Terminal operations (if implemented)
    // this.manageTerminal();
    
    // Power spawn operations (if implemented)
    // this.managePowerSpawn();
  }
  
  /**
   * Add a spawn request to the queue (with duplicate checking)
   */
  addSpawnRequest(priority: number, name: string, body: BodyPartConstant[], memory: CreepMemory, arbiter: string): void {
    // Check if this arbiter already has a pending request
    const existingRequest = this.spawnQueue.find(r => r.arbiter === arbiter);
    if (existingRequest) {
      // Request already exists, don't add duplicate
      return;
    }
    
    this.spawnQueue.push({ priority, name, body, memory, arbiter });
  }
  
  /**
   * Process spawn queue with priority
   */
  private processSpawnQueue(): void {
    if (!this.spawn || this.spawn.spawning) return;
    if (this.spawnQueue.length === 0) return;
    
    // Sort queue by priority (lowest number = highest priority)
    this.spawnQueue.sort((a, b) => a.priority - b.priority);
    
    // Try to spawn highest priority request
    const request = this.spawnQueue[0];
    const result = this.spawn.spawnCreep(request.body, request.name, { memory: request.memory });
    
    if (result === OK) {
      this.spawnQueue.shift(); // Remove from queue
      console.log(`✨ [CommandGateway] Spawning ${request.name} (priority: ${request.priority})`);
    } else if (result === ERR_NOT_ENOUGH_ENERGY) {
      // Keep in queue, try again next tick
    } else {
      // Other error, remove from queue
      this.spawnQueue.shift();
      console.log(`❌ [CommandGateway] Failed to spawn ${request.name}: ${result}`);
    }
  }
  
  private manageLinks(): void {
    if (this.links.length === 0) return;
    
    // Find the central link (nearest to storage)
    const centralLink = this.storage ? 
      this.storage.pos.findClosestByRange(this.links) : 
      this.links[0];
    
    if (!centralLink) return;
    
    // Receive energy from remote links
    // (Remote links would be managed by MiningGateways)
    
    // Distribute energy to controller link if it exists
    const controllerLink = this.room.controller?.pos.findInRange(FIND_MY_STRUCTURES, 3, {
      filter: (s) => s.structureType === STRUCTURE_LINK
    })[0] as StructureLink | undefined;
    
    if (controllerLink && 
        centralLink.store.getUsedCapacity(RESOURCE_ENERGY) > 400 &&
        controllerLink.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
      centralLink.transferEnergy(controllerLink);
    }
  }
  
  /**
   * Check if we need energy delivered to the command center
   */
  get needsEnergy(): boolean {
    // Check if spawn/extensions need energy
    const spawns = this.room.find(FIND_MY_SPAWNS, {
      filter: (s) => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });
    
    const extensions = this.room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_EXTENSION &&
                     (s as StructureExtension).store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });
    
    return spawns.length > 0 || extensions.length > 0;
  }
  
  /**
   * Check if storage has excess energy
   */
  get hasExcessEnergy(): boolean {
    if (!this.storage) return false;
    return this.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 50000;
  }
}
