/**
 * BUILDER ARBITER - Construction Manager
 * 
 * "We shall build monuments to the Great Journey"
 * 
 * Manages builder Warriors that construct buildings and repair structures.
 * Adapts to construction needs dynamically.
 */

/// <reference types="@types/screeps" />

import { Arbiter, ArbiterPriority } from './Arbiter';
import { SpawnPriority } from '../spawning/SpawnQueue';
import { Nexus } from '../core/Nexus';
import { Warrior } from '../Warriors/Warrior';
import { EnergyCollector } from '../utils/EnergyCollector';
import { getSpawnName } from '../utils/SpawnNames';
import { ROLES, RoleHelpers } from '../constants/Roles';
import { BodyBuilder } from '../utils/BodyBuilder';

/**
 * Builder Arbiter - Manages construction and repair
 */
export class EngineerArbiter extends Arbiter {
  builders: Warrior[];
  
  constructor(Nexus: Nexus) {
    super(Nexus, 'builder', ArbiterPriority.support.builder);
    this.builders = [];
  }
  
  init(): void {
    this.refresh();
    
    // Update builders list from Warriors
    this.builders = this.warriors;
    
    // Place construction sites based on room plan
    // More frequent for critical structures like containers
    if (Game.time % 10 === 0) {
      this.placeConstructionSites();
    }
    
    // Request builders if needed
    const desiredBuilders = this.calculateDesiredBuilders();
    const currentBuilders = this.builders.length;
    
    // Debug logging (more frequent to catch issues)
    if (Game.time % 10 === 0 && (desiredBuilders > 0 || currentBuilders > 0)) {
      const sites = this.room.find(FIND_MY_CONSTRUCTION_SITES).length;
      console.log(`🔧 ${this.print}: ${currentBuilders}/${desiredBuilders} builders, ${sites} construction sites`);
    }
    
    // DEFENSIVE PROTOCOL: During high threat (>= 6), only spawn builders if we have damaged structures
    // Prioritize defense over new construction
    const threatLevel = this.Nexus.safeModeManager.getThreatLevel();
    if (threatLevel >= 6 && currentBuilders < desiredBuilders) {
      const damagedStructures = this.room.find(FIND_STRUCTURES, {
        filter: s => s.hits < s.hitsMax && 
                    (s.structureType === STRUCTURE_SPAWN ||
                     s.structureType === STRUCTURE_TOWER ||
                     s.structureType === STRUCTURE_RAMPART)
      });
      
      if (damagedStructures.length === 0) {
        if (Game.time % 100 === 0) {
          console.log(`⚔️ ${this.print}: Suspending builder spawns during combat (threat: ${threatLevel}/10)`);
        }
        return; // Skip spawning builders for new construction during heavy combat
      }
    }
    
    // Request spawn whenever we need more builders (removed tick throttle)
    // SpawnQueue handles deduplication, so it's safe to request every tick
    if (currentBuilders < desiredBuilders) {
      if (Game.time % 10 === 0) {
        console.log(`🔧 ${this.print}: Requesting builder (current: ${currentBuilders}, desired: ${desiredBuilders})`)
      }
      this.requestBuilder();
    }
  }
  
  run(): void {
    for (const builder of this.builders) {
      this.runBuilder(builder);
    }
  }
  
  private runBuilder(builder: Warrior): void {
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
  
  private buildSomething(builder: Warrior): boolean {
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
  
  private repairSomething(builder: Warrior): boolean {
    // Check DefenseGateway for fortification repair needs first
    const DefenseGateway = this.Nexus.DefenseGateway;
    
    // Priority 1: Ramparts needing repair
    const ramparts = DefenseGateway.getRampartsNeedingRepair();
    if (ramparts.length > 0) {
      const target = ramparts[0];
      const result = builder.repairStructure(target);
      if (result === OK || result === ERR_NOT_IN_RANGE) {
        builder.say('🛡️');
        return true;
      }
    }
    
    // Priority 2: Prefer repairing roads/containers (prevent decay)
    // Roads and containers decay over time and must be maintained
    const roadsAndContainers = this.room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER || s.structureType === STRUCTURE_ROAD
    }) as (StructureContainer | StructureRoad)[];

    const needyRoads = roadsAndContainers.filter(s => s.hits < s.hitsMax * 0.9);
    if (needyRoads.length > 0) {
      // Repair the weakest road/container first
      needyRoads.sort((a, b) => a.hits - b.hits);
      const target = needyRoads[0];
      const result = builder.repairStructure(target);
      if (result === OK || result === ERR_NOT_IN_RANGE) {
        builder.say('🛣️');
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
        // Containers and roads decay - repair at 90% to prevent loss
        if (s.structureType === STRUCTURE_CONTAINER || 
            s.structureType === STRUCTURE_ROAD) {
          return s.hits < s.hitsMax * 0.9;
        }
        // Other structures at 75% HP
        return s.hits < s.hitsMax * 0.75;
      }
    });
    
