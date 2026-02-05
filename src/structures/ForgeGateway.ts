/**
 * LAB Gateway - Chemical Reaction Management
 * 
 * "Through knowledge and alchemy, power is achieved"
 * 
 * Manages lab structures and chemical reactions to produce
 * valuable compounds and boosts for the KHALA's forces.
 */

/// <reference types="@types/screeps" />

import { Nexus } from '../core/Nexus';
import { Gateway } from './Gateway';
import { ReactionPlanner } from '../labs/ReactionPlanner';

export interface ForgeGatewayMemory {
  reactionQueue: ReactionTask[];
  currentReaction: ReactionTask | null;
  autoProduction: boolean; // Auto-produce based on stock levels
  lastProductionCheck: number; // Last tick we checked what to produce
}

export interface ReactionTask {
  product: MineralCompoundConstant;
  amount: number;
  ingredient1: ResourceConstant;
  ingredient2: ResourceConstant;
}

/**
 * Lab reaction recipes
 */
const REACTIONS: { [key: string]: [ResourceConstant, ResourceConstant] } = {
  // Tier 1 base compounds
  OH: [RESOURCE_OXYGEN, RESOURCE_HYDROGEN],
  ZK: [RESOURCE_ZYNTHIUM, RESOURCE_CATALYST],
  UL: [RESOURCE_UTRIUM, RESOURCE_LEMERGIUM],
  G: [RESOURCE_ZYNTHIUM, RESOURCE_KEANIUM],
  
  // Tier 2 compounds
  GH: [RESOURCE_GHODIUM, RESOURCE_HYDROGEN],
  GH2O: [RESOURCE_GHODIUM_HYDRIDE, RESOURCE_HYDROXIDE],
  XGH2O: [RESOURCE_GHODIUM_ACID, RESOURCE_CATALYST],
  
  // Boosts
  UH: [RESOURCE_UTRIUM, RESOURCE_HYDROGEN],
  UH2O: [RESOURCE_UTRIUM_HYDRIDE, RESOURCE_HYDROXIDE],
  XUH2O: [RESOURCE_UTRIUM_ACID, RESOURCE_CATALYST],
  
  UO: [RESOURCE_UTRIUM, RESOURCE_OXYGEN],
  UHO2: [RESOURCE_UTRIUM_HYDRIDE, RESOURCE_HYDROXIDE],
  XUHO2: [RESOURCE_UTRIUM_ALKALIDE, RESOURCE_CATALYST],
  
  KH: [RESOURCE_KEANIUM, RESOURCE_HYDROGEN],
  KH2O: [RESOURCE_KEANIUM_HYDRIDE, RESOURCE_HYDROXIDE],
  XKH2O: [RESOURCE_KEANIUM_ACID, RESOURCE_CATALYST],
  
  KO: [RESOURCE_KEANIUM, RESOURCE_OXYGEN],
  KHO2: [RESOURCE_KEANIUM_HYDRIDE, RESOURCE_HYDROXIDE],
  XKHO2: [RESOURCE_KEANIUM_ALKALIDE, RESOURCE_CATALYST],
  
  LH: [RESOURCE_LEMERGIUM, RESOURCE_HYDROGEN],
  LH2O: [RESOURCE_LEMERGIUM_HYDRIDE, RESOURCE_HYDROXIDE],
  XLH2O: [RESOURCE_LEMERGIUM_ACID, RESOURCE_CATALYST],
  
  LO: [RESOURCE_LEMERGIUM, RESOURCE_OXYGEN],
  LHO2: [RESOURCE_LEMERGIUM_HYDRIDE, RESOURCE_HYDROXIDE],
  XLHO2: [RESOURCE_LEMERGIUM_ALKALIDE, RESOURCE_CATALYST],
  
  ZH: [RESOURCE_ZYNTHIUM, RESOURCE_HYDROGEN],
  ZH2O: [RESOURCE_ZYNTHIUM_HYDRIDE, RESOURCE_HYDROXIDE],
  XZH2O: [RESOURCE_ZYNTHIUM_ACID, RESOURCE_CATALYST],
  
  ZO: [RESOURCE_ZYNTHIUM, RESOURCE_OXYGEN],
  ZHO2: [RESOURCE_ZYNTHIUM_HYDRIDE, RESOURCE_HYDROXIDE],
  XZHO2: [RESOURCE_ZYNTHIUM_ALKALIDE, RESOURCE_CATALYST]
};

/**
 * Lab Gateway - Manages chemical reactions
 */
export class ForgeGateway extends Gateway {
  labs: StructureLab[];
  inputLabs: StructureLab[];
  outputLabs: StructureLab[];
  
  constructor(Nexus: Nexus) {
    // Use storage or controller position as anchor
    const pos = Nexus.storage?.pos || 
                Nexus.controller?.pos || 
                new RoomPosition(25, 25, Nexus.room.name);
    super(Nexus, pos);
    
    this.labs = [];
    this.inputLabs = [];
    this.outputLabs = [];
  }
  
