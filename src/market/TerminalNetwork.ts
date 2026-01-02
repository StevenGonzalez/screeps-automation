/**
 * TERMINAL NETWORK
 * 
 * "The Network of Sacred Conduits connects our holy cities"
 * 
 * Multi-room resource distribution system that:
 * - Balances energy across empire
 * - Shares minerals between rooms
 * - Distributes boost compounds
 * - Handles emergency resource transfers
 */

/// <reference types="@types/screeps" />

export interface TerminalNetworkMemory {
  transferQueue: TransferRequest[];
  lastBalance: number;
}

export interface TransferRequest {
  id: string;
  from: string;
  to: string;
  resource: ResourceConstant;
  amount: number;
  priority: number;
  createdAt: number;
}

/**
 * Multi-room terminal network for resource distribution
 */
export class TerminalNetwork {
  memory: TerminalNetworkMemory;
  
  private readonly BALANCE_INTERVAL = 500; // Balance every 500 ticks
  private readonly MIN_ENERGY_TRANSFER = 10000; // Don't transfer less than this
  private readonly ENERGY_SURPLUS_THRESHOLD = 150000; // Share energy above this
  private readonly ENERGY_DEFICIT_THRESHOLD = 50000; // Request energy below this
  
  constructor() {
    if (!Memory.terminalNetwork) {
      (Memory as any).terminalNetwork = {
        transferQueue: [],
        lastBalance: 0
      };
    }
    this.memory = (Memory as any).terminalNetwork;
  }
  
  /**
   * Run terminal network operations
   */
  run(): void {
    // Process transfer queue
    this.processTransfers();
    
    // Balance resources periodically
    if (Game.time - this.memory.lastBalance > this.BALANCE_INTERVAL) {
      this.balanceResources();
      this.memory.lastBalance = Game.time;
    }
  }
  
  /**
   * Process pending transfers
   */
  private processTransfers(): void {
    // Clean up old/invalid requests
    this.memory.transferQueue = this.memory.transferQueue.filter(req => {
      // Remove requests older than 10000 ticks
      if (Game.time - req.createdAt > 10000) return false;
      
      // Remove if rooms don't exist or don't have terminals
      const fromRoom = Game.rooms[req.from];
      const toRoom = Game.rooms[req.to];
      if (!fromRoom?.terminal || !toRoom?.terminal) return false;
      
      return true;
    });
    
    // Sort by priority (higher first)
    this.memory.transferQueue.sort((a, b) => b.priority - a.priority);
    
    // Process transfers
    for (const request of this.memory.transferQueue) {
      if (this.executeTransfer(request)) {
        // Remove completed transfer
        this.memory.transferQueue = this.memory.transferQueue.filter(r => r.id !== request.id);
      }
    }
  }
  
  /**
   * Execute a transfer request
   */
  private executeTransfer(request: TransferRequest): boolean {
    const fromRoom = Game.rooms[request.from];
    const toRoom = Game.rooms[request.to];
    
    if (!fromRoom?.terminal || !toRoom?.terminal) return true; // Remove invalid request
    
    const terminal = fromRoom.terminal;
    
    // Check if we have the resource
    const available = terminal.store[request.resource] || 0;
    if (available < request.amount) {
      // Not enough - check if we should wait or cancel
      if (request.resource === RESOURCE_ENERGY) {
        return false; // Wait for energy
      }
      return true; // Cancel mineral requests we can't fulfill
    }
    
    // Calculate transfer cost
    const cost = Game.market.calcTransactionCost(request.amount, request.from, request.to);
    
    // Check if we have enough energy
    if (terminal.store.energy < cost) return false; // Wait for energy
    
    // Send resources
    const result = terminal.send(request.resource, request.amount, request.to);
    
    if (result === OK) {
      console.log(`🔄 Network: Sent ${request.amount} ${request.resource} from ${request.from} to ${request.to} (cost: ${cost} energy)`);
      return true;
    } else if (result === ERR_TIRED) {
      return false; // Terminal on cooldown, try again later
    }
    
    return true; // Remove request on other errors
  }
  
  /**
   * Balance resources across empire
   */
  private balanceResources(): void {
    this.balanceEnergy();
    this.balanceMinerals();
  }
  
  /**
   * Balance energy across rooms
   */
  private balanceEnergy(): void {
    const rooms = Object.values(Game.rooms).filter(r => r.controller?.my && r.terminal);
    if (rooms.length < 2) return; // Need at least 2 rooms to balance
    
    // Calculate each room's energy status
    const roomStatus = rooms.map(room => {
      const terminal = room.terminal!;
      const storage = room.storage;
      const totalEnergy = (terminal.store.energy || 0) + (storage?.store.energy || 0);
      
      return {
        room: room.name,
        terminal,
        totalEnergy,
        surplus: Math.max(0, totalEnergy - this.ENERGY_SURPLUS_THRESHOLD),
        deficit: Math.max(0, this.ENERGY_DEFICIT_THRESHOLD - totalEnergy)
      };
    });
    
    // Find rooms with surplus and deficit
    const surplusRooms = roomStatus.filter(r => r.surplus > this.MIN_ENERGY_TRANSFER).sort((a, b) => b.surplus - a.surplus);
    const deficitRooms = roomStatus.filter(r => r.deficit > this.MIN_ENERGY_TRANSFER).sort((a, b) => b.deficit - a.deficit);
    
    // Match surplus with deficit
    for (const deficitRoom of deficitRooms) {
      for (const surplusRoom of surplusRooms) {
        if (surplusRoom.surplus < this.MIN_ENERGY_TRANSFER) continue;
        
        // Calculate transfer amount
        const transferAmount = Math.min(
          surplusRoom.surplus,
          deficitRoom.deficit,
          50000 // Max 50k per transfer
        );
        
        if (transferAmount < this.MIN_ENERGY_TRANSFER) continue;
        
        // Queue transfer
        this.queueTransfer(
          surplusRoom.room,
          deficitRoom.room,
          RESOURCE_ENERGY,
          transferAmount,
          5 // Normal priority
        );
        
        // Update tracking
        surplusRoom.surplus -= transferAmount;
        deficitRoom.deficit -= transferAmount;
        
        if (deficitRoom.deficit < this.MIN_ENERGY_TRANSFER) break;
      }
    }
  }
  
