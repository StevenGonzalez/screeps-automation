/**
 * ACOLYTE ARBITER - Sacred Initiates
 * 
 * "The youngest of the faithful gather energy for the Covenant"
 * 
 * Manages Acolyte initiates during bootstrap phase (RCL 1-3).
 * Acolytes directly harvest energy sources and deliver to spawns/extensions.
 * Transitions to miner+hauler system once containers are built.
 */

/// <reference types="@types/screeps" />

import { Arbiter, ArbiterPriority } from './Arbiter';
import { SpawnPriority } from '../spawning/SpawnQueue';
import { HighCharity } from '../core/HighCharity';
import { Elite } from '../elites/Elite';

/**
 * Acolyte Arbiter - Manages early-game energy harvesting
 */
export class AcolyteArbiter extends Arbiter {
  acolytes: Elite[];
  
  constructor(highCharity: HighCharity) {
    super(highCharity, 'acolyte', ArbiterPriority.economy.mining - 1); // Higher priority than miners
    this.acolytes = [];
  }
  
  init(): void {
    this.refresh();
    this.acolytes = this.elites;
    
    // Only active during bootstrap phase (no containers yet)
    if (!this.shouldBeActive()) {
      return;
    }
    
    // Calculate desired acolytes
    const desired = this.calculateDesiredAcolytes();
    const current = this.acolytes.length;
    
    if (Game.time % 10 === 0 && current < desired) {
      this.requestAcolyte();
    }
    
    if (Game.time % 50 === 0) {
      console.log(`🙏 ${this.print}: ${current}/${desired} acolytes`);
    }
  }
  
  run(): void {
    // Always run existing acolytes until they die naturally
    // (even after containers exist - let them finish their life)
    for (const acolyte of this.acolytes) {
      this.runAcolyte(acolyte);
    }
  }
  