  init(): void {
    // Gather lab references
    this.labs = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_LAB
    }) as StructureLab[];
    
    // Need at least 3 labs to run reactions (2 inputs, 1+ outputs)
    if (this.labs.length < 3) {
      this.inputLabs = [];
      this.outputLabs = [];
      return;
    }
    
    // Assign input and output labs
    // Input labs should be close to storage for easy refilling
    const sortedLabs = this.labs.sort((a, b) => {
      if (!this.Nexus.storage) return 0;
      return a.pos.getRangeTo(this.Nexus.storage) - b.pos.getRangeTo(this.Nexus.storage);
    });
    
    this.inputLabs = sortedLabs.slice(0, 2);
    this.outputLabs = sortedLabs.slice(2);
  }
  
  run(): void {
    if (this.labs.length < 3) return;
    
    // Auto-production: Check what we should produce every 100 ticks
    const memory = this.memory as ForgeGatewayMemory;
    if (memory.autoProduction !== false) { // Default to true
      if (!memory.lastProductionCheck || Game.time - memory.lastProductionCheck >= 100) {
        this.planAutoProduction();
        memory.lastProductionCheck = Game.time;
      }
    }
    
    // Check if we have a current reaction
    const currentReaction = memory.currentReaction;
    
    if (currentReaction) {
      this.executeReaction(currentReaction);
    } else {
      // Check for queued reactions
      const queue = memory.reactionQueue || [];
      if (queue.length > 0) {
        memory.currentReaction = queue.shift()!;
      }
    }
  }
  
  private executeReaction(task: ReactionTask): void {
    const ingredients = ReactionPlanner.getIngredients(task.product);
    
    if (!ingredients) {
      console.log(`⚠️ Unknown reaction: ${task.product}`);
      (this.memory as ForgeGatewayMemory).currentReaction = null;
      return;
    }
    
    const [input1, input2] = ingredients;
    
    // Check input labs have the right resources
    const lab1 = this.inputLabs[0];
    const lab2 = this.inputLabs[1];
    
    if (!lab1 || !lab2) return;
    
    const lab1Resource = lab1.mineralType;
    const lab2Resource = lab2.mineralType;
    
    // Check if labs need refilling
    const lab1Amount = lab1.store?.getUsedCapacity(input1 as ResourceConstant) || 0;
    if (lab1Resource !== input1 || lab1Amount < 100) {
      // Need to refill lab1 - HaulerArbiter will handle this via PylonNetwork
      return;
    }
    
    const lab2Amount = lab2.store?.getUsedCapacity(input2 as ResourceConstant) || 0;
    if (lab2Resource !== input2 || lab2Amount < 100) {
      // Need to refill lab2
      return;
    }
    
    // Run reactions on output labs
    let reactionsRun = 0;
    for (const outputLab of this.outputLabs) {
      if (outputLab.cooldown > 0) continue;
      
      const result = outputLab.runReaction(lab1, lab2);
      if (result === OK) {
        reactionsRun++;
      }
    }
    
    // Check if task is complete
    const produced = this.outputLabs.reduce((sum, lab) => 
      sum + lab.store.getUsedCapacity(task.product), 0
    );
    
    if (produced >= task.amount) {
      console.log(`✅ Completed reaction: ${task.product} (${produced}/${task.amount})`);
      (this.memory as ForgeGatewayMemory).currentReaction = null;
    }
  }
  
  /**
   * Automatically plan production based on stock levels
   */
  private planAutoProduction(): void {
    // Get top priority compounds to produce
    const priorities = ReactionPlanner.planProduction(
      this.Nexus.storage || null,
      this.Nexus.terminal || null
    );
    
    if (priorities.length === 0) return;
    
    // Queue reactions for each priority compound
    for (const compound of priorities) {
      // Get full reaction chain needed
      const chain = ReactionPlanner.getReactionChain(compound);
      
      // Queue each step in the chain
      for (const product of chain) {
        // Check if we can produce it
        const amount = 3000; // Produce 3000 units
        if (ReactionPlanner.canProduce(product, amount, this.Nexus.storage || null, this.Nexus.terminal || null)) {
          const ingredients = ReactionPlanner.getIngredients(product);
          if (ingredients) {
            this.queueReaction(product, amount);
          }
        }
      }
    }
  }
  
  /**
   * Queue a reaction to produce a compound
   */
  queueReaction(product: MineralCompoundConstant, amount: number): void {
    const ingredients = ReactionPlanner.getIngredients(product);
    if (!ingredients) {
      console.log(`⚠️ No recipe for ${product}`);
      return;
    }
    
    const task: ReactionTask = {
      product,
      amount,
      ingredient1: ingredients[0],
      ingredient2: ingredients[1]
    };
    
    const memory = this.memory as ForgeGatewayMemory;
    if (!memory.reactionQueue) {
      memory.reactionQueue = [];
    }
    
    // Check if already queued
    const alreadyQueued = memory.reactionQueue.some(t => t.product === product);
    const isCurrentReaction = memory.currentReaction?.product === product;
    
    if (alreadyQueued || isCurrentReaction) {
      return; // Already producing this
    }
    
    memory.reactionQueue.push(task);
    
    console.log(`⚗️ Queued reaction: ${amount}x ${product}`);
  }
  
  /**
   * Check if labs are busy with reactions
   */
  isBusy(): boolean {
    return !!(this.memory as ForgeGatewayMemory).currentReaction ||
           ((this.memory as ForgeGatewayMemory).reactionQueue || []).length > 0;
  }
  
  /**
   * Get the resources needed for current/queued reactions
   */
  getNeededResources(): { [resource: string]: number } {
    const needed: { [resource: string]: number } = {};
    
    const current = (this.memory as ForgeGatewayMemory).currentReaction;
    const queue = (this.memory as ForgeGatewayMemory).reactionQueue || [];
    const allTasks = current ? [current, ...queue] : queue;
    
    for (const task of allTasks) {
      needed[task.ingredient1] = (needed[task.ingredient1] || 0) + task.amount;
      needed[task.ingredient2] = (needed[task.ingredient2] || 0) + task.amount;
    }
    
    return needed;
  }
}
