/**
 * HARVESTER ARBITER - Early Game Energy Collection
 * 
 * "In the beginning, all must toil to gather the sacred energy"
 * 
 * Manages harvester Elites during bootstrap phase (RCL 1-3).
 * Harvesters directly harvest energy sources and deliver to spawns/extensions.
 * Transitions to miner+hauler system once containers are built.
 */

/// <reference types="@types/screeps" />

import { Arbiter, ArbiterPriority } from './Arbiter';
import { SpawnPriority } from '../spawning/SpawnQueue';
import { HighCharity } from '../core/HighCharity';
import { Elite } from '../elites/Elite';

/**
 * Harvester Arbiter - Manages early-game energy harvesting
 */
export class HarvesterArbiter extends Arbiter {
  harvesters: Elite[];
  
  constructor(highCharity: HighCharity) {
    super(highCharity, 'harvester', ArbiterPriority.economy.mining - 1); // Higher priority than miners
    this.harvesters = [];
  }
  
  init(): void {
    this.refresh();
    this.harvesters = this.elites;
    
    // Only active during bootstrap phase (no containers yet)
    if (!this.shouldBeActive()) {
      return;
    }
    
    // Calculate desired harvesters
    const desired = this.calculateDesiredHarvesters();
    const current = this.harvesters.length;
    
    if (Game.time % 10 === 0 && current < desired) {
      this.requestHarvester();
    }
    
    if (Game.time % 50 === 0) {
      console.log(`🌾 ${this.print}: ${current}/${desired} harvesters`);
    }
  }
  
  run(): void {
    // Only active during bootstrap
    if (!this.shouldBeActive()) {
      return;
    }
    
    for (const harvester of this.harvesters) {
      this.runHarvester(harvester);
    }
  }
  
  /**
   * Check if harvester arbiter should be active
   */
  private shouldBeActive(): boolean {
    // Active if no containers exist OR during bootstrap phase
    const containers = this.room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_CONTAINER
    });
    
    return containers.length === 0 || this.highCharity.isBootstrapping;
  }
  
  /**
   * Run individual harvester logic
   */
  private runHarvester(harvester: Elite): void {
    // If empty, go harvest
    if (harvester.store.getUsedCapacity() === 0) {
      const source = this.findBestSource(harvester);
      if (source) {
        const result = harvester.harvestSource(source);
        if (result === OK) {
          harvester.say('⛏️');
        }
      }
      return;
    }
    
    // If full, deliver energy
    const target = this.findDeliveryTarget(harvester);
    if (target) {
      const result = harvester.transferTo(target);
      if (result === OK) {
        harvester.say('💰');
      } else if (result === ERR_FULL) {
        // Target full, find another
        const nextTarget = this.findDeliveryTarget(harvester, [target.id]);
        if (nextTarget) {
          harvester.transferTo(nextTarget);
        }
      }
    } else {
      // No targets need energy, park near spawn
      const spawn = this.highCharity.spawns[0];
      if (spawn && !harvester.pos.isNearTo(spawn)) {
        harvester.goTo(spawn.pos);
      }
      harvester.say('⏸️');
    }
  }
  
  /**
   * Find best source to harvest from
   */
  private findBestSource(harvester: Elite): Source | null {
    // Find source with fewest harvesters assigned
    const sources = this.room.find(FIND_SOURCES_ACTIVE);
    if (sources.length === 0) return null;
    
    // Count harvesters per source
    const counts: { [id: string]: number } = {};
    for (const h of this.harvesters) {
      const targetSource = h.memory.sourceId as string | undefined;
      if (targetSource) {
        counts[targetSource] = (counts[targetSource] || 0) + 1;
      }
    }
    
    // Find source with least harvesters
    let bestSource = sources[0];
    let leastCount = counts[bestSource.id] || 0;
    
    for (const source of sources) {
      const count = counts[source.id] || 0;
      if (count < leastCount) {
        bestSource = source;
        leastCount = count;
      }
    }
    
    // Assign this harvester to the source
    harvester.memory.sourceId = bestSource.id;
    
    return bestSource;
  }
  
  /**
   * Find best delivery target (spawn/extension)
   */
  private findDeliveryTarget(
    harvester: Elite, 
    excludeIds: Id<Structure>[] = []
  ): StructureSpawn | StructureExtension | null {
    // Priority: Spawns first, then extensions
    const spawns = this.room.find(FIND_MY_SPAWNS, {
      filter: s => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
                  !excludeIds.includes(s.id)
    });
    
    if (spawns.length > 0) {
      return harvester.pos.findClosestByPath(spawns);
    }
    
    const extensions = this.room.find(FIND_MY_STRUCTURES, {
      filter: (s): s is StructureExtension => 
        s.structureType === STRUCTURE_EXTENSION &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
        !excludeIds.includes(s.id)
    });
    
    if (extensions.length > 0) {
      return harvester.pos.findClosestByPath(extensions);
    }
    
    return null;
  }
  
  /**
   * Calculate desired number of harvesters
   */
  private calculateDesiredHarvesters(): number {
    const sources = this.room.find(FIND_SOURCES);
    const spawns = this.highCharity.spawns.length;
    const extensions = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_EXTENSION
    }).length;
    
    // Early game: Need more harvesters to fill spawns/extensions quickly
    // Formula: 2 per source at RCL 1, scale down as we get containers
    
    if (this.highCharity.level === 1) {
      // RCL 1: 2 harvesters per source minimum
      return Math.max(sources.length * 2, 2);
    }
    
    if (this.highCharity.level === 2) {
      // RCL 2: Still need multiple harvesters
      return Math.max(sources.length * 2, 3);
    }
    
    // RCL 3+: Transition to miner+hauler (if containers exist)
    const containers = this.room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_CONTAINER
    });
    
    if (containers.length > 0) {
      // Containers exist, phase out harvesters
      return 0;
    }
    
    // No containers yet, keep 1 per source
    return sources.length;
  }
  
  /**
   * Request a harvester spawn
   */
  private requestHarvester(): void {
    const body = this.calculateHarvesterBody();
    const name = `Harvester_${Game.time}`;
    
    // Harvesters are CRITICAL during bootstrap (no energy = no spawning)
    const priority = this.highCharity.isBootstrapping && this.harvesters.length < 2 ?
      SpawnPriority.CRITICAL :
      SpawnPriority.ECONOMY;
    
    const important = this.highCharity.isBootstrapping && this.harvesters.length < 2;
    
    this.requestSpawn(body, name, {
      role: 'harvester',
      sourceId: undefined // Will be assigned dynamically
    } as any, priority, important);
  }
  
  /**
   * Calculate harvester body based on available energy
   */
  private calculateHarvesterBody(): BodyPartConstant[] {
    // Harvesters need balanced WORK, CARRY, MOVE
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
