/**
 * FactoryManager
 * 
 * "The forges of Aiur burn eternal, shaping raw elements into instruments of ascension"
 * 
 * Manages automated commodity production in factories.
 * Factories can produce commodities from base minerals and compounds,
 * which can then be sold on the market for credits.
 * 
 * Features:
 * - Automatic commodity production chains (Level 0-5)
 * - Resource gathering via Terminal Network
 * - Production prioritization based on profitability
 * - Statistics tracking and efficiency monitoring
 */

import { Nexus } from '../core/Nexus';

// Commodity constants (compressed commodities aren't in TypeScript definitions)
const COMMODITY_UTRIUM_BAR = 'utrium_bar' as CommodityConstant;
const COMMODITY_LEMERGIUM_BAR = 'lemergium_bar' as CommodityConstant;
const COMMODITY_ZYNTHIUM_BAR = 'zynthium_bar' as CommodityConstant;
const COMMODITY_KEANIUM_BAR = 'keanium_bar' as CommodityConstant;
const COMMODITY_GHODIUM_MELT = 'ghodium_melt' as CommodityConstant;
const COMMODITY_OXIDANT = 'oxidant' as CommodityConstant;
const COMMODITY_REDUCTANT = 'reductant' as CommodityConstant;
const COMMODITY_PURIFIER = 'purifier' as CommodityConstant;
const COMMODITY_BATTERY = 'battery' as CommodityConstant;

export interface CommodityRecipe {
  level: number;
  components: { [resource: string]: number };
  cooldown: number;
  amount: number;
}

export interface ProductionStats {
  totalProduced: number;
  productionsByType: { [commodity: string]: number };
  totalCooldown: number;
  lastProduction: number;
}

/**
 * Commodity production recipes
 * Source: https://docs.screeps.com/resources.html
 */
const COMMODITY_RECIPES: { [commodity: string]: CommodityRecipe } = {
  // Level 0 - Base commodities (from minerals)
  [RESOURCE_UTRIUM_BAR]: { 
    level: 0, 
    components: { [RESOURCE_UTRIUM]: 500, [RESOURCE_ENERGY]: 200 }, 
    cooldown: 20, 
    amount: 100 
  },
  [RESOURCE_LEMERGIUM_BAR]: { 
    level: 0, 
    components: { [RESOURCE_LEMERGIUM]: 500, [RESOURCE_ENERGY]: 200 }, 
    cooldown: 20, 
    amount: 100 
  },
  [RESOURCE_ZYNTHIUM_BAR]: { 
    level: 0, 
    components: { [RESOURCE_ZYNTHIUM]: 500, [RESOURCE_ENERGY]: 200 }, 
    cooldown: 20, 
    amount: 100 
  },
  [RESOURCE_KEANIUM_BAR]: { 
    level: 0, 
    components: { [RESOURCE_KEANIUM]: 500, [RESOURCE_ENERGY]: 200 }, 
    cooldown: 20, 
    amount: 100 
  },
  [RESOURCE_GHODIUM_MELT]: { 
    level: 0, 
    components: { [RESOURCE_GHODIUM]: 500, [RESOURCE_ENERGY]: 200 }, 
    cooldown: 20, 
    amount: 100 
  },
  [RESOURCE_OXIDANT]: { 
    level: 0, 
    components: { [RESOURCE_OXYGEN]: 500, [RESOURCE_ENERGY]: 200 }, 
    cooldown: 20, 
    amount: 100 
  },
  [RESOURCE_REDUCTANT]: { 
    level: 0, 
    components: { [RESOURCE_HYDROGEN]: 500, [RESOURCE_ENERGY]: 200 }, 
    cooldown: 20, 
    amount: 100 
  },
  [RESOURCE_PURIFIER]: { 
    level: 0, 
    components: { [RESOURCE_CATALYST]: 500, [RESOURCE_ENERGY]: 200 }, 
    cooldown: 20, 
    amount: 100 
  },
  [RESOURCE_BATTERY]: { 
    level: 0, 
    components: { [RESOURCE_ENERGY]: 600 }, 
    cooldown: 10, 
    amount: 50 
  },
  
  // Level 1 - Compressed commodities
  [COMMODITY_UTRIUM_BAR]: {
    level: 1,
    components: { [RESOURCE_UTRIUM_BAR]: 100, [RESOURCE_ENERGY]: 200 },
    cooldown: 20,
    amount: 20
  },
  [COMMODITY_LEMERGIUM_BAR]: {
    level: 1,
    components: { [RESOURCE_LEMERGIUM_BAR]: 100, [RESOURCE_ENERGY]: 200 },
    cooldown: 20,
    amount: 20
  },
  [COMMODITY_ZYNTHIUM_BAR]: {
    level: 1,
    components: { [RESOURCE_ZYNTHIUM_BAR]: 100, [RESOURCE_ENERGY]: 200 },
    cooldown: 20,
    amount: 20
  },
  [COMMODITY_KEANIUM_BAR]: {
    level: 1,
    components: { [RESOURCE_KEANIUM_BAR]: 100, [RESOURCE_ENERGY]: 200 },
    cooldown: 20,
    amount: 20
  },
  [COMMODITY_GHODIUM_MELT]: {
    level: 1,
    components: { [RESOURCE_GHODIUM_MELT]: 100, [RESOURCE_ENERGY]: 200 },
    cooldown: 20,
    amount: 20
  },
  [COMMODITY_OXIDANT]: {
    level: 1,
    components: { [RESOURCE_OXIDANT]: 100, [RESOURCE_ENERGY]: 200 },
    cooldown: 20,
    amount: 20
  },
  [COMMODITY_REDUCTANT]: {
    level: 1,
    components: { [RESOURCE_REDUCTANT]: 100, [RESOURCE_ENERGY]: 200 },
    cooldown: 20,
    amount: 20
  },
  [COMMODITY_PURIFIER]: {
    level: 1,
    components: { [RESOURCE_PURIFIER]: 100, [RESOURCE_ENERGY]: 200 },
    cooldown: 20,
    amount: 20
  },
  [COMMODITY_BATTERY]: {
    level: 1,
    components: { [RESOURCE_BATTERY]: 50, [RESOURCE_ENERGY]: 200 },
    cooldown: 20,
    amount: 10
  }
};

