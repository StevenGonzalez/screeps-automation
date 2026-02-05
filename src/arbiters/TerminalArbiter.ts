/**
 * TERMINAL ARBITER - Market Operations & Resource Trading
 * 
 * "Through commerce, the KHALA expands its reach"
 * 
 * Manages terminal operations including market trading, inter-colony
 * resource transfers, and automated buy/sell orders.
 */

/// <reference types="@types/screeps" />

import { Arbiter, ArbiterPriority } from './Arbiter';
import { Nexus } from '../core/Nexus';
import { LogisticsRequest, RequestPriority, RequestType } from '../logistics/LogisticsRequest';

export interface TerminalMemory {
  lastMarketCheck: number;
  activeOrders: string[];
  resourceTargets: { [resource: string]: number };
  tradeHistory: {
    [resource: string]: {
      avgBuyPrice: number;
      avgSellPrice: number;
      lastUpdate: number;
    };
  };
}

/**
 * Terminal Arbiter - Manages market trading and resource distribution
 */
export class TerminalArbiter extends Arbiter {
  terminal: StructureTerminal;
  
  constructor(Nexus: Nexus) {
    super(Nexus, 'terminal', ArbiterPriority.economy.hauling);
    
    if (!Nexus.terminal) {
      throw new Error('TerminalArbiter requires a terminal');
    }
    
    this.terminal = Nexus.terminal;
    
    // Initialize memory
    if (!this.memory.lastMarketCheck) {
      this.memory.lastMarketCheck = 0;
    }
    if (!this.memory.activeOrders) {
      this.memory.activeOrders = [];
    }
    if (!this.memory.resourceTargets) {
      this.memory.resourceTargets = this.getDefaultResourceTargets();
    }
    if (!this.memory.tradeHistory) {
      this.memory.tradeHistory = {};
    }
  }
  
  init(): void {
    // Clean up completed orders
    this.cleanupOrders();
    
    // Balance resources between colonies (every 50 ticks)
    if (Game.time % 50 === 0) {
      this.balanceResources();
    }
    
    // Check market opportunities (every 100 ticks)
    if (Game.time % 100 === 0) {
      this.checkMarket();
    }
  }
  
  run(): void {
    // Process active sell orders
    this.processSellOrders();
    
    // Manage energy levels
    this.manageEnergy();
    
    // Send excess minerals to other colonies if needed
    this.distributeExcessResources();
  }
  
  /**
   * Default resource targets for terminal storage
   */
  private getDefaultResourceTargets(): { [resource: string]: number } {
    return {
      energy: 50000,
      // Base minerals
      H: 5000,
      O: 5000,
      U: 5000,
      L: 5000,
      K: 5000,
      Z: 5000,
      X: 5000,
      // Tier 1 compounds
      OH: 1000,
      ZK: 1000,
      UL: 1000,
      G: 3000,
      // Power
      power: 1000
    };
  }
  
  /**
   * Clean up completed or cancelled orders
   */
  private cleanupOrders(): void {
    const activeOrders = this.memory.activeOrders.filter((orderId: string) => {
      const order = Game.market.getOrderById(orderId);
      return order && order.remainingAmount > 0;
    });
    
    this.memory.activeOrders = activeOrders;
  }
  
  /**
   * Balance resources with other Nexuses
   */
  private balanceResources(): void {
    const KHALA = (Game as any).cov;
    if (!KHALA) return;
    
    // Get all Nexuses with terminals
    const nexuses = Object.values(KHALA.nexuses).filter((hc: any) => 
      hc.terminal && hc.name !== this.Nexus.name
    ) as Nexus[];
    
    if (nexuses.length === 0) return;
    
    // Check for resources we have excess of
    for (const resourceType in this.terminal.store) {
      const resource = resourceType as ResourceConstant;
      const amount = this.terminal.store.getUsedCapacity(resource);
      const target = this.memory.resourceTargets[resource] || 0;
      
      // We have significant excess
      if (amount > target * 1.5 && amount > 5000) {
        // Find a Nexus that needs this resource
        for (const targetHC of nexuses) {
          if (!targetHC.terminal) continue;
          
          const targetAmount = targetHC.terminal.store.getUsedCapacity(resource);
          const targetNeeds = (this.memory.resourceTargets[resource] || 0) * 0.5;
          
          // They need it
          if (targetAmount < targetNeeds) {
            const sendAmount = Math.min(amount - target, target - targetAmount, 10000);
            
            if (sendAmount > 0) {
              const result = this.terminal.send(resource, sendAmount, targetHC.name);
              
              if (result === OK) {
                console.log(`📦 ${this.print}: Sent ${sendAmount} ${resource} to ${targetHC.name}`);
                return; // One transfer per tick
              }
            }
          }
        }
      }
    }
  }
  
