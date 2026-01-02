/**
 * MINING ARBITER - Mining Operations Manager
 * 
 * "Extract resources for the Covenant"
 * 
 * Manages mining operations at energy sources. Spawns and coordinates
 * miner Elites to efficiently harvest energy.
 */

/// <reference types="@types/screeps" />

import { Arbiter, ArbiterPriority } from './Arbiter';
import { HighCharity } from '../core/HighCharity';
import { Elite } from '../elites/Elite';

/**
 * Mining Arbiter - Manages energy harvesting
 */
export class MiningArbiter extends Arbiter {
  source: Source | null;
  container: StructureContainer | null;
  miners: Elite[];
  
  constructor(highCharity: HighCharity, source: Source) {
    super(highCharity, `mining_${source.id}`, ArbiterPriority.economy.mining);
    
    this.source = source;
    this.container = null;
    this.miners = [];
  }
  
  init(): void {
    // Refresh miners
    this.refresh();
    
    // Find container near source
    if (this.source) {
      const containers = this.source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER
      }) as StructureContainer[];
      this.container = containers[0] || null;
    }
    
    // Request miners if needed
    const desiredMiners = this.calculateDesiredMiners();
    const currentMiners = this.miners.length;
    
    if (currentMiners < desiredMiners) {
      this.requestMiner();
    }
  }
  
  run(): void {
    // Direct each miner to harvest
    for (const miner of this.miners) {
      this.runMiner(miner);
    }
  }
  
  private runMiner(miner: Elite): void {
    if (!this.source) return;
    
    // If container exists and miner is not on it, move to it
    if (this.container && !miner.pos.isEqualTo(this.container.pos)) {
      miner.goTo(this.container.pos);
      return;
    }
    
    // Harvest
    const harvestResult = miner.harvestSource(this.source);
    
    if (harvestResult === OK) {
      miner.say('⛏️');
    }
    
    // If miner is full and no container, transfer to nearby structures
    if (miner.isFull && !this.container) {
      const nearbySpawn = miner.pos.findInRange(FIND_MY_SPAWNS, 1)[0];
      if (nearbySpawn && nearbySpawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        miner.transferTo(nearbySpawn);
      }
    }
  }
  
  private calculateDesiredMiners(): number {
    // Early game: 1 miner per source
    // Later: Depends on source energy and room phase
    if (this.highCharity.level < 3) {
      return 1;
    }
    
    // With container, 1 dedicated miner is optimal
    if (this.container) {
      return 1;
    }
    
    return 2; // Without container, use 2 miners
  }
  
  private requestMiner(): void {
    const body = this.calculateMinerBody();
    const name = `miner_${this.source?.id}_${Game.time}`;
    
    this.requestSpawn(body, name, {
      role: 'elite_miner', // Covenant themed role
      sourceId: this.source?.id
    } as any);
  }
  
  private calculateMinerBody(): BodyPartConstant[] {
    const energy = this.highCharity.energyCapacity;
    
    // Early game: Small miner
    if (energy < 550) {
      return [WORK, WORK, MOVE, CARRY];
    }
    
    // Mid game: Dedicated miner
    if (energy < 800) {
      return [WORK, WORK, WORK, WORK, WORK, MOVE, MOVE];
    }
    
    // Late game: Optimal 5 WORK miner
    return [WORK, WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, MOVE];
  }
  
  protected getCreepsForRole(): Creep[] {
    if (!this.source) return [];
    
    return this.room.find(FIND_MY_CREEPS, {
      filter: (creep) => 
        creep.memory.arbiter === this.ref ||
        (creep.memory.role === 'miner' && creep.memory.sourceId === this.source?.id)
    });
  }
}