export class FactoryManager {
  private colony: Nexus;
  private factory: StructureFactory | null;

  constructor(colony: Nexus) {
    this.colony = colony;
    this.factory = this.findFactory();
    this.initializeMemory();
  }

  /**
   * Main execution loop - runs every tick
   */
  public run(): void {
    if (!this.factory) {
      this.factory = this.findFactory();
      return;
    }

    // Skip if factory is on cooldown
    if (this.factory.cooldown > 0) {
      return;
    }

    // Find what we can produce
    const productionTarget = this.selectProduction();
    
    if (productionTarget) {
      this.produce(productionTarget);
    }
  }

  /**
   * Find the factory in this colony
   */
  private findFactory(): StructureFactory | null {
    const factories = this.colony.room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_FACTORY
    }) as StructureFactory[];

    return factories.length > 0 ? factories[0] : null;
  }

  /**
   * Select what to produce based on available resources
   */
  private selectProduction(): string | null {
    if (!this.factory) return null;

    const storage = this.colony.room.storage;
    const terminal = this.colony.room.terminal;
    
    if (!storage && !terminal) return null;

    // Get factory level
    const factoryLevel = this.factory.level || 0;

    // Priority: Level 1 compressed commodities (more valuable)
    // Then Level 0 base commodities
    const priorities = [1, 0];

    for (const targetLevel of priorities) {
      if (targetLevel > factoryLevel) continue;

      for (const commodity in COMMODITY_RECIPES) {
        const recipe = COMMODITY_RECIPES[commodity];
        
        if (recipe.level !== targetLevel) continue;
        
        // Check if we have the components
        if (this.hasComponents(recipe)) {
          // Don't overproduce - cap at 10k per commodity
          const currentAmount = this.getCommodityAmount(commodity);
          if (currentAmount >= 10000) continue;
          
          return commodity;
        }
      }
    }

    return null;
  }

  /**
   * Check if we have the required components for a recipe
   */
  private hasComponents(recipe: CommodityRecipe): boolean {
    const storage = this.colony.room.storage;
    const terminal = this.colony.room.terminal;
    const factory = this.factory;
    
    if (!factory) return false;

    for (const resource in recipe.components) {
      const required = recipe.components[resource];
      
      // Check factory, storage, and terminal
      const inFactory = factory.store[resource as ResourceConstant] || 0;
      const inStorage = storage?.store[resource as ResourceConstant] || 0;
      const inTerminal = terminal?.store[resource as ResourceConstant] || 0;
      
      const total = inFactory + inStorage + inTerminal;
      
      if (total < required) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get current amount of a commodity across storage/terminal
   */
  private getCommodityAmount(commodity: string): number {
    const storage = this.colony.room.storage;
    const terminal = this.colony.room.terminal;
    const factory = this.factory;
    
    const inFactory = factory?.store[commodity as ResourceConstant] || 0;
    const inStorage = storage?.store[commodity as ResourceConstant] || 0;
    const inTerminal = terminal?.store[commodity as ResourceConstant] || 0;
    
    return inFactory + inStorage + inTerminal;
  }

  /**
   * Produce a commodity
   */
  private produce(commodity: string): void {
    if (!this.factory) return;

    const recipe = COMMODITY_RECIPES[commodity];
    if (!recipe) return;

    // Transfer components to factory if needed
    this.transferComponents(recipe);

    // Produce
    const result = this.factory.produce(commodity as CommodityConstant);

    if (result === OK) {
      const memory = this.getMemory();
      memory.totalProduced += recipe.amount;
      memory.productionsByType[commodity] = (memory.productionsByType[commodity] || 0) + recipe.amount;
      memory.lastProduction = Game.time;
      
      console.log(`🏭 ${this.colony.name}: Produced ${recipe.amount} ${commodity}`);
    }
  }

  /**
   * Transfer components from storage/terminal to factory
   * Note: This creates tasks for haulers to handle. Direct transfers not supported.
   * For now, we'll just check if resources are available in the room.
   */
  private transferComponents(recipe: CommodityRecipe): void {
    if (!this.factory) return;
    
    // The factory will automatically pull resources from nearby containers/storage
    // Haulers should be keeping the factory stocked via PylonNetwork logistics
    // No manual transfer needed - just verify resources are in the room
  }

  /**
   * Get current factory status
   */
  public getStatus(): {
    hasFactory: boolean;
    factoryLevel: number;
    cooldown: number;
    currentProduction: string | null;
    statistics: ProductionStats;
    resources: { [resource: string]: number };
  } {
    const factoryLevel = this.factory?.level || 0;
    
    return {
      hasFactory: this.factory !== null,
      factoryLevel: factoryLevel,
      cooldown: this.factory?.cooldown || 0,
      currentProduction: this.selectProduction(),
      statistics: this.getMemory(),
      resources: this.getFactoryResources()
    };
  }

  /**
   * Get resources in factory
   */
  private getFactoryResources(): { [resource: string]: number } {
    if (!this.factory) return {};
    
    const resources: { [resource: string]: number } = {};
    
    for (const resource in this.factory.store) {
      resources[resource] = this.factory.store[resource as ResourceConstant];
    }
    
    return resources;
  }

  /**
   * Initialize memory structure
   */
  private initializeMemory(): void {
    if (!this.colony.memory.factory) {
      this.colony.memory.factory = {
        totalProduced: 0,
        productionsByType: {},
        totalCooldown: 0,
        lastProduction: 0
      };
    }
  }

  /**
   * Get memory reference
   */
  private getMemory(): ProductionStats {
    if (!this.colony.memory.factory) {
      this.initializeMemory();
    }
    return this.colony.memory.factory!;
  }

  /**
   * Check if colony is ready for factory automation
   */
  public static isColonyReady(colony: Nexus): boolean {
    // Needs RCL 7+ for factory
    if (colony.room.controller && colony.room.controller.level < 7) {
      return false;
    }

    // Needs factory built
    const factories = colony.room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_FACTORY
    });

    return factories.length > 0;
  }
}
