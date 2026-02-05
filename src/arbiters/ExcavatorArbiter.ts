/**
 * MINERAL MINING ARBITER - Mineral Extraction
 * 
 * "The rare gifts of the gods must be gathered"
 * 
 * Manages mineral extraction operations in the colony.
 * Activates at RCL 6+ when extractors become available.
 */

/// <reference types="@types/screeps" />

import { Arbiter, ArbiterPriority } from './Arbiter';
import { Nexus } from '../core/Nexus';
import { Warrior } from '../Warriors/Warrior';
import { BodyBuilder } from '../utils/BodyBuilder';

/**
 * Mineral Mining Arbiter - Manages mineral extraction
 */
export class ExcavatorArbiter extends Arbiter {
  mineral: Mineral;
  extractor: StructureExtractor | null;
  container: StructureContainer | null;
  miners: Warrior[];
  
  constructor(Nexus: Nexus, mineral: Mineral) {
    super(Nexus, `mineralMining_${mineral.id}`, ArbiterPriority.economy.mining);
    this.mineral = mineral;
    this.extractor = null;
    this.container = null;
    this.miners = [];
  }
  
  init(): void {
    this.refresh();
    
    // Only operate at RCL 6+
    const controllerLevel = this.room.controller?.level || 0;
    if (controllerLevel < 6) return;
    
    // Check if mineral is depleted
    if (this.mineral.mineralAmount === 0) return;
    
    // Need extractor to mine
    if (!this.extractor) return;
    
    // Check if we have storage space
    if (!this.Nexus.storage && !this.Nexus.terminal) return;
    
    // Check if storage is full of this mineral type
    const storedAmount = (this.Nexus.storage?.store.getUsedCapacity(this.mineral.mineralType) || 0) +
                         (this.Nexus.terminal?.store.getUsedCapacity(this.mineral.mineralType) || 0);
    
    // Stop mining if we have more than 100k of this mineral
    if (storedAmount > 100000) return;
    
    // DEFENSIVE PROTOCOL: Don't spawn mineral miners during combat (threat >= 4)
    // Mineral mining is luxury economy, not essential during defense
    const threatLevel = this.Nexus.safeModeManager.getThreatLevel();
    if (threatLevel >= 4) {
      if (Game.time % 100 === 0) {
        console.log(`⚔️ ${this.print}: Suspending excavator spawns (threat: ${threatLevel}/10)`);
      }
      return; // Skip spawning during combat
    }
    
    // Request miner if needed
    const desiredMiners = this.extractor.cooldown === 0 ? 1 : 0;
    if (this.miners.length < desiredMiners) {
      this.requestMiner();
    }
  }
  
  run(): void {
    for (const miner of this.miners) {
      this.runMiner(miner);
    }
  }
  
  private runMiner(miner: Warrior): void {
    // State machine: mining → depositing
    if (miner.isFull) {
      this.deposit(miner);
    } else {
      this.mine(miner);
    }
  }
  
  private mine(miner: Warrior): void {
    const result = miner.harvestMineral(this.mineral);
    
    if (result === OK) {
      miner.say('⛏️💎');
    } else if (result === ERR_NOT_IN_RANGE) {
      miner.goTo(this.mineral);
      miner.say('➡️💎');
    } else if (result === ERR_NOT_ENOUGH_RESOURCES || result === ERR_TIRED) {
      // Mineral depleted or extractor on cooldown
      miner.say('💤');
    }
  }
  
  private deposit(miner: Warrior): void {
    let target: StructureStorage | StructureTerminal | StructureContainer | null = null;
    
    // Priority: Container > Storage > Terminal
    if (this.container && this.container.store.getFreeCapacity() > 0) {
      target = this.container;
    } else if (this.Nexus.storage && 
               this.Nexus.storage.store.getFreeCapacity() > 0) {
      target = this.Nexus.storage;
    } else if (this.Nexus.terminal && 
               this.Nexus.terminal.store.getFreeCapacity() > 0) {
      target = this.Nexus.terminal;
    }
    
    if (!target) {
      miner.say('❌');
      return;
    }
    
    const result = miner.transferTo(target);
    
    if (result === OK || result === ERR_NOT_IN_RANGE) {
      miner.say('📦');
    }
  }
  
  private requestMiner(): void {
    const body = this.calculateMinerBody();
    const name = `Excavator_${Game.time}`;
    
    this.requestSpawn(body, name, {
      role: 'Warrior_mineralMiner' // KHALA themed role
    } as any);
  }
  
  private calculateMinerBody(): BodyPartConstant[] {
    // Mineral miners need lots of WORK parts
    // Use capacity when not bootstrapping for full-size bodies
    const totalCreeps = this.room.find(FIND_MY_CREEPS).length;
    const energyRatio = this.Nexus.energyAvailable / this.Nexus.energyCapacity;
    const useAvailable = this.Nexus.isBootstrapping || totalCreeps === 0 || energyRatio < 0.9;
    
    const energy = useAvailable ? 
      this.Nexus.energyAvailable : 
      this.Nexus.energyCapacity;
    
    return BodyBuilder.miner(energy);
  }
  
  protected getCreepsForRole(): Creep[] {
    return this.room.find(FIND_MY_CREEPS, {
      filter: (creep) => 
        creep.memory.arbiter === this.ref ||
        (creep.memory.role === 'mineralMiner' && 
         (creep.memory as any).mineralId === this.mineral.id)
    });
  }
  
  refresh(): void {
    super.refresh();
    
    // Find extractor
    const extractors = this.mineral.pos.lookFor(LOOK_STRUCTURES).filter(
      s => s.structureType === STRUCTURE_EXTRACTOR
    ) as StructureExtractor[];
    this.extractor = extractors[0] || null;
    
    // Find container near mineral
    const containers = this.mineral.pos.findInRange(FIND_STRUCTURES, 2, {
      filter: s => s.structureType === STRUCTURE_CONTAINER
    }) as StructureContainer[];
    this.container = containers[0] || null;
    
    // Update miners
    this.miners = this.getCreepsForRole().map(c => new Warrior(c));
  }
}
