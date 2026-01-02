/**
 * REACTION PLANNER - Automatic Compound Production
 * 
 * "Through the sacred alchemy, power manifests"
 * 
 * Intelligent reaction planning system that automatically:
 * - Plans multi-tier reaction chains
 * - Calculates ingredient requirements
 * - Produces compounds based on stock levels
 * - Prioritizes high-value boosts
 */

/// <reference types="@types/screeps" />

export interface ReactionChain {
  product: MineralCompoundConstant;
  ingredient1: ResourceConstant;
  ingredient2: ResourceConstant;
  tier: number; // 0=base, 1=tier1, 2=tier2, 3=tier3
  dependencies: ResourceConstant[]; // All ingredients needed
}

/**
 * Complete reaction database with tiers
 */
export const REACTION_CHAINS: { [key: string]: ReactionChain } = {
  // Tier 1 - Base compounds
  OH: { product: 'OH' as MineralCompoundConstant, ingredient1: RESOURCE_OXYGEN, ingredient2: RESOURCE_HYDROGEN, tier: 1, dependencies: [RESOURCE_OXYGEN, RESOURCE_HYDROGEN] },
  ZK: { product: 'ZK' as MineralCompoundConstant, ingredient1: RESOURCE_ZYNTHIUM, ingredient2: RESOURCE_KEANIUM, tier: 1, dependencies: [RESOURCE_ZYNTHIUM, RESOURCE_KEANIUM] },
  UL: { product: 'UL' as MineralCompoundConstant, ingredient1: RESOURCE_UTRIUM, ingredient2: RESOURCE_LEMERGIUM, tier: 1, dependencies: [RESOURCE_UTRIUM, RESOURCE_LEMERGIUM] },
  G: { product: 'G' as MineralCompoundConstant, ingredient1: RESOURCE_ZYNTHIUM, ingredient2: RESOURCE_KEANIUM, tier: 1, dependencies: [RESOURCE_ZYNTHIUM, RESOURCE_KEANIUM] },
  
  // Tier 2 - Advanced compounds
  UH: { product: 'UH' as MineralCompoundConstant, ingredient1: RESOURCE_UTRIUM, ingredient2: RESOURCE_HYDROGEN, tier: 2, dependencies: [RESOURCE_UTRIUM, RESOURCE_HYDROGEN] },
  UO: { product: 'UO' as MineralCompoundConstant, ingredient1: RESOURCE_UTRIUM, ingredient2: RESOURCE_OXYGEN, tier: 2, dependencies: [RESOURCE_UTRIUM, RESOURCE_OXYGEN] },
  KH: { product: 'KH' as MineralCompoundConstant, ingredient1: RESOURCE_KEANIUM, ingredient2: RESOURCE_HYDROGEN, tier: 2, dependencies: [RESOURCE_KEANIUM, RESOURCE_HYDROGEN] },
  KO: { product: 'KO' as MineralCompoundConstant, ingredient1: RESOURCE_KEANIUM, ingredient2: RESOURCE_OXYGEN, tier: 2, dependencies: [RESOURCE_KEANIUM, RESOURCE_OXYGEN] },
  LH: { product: 'LH' as MineralCompoundConstant, ingredient1: RESOURCE_LEMERGIUM, ingredient2: RESOURCE_HYDROGEN, tier: 2, dependencies: [RESOURCE_LEMERGIUM, RESOURCE_HYDROGEN] },
  LO: { product: 'LO' as MineralCompoundConstant, ingredient1: RESOURCE_LEMERGIUM, ingredient2: RESOURCE_OXYGEN, tier: 2, dependencies: [RESOURCE_LEMERGIUM, RESOURCE_OXYGEN] },
  ZH: { product: 'ZH' as MineralCompoundConstant, ingredient1: RESOURCE_ZYNTHIUM, ingredient2: RESOURCE_HYDROGEN, tier: 2, dependencies: [RESOURCE_ZYNTHIUM, RESOURCE_HYDROGEN] },
  ZO: { product: 'ZO' as MineralCompoundConstant, ingredient1: RESOURCE_ZYNTHIUM, ingredient2: RESOURCE_OXYGEN, tier: 2, dependencies: [RESOURCE_ZYNTHIUM, RESOURCE_OXYGEN] },
  GH: { product: 'GH' as MineralCompoundConstant, ingredient1: RESOURCE_GHODIUM, ingredient2: RESOURCE_HYDROGEN, tier: 2, dependencies: [RESOURCE_GHODIUM, RESOURCE_HYDROGEN] },
  GO: { product: 'GO' as MineralCompoundConstant, ingredient1: RESOURCE_GHODIUM, ingredient2: RESOURCE_OXYGEN, tier: 2, dependencies: [RESOURCE_GHODIUM, RESOURCE_OXYGEN] },
  
  // Tier 3 - Boosted compounds (require OH)
  UH2O: { product: 'UH2O' as MineralCompoundConstant, ingredient1: 'UH' as ResourceConstant, ingredient2: 'OH' as ResourceConstant, tier: 3, dependencies: [RESOURCE_UTRIUM, RESOURCE_HYDROGEN, RESOURCE_OXYGEN, RESOURCE_HYDROGEN] },
  UHO2: { product: 'UHO2' as MineralCompoundConstant, ingredient1: 'UO' as ResourceConstant, ingredient2: 'OH' as ResourceConstant, tier: 3, dependencies: [RESOURCE_UTRIUM, RESOURCE_OXYGEN, RESOURCE_OXYGEN, RESOURCE_HYDROGEN] },
  KH2O: { product: 'KH2O' as MineralCompoundConstant, ingredient1: 'KH' as ResourceConstant, ingredient2: 'OH' as ResourceConstant, tier: 3, dependencies: [RESOURCE_KEANIUM, RESOURCE_HYDROGEN, RESOURCE_OXYGEN, RESOURCE_HYDROGEN] },
  KHO2: { product: 'KHO2' as MineralCompoundConstant, ingredient1: 'KO' as ResourceConstant, ingredient2: 'OH' as ResourceConstant, tier: 3, dependencies: [RESOURCE_KEANIUM, RESOURCE_OXYGEN, RESOURCE_OXYGEN, RESOURCE_HYDROGEN] },
  LH2O: { product: 'LH2O' as MineralCompoundConstant, ingredient1: 'LH' as ResourceConstant, ingredient2: 'OH' as ResourceConstant, tier: 3, dependencies: [RESOURCE_LEMERGIUM, RESOURCE_HYDROGEN, RESOURCE_OXYGEN, RESOURCE_HYDROGEN] },
  LHO2: { product: 'LHO2' as MineralCompoundConstant, ingredient1: 'LO' as ResourceConstant, ingredient2: 'OH' as ResourceConstant, tier: 3, dependencies: [RESOURCE_LEMERGIUM, RESOURCE_OXYGEN, RESOURCE_OXYGEN, RESOURCE_HYDROGEN] },
  ZH2O: { product: 'ZH2O' as MineralCompoundConstant, ingredient1: 'ZH' as ResourceConstant, ingredient2: 'OH' as ResourceConstant, tier: 3, dependencies: [RESOURCE_ZYNTHIUM, RESOURCE_HYDROGEN, RESOURCE_OXYGEN, RESOURCE_HYDROGEN] },
  ZHO2: { product: 'ZHO2' as MineralCompoundConstant, ingredient1: 'ZO' as ResourceConstant, ingredient2: 'OH' as ResourceConstant, tier: 3, dependencies: [RESOURCE_ZYNTHIUM, RESOURCE_OXYGEN, RESOURCE_OXYGEN, RESOURCE_HYDROGEN] },
  GH2O: { product: 'GH2O' as MineralCompoundConstant, ingredient1: 'GH' as ResourceConstant, ingredient2: 'OH' as ResourceConstant, tier: 3, dependencies: [RESOURCE_GHODIUM, RESOURCE_HYDROGEN, RESOURCE_OXYGEN, RESOURCE_HYDROGEN] },
  GHO2: { product: 'GHO2' as MineralCompoundConstant, ingredient1: 'GO' as ResourceConstant, ingredient2: 'OH' as ResourceConstant, tier: 3, dependencies: [RESOURCE_GHODIUM, RESOURCE_OXYGEN, RESOURCE_OXYGEN, RESOURCE_HYDROGEN] },
  
  // Tier 4 - Catalyzed (final tier)
  XUH2O: { product: 'XUH2O' as MineralCompoundConstant, ingredient1: 'UH2O' as ResourceConstant, ingredient2: RESOURCE_CATALYST, tier: 4, dependencies: [RESOURCE_UTRIUM, RESOURCE_HYDROGEN, RESOURCE_OXYGEN, RESOURCE_HYDROGEN, RESOURCE_CATALYST] },
  XUHO2: { product: 'XUHO2' as MineralCompoundConstant, ingredient1: 'UHO2' as ResourceConstant, ingredient2: RESOURCE_CATALYST, tier: 4, dependencies: [RESOURCE_UTRIUM, RESOURCE_OXYGEN, RESOURCE_OXYGEN, RESOURCE_HYDROGEN, RESOURCE_CATALYST] },
  XKH2O: { product: 'XKH2O' as MineralCompoundConstant, ingredient1: 'KH2O' as ResourceConstant, ingredient2: RESOURCE_CATALYST, tier: 4, dependencies: [RESOURCE_KEANIUM, RESOURCE_HYDROGEN, RESOURCE_OXYGEN, RESOURCE_HYDROGEN, RESOURCE_CATALYST] },
  XKHO2: { product: 'XKHO2' as MineralCompoundConstant, ingredient1: 'KHO2' as ResourceConstant, ingredient2: RESOURCE_CATALYST, tier: 4, dependencies: [RESOURCE_KEANIUM, RESOURCE_OXYGEN, RESOURCE_OXYGEN, RESOURCE_HYDROGEN, RESOURCE_CATALYST] },
  XLH2O: { product: 'XLH2O' as MineralCompoundConstant, ingredient1: 'LH2O' as ResourceConstant, ingredient2: RESOURCE_CATALYST, tier: 4, dependencies: [RESOURCE_LEMERGIUM, RESOURCE_HYDROGEN, RESOURCE_OXYGEN, RESOURCE_HYDROGEN, RESOURCE_CATALYST] },
  XLHO2: { product: 'XLHO2' as MineralCompoundConstant, ingredient1: 'LHO2' as ResourceConstant, ingredient2: RESOURCE_CATALYST, tier: 4, dependencies: [RESOURCE_LEMERGIUM, RESOURCE_OXYGEN, RESOURCE_OXYGEN, RESOURCE_HYDROGEN, RESOURCE_CATALYST] },
  XZH2O: { product: 'XZH2O' as MineralCompoundConstant, ingredient1: 'ZH2O' as ResourceConstant, ingredient2: RESOURCE_CATALYST, tier: 4, dependencies: [RESOURCE_ZYNTHIUM, RESOURCE_HYDROGEN, RESOURCE_OXYGEN, RESOURCE_HYDROGEN, RESOURCE_CATALYST] },
  XZHO2: { product: 'XZHO2' as MineralCompoundConstant, ingredient1: 'ZHO2' as ResourceConstant, ingredient2: RESOURCE_CATALYST, tier: 4, dependencies: [RESOURCE_ZYNTHIUM, RESOURCE_OXYGEN, RESOURCE_OXYGEN, RESOURCE_HYDROGEN, RESOURCE_CATALYST] },
  XGH2O: { product: 'XGH2O' as MineralCompoundConstant, ingredient1: 'GH2O' as ResourceConstant, ingredient2: RESOURCE_CATALYST, tier: 4, dependencies: [RESOURCE_GHODIUM, RESOURCE_HYDROGEN, RESOURCE_OXYGEN, RESOURCE_HYDROGEN, RESOURCE_CATALYST] },
  XGHO2: { product: 'XGHO2' as MineralCompoundConstant, ingredient1: 'GHO2' as ResourceConstant, ingredient2: RESOURCE_CATALYST, tier: 4, dependencies: [RESOURCE_GHODIUM, RESOURCE_OXYGEN, RESOURCE_OXYGEN, RESOURCE_HYDROGEN, RESOURCE_CATALYST] }
};

