/**
 * BOOST MANAGER - Automated Military Enhancement System
 * 
 * "The faithful shall be made mighty for war"
 * 
 * Manages automatic production of military boosts for combat operations.
 * Prioritizes compounds based on colony needs and military activity.
 */

/// <reference types="@types/screeps" />

import { HighCharity } from '../core/HighCharity';

export interface BoostManagerMemory {
  productionTargets: { [compound: string]: number };
  lastProductionCheck: number;
  militaryBoostMode: boolean;
  totalBoostsProduced: number;
  totalCreepsBoosted: number;
}

/**
 * Military boost priorities for different combat scenarios
 */
export const MILITARY_BOOSTS = {
  // Tier 1: Essential combat boosts (Tier 3 compounds)
  attack: [
    RESOURCE_UTRIUM_HYDRIDE,      // UH2O - +100% attack
    RESOURCE_UTRIUM_ACID,         // UH - +100% attack (lower tier)
  ],
  heal: [
    RESOURCE_LEMERGIUM_OXIDE,     // LO2O - +100% heal
    RESOURCE_LEMERGIUM_ALKALIDE,  // LO - +100% heal (lower tier)
  ],
  ranged: [
    RESOURCE_KEANIUM_OXIDE,       // KO2O - +100% rangedAttack
    RESOURCE_KEANIUM_ALKALIDE,    // KO - +100% rangedAttack (lower tier)
  ],
  tough: [
    RESOURCE_GHODIUM_OXIDE,       // GO2O - -50% damage taken
    RESOURCE_GHODIUM_HYDRIDE,     // GO - -50% damage taken (lower tier)
  ],
  move: [
    RESOURCE_ZYNTHIUM_OXIDE,      // ZO2O - +100% fatigue decrease
    RESOURCE_ZYNTHIUM_ALKALIDE,   // ZO - +100% fatigue decrease (lower tier)
  ],
  
  // Tier 2: Premium boosts (Tier 4 - catalyzed)
  premiumAttack: [
    RESOURCE_CATALYZED_UTRIUM_ACID,      // XUH2O - +300% attack
  ],
  premiumHeal: [
    RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE, // XLHO2 - +300% heal
  ],
  premiumRanged: [
    RESOURCE_CATALYZED_KEANIUM_ALKALIDE,   // XKHO2 - +300% rangedAttack
  ],
  premiumTough: [
    RESOURCE_CATALYZED_GHODIUM_ALKALIDE,   // XGHO2 - -70% damage taken
  ],
  premiumMove: [
    RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE,  // XZO2 - +300% fatigue decrease
  ],
  
  // Tier 3: Siege/Support boosts
  dismantle: [
    RESOURCE_ZYNTHIUM_HYDRIDE,           // ZH2O - +300% dismantle
    RESOURCE_CATALYZED_ZYNTHIUM_ACID,   // XZH2O - +600% dismantle
  ],
  work: [
    RESOURCE_GHODIUM_HYDRIDE,           // GH2O - +100% upgradeController/harvest
    RESOURCE_CATALYZED_GHODIUM_ACID,   // XGH2O - +300% upgradeController/harvest
  ]
};

/**
 * Target stock levels for each boost compound
 */
const BOOST_TARGETS = {
  // Tier 3 compounds (standard military)
  [RESOURCE_UTRIUM_HYDRIDE]: 6000,      // UH2O
  [RESOURCE_LEMERGIUM_OXIDE]: 6000,     // LO2O
  [RESOURCE_KEANIUM_OXIDE]: 6000,       // KO2O
  [RESOURCE_GHODIUM_OXIDE]: 6000,       // GO2O
  [RESOURCE_ZYNTHIUM_OXIDE]: 6000,      // ZO2O
  [RESOURCE_ZYNTHIUM_HYDRIDE]: 3000,    // ZH2O (dismantle)
  
  // Tier 4 compounds (premium military)
  [RESOURCE_CATALYZED_UTRIUM_ACID]: 3000,       // XUH2O
  [RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE]: 3000, // XLHO2
  [RESOURCE_CATALYZED_KEANIUM_ALKALIDE]: 3000,  // XKHO2
  [RESOURCE_CATALYZED_GHODIUM_ALKALIDE]: 3000,  // XGHO2
  [RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE]: 3000, // XZO2
  [RESOURCE_CATALYZED_ZYNTHIUM_ACID]: 1500,     // XZH2O (siege)
  
  // Base minerals (always need for production)
  [RESOURCE_HYDROGEN]: 10000,
  [RESOURCE_OXYGEN]: 10000,
  [RESOURCE_CATALYST]: 5000,
  [RESOURCE_HYDROXIDE]: 5000,  // OH
};

