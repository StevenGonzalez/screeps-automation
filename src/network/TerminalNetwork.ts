/**
 * TERMINAL NETWORK - Inter-Colony Resource Distribution
 * 
 * "The tithe flows through sacred channels"
 * 
 * Coordinates resource sharing between all colonies to maximize
 * efficiency and support expansion, combat, and development.
 */

/// <reference types="@types/screeps" />

import { Covenant } from '../core/Covenant';
import { HighCharity } from '../core/HighCharity';

export interface ResourceNeed {
  roomName: string;
  resourceType: ResourceConstant;
  amount: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  reason: string;
}

export interface ResourceSurplus {
  roomName: string;
  resourceType: ResourceConstant;
  amount: number;
}

export interface TransferOrder {
  from: string;
  to: string;
  resourceType: ResourceConstant;
  amount: number;
  scheduled: number;
  completed: boolean;
}

export interface TerminalNetworkMemory {
  transfers: TransferOrder[];
  lastBalancing: number;
  statistics: {
    totalTransfers: number;
    energyShared: number;
    mineralsShared: number;
    compoundsShared: number;
  };
}

/**
 * Terminal Network - Coordinates resource sharing across all colonies
 */
export class TerminalNetwork {
  private covenant: Covenant;
  
  private get memory(): TerminalNetworkMemory {
    if (!Memory.terminalNetwork) {
      Memory.terminalNetwork = {
        transfers: [],
        lastBalancing: 0,
        statistics: {
          totalTransfers: 0,
          energyShared: 0,
          mineralsShared: 0,
          compoundsShared: 0
        }
      };
    }
    return Memory.terminalNetwork as TerminalNetworkMemory;
  }
  
  constructor(covenant: Covenant) {
    this.covenant = covenant;
  }
  
  /**
   * Run terminal network
   */
  run(): void {
    // Process scheduled transfers
    this.processTransfers();
    
    // Balance resources periodically
    if (Game.time - this.memory.lastBalancing > 100) {
      this.balanceResources();
      this.memory.lastBalancing = Game.time;
    }
    
    // Handle emergencies every tick
    this.handleEmergencies();
  }
  
  /**
   * Process scheduled resource transfers
   */
  private processTransfers(): void {
    const pendingTransfers = this.memory.transfers.filter(t => !t.completed);
    
    for (const transfer of pendingTransfers) {
      // Skip if scheduled for future
      if (transfer.scheduled > Game.time) continue;
      
      const fromRoom = Game.rooms[transfer.from];
      const toRoom = Game.rooms[transfer.to];
      
      if (!fromRoom || !toRoom) continue;
      
      const fromTerminal = fromRoom.terminal;
      const toTerminal = toRoom.terminal;
      
      if (!fromTerminal || !toTerminal) {
        transfer.completed = true;
        continue;
      }
      
      // Check cooldown
      if (fromTerminal.cooldown > 0) continue;
      
      // Execute transfer
      const available = fromTerminal.store.getUsedCapacity(transfer.resourceType);
      const sendAmount = Math.min(transfer.amount, available);
      
      if (sendAmount > 0) {
        const result = fromTerminal.send(
          transfer.resourceType,
          sendAmount,
          transfer.to
        );
        
        if (result === OK) {
          transfer.completed = true;
          this.memory.statistics.totalTransfers++;
          
          // Update statistics
          if (transfer.resourceType === RESOURCE_ENERGY) {
            this.memory.statistics.energyShared += sendAmount;
          } else if (this.isMineral(transfer.resourceType)) {
            this.memory.statistics.mineralsShared += sendAmount;
          } else {
            this.memory.statistics.compoundsShared += sendAmount;
          }
          
          console.log(`🔄 Terminal Network: Sent ${sendAmount} ${transfer.resourceType} from ${transfer.from} → ${transfer.to}`);
        }
      } else {
        transfer.completed = true; // Nothing to send
      }
    }
    
    // Clean up old completed transfers
    if (Game.time % 1000 === 0) {
      this.memory.transfers = this.memory.transfers.filter(t => 
        !t.completed || Game.time - t.scheduled < 5000
      );
    }
  }
  
  /**
   * Balance resources across all colonies
   */
  private balanceResources(): void {
    const colonies = this.getColoniesWithTerminals();
    if (colonies.length < 2) return; // Need at least 2 colonies
    
    // Identify needs and surpluses
    const needs = this.identifyResourceNeeds(colonies);
    const surpluses = this.identifyResourceSurpluses(colonies);
    
    // Match surpluses to needs
    this.matchAndScheduleTransfers(needs, surpluses);
  }
  
