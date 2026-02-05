/**
 * MARKET MANAGER - Automated Trading System
 * 
 * "Credits flow like the will of the Prophets"
 * 
 * Intelligent market trading system that automatically:
 * - Sells excess resources for profit
 * - Buys needed resources at good prices
 * - Manages credit balance
 * - Tracks price history and trends
 */

/// <reference types="@types/screeps" />

import { Nexus } from '../core/Nexus';

export interface MarketManagerMemory {
  priceHistory: {
    [resource: string]: {
      buy: number[];  // Last 10 buy prices
      sell: number[]; // Last 10 sell prices
      lastUpdate: number;
    };
  };
  tradeLog: {
    resource: ResourceConstant;
    amount: number;
    price: number;
    type: 'buy' | 'sell';
    tick: number;
  }[];
  autoTradeEnabled: boolean;
  minCredits: number; // Don't spend below this
  sellThresholds: { [resource: string]: number }; // Sell when above this
  buyThresholds: { [resource: string]: number };  // Buy when below this
  commodityStats?: {
    totalSold: number;
    totalCreditsEarned: number;
    salesByType: { [commodity: string]: { amount: number; credits: number } };
  };
}

export interface TradeOpportunity {
  resource: ResourceConstant;
  type: 'buy' | 'sell';
  amount: number;
  price: number;
  profit: number;
  roomName: string;
}

/**
 * Market Manager - Automated trading intelligence
 */
export class MarketManager {
  Nexus: Nexus;
  room: Room;
  terminal: StructureTerminal | null;
  memory: MarketManagerMemory;
  
  constructor(Nexus: Nexus) {
    this.Nexus = Nexus;
    this.room = Nexus.room;
    this.terminal = Nexus.terminal || null;
    
    // Initialize memory
    const roomMem: any = Memory.rooms[this.room.name];
    if (!roomMem.market) {
      roomMem.market = {
        priceHistory: {},
        tradeLog: [],
        autoTradeEnabled: true,
        minCredits: 10000,
        sellThresholds: this.getDefaultSellThresholds(),
        buyThresholds: this.getDefaultBuyThresholds(),
        commodityStats: {
          totalSold: 0,
          totalCreditsEarned: 0,
          salesByType: {}
        }
      };
    }
    this.memory = roomMem.market;
  }
  
  /**
   * Run market operations
   */
  run(): void {
    if (!this.terminal || !this.memory.autoTradeEnabled) return;
    
    // Update price history every 100 ticks
    if (Game.time % 100 === 0) {
      this.updatePriceHistory();
    }
    
    // Check for sell opportunities every 50 ticks
    if (Game.time % 50 === 0) {
      this.checkSellOpportunities();
    }
    
    // Check for buy opportunities every 75 ticks
    if (Game.time % 75 === 25) {
      this.checkBuyOpportunities();
    }
    
    // Clean up old trade logs
    if (Game.time % 1000 === 0) {
      this.cleanupTradeLogs();
    }
  }
  
  /**
   * Default sell thresholds (sell when storage + terminal exceeds this)
   */
  private getDefaultSellThresholds(): { [resource: string]: number } {
    return {
      energy: 300000,
      power: 5000,
      // Base minerals
      H: 50000,
      O: 50000,
      U: 50000,
      L: 50000,
      K: 50000,
      Z: 50000,
      X: 50000,
      // Tier 1 compounds
      OH: 10000,
      ZK: 10000,
      UL: 10000,
      G: 10000,
      // Tier 2 compounds
      UH: 3000,
      UO: 3000,
      KH: 3000,
      KO: 3000,
      LH: 3000,
      LO: 3000,
      ZH: 3000,
      ZO: 3000,
      GH: 3000,
      GO: 3000,
      // Factory commodities - Level 0 (bars, melts, etc)
      [RESOURCE_UTRIUM_BAR]: 1000,
      [RESOURCE_LEMERGIUM_BAR]: 1000,
      [RESOURCE_ZYNTHIUM_BAR]: 1000,
      [RESOURCE_KEANIUM_BAR]: 1000,
      [RESOURCE_GHODIUM_MELT]: 1000,
      [RESOURCE_OXIDANT]: 1000,
      [RESOURCE_REDUCTANT]: 1000,
      [RESOURCE_PURIFIER]: 1000,
      [RESOURCE_BATTERY]: 1000
    };
  }
  