  /**
   * Check market for trading opportunities
   */
  private checkMarket(): void {
    const phase = this.Nexus.memory.phase;
    
    // Only trade at mature/powerhouse phase
    if (phase !== 'mature' && phase !== 'powerhouse') return;
    
    // Sell excess resources
    this.sellExcessResources();
    
    // Buy needed resources
    this.buyNeededResources();
  }
  
  /**
   * Sell resources we have too much of
   */
  private sellExcessResources(): void {
    const SELL_THRESHOLD_MULTIPLIER = 2;
    
    for (const resourceType in this.terminal.store) {
      const resource = resourceType as ResourceConstant;
      
      // Don't sell energy through market (use transfer instead)
      if (resource === RESOURCE_ENERGY) continue;
      
      const amount = this.terminal.store.getUsedCapacity(resource);
      const target = this.memory.resourceTargets[resource] || 0;
      
      // We have significant excess
      if (amount > target * SELL_THRESHOLD_MULTIPLIER && amount > 1000) {
        // Check if we already have a sell order for this
        const existingOrder = this.memory.activeOrders.find((orderId: string) => {
          const order = Game.market.getOrderById(orderId);
          return order && order.resourceType === resource && order.type === ORDER_SELL;
        });
        
        if (existingOrder) continue; // Already selling
        
        // Get market price
        const marketOrders = Game.market.getAllOrders({ resourceType: resource, type: ORDER_BUY });
        if (marketOrders.length === 0) continue;
        
        // Sort by price descending
        marketOrders.sort((a, b) => b.price - a.price);
        const bestBuyOrder = marketOrders[0];
        
        // Create sell order at competitive price
        const sellPrice = bestBuyOrder.price * 0.95; // Slightly undercut
        const sellAmount = Math.min(amount - target, 10000);
        
        const result = Game.market.createOrder({
          type: ORDER_SELL,
          resourceType: resource,
          price: sellPrice,
          totalAmount: sellAmount,
          roomName: this.room.name
        });
        
        if (result === OK) {
          console.log(`💰 ${this.print}: Created sell order: ${sellAmount} ${resource} @ ${sellPrice.toFixed(3)}`);
          // Order ID will be added next tick during cleanup
        }
      }
    }
  }
  
  /**
   * Buy resources we need
   */
  private buyNeededResources(): void {
    const credits = Game.market.credits;
    
    // Don't trade if low on credits
    if (credits < 10000) return;
    
    const BUY_THRESHOLD_MULTIPLIER = 0.3;
    
    for (const resource in this.memory.resourceTargets) {
      const resourceType = resource as ResourceConstant;
      const target = this.memory.resourceTargets[resource];
      const amount = this.terminal.store.getUsedCapacity(resourceType);
      
      // We're significantly below target
      if (amount < target * BUY_THRESHOLD_MULTIPLIER) {
        // Get market price
        const marketOrders = Game.market.getAllOrders({ 
          resourceType: resourceType, 
          type: ORDER_SELL 
        });
        
        if (marketOrders.length === 0) continue;
        
        // Sort by price ascending
        marketOrders.sort((a, b) => a.price - b.price);
        const bestSellOrder = marketOrders[0];
        
        // Only buy if price is reasonable
        const avgPrice = this.getAveragePrice(resourceType);
        if (bestSellOrder.price > avgPrice * 1.5) continue; // Too expensive
        
        // Calculate how much to buy
        const buyAmount = Math.min(target - amount, bestSellOrder.amount, 5000);
        const cost = buyAmount * bestSellOrder.price;
        
        // Don't spend more than 20% of credits
        if (cost > credits * 0.2) continue;
        
        const result = Game.market.deal(bestSellOrder.id, buyAmount, this.room.name);
        
        if (result === OK) {
          console.log(`💎 ${this.print}: Bought ${buyAmount} ${resourceType} @ ${bestSellOrder.price.toFixed(3)} (${cost.toFixed(0)} credits)`);
          
          // Update trade history
          this.updateTradeHistory(resourceType, bestSellOrder.price, 'buy');
          return; // One deal per tick
        }
      }
    }
  }
  
