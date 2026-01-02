/**
 * BOOST TEMPLE - Creep Enhancement Sanctum
 * 
 * "Through sacred alchemy, the Elites shall transcend their mortal limits"
 * 
 * Manages boosting operations for creeps, providing powerful enhancements
 * to their capabilities through mineral compounds.
 */

/// <reference types="@types/screeps" />

import { Temple } from './Temple';
import { HighCharity } from '../core/HighCharity';

export interface BoostRequest {
  creepName: string;
  boosts: ResourceConstant[];
  priority: number;
  role: string;
}

export interface BoostTempleMemory {
  boostQueue: BoostRequest[];
  activeBoosts: { [creepName: string]: ResourceConstant[] };
}

/**
 * Boost configurations for different roles
 */
export const BOOST_CONFIGS: { [role: string]: ResourceConstant[] } = {
  // Combat boosts
  'elite_attacker': [RESOURCE_UTRIUM_HYDRIDE, RESOURCE_GHODIUM_OXIDE, RESOURCE_ZYNTHIUM_OXIDE],  // UH2O, GO, ZO
  'elite_defender': [RESOURCE_UTRIUM_HYDRIDE, RESOURCE_GHODIUM_OXIDE, RESOURCE_LEMERGIUM_OXIDE], // UH2O, GO, LO
  'elite_healer': [RESOURCE_LEMERGIUM_OXIDE, RESOURCE_LEMERGIUM_ALKALIDE, RESOURCE_GHODIUM_OXIDE], // LO, LHO2, GO
  
  // Economic boosts
  'elite_miner': [RESOURCE_UTRIUM_OXIDE], // UO - +50% harvest
  'elite_upgrader': [RESOURCE_GHODIUM_HYDRIDE], // GH - +50% upgrade
  'elite_builder': [RESOURCE_LEMERGIUM_HYDRIDE, RESOURCE_ZYNTHIUM_HYDRIDE], // LH, ZH - build/repair speed + move
  'elite_hauler': [RESOURCE_KEANIUM_OXIDE], // KO - +50% carry
  
  // Remote operations
  'elite_remoteMiner': [RESOURCE_UTRIUM_OXIDE, RESOURCE_KEANIUM_OXIDE], // UO, KO
  'elite_claimer': [RESOURCE_GHODIUM_HYDRIDE], // GH - faster claiming
  
  // Mineral operations
  'elite_mineralMiner': [RESOURCE_UTRIUM_OXIDE], // UO
};

/**
 * Boost tier priorities (higher tier = better but more expensive)
 */
const BOOST_TIERS: { [boost: string]: number } = {
  // Tier 1 (T1) - Basic boosts
  [RESOURCE_UTRIUM_HYDRIDE]: 1,
  [RESOURCE_UTRIUM_OXIDE]: 1,
  [RESOURCE_KEANIUM_HYDRIDE]: 1,
  [RESOURCE_KEANIUM_OXIDE]: 1,
  [RESOURCE_LEMERGIUM_HYDRIDE]: 1,
  [RESOURCE_LEMERGIUM_OXIDE]: 1,
  [RESOURCE_ZYNTHIUM_HYDRIDE]: 1,
  [RESOURCE_ZYNTHIUM_OXIDE]: 1,
  [RESOURCE_GHODIUM_HYDRIDE]: 1,
  [RESOURCE_GHODIUM_OXIDE]: 1,
  
  // Tier 2 (T2) - Advanced boosts (2x effect)
  [RESOURCE_UTRIUM_ACID]: 2,
  [RESOURCE_UTRIUM_ALKALIDE]: 2,
  [RESOURCE_KEANIUM_ACID]: 2,
  [RESOURCE_KEANIUM_ALKALIDE]: 2,
  [RESOURCE_LEMERGIUM_ACID]: 2,
  [RESOURCE_LEMERGIUM_ALKALIDE]: 2,
  [RESOURCE_ZYNTHIUM_ACID]: 2,
  [RESOURCE_ZYNTHIUM_ALKALIDE]: 2,
  [RESOURCE_GHODIUM_ACID]: 2,
  [RESOURCE_GHODIUM_ALKALIDE]: 2,
  
  // Tier 3 (T3) - Elite boosts (4x effect)
  [RESOURCE_CATALYZED_UTRIUM_ACID]: 3,
  [RESOURCE_CATALYZED_UTRIUM_ALKALIDE]: 3,
  [RESOURCE_CATALYZED_KEANIUM_ACID]: 3,
  [RESOURCE_CATALYZED_KEANIUM_ALKALIDE]: 3,
  [RESOURCE_CATALYZED_LEMERGIUM_ACID]: 3,
  [RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE]: 3,
  [RESOURCE_CATALYZED_ZYNTHIUM_ACID]: 3,
  [RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE]: 3,
  [RESOURCE_CATALYZED_GHODIUM_ACID]: 3,
  [RESOURCE_CATALYZED_GHODIUM_ALKALIDE]: 3,
};

