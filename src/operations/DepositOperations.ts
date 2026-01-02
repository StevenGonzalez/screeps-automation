/**
 * DEPOSIT OPERATIONS - Sacred Pilgrimages to Ancient Treasures
 * 
 * "Send the faithful to claim the ancient treasures hidden in the void"
 * 
 * Manages Pilgrim expeditions to harvest biomass, silicon,
 * metal, and mist deposits in highway rooms.
 */

/// <reference types="@types/screeps" />

import { HighCharity } from '../core/HighCharity';

export interface DepositTarget {
  depositId: Id<Deposit>;
  depositType: DepositConstant;
  roomName: string;
  pos: { x: number; y: number };
  lastCooldown: number;
  discovered: number;
  distance: number;
  active: boolean;
  disabled: boolean;
  profitability: number;
}

export interface DepositMemory {
  deposits: { [depositId: string]: DepositTarget };
  lastScan: number;
}

/**
 * Deposit Operations Manager - Coordinates deposit harvesting
 */
export class DepositOperations {
  private highCharity: HighCharity;
  
  private get memory(): DepositMemory {
    if (!this.highCharity.memory.deposits) {
      this.highCharity.memory.deposits = {
        deposits: {},
        lastScan: 0
      };
    }
    return this.highCharity.memory.deposits as DepositMemory;
  }
  
  constructor(highCharity: HighCharity) {
    this.highCharity = highCharity;
  }
  
  /**
   * Run deposit operations
   */
  run(): void {
    // Only operate at RCL 7+ (need heavy creeps and stable economy)
    if ((this.highCharity.controller?.level || 0) < 7) return;
    
    // Need storage and good energy reserves
    if (!this.highCharity.storage || 
        this.highCharity.storage.store.getUsedCapacity(RESOURCE_ENERGY) < 100000) {
      return;
    }
    
    // Scan for deposits periodically
    if (Game.time - this.memory.lastScan > 1000) {
      this.scanForDeposits();
      this.memory.lastScan = Game.time;
    }
    
    // Clean up expired deposits
    this.cleanupExpiredDeposits();
    
    // Manage active deposit operations
    this.manageDepositOperations();
  }
  
  /**
   * Scan highway rooms for deposits
   */
  private scanForDeposits(): void {
    const scanRange = 7; // Scan up to 7 rooms away
    const homeRoom = this.highCharity.name;
    
    // Get all rooms within range
    const roomsToScan = this.getRoomsInRange(homeRoom, scanRange);
    
    for (const roomName of roomsToScan) {
      // Only scan highway rooms (where deposits spawn)
      if (!this.isHighwayRoom(roomName)) continue;
      
      // Skip if no vision
      const room = Game.rooms[roomName];
      if (!room) continue;
      
      // Find deposits
      const deposits = room.find(FIND_DEPOSITS);
      
      for (const deposit of deposits) {
        this.registerDeposit(deposit);
      }
    }
  }
  
  /**
   * Register a discovered deposit
   */
  private registerDeposit(deposit: Deposit): void {
    const depositId = deposit.id;
    
    // Skip if already registered and active
    if (this.memory.deposits[depositId]) return;
    
    const distance = Game.map.getRoomLinearDistance(this.highCharity.name, deposit.room!.name);
    const profitability = this.calculateProfitability(deposit, distance);
    
    // Skip if not profitable enough
    if (profitability < 0.3) return;
    
    const target: DepositTarget = {
      depositId: depositId,
      depositType: deposit.depositType,
      roomName: deposit.room!.name,
      pos: { x: deposit.pos.x, y: deposit.pos.y },
      lastCooldown: deposit.lastCooldown,
      discovered: Game.time,
      distance: distance,
      active: false,
      disabled: false,
      profitability: profitability
    };
    
    this.memory.deposits[depositId] = target;
    console.log(`� Pilgrimage: Discovered ${deposit.depositType} in ${deposit.room!.name} (profit: ${profitability.toFixed(2)})`);
  }
  
