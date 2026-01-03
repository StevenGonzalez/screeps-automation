/**
 * Lekgolo Arbiter - Mining Operations Manager
 * 
 * "The Lekgolo consume and extract resources from the earth"
 * 
 * Manages mining operations at energy sources. Lekgolo worms sit on containers
 * and continuously extract energy from sources.
 */

/// <reference types="@types/screeps" />

import { Arbiter, ArbiterPriority } from './Arbiter';
import { SpawnPriority } from '../spawning/SpawnQueue';
import { HighCharity } from '../core/HighCharity';
import { Elite } from '../elites/Elite';
import { ROLES, RoleHelpers } from '../constants/Roles';

/**
 * Lekgolo Arbiter - Manages energy harvesting
 */
export class LekgoloArbiter extends Arbiter {
  source: Source | null;
  container: StructureContainer | null;
  miners: Elite[];
  
  constructor(highCharity: HighCharity, source: Source) {
    super(highCharity, `lekgolo_${source.id}`, ArbiterPriority.economy.mining);
    
    this.source = source;
    this.container = null;
    this.miners = [];
  }
  
  init(): void {
    // Refresh miners
    this.refresh();
    
    // Update miners list from elites
    this.miners = this.elites;
    
    // Find container near source
    if (this.source) {
      const containers = this.source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER
      }) as StructureContainer[];
      this.container = containers[0] || null;
    }
    
    // Request boosts for miners at powerhouse colonies
    if (this.highCharity.memory.phase === 'powerhouse' && this.highCharity.boostTemple?.isReady()) {
      for (const miner of this.miners) {
        if (!this.highCharity.boostTemple.isCreepBoosted(miner.name)) {
          this.highCharity.boostTemple.requestBoost(miner.name, 'elite_miner', ArbiterPriority.economy.mining);
        }
      }
    }
    
    // Request Lekgolo if needed
    const desiredMiners = this.calculateDesiredMiners();
    const currentMiners = this.miners.length;
    
    console.log(`⛏️ ${this.print}: ${currentMiners}/${desiredMiners} miners (container: ${!!this.container})`);
    
    // Request spawn whenever we need more miners (removed tick throttle)
    // SpawnQueue handles deduplication, so it's safe to request every tick
    if (currentMiners < desiredMiners) {
      this.requestMiner();
    }
  }
  
  run(): void {
    // Direct each miner to harvest
    for (const miner of this.miners) {
      this.runMiner(miner);
    }
    
    // Debug: Show we're managing creeps
    if (Game.time % 100 === 0 && this.miners.length > 0) {
      console.log(`⛏️ ${this.print}: Managing ${this.miners.length} miners`);
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
    
    // Transfer to source link if link network is active
    if (this.highCharity.linkTemple?.isActive()) {
      const sourceLinks = this.highCharity.linkTemple.getSourceLinks();
      const nearbyLink = sourceLinks.find(link => 
        link.pos.inRangeTo(this.source!, 2) && 
        link.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      );
      
      if (nearbyLink && miner.pos.isNearTo(nearbyLink)) {
        const result = miner.transferTo(nearbyLink);
        if (result === OK) {
          miner.say('⚡');
        }
      }
    }
    
    // If miner is full and no container, transfer to nearby structures
    if (miner.store.getFreeCapacity() === 0 && !this.container) {
      const nearbySpawn = miner.pos.findInRange(FIND_MY_SPAWNS, 1)[0];
      if (nearbySpawn && nearbySpawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        miner.transferTo(nearbySpawn);
      }
    }
  }
  
  private calculateDesiredMiners(): number {
    // Lekgolo only spawn when there's a container AT THIS SOURCE
    // Before container: GruntArbiter handles energy collection
    
    // With container near this source, 1 dedicated Lekgolo is optimal
    if (this.container) {
      return 1;
    }
    
    // No container at this source yet - acolytes handle it
    return 0;
  }
  
  private requestMiner(): void {
    const body = this.calculateMinerBody();
    const name = `Lekgolo_${this.source?.id}_${Game.time}`;
    
    // Count total miners across all sources
    const allMiners = this.room.find(FIND_MY_CREEPS, {
      filter: c => RoleHelpers.isMiner(c.memory.role || '')
    });
    
    // First miner is EMERGENCY (no energy production without it!)
    // Additional miners during bootstrap are CRITICAL
    const priority = allMiners.length === 0 ? 
      SpawnPriority.EMERGENCY :
      (this.highCharity.isBootstrapping && this.miners.length === 0 ?
        SpawnPriority.CRITICAL :
        SpawnPriority.ECONOMY);
    
    const important = allMiners.length === 0 || (this.highCharity.isBootstrapping && this.miners.length === 0);
    
    this.requestSpawn(body, name, {
      role: ROLES.ELITE_LEKGOLO,
      sourceId: this.source?.id
    } as any, priority, important);
  }
  
  private calculateMinerBody(): BodyPartConstant[] {
    // Use available energy during bootstrap, otherwise use capacity
    const energy = this.highCharity.isBootstrapping ? 
      this.highCharity.energyAvailable : 
      this.highCharity.energyCapacity;
    
    // Emergency: Minimal Lekgolo (200 energy) - use during very early bootstrap
    if (energy <= 300) {
      return [WORK, MOVE, CARRY];
    }
    
    // Early game: Small Lekgolo (300 energy)
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
        (RoleHelpers.isMiner(creep.memory.role || '') && creep.memory.sourceId === this.source?.id)
    });
  }
}

