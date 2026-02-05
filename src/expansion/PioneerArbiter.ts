/**
 * PIONEER ARBITER - Colony Bootstrapping
 * 
 * "From humble beginnings, great civilizations rise"
 * 
 * Manages pioneer creeps that claim new rooms and establish
 * initial infrastructure for new Nexuses.
 */

/// <reference types="@types/screeps" />

import { Arbiter } from '../arbiters/Arbiter';
import { Nexus } from '../core/Nexus';
import { Warrior } from '../Warriors/Warrior';

export class PioneerArbiter extends Arbiter {
  targetRoom: string;
  
  constructor(Nexus: Nexus, targetRoom: string) {
    const ref = `pioneer_${targetRoom}`;
    super(Nexus, ref, 100); // Highest priority - critical for expansion
    
    this.targetRoom = targetRoom;
  }
  
  init(): void {
    // Warriors are gathered automatically by Arbiter base class
  }
  
  run(): void {
    for (const pioneer of this.warriors) {
      this.runPioneer(pioneer);
    }
  }
  
  private runPioneer(pioneer: Warrior): void {
    const targetRoom = Game.rooms[this.targetRoom];
    
    // Phase 1: Claim the room
    if (!targetRoom || !targetRoom.controller || !targetRoom.controller.my) {
      this.claimPhase(pioneer);
      return;
    }
    
    // Phase 2: Bootstrap infrastructure
    this.bootstrapPhase(pioneer, targetRoom);
  }
  
  /**
   * Phase 1: Move to room and claim controller
   */
  private claimPhase(pioneer: Warrior): void {
    // Move to target room
    if (pioneer.creep.room.name !== this.targetRoom) {
      const exitDir = pioneer.creep.room.findExitTo(this.targetRoom);
      if (exitDir > 0) {
        const exit = pioneer.creep.pos.findClosestByPath(exitDir as ExitConstant);
        if (exit) {
          pioneer.creep.moveTo(exit, {
            visualizePathStyle: { stroke: '#ffaa00' }
          });
        }
      }
      return;
    }
    
    // Find controller
    const controller = pioneer.creep.room.controller;
    if (!controller) return;
    
    // Claim controller
    const result = pioneer.creep.claimController(controller);
    if (result === ERR_NOT_IN_RANGE) {
      pioneer.creep.moveTo(controller, {
        visualizePathStyle: { stroke: '#00ff00' }
      });
    } else if (result === OK) {
      console.log(`✅ ${pioneer.creep.name} claimed ${this.targetRoom}!`);
    }
  }
  
  /**
   * Phase 2: Build initial infrastructure
   */
  private bootstrapPhase(pioneer: Warrior, room: Room): void {
    // If carrying energy, build
    if (pioneer.creep.store[RESOURCE_ENERGY] > 0) {
      this.buildInfrastructure(pioneer, room);
    } else {
      this.gatherEnergy(pioneer, room);
    }
  }
  
  /**
   * Gather energy from sources
   */
  private gatherEnergy(pioneer: Warrior, room: Room): void {
    // Find nearest source
    const sources = room.find(FIND_SOURCES_ACTIVE);
    if (sources.length === 0) return;
    
    const nearest = pioneer.creep.pos.findClosestByPath(sources);
    if (!nearest) return;
    
    const result = pioneer.creep.harvest(nearest);
    if (result === ERR_NOT_IN_RANGE) {
      pioneer.creep.moveTo(nearest, {
        visualizePathStyle: { stroke: '#ffaa00' }
      });
    }
  }
  