  /**
   * Default buy thresholds (buy when storage + terminal below this)
   */
  private getDefaultBuyThresholds(): { [resource: string]: number } {
    return {
      energy: 50000,
      power: 500,
      // Base minerals - always keep minimum stock
      H: 5000,
      O: 5000,
      U: 5000,
      L: 5000,
      K: 5000,
      Z: 5000,
      X: 5000,
      // Compounds for boosting
      catalyzedGhodiumAlkalide: 100, // XGH2O
      catalyzedGhodiumAcid: 100,     // XGH2A
      catalyzedZynthiumAlkalide: 100, // XZH2O
      catalyzedZynthiumAcid: 100,     // XZH2A
      catalyzedKeaniumAlkalide: 100,  // XKH2O
      catalyzedKeaniumAcid: 100,      // XKH2A
      catalyzedLemergiumAlkalide: 100,// XLH2O
      catalyzedLemergiumAcid: 100,    // XLH2A
      catalyzedUtriumAlkalide: 100,   // XUH2O
      catalyzedUtriumAcid: 100        // XUHO2
    };
  }
  
  /**
   * Update price history from market orders
   */
  private updatePriceHistory(): void {
    const resources: ResourceConstant[] = [
      RESOURCE_ENERGY, RESOURCE_POWER,
      RESOURCE_HYDROGEN, RESOURCE_OXYGEN, RESOURCE_UTRIUM, RESOURCE_LEMERGIUM,
      RESOURCE_KEANIUM, RESOURCE_ZYNTHIUM, RESOURCE_CATALYST, RESOURCE_GHODIUM
    ];
    
    for (const resource of resources) {
      const buyOrders = Game.market.getAllOrders({
        type: ORDER_BUY,
        resourceType: resource
      }).sort((a, b) => b.price - a.price).slice(0, 5);
      
      const sellOrders = Game.market.getAllOrders({
        type: ORDER_SELL,
        resourceType: resource
      }).sort((a, b) => a.price - b.price).slice(0, 5);
      
      if (buyOrders.length > 0 || sellOrders.length > 0) {
        if (!this.memory.priceHistory[resource]) {
          this.memory.priceHistory[resource] = {
            buy: [],
            sell: [],
            lastUpdate: 0
          };
        }
        
        const history = this.memory.priceHistory[resource];
        
        if (buyOrders.length > 0) {
          const avgBuy = buyOrders.reduce((sum, o) => sum + o.price, 0) / buyOrders.length;
          history.buy.push(avgBuy);
          if (history.buy.length > 10) history.buy.shift();
        }
        
        if (sellOrders.length > 0) {
          const avgSell = sellOrders.reduce((sum, o) => sum + o.price, 0) / sellOrders.length;
          history.sell.push(avgSell);
          if (history.sell.length > 10) history.sell.shift();
        }
        
        history.lastUpdate = Game.time;
      }
    }
  }
  
  /**
   * Check for profitable sell opportunities
   */
  private checkSellOpportunities(): void {
    if (!this.terminal) return;
    
    const storage = this.Nexus.storage;
    if (!storage) return;
    
    // Check each resource type
    for (const resourceType in this.terminal.store) {
      const resource = resourceType as ResourceConstant;
      
      // Skip if we don't have enough
      const terminalAmount = this.terminal.store.getUsedCapacity(resource);
      const storageAmount = storage.store.getUsedCapacity(resource);
      const totalAmount = terminalAmount + storageAmount;
      
      const sellThreshold = this.memory.sellThresholds[resource];
      if (!sellThreshold || totalAmount < sellThreshold) continue;
      
      // We have excess - check if price is good
      const excessAmount = totalAmount - sellThreshold;
      const sellAmount = Math.min(excessAmount, terminalAmount, 10000);
      
      if (sellAmount < 100) continue; // Not worth the transaction cost
      
      // Find best buy orders
      const buyOrders = Game.market.getAllOrders({
        type: ORDER_BUY,
        resourceType: resource
      }).filter(order => order.amount >= 100)
        .sort((a, b) => b.price - a.price);
      
      if (buyOrders.length === 0) continue;
      
      const bestOrder = buyOrders[0];
      const avgMarketPrice = this.getAveragePrice(resource, 'buy');
      
      // Only sell if price is above 80% of historical average (or no history)
      if (avgMarketPrice > 0 && bestOrder.price < avgMarketPrice * 0.8) continue;
      
      // Calculate profit after transaction cost
      const transferCost = Game.market.calcTransactionCost(sellAmount, this.room.name, bestOrder.roomName!);
      const profit = sellAmount * bestOrder.price;
      
      // Need enough energy for transfer
      if (this.terminal.store.getUsedCapacity(RESOURCE_ENERGY) < transferCost) continue;
      
      // Profitable trade!
      if (profit > 100) {
        this.executeSell(resource, sellAmount, bestOrder);
      }
    }
  }
  
