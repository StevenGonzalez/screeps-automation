/**
 * POWER Gateway - Power Processing Facility
 * 
 * "Harness the ancient power"
 * 
 * Manages power harvesting from PowerBanks and power processing
 * via Power Spawns. Coordinates scouting, attack squads, and power usage.
 */

/// <reference types="@types/screeps" />

import { Gateway } from './Gateway';
import { Nexus } from '../core/Nexus';

export interface PowerBankTarget {
  roomName: string;
  pos: { x: number; y: number };
  power: number;
  ticksToDecay: number;
  decayTime: number; // Alias for ticksToDecay
  hits: number;
  discovered: number;
  distance: number; // Distance from home room
  squadAssigned: boolean;
}

/**
 * Power Gateway - Manages power harvesting and processing
 */
export class PowerGateway extends Gateway {
  powerSpawn: StructurePowerSpawn | null;
  powerBanks: Map<string, PowerBankTarget>;
  
  constructor(Nexus: Nexus) {
    const powerSpawnPos = Nexus.storage?.pos || Nexus.primarySpawn?.pos || 
                          new RoomPosition(25, 25, Nexus.name);
    super(Nexus, powerSpawnPos);
    
    this.powerSpawn = null;
    this.powerBanks = new Map();
    
    // Load from memory
    this.loadFromMemory();
  }
  