/**
 * Boost priority for auto-production (higher = more important)
 */
export const BOOST_PRIORITY: { [key: string]: number } = {
  // Tier 4 boosts (highest priority)
  XUH2O: 100, // attack +300%
  XUHO2: 90,  // heal +300%
  XKHO2: 85,  // ranged +300%
  XLH2O: 80,  // build +100%
  XLHO2: 75,  // repair +100%
  XZH2O: 70,  // dismantle +300%
  XZHO2: 65,  // fatigue -100%
  XGH2O: 60,  // upgrade +100%
  XGHO2: 55,  // tough +300%
  XKH2O: 50,  // carry +100%
  
  // Tier 3 boosts
  UH2O: 45,
  UHO2: 44,
  KHO2: 43,
  LH2O: 42,
  LHO2: 41,
  ZH2O: 40,
  ZHO2: 39,
  GH2O: 38,
  GHO2: 37,
  KH2O: 36,
  
  // Tier 2 (mainly intermediates)
  UH: 20,
  UO: 19,
  KH: 18,
  KO: 17,
  LH: 16,
  LO: 15,
  ZH: 14,
  ZO: 13,
  GH: 12,
  GO: 11,
  
  // Tier 1 (basic compounds)
  OH: 30, // Higher priority as it's needed for many tier 3
  G: 10,
  ZK: 5,
  UL: 4
};

