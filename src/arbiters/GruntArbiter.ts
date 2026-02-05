/**
 * GRUNT ARBITER - Unggoy Laborers
 * 
 * "The Unggoy serve the KHALA with unwavering loyalty"
 * 
 * Manages Grunt laborers during bootstrap phase (RCL 1-3).
 * Grunts directly harvest energy sources and deliver to spawns/extensions.
 * Transitions to specialized miner+hauler system once containers are built.
 */

/// <reference types="@types/screeps" />

import { Arbiter, ArbiterPriority } from './Arbiter';
import { SpawnPriority } from '../spawning/SpawnQueue';
import { Nexus } from '../core/Nexus';
import { Warrior } from '../Warriors/Warrior';
import { ROLES, RoleHelpers } from '../constants/Roles';
import { BodyBuilder } from '../utils/BodyBuilder';

/**
 * Grunt Arbiter - Manages early-game energy harvesting
 */
export class ZealotArbiter extends Arbiter {
  grunts: Warrior[];
  
  constructor(Nexus: Nexus) {
    super(Nexus, 'grunt', ArbiterPriority.economy.mining - 1); // Higher priority than miners
    this.grunts = [];
  }
  
  init(): void {
    this.refresh();
    this.grunts = this.warriors;
    
    const isActive = this.shouldBeActive();
    const totalCreeps = this.room.find(FIND_MY_CREEPS).length;
    
    // Debug logging (more frequent when no creeps)
    if (totalCreeps === 0 || Game.time % 10 === 0) {
      const desired = this.calculateDesiredgrunts();
      const current = this.grunts.length;
      
      // Detailed energy breakdown
      const spawns = this.room.find(FIND_MY_SPAWNS);
      const extensions = this.room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_EXTENSION
      }) as StructureExtension[];
      
      const spawnEnergy = spawns.reduce((sum, s) => sum + s.store[RESOURCE_ENERGY], 0);
      const extensionEnergy = extensions.reduce((sum, e) => sum + e.store[RESOURCE_ENERGY], 0);
      