  init(): void {
    // Find power spawn
    const powerSpawns = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_POWER_SPAWN
    }) as StructurePowerSpawn[];
    
    this.powerSpawn = powerSpawns[0] || null;
    
    // Scan for power banks periodically
    if (Game.time % 250 === 0) {
      this.scanForPowerBanks();
    }
    
    // Remove expired targets
    this.cleanupExpiredTargets();
  }
  
  run(): void {
    // Process power if we have a power spawn
    if (this.powerSpawn) {
      this.processPower();
    }
    
    // Save to memory
    this.saveToMemory();
  }
  
  /**
   * Process power in power spawn
   */
  private processPower(): void {
    if (!this.powerSpawn) return;
    
    const storage = this.Nexus.storage;
    if (!storage) return;
    
    // Check if we have both power and energy
    const powerAmount = storage.store.getUsedCapacity(RESOURCE_POWER);
    const energyAmount = storage.store.getUsedCapacity(RESOURCE_ENERGY);
    
    // Need at least 100 power and enough energy
    if (powerAmount < 100 || energyAmount < 50000) return;
    
    // Check if power spawn needs refilling
    const psEnergy = this.powerSpawn.store.getUsedCapacity(RESOURCE_ENERGY);
    const psPower = this.powerSpawn.store.getUsedCapacity(RESOURCE_POWER);
    
    if (psEnergy < 1000 || psPower < 10) {
      // Let haulers handle refilling
      return;
    }
    
    // Process power
    const result = this.powerSpawn.processPower();
    if (result === OK && Game.time % 100 === 0) {
      console.log(`⚡ powerGateway: Processing power`);
    }
  }
  
  /**
   * Scan nearby rooms for power banks
   */
  private scanForPowerBanks(): void {
    const range = 5; // Scan 5 rooms away
    
    for (let x = -range; x <= range; x++) {
      for (let y = -range; y <= range; y++) {
        const roomName = this.getRoomNameAtOffset(this.Nexus.name, x, y);
        if (!roomName) continue;
        
        const room = Game.rooms[roomName];
        if (!room) continue; // No vision
        
        // Look for power banks
        const powerBanks = room.find(FIND_STRUCTURES, {
          filter: s => s.structureType === STRUCTURE_POWER_BANK
        }) as StructurePowerBank[];
        
        for (const bank of powerBanks) {
          this.registerPowerBank(bank);
        }
      }
    }
  }
  
  /**
   * Register a discovered power bank
   */
  private registerPowerBank(bank: StructurePowerBank): void {
    const id = `${bank.room.name}_${bank.pos.x}_${bank.pos.y}`;
    const distance = Game.map.getRoomLinearDistance(this.Nexus.name, bank.room.name);
    
    if (!this.powerBanks.has(id)) {
      const target: PowerBankTarget = {
        roomName: bank.room.name,
        pos: { x: bank.pos.x, y: bank.pos.y },
        power: bank.power,
        ticksToDecay: bank.ticksToDecay,
        decayTime: bank.ticksToDecay, // Alias
        hits: bank.hits,
        discovered: Game.time,
        distance: distance,
        squadAssigned: false
      };
      
      this.powerBanks.set(id, target);
      
      console.log(`⚡ powerGateway: Discovered PowerBank in ${bank.room.name} - ${bank.power} power, ${bank.ticksToDecay} ticks`);
    }
  }
  
  /**
   * Get best power bank target
   */
  getBestTarget(): PowerBankTarget | null {
    const targets = Array.from(this.powerBanks.values())
      .filter(t => !t.squadAssigned && t.ticksToDecay > 2000);
    
    if (targets.length === 0) return null;
    
    // Sort by power amount and distance
    targets.sort((a, b) => {
      const distA = Game.map.getRoomLinearDistance(this.Nexus.name, a.roomName);
      const distB = Game.map.getRoomLinearDistance(this.Nexus.name, b.roomName);
      
      // Prefer closer and higher power
      const scoreA = a.power - (distA * 200);
      const scoreB = b.power - (distB * 200);
      
      return scoreB - scoreA;
    });
    
    return targets[0];
  }
  
  /**
   * Mark target as assigned
   */
  assignTarget(roomName: string): void {
    for (const [id, target] of this.powerBanks) {
      if (target.roomName === roomName) {
        target.squadAssigned = true;
      }
    }
  }
  
  /**
   * Remove expired targets
   */
  private cleanupExpiredTargets(): void {
    for (const [id, target] of this.powerBanks) {
      // Remove if discovered more than 5000 ticks ago or decayed
      if (Game.time - target.discovered > 5000 || target.ticksToDecay < 500) {
        this.powerBanks.delete(id);
      }
    }
  }
  
  /**
   * Get room name at offset
   */
  private getRoomNameAtOffset(roomName: string, xOffset: number, yOffset: number): string | null {
    const match = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
    if (!match) return null;
    
    const [, xDir, xNum, yDir, yNum] = match;
    
    let x = parseInt(xNum);
    let y = parseInt(yNum);
    
    if (xDir === 'W') x = -x;
    if (yDir === 'S') y = -y;
    
    x += xOffset;
    y += yOffset;
    
    const newXDir = x >= 0 ? 'E' : 'W';
    const newYDir = y >= 0 ? 'N' : 'S';
    
    return `${newXDir}${Math.abs(x)}${newYDir}${Math.abs(y)}`;
  }
  
  /**
   * Load power banks from memory
   */
  private loadFromMemory(): void {
    const mem: any = Memory.rooms[this.Nexus.name];
    if (!mem.PowerGateway) {
      mem.PowerGateway = { powerBanks: {} };
    }
    
    for (const [id, target] of Object.entries(mem.PowerGateway.powerBanks || {})) {
      this.powerBanks.set(id, target as PowerBankTarget);
    }
  }
  
  /**
   * Save power banks to memory
   */
  private saveToMemory(): void {
    const mem: any = Memory.rooms[this.Nexus.name];
    if (!mem.PowerGateway) {
      mem.PowerGateway = {};
    }
    
    mem.PowerGateway.powerBanks = {};
    for (const [id, target] of this.powerBanks) {
      mem.PowerGateway.powerBanks[id] = target;
    }
  }
  
  /**
   * Get power bank count
   */
  get targetCount(): number {
    return this.powerBanks.size;
  }
  
  /**
   * Get all available power bank targets
   */
  getAvailableTargets(): PowerBankTarget[] {
    return Array.from(this.powerBanks.values()).filter(
      target => !target.squadAssigned && target.ticksToDecay > 2000
    );
  }
  
  /**
   * Check if power harvesting is ready
   */
  get isReady(): boolean {
    // Need RCL 8 and storage with resources
    if (!this.Nexus.storage || this.Nexus.level < 8) {
      return false;
    }
    
    // Need sufficient resources for squad
    const energy = this.Nexus.storage.store.getUsedCapacity(RESOURCE_ENERGY);
    return energy > 100000;
  }
}