/**
 * Boost Manager - Automated boost production for military operations
 */
export class BoostManager {
  private highCharity: HighCharity;
  private memory: BoostManagerMemory;
  
  constructor(highCharity: HighCharity) {
    this.highCharity = highCharity;
    
    // Initialize memory
    const roomMem: any = Memory.rooms[highCharity.name];
    if (!roomMem.boostManager) {
      roomMem.boostManager = {
        productionTargets: {},
        lastProductionCheck: 0,
        militaryBoostMode: false,
        totalBoostsProduced: 0,
        totalCreepsBoosted: 0
      };
    }
    this.memory = roomMem.boostManager;
  }
  
  /**
   * Run boost manager
   */
  run(): void {
    // Only run if we have labs
    if (!this.highCharity.labTemple || this.highCharity.labTemple.labs.length < 3) {
      return;
    }
    
    // Check production needs every 100 ticks
    if (!this.memory.lastProductionCheck || Game.time - this.memory.lastProductionCheck >= 100) {
      this.evaluateProductionNeeds();
      this.memory.lastProductionCheck = Game.time;
    }
    
    // Queue reactions for needed boosts
    this.queueBoostProduction();
    
    // Request minerals from market if needed
    if (Game.time % 500 === 0) {
      this.requestNeededMinerals();
    }
  }
  
  /**
   * Evaluate what boosts we need to produce
   */
  private evaluateProductionNeeds(): void {
    if (!this.highCharity.storage) return;
    
    const storage = this.highCharity.storage;
    const terminal = this.highCharity.terminal;
    
    // Reset production targets
    this.memory.productionTargets = {};
    
    // Check each boost compound
    for (const [compound, target] of Object.entries(BOOST_TARGETS)) {
      const resource = compound as ResourceConstant;
      
      // Get current stock
      const storageAmount = storage.store.getUsedCapacity(resource) || 0;
      const terminalAmount = terminal?.store.getUsedCapacity(resource) || 0;
      const totalAmount = storageAmount + terminalAmount;
      
      // If below target, add to production queue
      if (totalAmount < target) {
        const needed = target - totalAmount;
        this.memory.productionTargets[compound] = needed;
      }
    }
    
    // Check if we have active military operations
    this.memory.militaryBoostMode = this.hasMilitaryActivity();
    
    // If military mode, prioritize combat boosts
    if (this.memory.militaryBoostMode) {
      this.prioritizeMilitaryBoosts();
    }
  }
  
  /**
   * Check if there's active military operations
   */
  private hasMilitaryActivity(): boolean {
    // Check VanguardArbiter
    const vanguard = Object.values(this.highCharity.arbiters).find((a: any) => a.ref === 'vanguard');
    if (vanguard) {
      const status = (vanguard as any).getSquadStatus?.();
      if (status && status.size > 0) {
        return true;
      }
    }
    
    // Check WarCouncil
    if (this.highCharity.warCouncil) {
      const warStatus = this.highCharity.warCouncil.getStatus();
      if (warStatus.activeSquads > 0 || warStatus.targets > 0) {
        return true;
      }
    }
    
    // Check for combat creeps spawning
    const combatCreeps = this.highCharity.room.find(FIND_MY_CREEPS, {
      filter: (c: Creep) => c.memory.role === 'attacker' || 
                           c.memory.role === 'healer' || 
                           c.memory.role === 'ranged'
    });
    
    return combatCreeps.length > 0;
  }
  
  /**
   * Prioritize military boosts when in combat mode
   */
  private prioritizeMilitaryBoosts(): void {
    // Boost priority multipliers
    const combatBoosts = [
      RESOURCE_CATALYZED_UTRIUM_ACID,       // Attack
      RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE, // Heal
      RESOURCE_CATALYZED_KEANIUM_ALKALIDE,  // Ranged
      RESOURCE_CATALYZED_GHODIUM_ALKALIDE,  // Tough
      RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE, // Move
    ];
    
    // Increase targets for combat boosts in military mode
    for (const boost of combatBoosts) {
      if (this.memory.productionTargets[boost]) {
        this.memory.productionTargets[boost] *= 2; // Double production
      }
    }
  }
  