  /**
   * Check for good buy opportunities
   */
  private checkBuyOpportunities(): void {
    if (!this.terminal) return;
    if (Game.market.credits < this.memory.minCredits + 5000) return; // Keep reserve
    
    const storage = this.Nexus.storage;
    if (!storage) return;
    
    // Check resources we need
    for (const resource in this.memory.buyThresholds) {
      const resourceType = resource as ResourceConstant;
      const threshold = this.memory.buyThresholds[resource];
      
      const terminalAmount = this.terminal.store.getUsedCapacity(resourceType) || 0;
      const storageAmount = storage.store.getUsedCapacity(resourceType) || 0;
      const totalAmount = terminalAmount + storageAmount;
      
      // We need this resource
      if (totalAmount < threshold) {
        const buyAmount = Math.min(threshold - totalAmount, 10000);
        
        if (buyAmount < 100) continue;
        
        // Find best sell orders
        const sellOrders = Game.market.getAllOrders({
          type: ORDER_SELL,
          resourceType: resourceType
        }).filter(order => order.amount >= buyAmount)
          .sort((a, b) => a.price - b.price);
        
        if (sellOrders.length === 0) continue;
        
        const bestOrder = sellOrders[0];
        const avgMarketPrice = this.getAveragePrice(resourceType, 'sell');
        
        // Only buy if price is below 120% of historical average (or no history)
        if (avgMarketPrice > 0 && bestOrder.price > avgMarketPrice * 1.2) continue;
        
        const totalCost = buyAmount * bestOrder.price;
        
        // Don't overspend
        if (Game.market.credits < this.memory.minCredits + totalCost) continue;
        
        // Good deal!
        if (totalCost < 5000 || bestOrder.price <= avgMarketPrice * 1.1) {
          this.executeBuy(resourceType, buyAmount, bestOrder);
        }
      }
    }
  }
  
  /**
   * Execute a sell order
   */
  private executeSell(resource: ResourceConstant, amount: number, order: Order): void {
    if (!this.terminal) return;
    
    const result = Game.market.deal(order.id, amount, this.room.name);
    
    if (result === OK) {
      const revenue = amount * order.price;
      
      console.log(
        `💰 SOLD ${amount} ${resource} for ${revenue.toFixed(0)} credits ` +
        `(${order.price.toFixed(3)} each) in ${this.room.name}`
      );
      
      // Log trade
      this.memory.tradeLog.push({
        resource,
        amount,
        price: order.price,
        type: 'sell',
        tick: Game.time
      });
    } else {
      console.log(`❌ Failed to sell ${resource}: ${result}`);
    }
  }
  
  /**
   * Execute a buy order
   */
  private executeBuy(resource: ResourceConstant, amount: number, order: Order): void {
    if (!this.terminal) return;
    
    const result = Game.market.deal(order.id, amount, this.room.name);
    
    if (result === OK) {
      const cost = amount * order.price;
      
      console.log(
        `🛒 BOUGHT ${amount} ${resource} for ${cost.toFixed(0)} credits ` +
        `(${order.price.toFixed(3)} each) in ${this.room.name}`
      );
      
      // Log trade
      this.memory.tradeLog.push({
        resource,
        amount,
        price: order.price,
        type: 'buy',
        tick: Game.time
      });
    } else {
      console.log(`❌ Failed to buy ${resource}: ${result}`);
    }
  }
  
  /**
   * Get average price from history
   */
  private getAveragePrice(resource: ResourceConstant, type: 'buy' | 'sell'): number {
    const history = this.memory.priceHistory[resource];
    if (!history) return 0;
    
    const prices = type === 'buy' ? history.buy : history.sell;
    if (prices.length === 0) return 0;
    
    return prices.reduce((sum, p) => sum + p, 0) / prices.length;
  }
  
  /**
   * Clean up old trade logs (keep last 100)
   */
  private cleanupTradeLogs(): void {
    if (this.memory.tradeLog.length > 100) {
      this.memory.tradeLog = this.memory.tradeLog.slice(-100);
    }
  }
  