    if (damaged.length === 0) {
      builder.say('✋');
      return false;
    }
    
    // Prioritize critical structures and containers
    const critical = damaged.find(s => 
      s.structureType === STRUCTURE_SPAWN ||
      s.structureType === STRUCTURE_TOWER ||
      s.structureType === STRUCTURE_STORAGE ||
      s.structureType === STRUCTURE_CONTAINER
    );
    
    const target = critical || damaged[0];
    const result = builder.repairStructure(target);
    
    if (result === OK || result === ERR_NOT_IN_RANGE) {
      builder.say('🔧');
      return true;
    }

    // Priority 4: Walls (low-frequency or threat-driven)
    const walls = DefenseGateway.getWallsNeedingRepair();
    if (walls.length > 0) {
      // Only perform bulk wall repairs if under threat or on a low-frequency maintenance tick
      const threatLevel = (DefenseGateway.memory as any)?.threatLevel || 0;
      const maintenanceTick = (Game.time % 1000) === 0; // once every 1000 ticks

      if (threatLevel > 0 || maintenanceTick) {
        const targetWall = walls[0];
        const r = builder.repairStructure(targetWall);
        if (r === OK || r === ERR_NOT_IN_RANGE) {
          builder.say('🧱');
          return true;
        }
      }
    }