  /**
   * Queue boost production in labs
   */
  private queueBoostProduction(): void {
    if (!this.highCharity.labTemple) return;
    
    // Get compounds sorted by priority (lowest stock first)
    const priorities = Object.entries(this.memory.productionTargets)
      .sort((a, b) => {
        // Military boosts first
        const aIsMilitary = this.isMilitaryBoost(a[0]);
        const bIsMilitary = this.isMilitaryBoost(b[0]);
        
        if (aIsMilitary && !bIsMilitary) return -1;
        if (!aIsMilitary && bIsMilitary) return 1;
        
        // Then by amount needed
        return b[1] - a[1];
      })
      .slice(0, 5); // Top 5 priorities
    
    // Queue reactions for top priorities
    for (const [compound, amount] of priorities) {
      // Check if we can produce this
      if (this.canProduce(compound as MineralCompoundConstant)) {
        const batchSize = Math.min(amount, 3000); // Produce in 3k batches
        this.highCharity.labTemple.queueReaction(compound as MineralCompoundConstant, batchSize);
      }
    }
  }
  
  /**
   * Check if a compound is a military boost
   */
  private isMilitaryBoost(compound: string): boolean {
    const militaryCompounds = [
      RESOURCE_UTRIUM_HYDRIDE, RESOURCE_UTRIUM_ACID,
      RESOURCE_LEMERGIUM_OXIDE, RESOURCE_LEMERGIUM_ALKALIDE,
      RESOURCE_KEANIUM_OXIDE, RESOURCE_KEANIUM_ALKALIDE,
      RESOURCE_GHODIUM_OXIDE, RESOURCE_GHODIUM_HYDRIDE,
      RESOURCE_ZYNTHIUM_OXIDE, RESOURCE_ZYNTHIUM_ALKALIDE,
      RESOURCE_ZYNTHIUM_HYDRIDE,
      RESOURCE_CATALYZED_UTRIUM_ACID,
      RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE,
      RESOURCE_CATALYZED_KEANIUM_ALKALIDE,
      RESOURCE_CATALYZED_GHODIUM_ALKALIDE,
      RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE,
      RESOURCE_CATALYZED_ZYNTHIUM_ACID,
    ] as string[];
    
    return militaryCompounds.includes(compound);
  }
  
  /**
   * Check if we can produce a compound
   */
  private canProduce(compound: MineralCompoundConstant): boolean {
    if (!this.highCharity.storage) return false;
    
    // Get ingredients needed
    const ingredients = this.getIngredients(compound);
    if (!ingredients) return false;
    
    const [ing1, ing2] = ingredients;
    const storage = this.highCharity.storage;
    const terminal = this.highCharity.terminal;
    
    // Check if we have ingredients
    const ing1Amount = (storage.store.getUsedCapacity(ing1) || 0) + 
                      (terminal?.store.getUsedCapacity(ing1) || 0);
    const ing2Amount = (storage.store.getUsedCapacity(ing2) || 0) + 
                      (terminal?.store.getUsedCapacity(ing2) || 0);
    
    // Need at least 1000 of each ingredient
    return ing1Amount >= 1000 && ing2Amount >= 1000;
  }
  