  /**
   * Build critical infrastructure
   */
  private buildInfrastructure(pioneer: Warrior, room: Room): void {
    // Priority 1: Build spawn (critical!)
    const spawns = room.find(FIND_MY_SPAWNS);
    if (spawns.length === 0) {
      // Find spawn construction site
      const spawnSites = room.find(FIND_MY_CONSTRUCTION_SITES, {
        filter: s => s.structureType === STRUCTURE_SPAWN
      });
      
      if (spawnSites.length > 0) {
        this.buildTarget(pioneer, spawnSites[0]);
        return;
      } else {
        // Place spawn near controller
        this.placeSpawn(pioneer, room);
        return;
      }
    }
    
    // Priority 2: Build container near source
    const containers = room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_CONTAINER
    });
    
    if (containers.length === 0) {
      const containerSites = room.find(FIND_MY_CONSTRUCTION_SITES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER
      });
      
      if (containerSites.length > 0) {
        this.buildTarget(pioneer, containerSites[0]);
        return;
      } else {
        this.placeContainer(pioneer, room);
        return;
      }
    }
    
    // Priority 3: Build extensions
    const extensions = room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_EXTENSION
    });
    
    const maxExtensions = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][room.controller!.level];
    if (extensions.length < maxExtensions) {
      const extensionSites = room.find(FIND_MY_CONSTRUCTION_SITES, {
        filter: s => s.structureType === STRUCTURE_EXTENSION
      });
      
      if (extensionSites.length > 0) {
        this.buildTarget(pioneer, extensionSites[0]);
        return;
      } else {
        this.placeExtension(pioneer, room);
        return;
      }
    }
    
    // Priority 4: Upgrade controller
    const controller = room.controller!;
    const result = pioneer.creep.upgradeController(controller);
    if (result === ERR_NOT_IN_RANGE) {
      pioneer.creep.moveTo(controller, {
        visualizePathStyle: { stroke: '#0000ff' }
      });
    }
  }
  
  /**
   * Build a specific target
   */
  private buildTarget(pioneer: Warrior, target: ConstructionSite): void {
    const result = pioneer.creep.build(target);
    if (result === ERR_NOT_IN_RANGE) {
      pioneer.creep.moveTo(target, {
        visualizePathStyle: { stroke: '#ffffff' }
      });
    }
  }
  
  /**
   * Place spawn near controller
   */
  private placeSpawn(pioneer: Warrior, room: Room): void {
    const controller = room.controller!;
    
    // Find position near controller
    const positions = [];
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        const x = controller.pos.x + dx;
        const y = controller.pos.y + dy;
        
        if (x < 2 || x > 47 || y < 2 || y > 47) continue;
        
        const pos = new RoomPosition(x, y, room.name);
        if (pos.lookFor(LOOK_TERRAIN)[0] !== 'wall' && 
            pos.lookFor(LOOK_STRUCTURES).length === 0) {
          positions.push(pos);
        }
      }
    }
    
    if (positions.length > 0) {
      const pos = positions[0];
      pos.createConstructionSite(STRUCTURE_SPAWN);
      console.log(`📍 Placed spawn at ${pos}`);
    }
  }
  
  /**
   * Place container near source
   */
  private placeContainer(pioneer: Warrior, room: Room): void {
    const sources = room.find(FIND_SOURCES);
    if (sources.length === 0) return;
    
    const source = sources[0];
    
    // Find adjacent position
    const positions = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        
        const x = source.pos.x + dx;
        const y = source.pos.y + dy;
        
        if (x < 1 || x > 48 || y < 1 || y > 48) continue;
        
        const pos = new RoomPosition(x, y, room.name);
        if (pos.lookFor(LOOK_TERRAIN)[0] !== 'wall' && 
            pos.lookFor(LOOK_STRUCTURES).length === 0) {
          positions.push(pos);
        }
      }
    }
    
    if (positions.length > 0) {
      const pos = positions[0];
      pos.createConstructionSite(STRUCTURE_CONTAINER);
      console.log(`📍 Placed container at ${pos}`);
    }
  }
  
  /**
   * Place extension near spawn
   */
  private placeExtension(pioneer: Warrior, room: Room): void {
    const spawns = room.find(FIND_MY_SPAWNS);
    if (spawns.length === 0) return;
    
    const spawn = spawns[0];
    
    // Find position near spawn
    const positions = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (dx === 0 && dy === 0) continue;
        
        const x = spawn.pos.x + dx;
        const y = spawn.pos.y + dy;
        
        if (x < 1 || x > 48 || y < 1 || y > 48) continue;
        
        const pos = new RoomPosition(x, y, room.name);
        if (pos.lookFor(LOOK_TERRAIN)[0] !== 'wall' && 
            pos.lookFor(LOOK_STRUCTURES).length === 0 &&
            pos.lookFor(LOOK_CONSTRUCTION_SITES).length === 0) {
          positions.push(pos);
        }
      }
    }
    
    if (positions.length > 0) {
      const pos = positions[0];
      pos.createConstructionSite(STRUCTURE_EXTENSION);
    }
  }
  
  getSpawnRequest(): any {
    const target = this.Nexus.KHALA.reclaimationCouncil.getStatus();
    if (!target || target.roomName !== this.targetRoom) return null;
    
    // Check if room is already claimed
    const room = Game.rooms[this.targetRoom];
    if (room && room.controller && room.controller.my) {
      // Room is claimed - need builders
      const current = this.warriors.length;
      if (current >= 3) return null; // Max 3 pioneers during bootstrap
      
      // Builder body: WORK, CARRY, MOVE
      const energy = this.Nexus.energyCapacity;
      const body: BodyPartConstant[] = [];
      
      let remainingEnergy = Math.min(energy, 1000);
      while (remainingEnergy >= 200) {
        body.push(WORK, CARRY, MOVE);
        remainingEnergy -= 200;
      }
      
      if (body.length === 0) {
        body.push(WORK, CARRY, MOVE);
      }
      
      return {
        body,
        memory: {
          role: 'pioneer',
          arbiter: this.ref,
          targetRoom: this.targetRoom
        },
        priority: 100,
        name: `Pioneer_${this.targetRoom}_${Game.time % 1000}`
      };
    } else {
      // Room not claimed yet - need claimer
      const current = this.warriors.length;
      if (current >= 1) return null; // Only 1 claimer needed
      
      return {
        body: [CLAIM, MOVE],
        memory: {
          role: 'pioneer',
          arbiter: this.ref,
          targetRoom: this.targetRoom
        },
        priority: 100,
        name: `Claimer_${this.targetRoom}_${Game.time % 1000}`
      };
    }
  }
}