  /**
   * Enable/disable auto trading
   */
  setAutoTrade(enabled: boolean): void {
    this.memory.autoTradeEnabled = enabled;
    console.log(`Market auto-trading ${enabled ? 'enabled' : 'disabled'} for ${this.room.name}`);
  }
  
  /**
   * Set minimum credit reserve
   */
  setMinCredits(amount: number): void {
    this.memory.minCredits = amount;
    console.log(`Minimum credit reserve set to ${amount} for ${this.room.name}`);
  }
  
  /**
   * Get trading statistics
   */
  getStats(): string {
    const recentTrades = this.memory.tradeLog.slice(-20);
    
    const buyTrades = recentTrades.filter(t => t.type === 'buy');
    const sellTrades = recentTrades.filter(t => t.type === 'sell');
    
    const totalBought = buyTrades.reduce((sum, t) => sum + (t.amount * t.price), 0);
    const totalSold = sellTrades.reduce((sum, t) => sum + (t.amount * t.price), 0);
    const netProfit = totalSold - totalBought;
    
    let stats = (
      `Market Manager - ${this.room.name}\n` +
      `  Credits: ${Game.market.credits.toLocaleString()}\n` +
      `  Min Reserve: ${this.memory.minCredits.toLocaleString()}\n` +
      `  Auto Trade: ${this.memory.autoTradeEnabled ? 'ON' : 'OFF'}\n` +
      `  Recent Trades (last 20):\n` +
      `    Bought: ${buyTrades.length} orders (${totalBought.toFixed(0)} credits)\n` +
      `    Sold: ${sellTrades.length} orders (${totalSold.toFixed(0)} credits)\n` +
      `    Net Profit: ${netProfit >= 0 ? '+' : ''}${netProfit.toFixed(0)} credits`
    );
    
    // Add commodity sales stats
    if (this.memory.commodityStats && this.memory.commodityStats.totalSold > 0) {
      stats += `\n  Commodity Sales (Lifetime):\n`;
      stats += `    Total Sold: ${this.memory.commodityStats.totalSold.toLocaleString()}\n`;
      stats += `    Total Revenue: ${this.memory.commodityStats.totalCreditsEarned.toLocaleString()} credits`;
    }
    
    return stats;
  }
  
  /**
   * Check if a resource is a commodity
   */
  private isCommodity(resource: ResourceConstant): boolean {
    const commodities = [
      RESOURCE_UTRIUM_BAR, RESOURCE_LEMERGIUM_BAR, RESOURCE_ZYNTHIUM_BAR,
      RESOURCE_KEANIUM_BAR, RESOURCE_GHODIUM_MELT, RESOURCE_OXIDANT,
      RESOURCE_REDUCTANT, RESOURCE_PURIFIER, RESOURCE_BATTERY,
      'utrium_bar', 'lemergium_bar', 'zynthium_bar', 'keanium_bar',
      'ghodium_melt', 'oxidant', 'reductant', 'purifier', 'battery'
    ];
    return commodities.includes(resource);
  }
  
  /**
   * Get price report for a resource
   */
  getPriceReport(resource: ResourceConstant): string {
    const history = this.memory.priceHistory[resource];
    if (!history) {
      return `No price history for ${resource}`;
    }
    
    const avgBuy = this.getAveragePrice(resource, 'buy');
    const avgSell = this.getAveragePrice(resource, 'sell');
    
    const storage = this.Nexus.storage;
    const terminal = this.terminal;
    
    const storageAmount = storage?.store.getUsedCapacity(resource) || 0;
    const terminalAmount = terminal?.store.getUsedCapacity(resource) || 0;
    const totalAmount = storageAmount + terminalAmount;
    
    const sellThreshold = this.memory.sellThresholds[resource] || 0;
    const buyThreshold = this.memory.buyThresholds[resource] || 0;
    
    return (
      `${resource} Market Report\n` +
      `  Stock: ${totalAmount.toLocaleString()} (Storage: ${storageAmount}, Terminal: ${terminalAmount})\n` +
      `  Sell Threshold: ${sellThreshold.toLocaleString()}\n` +
      `  Buy Threshold: ${buyThreshold.toLocaleString()}\n` +
      `  Avg Buy Price: ${avgBuy.toFixed(3)} credits\n` +
      `  Avg Sell Price: ${avgSell.toFixed(3)} credits\n` +
      `  Last Updated: ${Game.time - history.lastUpdate} ticks ago`
    );
  }
}
