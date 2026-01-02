/**
 * BUILDER ARBITER - Construction Manager
 * 
 * "We shall build monuments to the Great Journey"
 * 
 * Manages builder Elites that construct buildings and repair structures.
 * Adapts to construction needs dynamically.
 */

/// <reference types="@types/screeps" />

import { Arbiter, ArbiterPriority } from './Arbiter';
import { HighCharity } from '../core/HighCharity';
import { Elite } from '../elites/Elite';

/**
 * Builder Arbiter - Manages construction and repair
 */
export class BuilderArbiter extends Arbiter {
  builders: Elite[];
  
  constructor(highCharity: HighCharity) {
    super(highCharity, 'builder', ArbiterPriority.support.builder);
    this.builders = [];
  }
  
  init(): void {
    this.refresh();
    
    // Request builders if needed
    const desiredBuilders = this.calculateDesiredBuilders();
    const currentBuilders = this.builders.length;
    
    if (currentBuilders < desiredBuilders) {
      this.requestBuilder();
    }
  }
  
  run(): void {
    for (const builder of this.builders) {
      this.runBuilder(builder);
    }
  }
  
  private runBuilder(builder: Elite): void {
    // State machine: harvesting → building/repairing
    if (builder.memory.building && builder.needsEnergy) {
      builder.memory.building = false;
    }
    if (!builder.memory.building && builder.isFull) {
      builder.memory.building = true;
    }
    
    if (builder.memory.building) {
      // Build or repair
      if (!this.buildSomething(builder)) {
        this.repairSomething(builder);
      }
    } else {
      // Get energy
      this.getEnergy(builder);
    }
  }
  
  private buildSomething(builder: Elite): boolean {
    // Find construction sites
    const sites = this.room.find(FIND_MY_CONSTRUCTION_SITES);
    
    if (sites.length === 0) return false;
    
    // Prioritize by type
    const priority = [
      STRUCTURE_SPAWN,
      STRUCTURE_EXTENSION,
      STRUCTURE_TOWER,
      STRUCTURE_STORAGE,
      STRUCTURE_CONTAINER,
      STRUCTURE_ROAD,
      STRUCTURE_RAMPART,
      STRUCTURE_WALL
    ];
    
    let target: ConstructionSite | null = null;
    for (const type of priority) {
      target = sites.find(s => s.structureType === type) || null;
      if (target) break;
    }
    
    if (!target) target = sites[0];
    
    const result = builder.buildSite(target);
    if (result === OK || result === ERR_NOT_IN_RANGE) {
      builder.say('🔨');
      return true;
    }
    
    return false;
  }
  
  private repairSomething(builder: Elite): boolean {
    // Find structures needing repair (under 75% health)
    const damaged = this.room.find(FIND_STRUCTURES, {
      filter: (s) => {
        if (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) {
          return s.hits < 10000; // Don't over-repair walls/ramparts
        }
        return s.hits < s.hitsMax * 0.75;
      }
    });
    
    if (damaged.length === 0) {
      builder.say('✋');
      return false;
    }
    
    // Prioritize critical structures
    const critical = damaged.find(s => 
      s.structureType === STRUCTURE_SPAWN ||
      s.structureType === STRUCTURE_TOWER ||
      s.structureType === STRUCTURE_STORAGE
    );
    
    const target = critical || damaged[0];
    const result = builder.repairStructure(target);
    
    if (result === OK || result === ERR_NOT_IN_RANGE) {
      builder.say('🔧');
      return true;
    }
    
    return false;
  }
  
  private getEnergy(builder: Elite): void {
    // Priority: Containers > Storage > Dropped resources
    
    const container = builder.pos.findClosestByPath(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
                     s.store.getUsedCapacity(RESOURCE_ENERGY) > 50
    }) as StructureContainer | null;
    
    if (container) {
      builder.withdrawFrom(container);
      builder.say('🔋');
      return;
    }
    
    if (this.highCharity.storage && 
        this.highCharity.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 2000) {
      builder.withdrawFrom(this.highCharity.storage);
      builder.say('🏦');
      return;
    }
    
    const dropped = builder.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
      filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50
    });
    
    if (dropped) {
      if (builder.pos.isNearTo(dropped)) {
        builder.pickup(dropped);
      } else {
        builder.goTo(dropped);
      }
      builder.say('💎');
      return;
    }
    
    // Last resort: harvest
    const source = builder.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (source) {
      builder.harvestSource(source);
      builder.say('⛏️');
    }
  }
  
  private calculateDesiredBuilders(): number {
    const sites = this.room.find(FIND_MY_CONSTRUCTION_SITES);
    const phase = this.highCharity.memory.phase;
    
    // No construction sites
    if (sites.length === 0) {
      return phase === 'bootstrap' ? 1 : 0;
    }
    
    // Scale with construction sites
    const buildersNeeded = Math.min(Math.ceil(sites.length / 5), 4);
    
    // Bootstrap: Always have 1-2 builders
    if (phase === 'bootstrap') {
      return Math.max(buildersNeeded, 2);
    }
    
    // Developing: 2-3 builders
    if (phase === 'developing') {
      return Math.max(buildersNeeded, 2);
    }
    
    // Later phases: Scale with need
    return buildersNeeded;
  }
  
  private requestBuilder(): void {
    const body = this.calculateBuilderBody();
    const name = `builder_${Game.time}`;
    
    this.requestSpawn(body, name, {
      role: 'builder',
      building: false
    } as any);
  }
  
  private calculateBuilderBody(): BodyPartConstant[] {
    const energy = this.highCharity.energyCapacity;
    
    // Early game: Small builder
    if (energy < 400) {
      return [WORK, CARRY, MOVE, MOVE];
    }
    
    // Mid game: Balanced builder
    if (energy < 800) {
      return [WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE];
    }
    
    // Late game: Large builder
    const pattern: BodyPartConstant[] = [WORK, WORK, CARRY, MOVE, MOVE];
    return this.calculateBody(pattern, 6);
  }
  
  protected getCreepsForRole(): Creep[] {
    return this.room.find(FIND_MY_CREEPS, {
      filter: (creep) => 
        creep.memory.arbiter === this.ref ||
        creep.memory.role === 'builder'
    });
  }
}