/**
 * Reaction Planner - Intelligent compound production
 */
export class ReactionPlanner {
  /**
   * Plan what reactions to run based on stock levels
   */
  static planProduction(storage: StructureStorage | null, terminal: StructureTerminal | null): MineralCompoundConstant[] {
    if (!storage) return [];
    
    const priorities: { compound: MineralCompoundConstant; priority: number; needed: number }[] = [];
    
    // Check each boost compound
    for (const compound in BOOST_PRIORITY) {
      const resource = compound as MineralCompoundConstant;
      const basePriority = BOOST_PRIORITY[compound];
      
      // Check how much we have
      const storageAmount = storage.store.getUsedCapacity(resource) || 0;
      const terminalAmount = terminal?.store.getUsedCapacity(resource) || 0;
      const totalAmount = storageAmount + terminalAmount;
      
      // Determine target amounts by tier
      const chain = REACTION_CHAINS[compound];
      if (!chain) continue;
      
      let targetAmount = 0;
      if (chain.tier === 4) targetAmount = 3000;  // Tier 4: 3k
      else if (chain.tier === 3) targetAmount = 5000; // Tier 3: 5k
      else if (chain.tier === 2) targetAmount = 2000; // Tier 2: 2k
      else targetAmount = 10000; // Tier 1: 10k (used as ingredients)
      
      // Need more?
      if (totalAmount < targetAmount) {
        const needed = targetAmount - totalAmount;
        const adjustedPriority = basePriority * (needed / targetAmount); // Higher need = higher priority
        
        priorities.push({
          compound: resource,
          priority: adjustedPriority,
          needed
        });
      }
    }
    
    // Sort by priority
    priorities.sort((a, b) => b.priority - a.priority);
    
    // Return top compounds to produce
    return priorities.slice(0, 5).map(p => p.compound);
  }
  