  /**
   * Identify resource needs across colonies
   */
  private identifyResourceNeeds(colonies: HighCharity[]): ResourceNeed[] {
    const needs: ResourceNeed[] = [];
    
    for (const colony of colonies) {
      if (!colony.terminal) continue;
      
      // Energy needs
      const energyAmount = colony.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
      if (energyAmount < 20000) {
        needs.push({
          roomName: colony.name,
          resourceType: RESOURCE_ENERGY,
          amount: 50000 - energyAmount,
          priority: energyAmount < 10000 ? 'critical' : 'high',
          reason: 'Low energy reserves'
        });
      }
      
      // Mineral needs (for bootstrapping new colonies)
      if (colony.memory.phase === 'bootstrap' || colony.memory.phase === 'developing') {
        const minerals: MineralConstant[] = [
          RESOURCE_HYDROGEN, RESOURCE_OXYGEN, RESOURCE_UTRIUM,
          RESOURCE_LEMERGIUM, RESOURCE_KEANIUM, RESOURCE_ZYNTHIUM,
          RESOURCE_CATALYST
        ];
        
        for (const mineral of minerals) {
          const amount = colony.terminal.store.getUsedCapacity(mineral);
          if (amount < 1000) {
            needs.push({
              roomName: colony.name,
              resourceType: mineral,
              amount: 3000 - amount,
              priority: 'medium',
              reason: 'Developing colony needs base minerals'
            });
          }
        }
      }
      
      // Compound needs (for boosting)
      if (colony.memory.phase === 'mature' || colony.memory.phase === 'powerhouse') {
        const boostCompounds: ResourceConstant[] = [
          RESOURCE_CATALYZED_GHODIUM_ACID, // Upgrade boost
          RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE, // Heal boost
          RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE, // Move boost
          RESOURCE_CATALYZED_UTRIUM_ACID // Attack boost
        ];
        
        for (const compound of boostCompounds) {
          const amount = colony.terminal.store.getUsedCapacity(compound);
          if (amount < 500 && this.hasLabProduction(colony)) {
            needs.push({
              roomName: colony.name,
              resourceType: compound,
              amount: 1000 - amount,
              priority: 'medium',
              reason: 'Combat/boost compounds needed'
            });
          }
        }
      }
    }
    
    return needs.sort((a, b) => this.priorityValue(b.priority) - this.priorityValue(a.priority));
  }
  
  /**
   * Identify resource surpluses across colonies
   */
  private identifyResourceSurpluses(colonies: HighCharity[]): ResourceSurplus[] {
    const surpluses: ResourceSurplus[] = [];
    
    for (const colony of colonies) {
      if (!colony.terminal) continue;
      
      // Only share from mature/powerhouse colonies
      if (colony.memory.phase !== 'mature' && colony.memory.phase !== 'powerhouse') {
        continue;
      }
      
      // Energy surplus
      const energyAmount = colony.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
      if (energyAmount > 100000) {
        surpluses.push({
          roomName: colony.name,
          resourceType: RESOURCE_ENERGY,
          amount: energyAmount - 75000 // Keep 75k reserve
        });
      }
      
      // Mineral surpluses
      const minerals: MineralConstant[] = [
        RESOURCE_HYDROGEN, RESOURCE_OXYGEN, RESOURCE_UTRIUM,
        RESOURCE_LEMERGIUM, RESOURCE_KEANIUM, RESOURCE_ZYNTHIUM,
        RESOURCE_CATALYST
      ];
      
      for (const mineral of minerals) {
        const amount = colony.terminal.store.getUsedCapacity(mineral);
        if (amount > 10000) {
          surpluses.push({
            roomName: colony.name,
            resourceType: mineral,
            amount: amount - 5000 // Keep 5k reserve
          });
        }
      }
      
      // Compound surpluses
      for (const resourceType in colony.terminal.store) {
        const resource = resourceType as ResourceConstant;
        if (this.isCompound(resource)) {
          const amount = colony.terminal.store.getUsedCapacity(resource);
          if (amount > 2000) {
            surpluses.push({
              roomName: colony.name,
              resourceType: resource,
              amount: amount - 1000 // Keep 1k reserve
            });
          }
        }
      }
    }
    
    return surpluses;
  }
  
  /**
   * Match surpluses to needs and schedule transfers
   */
  private matchAndScheduleTransfers(needs: ResourceNeed[], surpluses: ResourceSurplus[]): void {
    for (const need of needs) {
      // Find matching surplus
      const matchingSurplus = surpluses.find(s => 
        s.resourceType === need.resourceType &&
        s.amount >= Math.min(need.amount, 1000) // At least 1k to make transfer worthwhile
      );
      
      if (!matchingSurplus) continue;
      
      // Calculate transfer amount
      const transferAmount = Math.min(
        need.amount,
        matchingSurplus.amount,
        10000 // Max 10k per transfer
      );
      
      // Calculate distance cost
      const distance = Game.map.getRoomLinearDistance(matchingSurplus.roomName, need.roomName);
      const cost = Game.market.calcTransactionCost(transferAmount, matchingSurplus.roomName, need.roomName);
      
      // Don't transfer if cost is too high
      if (cost > transferAmount * 0.1) continue; // Max 10% energy cost
      
      // Schedule transfer
      this.scheduleTransfer({
        from: matchingSurplus.roomName,
        to: need.roomName,
        resourceType: need.resourceType,
        amount: transferAmount,
        scheduled: Game.time,
        completed: false
      });
      
      // Update surplus
      matchingSurplus.amount -= transferAmount;
      
      console.log(`📋 Terminal Network: Scheduled ${transferAmount} ${need.resourceType} transfer (${matchingSurplus.roomName} → ${need.roomName}) - ${need.reason}`);
    }
  }
  