  /**
   * Process active sell orders - fulfill them
   */
  private processSellOrders(): void {
    for (const orderId of this.memory.activeOrders) {
      const order = Game.market.getOrderById(orderId);
      if (!order || order.type !== ORDER_SELL) continue;
      
      // Check if we still have the resource
      const amount = this.terminal.store.getUsedCapacity(order.resourceType as ResourceConstant);
      if (amount < order.remainingAmount) {
        // Cancel order if we don't have enough
        Game.market.cancelOrder(orderId);
        console.log(`❌ ${this.print}: Cancelled sell order for ${order.resourceType} - insufficient stock`);
      }
    }
  }
  
  /**
   * Manage energy levels - buy if low, sell if high
   */
  private manageEnergy(): void {
    const energyAmount = this.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
    const target = this.memory.resourceTargets.energy || 50000;
    
    // Very low energy - consider buying
    if (energyAmount < 10000 && Game.market.credits > 50000) {
      const orders = Game.market.getAllOrders({ 
        resourceType: RESOURCE_ENERGY, 
        type: ORDER_SELL 
      });
      
      if (orders.length > 0) {
        orders.sort((a, b) => a.price - b.price);
        const bestOrder = orders[0];
        
        // Only buy if price is reasonable (< 1 credit per energy)
        if (bestOrder.price < 1) {
          const buyAmount = Math.min(target - energyAmount, bestOrder.amount, 20000);
          const cost = buyAmount * bestOrder.price;
          
          if (cost < Game.market.credits * 0.1) {
            Game.market.deal(bestOrder.id, buyAmount, this.room.name);
            console.log(`⚡ ${this.print}: Bought ${buyAmount} energy @ ${bestOrder.price.toFixed(3)}`);
          }
        }
      }
    }
  }
  
  /**
   * Distribute excess resources to storage
   */
  private distributeExcessResources(): void {
    // Move excess resources to storage if available
    if (!this.Nexus.storage) return;
    
    for (const resourceType in this.terminal.store) {
      const resource = resourceType as ResourceConstant;
      const amount = this.terminal.store.getUsedCapacity(resource);
      const target = this.memory.resourceTargets[resource] || 0;
      
      // Keep terminal organized - move excess to storage
      if (amount > target * 1.2 && amount > target + 5000) {
        const transferAmount = Math.min(amount - target, 5000);
        
        // Let HaulerArbiter handle the transfer via logistics network
        const request = new LogisticsRequest({
          id: `terminal_${resource}_${Game.time}`,
          resourceType: resource,
          amount: transferAmount,
          priority: RequestPriority.LOW,
          type: RequestType.DEPOSIT,
          target: this.Nexus.storage
        });
        
        this.Nexus.PylonNetwork.registerRequest(request);
      }
    }
  }
  
  /**
   * Get average historical price for a resource
   */
  private getAveragePrice(resourceType: ResourceConstant): number {
    const history = this.memory.tradeHistory[resourceType];
    
    if (!history) {
      // Default prices for common resources
      const defaults: { [key: string]: number } = {
        [RESOURCE_ENERGY]: 0.5,
        [RESOURCE_HYDROGEN]: 1,
        [RESOURCE_OXYGEN]: 1,
        [RESOURCE_UTRIUM]: 1.5,
        [RESOURCE_LEMERGIUM]: 1.5,
        [RESOURCE_KEANIUM]: 1.5,
        [RESOURCE_ZYNTHIUM]: 1.5,
        [RESOURCE_CATALYST]: 2,
        [RESOURCE_GHODIUM]: 5,
        [RESOURCE_POWER]: 10
      };
      
      return defaults[resourceType] || 2;
    }
    
    return (history.avgBuyPrice + history.avgSellPrice) / 2;
  }
  
  /**
   * Update trade history with new transaction
   */
  private updateTradeHistory(resourceType: ResourceConstant, price: number, type: 'buy' | 'sell'): void {
    if (!this.memory.tradeHistory[resourceType]) {
      this.memory.tradeHistory[resourceType] = {
        avgBuyPrice: price,
        avgSellPrice: price,
        lastUpdate: Game.time
      };
    } else {
      const history = this.memory.tradeHistory[resourceType];
      
      if (type === 'buy') {
        history.avgBuyPrice = (history.avgBuyPrice * 0.9) + (price * 0.1);
      } else {
        history.avgSellPrice = (history.avgSellPrice * 0.9) + (price * 0.1);
      }
      
      history.lastUpdate = Game.time;
    }
  }
  
  protected getCreepsForRole(): Creep[] {
    return []; // Terminal doesn't use creeps
  }
}