  /**
   * Get full reaction chain needed to produce a compound
   */
  static getReactionChain(product: MineralCompoundConstant): MineralCompoundConstant[] {
    const chain = REACTION_CHAINS[product];
    if (!chain) return [];
    
    const result: MineralCompoundConstant[] = [];
    
    // Add dependencies first
    const [ing1, ing2] = [chain.ingredient1, chain.ingredient2];
    
    // If ingredient is a compound, get its chain
    if (REACTION_CHAINS[ing1]) {
      result.push(...this.getReactionChain(ing1 as MineralCompoundConstant));
    }
    if (REACTION_CHAINS[ing2]) {
      result.push(...this.getReactionChain(ing2 as MineralCompoundConstant));
    }
    
    // Add the product itself
    result.push(product);
    
    return result;
  }
  
  /**
   * Check if we have enough ingredients to produce a compound
   */
  static canProduce(
    product: MineralCompoundConstant,
    amount: number,
    storage: StructureStorage | null,
    terminal: StructureTerminal | null
  ): boolean {
    const chain = REACTION_CHAINS[product];
    if (!chain) return false;
    
    const [ing1, ing2] = [chain.ingredient1, chain.ingredient2];
    
    const ing1Amount = (storage?.store.getUsedCapacity(ing1) || 0) +
                       (terminal?.store.getUsedCapacity(ing1) || 0);
    const ing2Amount = (storage?.store.getUsedCapacity(ing2) || 0) +
                       (terminal?.store.getUsedCapacity(ing2) || 0);
    
    return ing1Amount >= amount && ing2Amount >= amount;
  }
  
  /**
   * Get ingredient requirements for a reaction
   */
  static getIngredients(product: MineralCompoundConstant): [ResourceConstant, ResourceConstant] | null {
    const chain = REACTION_CHAINS[product];
    if (!chain) return null;
    return [chain.ingredient1, chain.ingredient2];
  }
}