  /**
   * Get ingredients for a compound
   */
  private getIngredients(compound: MineralCompoundConstant): [ResourceConstant, ResourceConstant] | null {
    const recipes: { [key: string]: [ResourceConstant, ResourceConstant] } = {
      // Tier 1
      [RESOURCE_HYDROXIDE]: [RESOURCE_HYDROGEN, RESOURCE_OXYGEN],
      [RESOURCE_ZYNTHIUM_KEANITE]: [RESOURCE_ZYNTHIUM, RESOURCE_KEANIUM],
      [RESOURCE_UTRIUM_LEMERGITE]: [RESOURCE_UTRIUM, RESOURCE_LEMERGIUM],
      [RESOURCE_GHODIUM]: [RESOURCE_ZYNTHIUM_KEANITE, RESOURCE_UTRIUM_LEMERGITE],
      
      // Tier 2 - Acids
      [RESOURCE_UTRIUM_ACID]: [RESOURCE_UTRIUM, RESOURCE_HYDROGEN],
      [RESOURCE_UTRIUM_ALKALIDE]: [RESOURCE_UTRIUM, RESOURCE_OXYGEN],
      [RESOURCE_KEANIUM_ACID]: [RESOURCE_KEANIUM, RESOURCE_HYDROGEN],
      [RESOURCE_KEANIUM_ALKALIDE]: [RESOURCE_KEANIUM, RESOURCE_OXYGEN],
      [RESOURCE_LEMERGIUM_ACID]: [RESOURCE_LEMERGIUM, RESOURCE_HYDROGEN],
      [RESOURCE_LEMERGIUM_ALKALIDE]: [RESOURCE_LEMERGIUM, RESOURCE_OXYGEN],
      [RESOURCE_ZYNTHIUM_ACID]: [RESOURCE_ZYNTHIUM, RESOURCE_HYDROGEN],
      [RESOURCE_ZYNTHIUM_ALKALIDE]: [RESOURCE_ZYNTHIUM, RESOURCE_OXYGEN],
      [RESOURCE_GHODIUM_ACID]: [RESOURCE_GHODIUM, RESOURCE_HYDROGEN],
      [RESOURCE_GHODIUM_ALKALIDE]: [RESOURCE_GHODIUM, RESOURCE_OXYGEN],
      
      // Tier 3 - Hydrides/Oxides
      [RESOURCE_UTRIUM_HYDRIDE]: [RESOURCE_UTRIUM_ACID, RESOURCE_HYDROXIDE],
      [RESOURCE_UTRIUM_OXIDE]: [RESOURCE_UTRIUM_ALKALIDE, RESOURCE_HYDROXIDE],
      [RESOURCE_KEANIUM_HYDRIDE]: [RESOURCE_KEANIUM_ACID, RESOURCE_HYDROXIDE],
      [RESOURCE_KEANIUM_OXIDE]: [RESOURCE_KEANIUM_ALKALIDE, RESOURCE_HYDROXIDE],
      [RESOURCE_LEMERGIUM_HYDRIDE]: [RESOURCE_LEMERGIUM_ACID, RESOURCE_HYDROXIDE],
      [RESOURCE_LEMERGIUM_OXIDE]: [RESOURCE_LEMERGIUM_ALKALIDE, RESOURCE_HYDROXIDE],
      [RESOURCE_ZYNTHIUM_HYDRIDE]: [RESOURCE_ZYNTHIUM_ACID, RESOURCE_HYDROXIDE],
      [RESOURCE_ZYNTHIUM_OXIDE]: [RESOURCE_ZYNTHIUM_ALKALIDE, RESOURCE_HYDROXIDE],
      [RESOURCE_GHODIUM_HYDRIDE]: [RESOURCE_GHODIUM_ACID, RESOURCE_HYDROXIDE],
      [RESOURCE_GHODIUM_OXIDE]: [RESOURCE_GHODIUM_ALKALIDE, RESOURCE_HYDROXIDE],
      
      // Tier 4 - Catalyzed
      [RESOURCE_CATALYZED_UTRIUM_ACID]: [RESOURCE_UTRIUM_HYDRIDE, RESOURCE_CATALYST],
      [RESOURCE_CATALYZED_UTRIUM_ALKALIDE]: [RESOURCE_UTRIUM_OXIDE, RESOURCE_CATALYST],
      [RESOURCE_CATALYZED_KEANIUM_ACID]: [RESOURCE_KEANIUM_HYDRIDE, RESOURCE_CATALYST],
      [RESOURCE_CATALYZED_KEANIUM_ALKALIDE]: [RESOURCE_KEANIUM_OXIDE, RESOURCE_CATALYST],
      [RESOURCE_CATALYZED_LEMERGIUM_ACID]: [RESOURCE_LEMERGIUM_HYDRIDE, RESOURCE_CATALYST],
      [RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE]: [RESOURCE_LEMERGIUM_OXIDE, RESOURCE_CATALYST],
      [RESOURCE_CATALYZED_ZYNTHIUM_ACID]: [RESOURCE_ZYNTHIUM_HYDRIDE, RESOURCE_CATALYST],
      [RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE]: [RESOURCE_ZYNTHIUM_OXIDE, RESOURCE_CATALYST],
      [RESOURCE_CATALYZED_GHODIUM_ACID]: [RESOURCE_GHODIUM_HYDRIDE, RESOURCE_CATALYST],
      [RESOURCE_CATALYZED_GHODIUM_ALKALIDE]: [RESOURCE_GHODIUM_OXIDE, RESOURCE_CATALYST],
    };
    
    return recipes[compound] || null;
  }
  