/**
 * Boost Temple - Manages creep boosting operations
 */
export class BoostTemple extends Temple {
  labs: StructureLab[];
  boostLabs: StructureLab[]; // Labs designated for boosting
  memory: BoostTempleMemory;
  
  constructor(highCharity: HighCharity) {
    // Center on labs or storage
    const labs = highCharity.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_LAB
    });
    const pos = labs[0]?.pos || highCharity.storage?.pos || new RoomPosition(25, 25, highCharity.name);
    
    super(highCharity, pos);
    
    this.labs = [];
    this.boostLabs = [];
    
    // Initialize memory
    const roomMem: any = Memory.rooms[highCharity.name];
    if (!roomMem.boostTemple) {
      roomMem.boostTemple = {
        boostQueue: [],
        activeBoosts: {}
      };
    }
    this.memory = roomMem.boostTemple;
  }
  
  init(): void {
    // Find all labs
    this.labs = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_LAB
    }) as StructureLab[];
    
    // Designate labs for boosting (use labs near storage)
    if (this.highCharity.storage) {
      this.boostLabs = this.highCharity.storage.pos.findInRange(this.labs, 2);
    } else {
      this.boostLabs = this.labs.slice(0, 3); // Use first 3 labs
    }
  }
  
  run(): void {
    // Process boost queue
    this.processBoostQueue();
    
    // Clean up expired boost records
    this.cleanupBoostRecords();
  }
  
  /**
   * Request a boost for a creep
   */
  requestBoost(creepName: string, role: string, priority: number = 500): void {
    // Check if already in queue
    if (this.memory.boostQueue.some(r => r.creepName === creepName)) {
      return;
    }
    
    // Get boost configuration for role
    const boosts = this.getBoostsForRole(role);
    if (boosts.length === 0) return;
    
    // Add to queue
    this.memory.boostQueue.push({
      creepName,
      boosts,
      priority,
      role
    });
    
    console.log(`⚗️ [BoostTemple ${this.room.name}] Queued boost for ${creepName} (${role}): ${boosts.join(', ')}`);
  }
  
  /**
   * Get boost compounds for a role
   */
  private getBoostsForRole(role: string): ResourceConstant[] {
    const config = BOOST_CONFIGS[role];
    if (!config) return [];
    
    // Filter to only boosts we have in storage/terminal
    const available: ResourceConstant[] = [];
    const storage = this.highCharity.storage;
    const terminal = this.highCharity.terminal;
    
    for (const boost of config) {
      const storageAmount = storage?.store.getUsedCapacity(boost) || 0;
      const terminalAmount = terminal?.store.getUsedCapacity(boost) || 0;
      
      if (storageAmount + terminalAmount >= 30) {
        available.push(boost);
      }
    }
    
    return available;
  }
  
  /**
   * Process the boost queue
   */
  private processBoostQueue(): void {
    if (this.memory.boostQueue.length === 0) return;
    if (this.boostLabs.length === 0) return;
    
    // Sort by priority
    this.memory.boostQueue.sort((a, b) => a.priority - b.priority);
    
    // Process highest priority request
    const request = this.memory.boostQueue[0];
    const creep = Game.creeps[request.creepName];
    
    if (!creep) {
      // Creep doesn't exist, remove from queue
      this.memory.boostQueue.shift();
      return;
    }
    
    // Check if creep is in range of boost labs
    const nearbyLab = this.boostLabs.find(lab => creep.pos.isNearTo(lab));
    
    if (!nearbyLab) {
      // Creep not in position, wait
      if (Game.time % 10 === 0) {
        console.log(`⚗️ [BoostTemple] Waiting for ${creep.name} to reach boost position`);
      }
      return;
    }
    
    // Try to boost with each compound
    let boosted = false;
    for (const boost of request.boosts) {
      if (this.boostCreep(creep, boost)) {
        boosted = true;
        
        // Track active boost
        if (!this.memory.activeBoosts[creep.name]) {
          this.memory.activeBoosts[creep.name] = [];
        }
        this.memory.activeBoosts[creep.name].push(boost);
      }
    }
    
    if (boosted || request.boosts.length === 0) {
      // Boosting complete, remove from queue
      this.memory.boostQueue.shift();
      console.log(`✨ [BoostTemple] Boosted ${creep.name} - The Hierarchs are pleased!`);
    }
  }
  
  /**
   * Boost a creep with a specific compound
   */
  private boostCreep(creep: Creep, boost: ResourceConstant): boolean {
    // Check if creep is already boosted with this compound
    if (creep.body.some(part => part.boost === boost)) {
      return true; // Already boosted
    }
    
    // Find lab with this boost
    const lab = this.boostLabs.find(lab => 
      lab.mineralType === boost && 
      lab.store.getUsedCapacity(boost) >= 30 &&
      lab.store.getUsedCapacity(RESOURCE_ENERGY) >= 20
    );
    
    if (!lab) {
      // Need to load lab with boost
      this.loadBoostIntoLab(boost);
      return false;
    }
    
    // Try to boost
    const result = lab.boostCreep(creep);
    
    if (result === OK) {
      console.log(`⚗️ [BoostTemple] Applied ${boost} to ${creep.name}`);
      return true;
    } else if (result === ERR_NOT_IN_RANGE) {
      // Creep should move closer
      creep.moveTo(lab);
      return false;
    } else {
      console.log(`❌ [BoostTemple] Failed to boost ${creep.name} with ${boost}: ${result}`);
      return false;
    }
  }
  
  /**
   * Load a boost compound into a lab
   */
  private loadBoostIntoLab(boost: ResourceConstant): void {
    const lab = this.boostLabs.find(lab => 
      !lab.mineralType || lab.mineralType === boost
    );
    
    if (!lab) {
      console.log(`⚠️ [BoostTemple] No available labs for ${boost}`);
      return;
    }
    
    // Check if we have the boost in storage/terminal
    const storage = this.highCharity.storage;
    const terminal = this.highCharity.terminal;
    
    const storageAmount = storage?.store.getUsedCapacity(boost) || 0;
    const terminalAmount = terminal?.store.getUsedCapacity(boost) || 0;
    
    if (storageAmount + terminalAmount < 30) {
      console.log(`⚠️ [BoostTemple] Not enough ${boost} for boosting`);
      return;
    }
    
    // Request hauler to fill lab (via logistics)
    // This would integrate with ProphetsWill logistics network
    // For now, just log
    if (Game.time % 50 === 0) {
      console.log(`🔄 [BoostTemple] Need to load ${boost} into lab ${lab.id}`);
    }
  }
  
  /**
   * Clean up boost records for dead creeps
   */
  private cleanupBoostRecords(): void {
    for (const creepName in this.memory.activeBoosts) {
      if (!Game.creeps[creepName]) {
        delete this.memory.activeBoosts[creepName];
      }
    }
  }
  
  /**
   * Check if a creep is boosted
   */
  isCreepBoosted(creepName: string): boolean {
    return !!this.memory.activeBoosts[creepName];
  }
  
  /**
   * Get list of creeps waiting for boosts
   */
  getBoostQueue(): BoostRequest[] {
    return this.memory.boostQueue;
  }
  
  /**
   * Check if boost temple is ready to boost
   */
  isReady(): boolean {
    return this.boostLabs.length > 0 && 
           (!!this.highCharity.storage || !!this.highCharity.terminal);
  }
}