  /**
   * Balance minerals across rooms
   */
  private balanceMinerals(): void {
    const rooms = Object.values(Game.rooms).filter(r => r.controller?.my && r.terminal);
    if (rooms.length < 2) return;
    
    // Track mineral distribution
    const mineralCounts: { [resource: string]: { [roomName: string]: number } } = {};
    
    // Get base minerals
    const minerals: ResourceConstant[] = [
      RESOURCE_HYDROGEN,
      RESOURCE_OXYGEN,
      RESOURCE_UTRIUM,
      RESOURCE_LEMERGIUM,
      RESOURCE_KEANIUM,
      RESOURCE_ZYNTHIUM,
      RESOURCE_CATALYST
    ];
    
    // Count minerals in each room
    for (const room of rooms) {
      const terminal = room.terminal!;
      const storage = room.storage;
      
      for (const mineral of minerals) {
        if (!mineralCounts[mineral]) mineralCounts[mineral] = {};
        
        const amount = (terminal.store[mineral] || 0) + (storage?.store[mineral] || 0);
        mineralCounts[mineral][room.name] = amount;
      }
    }
    
    // Balance each mineral
    for (const mineral of minerals) {
      const counts = mineralCounts[mineral];
      const roomNames = Object.keys(counts);
      
      // Calculate average
      const total = roomNames.reduce((sum, name) => sum + counts[name], 0);
      const average = total / roomNames.length;
      
      // Find imbalances
      const excess = roomNames.filter(name => counts[name] > average * 1.5 && counts[name] > 5000);
      const shortage = roomNames.filter(name => counts[name] < average * 0.5 && average > 1000);
      
      // Transfer from excess to shortage
      for (const excessRoom of excess) {
        for (const shortageRoom of shortage) {
          const transferAmount = Math.min(
            counts[excessRoom] - average,
            average - counts[shortageRoom],
            5000 // Max 5k minerals per transfer
          );
          
          if (transferAmount > 1000) {
            this.queueTransfer(
              excessRoom,
              shortageRoom,
              mineral as ResourceConstant,
              transferAmount,
              3 // Lower priority than energy
            );
            
            counts[excessRoom] -= transferAmount;
            counts[shortageRoom] += transferAmount;
          }
        }
      }
    }
  }
  
  /**
   * Queue a transfer request
   */
  queueTransfer(from: string, to: string, resource: ResourceConstant, amount: number, priority: number = 5): void {
    // Check if similar request already exists
    const existing = this.memory.transferQueue.find(r => 
      r.from === from && r.to === to && r.resource === resource
    );
    
    if (existing) {
      // Update existing request
      existing.amount = Math.max(existing.amount, amount);
      existing.priority = Math.max(existing.priority, priority);
      return;
    }
    
    // Add new request
    this.memory.transferQueue.push({
      id: `${from}_${to}_${resource}_${Game.time}`,
      from,
      to,
      resource,
      amount,
      priority,
      createdAt: Game.time
    });
  }
  
  /**
   * Emergency resource transfer (high priority)
   */
  emergencyTransfer(from: string, to: string, resource: ResourceConstant, amount: number): void {
    this.queueTransfer(from, to, resource, amount, 10); // Highest priority
    console.log(`🚨 Network: Emergency transfer queued - ${amount} ${resource} from ${from} to ${to}`);
  }
  
  /**
   * Get status string for console
   */
  getStatus(): string {
    let output = '🌐 TERMINAL NETWORK\n\n';
    
    const rooms = Object.values(Game.rooms).filter(r => r.controller?.my && r.terminal);
    
    output += 'Terminals:\n';
    for (const room of rooms) {
      const terminal = room.terminal!;
      const storage = room.storage;
      const energy = (terminal.store.energy || 0) + (storage?.store.energy || 0);
      const cooldown = terminal.cooldown || 0;
      
      output += `  ${room.name}: ${energy.toLocaleString()} energy ${cooldown > 0 ? `(cooldown: ${cooldown})` : ''}\n`;
    }
    
    output += `\nTransfer Queue: ${this.memory.transferQueue.length} pending\n`;
    
    if (this.memory.transferQueue.length > 0) {
      output += '\nPending Transfers:\n';
      for (const req of this.memory.transferQueue.slice(0, 5)) {
        output += `  ${req.from} → ${req.to}: ${req.amount} ${req.resource} (priority ${req.priority})\n`;
      }
    }
    
    return output;
  }
}