    return false;
  }
  
  private getEnergy(builder: Warrior): void {
    // Use centralized EnergyCollector for worker energy collection
    EnergyCollector.collect(builder, {
      useLinks: false, // Links are for upgraders
      useContainers: true, // Use containers if available
      storageMinEnergy: 1000 // Lower threshold for storage
    });
  }
  
  private calculateDesiredBuilders(): number {
    const sites = this.room.find(FIND_MY_CONSTRUCTION_SITES);
    const phase = this.Nexus.memory.phase;
    
    // Check if there are structures needing repair
    const needsRepair = this.room.find(FIND_STRUCTURES, {
      filter: (s) => {
        if (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) {
          return false;
        }
        // Containers and roads decay constantly
        if (s.structureType === STRUCTURE_CONTAINER || s.structureType === STRUCTURE_ROAD) {
          return s.hits < s.hitsMax * 0.9;
        }
        // Critical structures
        if (s.structureType === STRUCTURE_SPAWN ||
            s.structureType === STRUCTURE_TOWER ||
            s.structureType === STRUCTURE_STORAGE) {
          return s.hits < s.hitsMax;
        }
        return s.hits < s.hitsMax * 0.75;
      }
    });
    
    // Always maintain 1 engineer if there's repair work
    const baseEngineers = needsRepair.length > 0 ? 1 : 0;
    
    // No construction sites - just maintain base
    if (sites.length === 0) {
      return phase === 'bootstrap' ? 1 : baseEngineers;
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
    
    // Later phases: Scale with need, but maintain base for repairs
    return Math.max(buildersNeeded, baseEngineers);
  }
  
  private requestBuilder(): void {
    const body = this.calculateBuilderBody();
    const name = `Engineer_${Game.time}`;
    
    // Builders use ECONOMY priority to ensure they spawn when needed
    const hasUrgentSites = this.room.find(FIND_MY_CONSTRUCTION_SITES, {
      filter: s => s.structureType === STRUCTURE_SPAWN || 
                   s.structureType === STRUCTURE_EXTENSION ||
                   s.structureType === STRUCTURE_CONTAINER
    }).length > 0;
    
    const priority = (this.Nexus.isBootstrapping && hasUrgentSites) ?
      SpawnPriority.CRITICAL : // Critical priority during bootstrap
      SpawnPriority.ECONOMY; // Normal economy priority otherwise
    
    // First builder or urgent sites during bootstrap should be important
    const important = this.builders.length === 0 || (this.Nexus.isBootstrapping && hasUrgentSites);
    
    this.requestSpawn(body, name, {
      role: ROLES.Warrior_ENGINEER, // KHALA themed role
      building: false
    } as any, priority, important);
  }
  
  private calculateBuilderBody(): BodyPartConstant[] {
    // Use available energy if no builders exist (emergency spawn)
    // OR if room doesn't have at least 90% energy capacity (still accumulating)
    const noBuilders = this.builders.length === 0;
    const energyRatio = this.Nexus.energyAvailable / this.Nexus.energyCapacity;
    const useAvailable = noBuilders || energyRatio < 0.9;
    
    const energy = useAvailable ? 
      Math.max(this.Nexus.energyAvailable, 200) : // At least 200 for minimal body
      this.Nexus.energyCapacity;
    
    // Use BodyBuilder for flexible builder body
    return BodyBuilder.builder(energy);
  }
  
  protected getCreepsForRole(): Creep[] {
    return this.room.find(FIND_MY_CREEPS, {
      filter: (creep) => 
        creep.memory.arbiter === this.ref ||
        RoleHelpers.isBuilder(creep.memory.role || '')
    });
  }
  
  /**
   * Place construction sites based on room plan
   */
  private placeConstructionSites(): void {
    const plan = this.Nexus.planner.getPlan();
    if (!plan) return;
    
    const level = this.room.controller?.level || 0;
    if (level === 0) return;
    
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
        const spawnName = getSpawnName(this.room.name, i);
        this.room.createConstructionSite(pos, STRUCTURE_SPAWN, spawnName);
        console.log(`🔱 Placing spawn: ${spawnName}`);
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
    
    // Place containers at sources (critical for Drone miners!)
    const sources = this.room.find(FIND_SOURCES);
    for (const source of sources) {
      // Check if container already exists near this source
      const existingContainer = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: s => s.structureType === STRUCTURE_CONTAINER
      })[0];
      
      const existingSite = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
        filter: s => s.structureType === STRUCTURE_CONTAINER
      })[0];
      
      if (!existingContainer && !existingSite) {
        // Find best position adjacent to source (not on source)
        const adjacentPositions = [
          new RoomPosition(source.pos.x - 1, source.pos.y - 1, this.room.name),
          new RoomPosition(source.pos.x, source.pos.y - 1, this.room.name),
          new RoomPosition(source.pos.x + 1, source.pos.y - 1, this.room.name),
          new RoomPosition(source.pos.x - 1, source.pos.y, this.room.name),
          new RoomPosition(source.pos.x + 1, source.pos.y, this.room.name),
          new RoomPosition(source.pos.x - 1, source.pos.y + 1, this.room.name),
          new RoomPosition(source.pos.x, source.pos.y + 1, this.room.name),
          new RoomPosition(source.pos.x + 1, source.pos.y + 1, this.room.name)
        ];
        
        // Find first valid position (not wall, not blocked)
        for (const pos of adjacentPositions) {
          const terrain = Game.map.getRoomTerrain(this.room.name);
          if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) {
            continue;
          }
          
          const structures = pos.lookFor(LOOK_STRUCTURES);
          if (structures.length > 0) {
            // Allow placement on roads (containers and roads can coexist)
            const blockingStructures = structures.filter(s => s.structureType !== STRUCTURE_ROAD);
            if (blockingStructures.length > 0) {
              continue;
            }
          }
          
          // Check for construction sites that would block (roads are OK!)
          const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
          if (sites.length > 0) {
            const blockingSites = sites.filter(s => s.structureType !== STRUCTURE_ROAD);
            if (blockingSites.length > 0) {
              continue;
            }
          }
          
          const result = this.room.createConstructionSite(pos, STRUCTURE_CONTAINER);
          if (result === OK) {
            break;
          }
        }
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