      console.log(`🙏 ${this.print}: ${current}/${desired} grunts, active: ${isActive}, totalCreeps: ${totalCreeps}`);
      console.log(`   Room energy: ${this.room.energyAvailable}/${this.room.energyCapacityAvailable}`);
      console.log(`   Manual count - Spawns: ${spawns.length} with ${spawnEnergy} energy, Extensions: ${extensions.length} with ${extensionEnergy} energy`);
      console.log(`   Total manual: ${spawnEnergy + extensionEnergy}`);
    }
    
    // Only active during bootstrap phase (no containers yet) OR emergency (no creeps)
    if (!isActive) {
      return;
    }
    
    // Calculate desired grunts
    const desired = this.calculateDesiredgrunts();
    const current = this.grunts.length;
    
    // Request spawn whenever we need more grunts
    // SpawnQueue handles deduplication, so it's safe to request every tick
    if (current < desired) {
      if (totalCreeps === 0 && Game.time % 5 === 0) {
        console.log(`🙏 ${this.print}: EMERGENCY SPAWN REQUEST - No creeps exist!`);
      }
      this.requestgrunt();
    }
  }
  
  run(): void {
    // Always run existing grunts until they die naturally
    // (even after containers exist - let them finish their life)
    for (const grunt of this.grunts) {
      this.rungrunt(grunt);
    }
  }
  
  /**
   * Check if grunt arbiter should be active
   */
  private shouldBeActive(): boolean {
    // EMERGENCY: If there are NO creeps at all, bootstrap with grunts
    const totalCreeps = this.room.find(FIND_MY_CREEPS).length;
    if (totalCreeps === 0) {
      return true;
    }
    
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
    
    // No source containers - grunts still needed
    return true;
  }
  
  /**
   * Run individual grunt logic - simple state machine
   */
  private rungrunt(ZEALOT_UNIT: Warrior): void {
    // State: HARVESTING or DELIVERING (based on carry capacity)
    const isHarvesting = grunt.store.getFreeCapacity() > 0;
    
    if (isHarvesting) {
      // HARVEST STATE: Go to assigned source and harvest
      let source: Source | null = null;
      
      // Check if we have an assigned source
      if (grunt.memory.sourceId) {
        source = Game.getObjectById(grunt.memory.sourceId as Id<Source>);
      }
      
      // If no assigned source or source is invalid, find a new one
      if (!source) {
        source = this.findBestSource(grunt);
      }
      
      if (source) {
        const result = grunt.harvestSource(source);
        if (result === OK) {
          grunt.say('⛏️');
        } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
          // Source depleted, clear assignment to find a new one
          grunt.memory.sourceId = undefined;
        }
      }
    } else {
      // DELIVER STATE: Take energy to spawn/extension
      const target = this.findDeliveryTarget(grunt);
      if (target) {
        const result = grunt.transferTo(target);
        if (result === OK) {
          grunt.say('💰');
        } else if (result === ERR_FULL) {
          // Target full, find another
          const nextTarget = this.findDeliveryTarget(grunt, [target.id]);
          if (nextTarget) {
            grunt.transferTo(nextTarget);
          }
        }
      } else {
        // No targets need energy, park near spawn
        const spawn = this.Nexus.spawns[0];
        if (spawn && !grunt.pos.isNearTo(spawn)) {
          grunt.goTo(spawn.pos);
        }
        grunt.say('⏸️');
      }
    }
  }
  
  /**
   * Find best source to harvest from (assigns permanently)
   */
  private findBestSource(ZEALOT_UNIT: Warrior): Source | null {
    const sources = this.room.find(FIND_SOURCES_ACTIVE);
    if (sources.length === 0) return null;
    
    // Count grunts per source
    const counts: { [id: string]: number } = {};
    for (const a of this.grunts) {
      const targetSource = a.memory.sourceId as string | undefined;
      if (targetSource) {
        counts[targetSource] = (counts[targetSource] || 0) + 1;
      }
    }
    
    // Find source with least grunts
    let bestSource = sources[0];
    let leastCount = counts[bestSource.id] || 0;
    
    for (const source of sources) {
      const count = counts[source.id] || 0;
      if (count < leastCount) {
        bestSource = source;
        leastCount = count;
      }
    }
    
    // Assign this grunt to the source permanently
    grunt.memory.sourceId = bestSource.id;
    
    return bestSource;
  }
  
  /**
   * Find best delivery target (spawn/extension)
   */
  private findDeliveryTarget(
    ZEALOT_UNIT: Warrior, 
    excludeIds: Id<Structure>[] = []
  ): StructureSpawn | StructureExtension | null {
    // Priority: Spawns first, then extensions
    const spawns = this.room.find(FIND_MY_SPAWNS, {
      filter: s => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
                  !excludeIds.includes(s.id)
    });
    
    if (spawns.length > 0) {
      return grunt.pos.findClosestByPath(spawns);
    }
    
    const extensions = this.room.find(FIND_MY_STRUCTURES, {
      filter: (s): s is StructureExtension => 
        s.structureType === STRUCTURE_EXTENSION &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
        !excludeIds.includes(s.id)
    });
    
    if (extensions.length > 0) {
      return grunt.pos.findClosestByPath(extensions);
    }
    
    return null;
  }
  
  /**
   * Calculate desired number of grunts
   */
  private calculateDesiredgrunts(): number {
    const sources = this.room.find(FIND_SOURCES);
    const spawns = this.Nexus.spawns.length;
    const extensions = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_EXTENSION
    }).length;
    
    // Early game: Need more harvesters to fill spawns/extensions quickly
    // Formula: 2 per source at RCL 1, scale down as we get containers
    
    if (this.Nexus.level === 1) {
      // RCL 1: 2 grunts per source minimum
      return Math.max(sources.length * 2, 2);
    }
    
    if (this.Nexus.level === 2) {
      // RCL 2: Still need multiple grunts
      return Math.max(sources.length * 2, 3);
    }
    
    // RCL 3+: Transition to miner+hauler (if containers exist)
    const containers = this.room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_CONTAINER
    });
    
    if (containers.length > 0) {
      // Containers exist, phase out grunts
      return 0;
    }
    
    // No containers yet, keep 1 per source
    return sources.length;
  }
  
  /**
   * Request an grunt spawn
   */
  private requestgrunt(): void {
    const body = this.calculategruntBody();
    const name = `Grunt_${Game.time}`;
    
    // EMERGENCY if no creeps exist at all
    const totalCreeps = this.room.find(FIND_MY_CREEPS).length;
    const priority = totalCreeps === 0 ? 
      SpawnPriority.EMERGENCY :
      (this.Nexus.isBootstrapping && this.grunts.length < 2 ?
        SpawnPriority.CRITICAL :
        SpawnPriority.ECONOMY);
    
    const important = totalCreeps === 0 || (this.Nexus.isBootstrapping && this.grunts.length < 2);
    
    this.requestSpawn(body, name, {
      role: ROLES.ZEALOT_UNIT,
      sourceId: undefined // Will be assigned dynamically
    } as any, priority, important);
  }
  
  /**
   * Calculate grunt body based on available energy
   */
  private calculategruntBody(): BodyPartConstant[] {
    // CRITICAL: If no creeps exist, ALWAYS use available energy (emergency bootstrap)
    const totalCreeps = this.room.find(FIND_MY_CREEPS).length;
    const energy = (this.Nexus.isBootstrapping || totalCreeps === 0) ? 
      this.Nexus.energyAvailable : 
      this.Nexus.energyCapacity;
    
    // Use BodyBuilder to create flexible worker body
    return BodyBuilder.worker(energy);
  }
  
  protected getCreepsForRole(): Creep[] {
    return this.room.find(FIND_MY_CREEPS, {
      filter: (creep) => 
        creep.memory.arbiter === this.ref ||
        RoleHelpers.isGrunt(creep.memory.role || '')
    });
  }
}