  /**
   * Request needed minerals from market
   */
  private requestNeededMinerals(): void {
    if (!this.highCharity.terminal || !this.highCharity.marketManager) return;
    
    const baseMinerals = [
      RESOURCE_HYDROGEN,
      RESOURCE_OXYGEN,
      RESOURCE_UTRIUM,
      RESOURCE_LEMERGIUM,
      RESOURCE_KEANIUM,
      RESOURCE_ZYNTHIUM,
      RESOURCE_CATALYST
    ];
    
    for (const mineral of baseMinerals) {
      const amount = this.highCharity.storage?.store.getUsedCapacity(mineral) || 0;
      const terminalAmount = this.highCharity.terminal.store.getUsedCapacity(mineral) || 0;
      const total = amount + terminalAmount;
      
      // If below 3000, request from market
      if (total < 3000 && Game.time % 50 === 0) {
        const needed = 5000 - total;
        // Market manager will handle buy orders
        if (Game.time % 500 === 0) {
          console.log(`💰 [BoostManager] Need ${needed} ${mineral} for boost production`);
        }
      }
    }
  }
  
  /**
   * Request boosts for a military creep
   */
  requestBoosts(creep: Creep, role: 'attacker' | 'healer' | 'ranged' | 'dismantler'): void {
    if (!this.highCharity.boostTemple) return;
    
    // Determine which boosts to use
    let boosts: ResourceConstant[] = [];
    
    switch (role) {
      case 'attacker':
        boosts = this.selectBestBoosts([...MILITARY_BOOSTS.premiumAttack, ...MILITARY_BOOSTS.attack], 1);
        boosts.push(...this.selectBestBoosts([...MILITARY_BOOSTS.premiumTough, ...MILITARY_BOOSTS.tough], 1));
        boosts.push(...this.selectBestBoosts([...MILITARY_BOOSTS.premiumMove, ...MILITARY_BOOSTS.move], 1));
        break;
      
      case 'healer':
        boosts = this.selectBestBoosts([...MILITARY_BOOSTS.premiumHeal, ...MILITARY_BOOSTS.heal], 1);
        boosts.push(...this.selectBestBoosts([...MILITARY_BOOSTS.premiumMove, ...MILITARY_BOOSTS.move], 1));
        break;
      
      case 'ranged':
        boosts = this.selectBestBoosts([...MILITARY_BOOSTS.premiumRanged, ...MILITARY_BOOSTS.ranged], 1);
        boosts.push(...this.selectBestBoosts([...MILITARY_BOOSTS.premiumTough, ...MILITARY_BOOSTS.tough], 1));
        boosts.push(...this.selectBestBoosts([...MILITARY_BOOSTS.premiumMove, ...MILITARY_BOOSTS.move], 1));
        break;
      
      case 'dismantler':
        boosts = this.selectBestBoosts(MILITARY_BOOSTS.dismantle, 1);
        boosts.push(...this.selectBestBoosts([...MILITARY_BOOSTS.premiumMove, ...MILITARY_BOOSTS.move], 1));
        break;
    }
    
    // Request boosts from BoostTemple
    if (boosts.length > 0) {
      this.highCharity.boostTemple.requestBoost(creep.name, role, 200); // High priority
      this.memory.totalCreepsBoosted++;
    }
  }
  
  /**
   * Select best available boosts from a list
   */
  private selectBestBoosts(options: ResourceConstant[], count: number): ResourceConstant[] {
    const selected: ResourceConstant[] = [];
    
    for (const boost of options) {
      // Check if we have this boost available
      const amount = (this.highCharity.storage?.store.getUsedCapacity(boost) || 0) +
                    (this.highCharity.terminal?.store.getUsedCapacity(boost) || 0);
      
      if (amount >= 300) { // Need at least 300 for boosting
        selected.push(boost);
        if (selected.length >= count) break;
      }
    }
    
    return selected;
  }
  
  /**
   * Get boost manager status
   */
  getStatus(): {
    militaryMode: boolean;
    productionTargets: number;
    boostsProduced: number;
    creepsBoosted: number;
  } {
    return {
      militaryMode: this.memory.militaryBoostMode,
      productionTargets: Object.keys(this.memory.productionTargets).length,
      boostsProduced: this.memory.totalBoostsProduced,
      creepsBoosted: this.memory.totalCreepsBoosted
    };
  }
  
  /**
   * Enable/disable military boost mode
   */
  setMilitaryMode(enabled: boolean): void {
    this.memory.militaryBoostMode = enabled;
    console.log(`⚗️ Military boost mode: ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }
}
