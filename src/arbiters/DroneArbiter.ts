/**
 * Drone Arbiter - Mining Operations Manager
 * 
 * "The Drones tirelessly extract resources from the earth"
 * 
 * Manages mining operations at energy sources. Drones sit on containers
 * and continuously extract energy from sources.
 */

/// <reference types="@types/screeps" />

import { Arbiter, ArbiterPriority } from './Arbiter';
import { SpawnPriority } from '../spawning/SpawnQueue';
import { HighCharity } from '../core/HighCharity';
import { Elite } from '../elites/Elite';
import { ROLES, RoleHelpers } from '../constants/Roles';
import { BodyBuilder } from '../utils/BodyBuilder';

/**
 * Drone Arbiter - Manages energy harvesting
 */
export class DroneArbiter extends Arbiter {
  source: Source | null;
  container: StructureContainer | null;
  miners: Elite[];
  
  constructor(highCharity: HighCharity, source: Source) {
    super(highCharity, `drone_${source.id}`, ArbiterPriority.economy.mining);
    
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
    
    // Request Drone if needed
    const desiredMiners = this.calculateDesiredMiners();
    const currentMiners = this.miners.length;
    const spawningMiners = this.countSpawningMiners();
    const totalMiners = currentMiners + spawningMiners;
    
    // Debug logging (more frequent to catch issues)
    if (Game.time % 10 === 0 && (desiredMiners > 0 || currentMiners > 0)) {
      console.log(`⛏️ ${this.print}: ${currentMiners}/${desiredMiners} miners (spawning: ${spawningMiners}, container: ${!!this.container})`);
    }
    
    // Request spawn whenever we need more miners
    // SpawnQueue handles deduplication, so it's safe to request every tick
    if (totalMiners < desiredMiners) {
      if (Game.time % 10 === 0) {
        console.log(`⛏️ ${this.print}: Requesting miner (current: ${currentMiners}, spawning: ${spawningMiners}, desired: ${desiredMiners})`);
      }
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
    // Drones only spawn when there's a container AT THIS SOURCE
    // Before container: GruntArbiter handles energy collection
    
    // With container near this source, 1 dedicated Drone is optimal
    if (this.container) {
      return 1;
    }
    
    // No container at this source yet - acolytes handle it
    return 0;
  }
  
  /**
   * Count creeps that are currently spawning for this source
   */
  private countSpawningMiners(): number {
    let count = 0;
    for (const spawn of this.highCharity.spawns) {
      if (spawn.spawning) {
        const spawningCreep = Game.creeps[spawn.spawning.name];
        // Check memory of the creep being spawned
        const memory = spawningCreep?.memory || Memory.creeps[spawn.spawning.name];
        if (memory && memory.sourceId === this.source?.id && RoleHelpers.isMiner(memory.role || '')) {
          count++;
        }
      }
    }
    return count;
  }
  
  private requestMiner(): void {
    const body = this.calculateMinerBody();
    const name = `Drone_${this.source?.id}_${Game.time}`;
    
    // Count total miners across all sources
    const allMiners = this.room.find(FIND_MY_CREEPS, {
      filter: c => RoleHelpers.isMiner(c.memory.role || '')
    });
    
    // First miner is EMERGENCY (no energy production without it!)
    // Additional miners during bootstrap or when critically low are CRITICAL
    const priority = allMiners.length === 0 ? 
      SpawnPriority.EMERGENCY :
      (this.highCharity.isBootstrapping && this.miners.length === 0 ?
        SpawnPriority.CRITICAL :
        SpawnPriority.ECONOMY);
    
    // IMPORTANT: Mark as important if we're low on miners (< 2 total)
    // This ensures spawning even when energy is below 80% capacity
    // Prevents colony death spiral from energy shortage
    const important = allMiners.length < 2 || (this.highCharity.isBootstrapping && this.miners.length === 0);
    
    this.requestSpawn(body, name, {
      role: ROLES.ELITE_DRONE,
      sourceId: this.source?.id
    } as any, priority, important);
  }
  
  private calculateMinerBody(): BodyPartConstant[] {
    // CRITICAL: If no creeps exist, ALWAYS use available energy (emergency bootstrap)
    const totalCreeps = this.room.find(FIND_MY_CREEPS).length;
    const energyRatio = this.highCharity.energyAvailable / this.highCharity.energyCapacity;
    const useAvailable = this.highCharity.isBootstrapping || totalCreeps === 0 || energyRatio < 0.9;
    
    const energy = useAvailable ? 
      this.highCharity.energyAvailable : 
      this.highCharity.energyCapacity;
    
    // Use BodyBuilder to create flexible miner body
    return BodyBuilder.miner(energy);
  }
  
  protected getCreepsForRole(): Creep[] {
    if (!this.source) return [];
    
    return this.room.find(FIND_MY_CREEPS, {
      filter: (creep) => {
        // Prioritize arbiter reference (proper assignment)
        if (creep.memory.arbiter === this.ref) {
          return true;
        }
        
        // Fallback: claim creeps with matching sourceId BUT ONLY if they have no arbiter assigned
        // This handles legacy creeps or edge cases where arbiter wasn't set
        if (!creep.memory.arbiter && 
            RoleHelpers.isMiner(creep.memory.role || '') && 
            creep.memory.sourceId === this.source?.id) {
          // Fix the arbiter reference
          creep.memory.arbiter = this.ref;
          return true;
        }
        
        return false;
      }
    });
  }
}