  /**
   * Handle emergency resource needs
   */
  private handleEmergencies(): void {
    const colonies = this.getColoniesWithTerminals();
    
    for (const colony of colonies) {
      if (!colony.terminal) continue;
      
      // Emergency: Colony under attack with low energy
      if (colony.defenseTemple.memory.threatLevel >= 7) {
        const energyAmount = colony.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
        
        if (energyAmount < 5000) {
          this.sendEmergencyEnergy(colony.name, 20000);
        }
      }
      
      // Emergency: Bootstrapping colony running out of energy
      if (colony.memory.phase === 'bootstrap' || colony.memory.phase === 'developing') {
        const energyAmount = colony.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
        
        if (energyAmount < 3000) {
          this.sendEmergencyEnergy(colony.name, 10000);
        }
      }
    }
  }
  
  /**
   * Send emergency energy to a colony
   */
  private sendEmergencyEnergy(targetRoom: string, amount: number): void {
    const colonies = this.getColoniesWithTerminals();
    
    // Find nearest colony with surplus energy
    let nearestColony: HighCharity | null = null;
    let minDistance = 999;
    
    for (const colony of colonies) {
      if (colony.name === targetRoom) continue;
      if (!colony.terminal) continue;
      
      const energyAmount = colony.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
      if (energyAmount < 50000) continue; // Need surplus
      
      const distance = Game.map.getRoomLinearDistance(colony.name, targetRoom);
      if (distance < minDistance) {
        minDistance = distance;
        nearestColony = colony;
      }
    }
    
    if (nearestColony) {
      this.scheduleTransfer({
        from: nearestColony.name,
        to: targetRoom,
        resourceType: RESOURCE_ENERGY,
        amount,
        scheduled: Game.time,
        completed: false
      });
      
      console.log(`🚨 Terminal Network: EMERGENCY energy transfer to ${targetRoom}`);
    }
  }
  
  /**
   * Schedule a resource transfer
   */
  private scheduleTransfer(transfer: TransferOrder): void {
    // Check if similar transfer already exists
    const exists = this.memory.transfers.some(t => 
      !t.completed &&
      t.from === transfer.from &&
      t.to === transfer.to &&
      t.resourceType === transfer.resourceType
    );
    
    if (!exists) {
      this.memory.transfers.push(transfer);
    }
  }
  
  /**
   * Get all colonies with terminals
   */
  private getColoniesWithTerminals(): HighCharity[] {
    return Object.values(this.covenant.highCharities).filter(hc => hc.terminal);
  }
  
  /**
   * Check if a resource is a mineral
   */
  private isMineral(resource: ResourceConstant): boolean {
    return [
      RESOURCE_HYDROGEN, RESOURCE_OXYGEN, RESOURCE_UTRIUM,
      RESOURCE_LEMERGIUM, RESOURCE_KEANIUM, RESOURCE_ZYNTHIUM,
      RESOURCE_CATALYST, RESOURCE_GHODIUM
    ].includes(resource as MineralConstant);
  }
  
  /**
   * Check if a resource is a compound
   */
  private isCompound(resource: ResourceConstant): boolean {
    return !this.isMineral(resource) && 
           resource !== RESOURCE_ENERGY && 
           resource !== RESOURCE_POWER &&
           resource.length > 1;
  }
  
  /**
   * Check if colony has lab production
   */
  private hasLabProduction(colony: HighCharity): boolean {
    return colony.labTemple !== null && colony.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_LAB
    }).length >= 3;
  }
  
  /**
   * Convert priority to numeric value
   */
  private priorityValue(priority: 'critical' | 'high' | 'medium' | 'low'): number {
    switch (priority) {
      case 'critical': return 4;
      case 'high': return 3;
      case 'medium': return 2;
      case 'low': return 1;
      default: return 0;
    }
  }
  
  /**
   * Get network statistics
   */
  getStatistics(): TerminalNetworkMemory['statistics'] {
    return this.memory.statistics;
  }
  
  /**
   * Get pending transfers
   */
  getPendingTransfers(): TransferOrder[] {
    return this.memory.transfers.filter(t => !t.completed);
  }
  
  /**
   * Force immediate energy transfer to a room
   */
  forceEnergyTransfer(targetRoom: string, amount: number): void {
    this.sendEmergencyEnergy(targetRoom, amount);
  }
}