  /**
   * Check if acolyte arbiter should be active
   */
  private shouldBeActive(): boolean {
    // Check if there are containers at sources (Extractors taking over)
    const sources = this.room.find(FIND_SOURCES);
    for (const source of sources) {
      const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: s => s.structureType === STRUCTURE_CONTAINER
      });
      if (containers.length > 0) {
        // Containers at sources exist - Extractors handle energy now
        return false;
      }
    }
    
    // No source containers - Acolytes still needed
    return true;
  }
  
  /**
   * Run individual acolyte logic - simple state machine
   */
  private runAcolyte(acolyte: Elite): void {
    // State: HARVESTING or DELIVERING (based on carry capacity)
    const isHarvesting = acolyte.store.getFreeCapacity() > 0;
    
    if (isHarvesting) {
      // HARVEST STATE: Go to assigned source and harvest
      let source: Source | null = null;
      
      // Check if we have an assigned source
      if (acolyte.memory.sourceId) {
        source = Game.getObjectById(acolyte.memory.sourceId as Id<Source>);
      }
      
      // If no assigned source or source is invalid, find a new one
      if (!source) {
        source = this.findBestSource(acolyte);
      }
      
      if (source) {
        const result = acolyte.harvestSource(source);
        if (result === OK) {
          acolyte.say('⛏️');
        } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
          // Source depleted, clear assignment to find a new one
          acolyte.memory.sourceId = undefined;
        }
      }
    } else {
      // DELIVER STATE: Take energy to spawn/extension
      const target = this.findDeliveryTarget(acolyte);
      if (target) {
        const result = acolyte.transferTo(target);
        if (result === OK) {
          acolyte.say('💰');
        } else if (result === ERR_FULL) {
          // Target full, find another
          const nextTarget = this.findDeliveryTarget(acolyte, [target.id]);
          if (nextTarget) {
            acolyte.transferTo(nextTarget);
          }
        }
      } else {
        // No targets need energy, park near spawn
        const spawn = this.highCharity.spawns[0];
        if (spawn && !acolyte.pos.isNearTo(spawn)) {
          acolyte.goTo(spawn.pos);
        }
        acolyte.say('⏸️');
      }
    }
  }
  
  /**
   * Find best source to harvest from (assigns permanently)
   */
  private findBestSource(acolyte: Elite): Source | null {
    const sources = this.room.find(FIND_SOURCES_ACTIVE);
    if (sources.length === 0) return null;
    
    // Count acolytes per source
    const counts: { [id: string]: number } = {};
    for (const a of this.acolytes) {
      const targetSource = a.memory.sourceId as string | undefined;
      if (targetSource) {
        counts[targetSource] = (counts[targetSource] || 0) + 1;
      }
    }
    
    // Find source with least acolytes
    let bestSource = sources[0];
    let leastCount = counts[bestSource.id] || 0;
    
    for (const source of sources) {
      const count = counts[source.id] || 0;
      if (count < leastCount) {
        bestSource = source;
        leastCount = count;
      }
    }
    
    // Assign this acolyte to the source permanently
    acolyte.memory.sourceId = bestSource.id;
    
    return bestSource;
  }
  
  /**
   * Find best delivery target (spawn/extension)
   */
  private findDeliveryTarget(
    acolyte: Elite, 
    excludeIds: Id<Structure>[] = []
  ): StructureSpawn | StructureExtension | null {
    // Priority: Spawns first, then extensions
    const spawns = this.room.find(FIND_MY_SPAWNS, {
      filter: s => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
                  !excludeIds.includes(s.id)
    });
    
    if (spawns.length > 0) {
      return acolyte.pos.findClosestByPath(spawns);
    }
    
    const extensions = this.room.find(FIND_MY_STRUCTURES, {
      filter: (s): s is StructureExtension => 
        s.structureType === STRUCTURE_EXTENSION &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
        !excludeIds.includes(s.id)
    });
    
    if (extensions.length > 0) {
      return acolyte.pos.findClosestByPath(extensions);
    }
    
    return null;
  }
  
  /**
   * Calculate desired number of acolytes
   */
  private calculateDesiredAcolytes(): number {
    const sources = this.room.find(FIND_SOURCES);
    const spawns = this.highCharity.spawns.length;
    const extensions = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_EXTENSION
    }).length;
    
    // Early game: Need more harvesters to fill spawns/extensions quickly
    // Formula: 2 per source at RCL 1, scale down as we get containers
    
    if (this.highCharity.level === 1) {
      // RCL 1: 2 acolytes per source minimum
      return Math.max(sources.length * 2, 2);
    }
    
    if (this.highCharity.level === 2) {
      // RCL 2: Still need multiple acolytes
      return Math.max(sources.length * 2, 3);
    }
    
    // RCL 3+: Transition to miner+hauler (if containers exist)
    const containers = this.room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_CONTAINER
    });
    
    if (containers.length > 0) {
      // Containers exist, phase out acolytes
      return 0;
    }
    
    // No containers yet, keep 1 per source
    return sources.length;
  }
  
  /**
   * Request an acolyte spawn
   */
  private requestAcolyte(): void {
    const body = this.calculateAcolyteBody();
    const name = `Acolyte_${Game.time}`;
    
    // Acolytes are CRITICAL during bootstrap (no energy = no spawning)
    const priority = this.highCharity.isBootstrapping && this.acolytes.length < 2 ?
      SpawnPriority.CRITICAL :
      SpawnPriority.ECONOMY;
    
    const important = this.highCharity.isBootstrapping && this.acolytes.length < 2;
    
    this.requestSpawn(body, name, {
      role: 'acolyte',
      sourceId: undefined // Will be assigned dynamically
    } as any, priority, important);
  }
  
  /**
   * Calculate acolyte body based on available energy
   */
  private calculateAcolyteBody(): BodyPartConstant[] {
    // Acolytes need balanced WORK, CARRY, MOVE
    const energy = this.highCharity.isBootstrapping ? 
      this.highCharity.energyAvailable : 
      this.highCharity.energyCapacity;
    
    // Minimal harvester (200 energy): 1W 1C 1M
    if (energy <= 250) {
      return [WORK, CARRY, MOVE];
    }
    
    // Small harvester (300 energy): 1W 2C 2M
    if (energy < 400) {
      return [WORK, CARRY, CARRY, MOVE, MOVE];
    }
    
    // Standard harvester (450 energy): 2W 2C 2M
    if (energy < 550) {
      return [WORK, WORK, CARRY, CARRY, MOVE, MOVE];
    }
    
    // Large harvester (550 energy): 2W 3C 3M
    if (energy < 700) {
      return [WORK, WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE];
    }
    
    // Max harvester (800 energy): 3W 3C 4M
    return [WORK, WORK, WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE];
  }
  
  protected getCreepsForRole(): Creep[] {
    return this.room.find(FIND_MY_CREEPS, {
      filter: (creep) => 
        creep.memory.arbiter === this.ref ||
        creep.memory.role === 'harvester'
    });
  }
}