  /**
   * Calculate deposit profitability score (0-1)
   */
  private calculateProfitability(deposit: Deposit, distance: number): number {
    let score = 0;
    
    // Cooldown factor (lower cooldown = better)
    const cooldownFactor = Math.max(0, 1 - (deposit.lastCooldown / 200));
    score += cooldownFactor * 0.4;
    
    // Distance factor (closer = better)
    if (distance <= 3) score += 0.3;
    else if (distance <= 5) score += 0.2;
    else if (distance <= 7) score += 0.1;
    
    // Decay factor (more time = better)
    const decayFactor = Math.min(1, deposit.ticksToDecay / 10000);
    score += decayFactor * 0.3;
    
    return score;
  }
  
  /**
   * Check if room is a highway room (where deposits spawn)
   */
  private isHighwayRoom(roomName: string): boolean {
    const parsed = /^([WE])([0-9]+)([NS])([0-9]+)$/.exec(roomName);
    if (!parsed) return false;
    
    const x = parseInt(parsed[2]);
    const y = parseInt(parsed[4]);
    
    // Highway rooms are every 10th coordinate (e.g., E0N0, E10N0, E0N10)
    return x % 10 === 0 || y % 10 === 0;
  }
  
  /**
   * Get all room names within range
   */
  private getRoomsInRange(centerRoom: string, range: number): string[] {
    const rooms: string[] = [];
    const parsed = /^([WE])([0-9]+)([NS])([0-9]+)$/.exec(centerRoom);
    if (!parsed) return rooms;
    
    const [, ewDir, xStr, nsDir, yStr] = parsed;
    const centerX = (ewDir === 'W' ? -1 : 1) * parseInt(xStr);
    const centerY = (nsDir === 'N' ? 1 : -1) * parseInt(yStr);
    
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        const x = centerX + dx;
        const y = centerY + dy;
        
        const xDir = x < 0 ? 'W' : 'E';
        const yDir = y < 0 ? 'S' : 'N';
        const roomName = `${xDir}${Math.abs(x)}${yDir}${Math.abs(y)}`;
        
        rooms.push(roomName);
      }
    }
    
    return rooms;
  }
  
  /**
   * Clean up expired deposits
   */
  private cleanupExpiredDeposits(): void {
    for (const depositId in this.memory.deposits) {
      const target = this.memory.deposits[depositId];
      
      // Check if deposit still exists (if we have vision)
      const room = Game.rooms[target.roomName];
      if (room) {
        const deposit = Game.getObjectById(target.depositId as Id<Deposit>);
        
        // Remove if deposit is gone
        if (!deposit) {
          console.log(`� Pilgrimage: Deposit ${target.depositType} in ${target.roomName} fully harvested`);
          delete this.memory.deposits[depositId];
        }
      }
    }
  }
  
  /**
   * Manage active deposit operations
   */
  private manageDepositOperations(): void {
    const deposits = Object.values(this.memory.deposits);
    
    // Get currently active deposits
    const activeDeposits = deposits.filter(d => d.active && !d.disabled);
    
    // Activate top deposits if we have capacity (max 2 active)
    if (activeDeposits.length < 2) {
      const availableDeposits = deposits
        .filter(d => !d.active && !d.disabled)
        .sort((a, b) => b.profitability - a.profitability);
      
      const toActivate = availableDeposits.slice(0, 2 - activeDeposits.length);
      
      for (const deposit of toActivate) {
        deposit.active = true;
        console.log(`� Pilgrimage: Sending faithful to ${deposit.depositType} in ${deposit.roomName}`);
      }
    }
  }
  
  /**
   * Get all active deposit targets
   */
  getActiveDeposits(): DepositTarget[] {
    return Object.values(this.memory.deposits).filter(d => d.active && !d.disabled);
  }
  
  /**
   * Toggle deposit operation
   */
  toggleDeposit(depositId: string, enable: boolean): void {
    const target = this.memory.deposits[depositId];
    if (!target) {
      console.log(`❌ Deposit ${depositId} not found`);
      return;
    }
    
    target.disabled = !enable;
    target.active = enable;
    
    console.log(`� Pilgrimage: ${enable ? 'Enabled' : 'Disabled'} ${target.depositType} in ${target.roomName}`);
  }
  
  /**
   * Get deposit by ID
   */
  getDeposit(depositId: string): DepositTarget | null {
    return this.memory.deposits[depositId] || null;
  }
  
  /**
   * Get all deposits
   */
  getAllDeposits(): DepositTarget[] {
    return Object.values(this.memory.deposits);
  }
}
