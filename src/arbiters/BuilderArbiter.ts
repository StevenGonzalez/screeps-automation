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
    
    // Place construction sites based on room plan
    if (Game.time % 50 === 0) {
      this.placeConstructionSites();
    }
    
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
    // Check DefenseTemple for fortification repair needs first
    const defenseTemple = this.highCharity.defenseTemple;
    
    // Priority 1: Ramparts needing repair
    const ramparts = defenseTemple.getRampartsNeedingRepair();
    if (ramparts.length > 0) {
      const target = ramparts[0];
      const result = builder.repairStructure(target);
      if (result === OK || result === ERR_NOT_IN_RANGE) {
        builder.say('🛡️');
        return true;
      }
    }
    
    // Priority 2: Walls needing repair
    const walls = defenseTemple.getWallsNeedingRepair();
    if (walls.length > 0) {
      const target = walls[0];
      const result = builder.repairStructure(target);
      if (result === OK || result === ERR_NOT_IN_RANGE) {
        builder.say('🧱');
        return true;
      }
    }
    
    // Priority 3: Other damaged structures
    const damaged = this.room.find(FIND_STRUCTURES, {
      filter: (s) => {
        // Skip walls and ramparts (handled above)
        if (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) {
          return false;
        }
        // Repair critical structures immediately
        if (s.structureType === STRUCTURE_SPAWN ||
            s.structureType === STRUCTURE_TOWER ||
            s.structureType === STRUCTURE_STORAGE) {
          return s.hits < s.hitsMax;
        }
        // Other structures at 75% HP
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
      role: 'elite_builder', // Covenant themed role
      building: false
    } as any);
  }
  
  private calculateBuilderBody(): BodyPartConstant[] {
    // Use available energy during bootstrap to get started quickly
    const energy = this.highCharity.isBootstrapping ? 
      this.highCharity.energyAvailable : 
      this.highCharity.energyCapacity;
    
    // Emergency: Minimal builder (200 energy)
    if (energy < 300) {
      return [WORK, CARRY, MOVE];
    }
    
    // Early game: Small builder (250 energy)
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
        creep.memory.role === 'elite_builder' ||
        creep.memory.role === 'builder'
    });
  }
  
  /**
   * Place construction sites based on room plan
   */
  private placeConstructionSites(): void {
    const plan = this.highCharity.planner.getPlan();
    if (!plan) return;
    
    const level = this.room.controller!.level;
    
    // Get max structures for current RCL
    const maxSpawns = CONTROLLER_STRUCTURES[STRUCTURE_SPAWN][level];
    const maxExtensions = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][level];
    const maxTowers = CONTROLLER_STRUCTURES[STRUCTURE_TOWER][level];
    const maxLabs = CONTROLLER_STRUCTURES[STRUCTURE_LAB][level];
    const maxLinks = CONTROLLER_STRUCTURES[STRUCTURE_LINK][level];
    
    // Count existing structures
    const existingSpawns = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_SPAWN
    }).length;
    const existingExtensions = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_EXTENSION
    }).length;
    const existingTowers = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_TOWER
    }).length;
    const existingLabs = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_LAB
    }).length;
    const existingLinks = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_LINK
    }).length;
    
    // Place spawns
    for (let i = existingSpawns; i < Math.min(maxSpawns, plan.spawns.length); i++) {
      const pos = plan.spawns[i];
      if (pos && !this.hasStructureOrSite(pos, STRUCTURE_SPAWN)) {
        this.room.createConstructionSite(pos, STRUCTURE_SPAWN);
      }
    }
    
    // Place extensions
    for (let i = existingExtensions; i < Math.min(maxExtensions, plan.extensions.length); i++) {
      const pos = plan.extensions[i];
      if (pos && !this.hasStructureOrSite(pos, STRUCTURE_EXTENSION)) {
        const result = this.room.createConstructionSite(pos, STRUCTURE_EXTENSION);
        if (result !== OK && result !== ERR_FULL) break; // Stop if hit construction site limit
      }
    }
    
    // Place towers
    for (let i = existingTowers; i < Math.min(maxTowers, plan.towers.length); i++) {
      const pos = plan.towers[i];
      if (pos && !this.hasStructureOrSite(pos, STRUCTURE_TOWER)) {
        this.room.createConstructionSite(pos, STRUCTURE_TOWER);
      }
    }
    
    // Place storage (RCL 4+)
    if (level >= 4 && plan.storage && !this.hasStructureOrSite(plan.storage, STRUCTURE_STORAGE)) {
      this.room.createConstructionSite(plan.storage, STRUCTURE_STORAGE);
    }
    
    // Place terminal (RCL 6+)
    if (level >= 6 && plan.terminal && !this.hasStructureOrSite(plan.terminal, STRUCTURE_TERMINAL)) {
      this.room.createConstructionSite(plan.terminal, STRUCTURE_TERMINAL);
    }
    
    // Place labs (RCL 6+)
    if (level >= 6) {
      for (let i = existingLabs; i < Math.min(maxLabs, plan.labs.length); i++) {
        const pos = plan.labs[i];
        if (pos && !this.hasStructureOrSite(pos, STRUCTURE_LAB)) {
          this.room.createConstructionSite(pos, STRUCTURE_LAB);
        }
      }
    }
    
    // Place factory (RCL 7+)
    if (level >= 7 && plan.factory && !this.hasStructureOrSite(plan.factory, STRUCTURE_FACTORY)) {
      this.room.createConstructionSite(plan.factory, STRUCTURE_FACTORY);
    }
    
    // Place power spawn (RCL 8)
    if (level >= 8 && plan.powerSpawn && !this.hasStructureOrSite(plan.powerSpawn, STRUCTURE_POWER_SPAWN)) {
      this.room.createConstructionSite(plan.powerSpawn, STRUCTURE_POWER_SPAWN);
    }
    
    // Place nuker (RCL 8)
    if (level >= 8 && plan.nuker && !this.hasStructureOrSite(plan.nuker, STRUCTURE_NUKER)) {
      this.room.createConstructionSite(plan.nuker, STRUCTURE_NUKER);
    }
    
    // Place observer (RCL 8)
    if (level >= 8 && plan.observer && !this.hasStructureOrSite(plan.observer, STRUCTURE_OBSERVER)) {
      this.room.createConstructionSite(plan.observer, STRUCTURE_OBSERVER);
    }
  }
  
  /**
   * Check if position has structure or construction site
   */
  private hasStructureOrSite(pos: RoomPosition, structureType: BuildableStructureConstant): boolean {
    const structures = pos.lookFor(LOOK_STRUCTURES);
    if (structures.some(s => s.structureType === structureType)) {
      return true;
    }
    
    const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
    if (sites.some(s => s.structureType === structureType)) {
      return true;
    }
    
    return false;
  }
}
