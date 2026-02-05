/**
 * CLAIMER ARBITER - Colony Expansion Manager
 * 
 * "The KHALA expands to new worlds"
 * 
 * Manages room claiming operations. Spawns claimer creeps to claim new rooms
 * identified by IntelligenceGateway, then supports bootstrapping the new colony.
 */

/// <reference types="@types/screeps" />

import { Arbiter, ArbiterPriority } from './Arbiter';
import { Nexus } from '../core/Nexus';
import { Warrior } from '../Warriors/Warrior';
import { BodyBuilder } from '../utils/BodyBuilder';
import { ROLES } from '../constants/Roles';

export interface ClaimerMemory {
  targetRoom: string;
  targetController: string;
  status: 'claiming' | 'reserved' | 'complete';
  claimAttempts: number;
}

/**
 * Claimer Arbiter - Manages room claiming and expansion
 */
export class ObserverArbiter extends Arbiter {
  targetRoom: string;
  targetController: Id<StructureController> | null;
  claimers: Warrior[];
  pioneers: Warrior[]; // Early bootstrap creeps for new room
  
  constructor(Nexus: Nexus, targetRoom: string) {
    super(Nexus, `claimer_${targetRoom}`, ArbiterPriority.expansion.claimer);
    
    this.targetRoom = targetRoom;
    this.targetController = null;
    this.claimers = [];
    this.pioneers = [];
    
    // Initialize memory
    if (!this.memory.targetRoom) {
      this.memory.targetRoom = targetRoom;
      this.memory.status = 'claiming';
      this.memory.claimAttempts = 0;
    }
  }
  
  init(): void {
    this.refresh();
    
    // Check if room is already claimed
    const targetRoom = Game.rooms[this.targetRoom];
    if (targetRoom && targetRoom.controller && targetRoom.controller.my) {
      this.memory.status = 'complete';
      console.log(`✅ ${this.print}: Room ${this.targetRoom} successfully claimed!`);
      return;
    }
    
    // Check if we have vision and can see the controller
    if (targetRoom && targetRoom.controller) {
      this.targetController = targetRoom.controller.id;
      
      // If controller is reserved by someone else, we need to wait or unreserve
      if (targetRoom.controller.reservation && 
          targetRoom.controller.reservation.username !== this.Nexus.room.controller!.owner!.username) {
        console.log(`⚠️ ${this.print}: Room ${this.targetRoom} is reserved by ${targetRoom.controller.reservation.username}`);
      }
    }
    
    // Request claimer if needed
    const desiredClaimers = this.calculateDesiredClaimers();
    if (this.claimers.length < desiredClaimers) {
      this.requestClaimer();
    }
    
    // Request pioneers once room is claimed
    if (this.memory.status === 'complete' && targetRoom) {
      const desiredPioneers = this.calculateDesiredPioneers();
      if (this.pioneers.length < desiredPioneers) {
        this.requestPioneer();
      }
    }
  }
  
  run(): void {
    // Direct claimers to claim the target room
    for (const claimer of this.claimers) {
      this.runClaimer(claimer);
    }
    
    // Direct pioneers to bootstrap the new room
    for (const pioneer of this.pioneers) {
      this.runPioneer(pioneer);
    }
  }
  
  private runClaimer(claimer: Warrior): void {
    const targetRoom = Game.rooms[this.targetRoom];
    
    // Move to target room if not there
    if (claimer.room.name !== this.targetRoom) {
      const exit = claimer.room.findExitTo(this.targetRoom);
      if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS) {
        console.log(`❌ ${this.print}: No path to ${this.targetRoom}`);
        return;
      }
      
      const exitPos = claimer.pos.findClosestByPath(exit as ExitConstant);
      if (exitPos) {
        claimer.goTo(exitPos);
        claimer.say('→🚀');
      }
      return;
    }
    
    // In target room - find controller
    if (!targetRoom || !targetRoom.controller) {
      console.log(`❌ ${this.print}: No controller visible in ${this.targetRoom}`);
      return;
    }
    
    const controller = targetRoom.controller;
    
    // Check if controller is owned by someone else
    if (controller.owner && !controller.my) {
      console.log(`⚠️ ${this.print}: Room ${this.targetRoom} owned by ${controller.owner.username}`);
      claimer.say('⚔️');
      return;
    }
    
    // Claim or reserve the controller
    if (!controller.my) {
      const result = claimer.creep.claimController(controller);
      
      if (result === OK) {
        console.log(`🎉 ${this.print}: Claimed ${this.targetRoom}!`);
        this.memory.status = 'complete';
        claimer.say('⚡👑');
      } else if (result === ERR_NOT_IN_RANGE) {
        claimer.goTo(controller);
        claimer.say('→👑');
      } else if (result === ERR_GCL_NOT_ENOUGH) {
        // GCL too low - reserve instead
        const reserveResult = claimer.creep.reserveController(controller);
        if (reserveResult === OK) {
          console.log(`📋 ${this.print}: Reserved ${this.targetRoom}`);
          this.memory.status = 'reserved';
          claimer.say('📋');
        } else if (reserveResult === ERR_NOT_IN_RANGE) {
          claimer.goTo(controller);
          claimer.say('→📋');
        }
      } else {
        console.log(`❌ ${this.print}: Claim failed with error ${result}`);
      }
      
      this.memory.claimAttempts++;
    } else {
      claimer.say('✅');
    }
  }
  
  private runPioneer(pioneer: Warrior): void {
    const targetRoom = Game.rooms[this.targetRoom];
    
    // Move to target room if not there
    if (pioneer.room.name !== this.targetRoom) {
      const exit = pioneer.room.findExitTo(this.targetRoom);
      if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS) {
        return;
      }
      
      const exitPos = pioneer.pos.findClosestByPath(exit as ExitConstant);
      if (exitPos) {
        pioneer.goTo(exitPos);
        pioneer.say('→🏗️');
      }
      return;
    }
    
    // In target room - act as a hybrid harvester/builder/upgrader
    if (!targetRoom) return;
    
    // State machine: harvesting → working
    if (pioneer.memory.working && pioneer.needsEnergy) {
      pioneer.memory.working = false;
    }
    if (!pioneer.memory.working && pioneer.isFull) {
      pioneer.memory.working = true;
    }
    
    if (pioneer.memory.working) {
      this.pioneerWork(pioneer, targetRoom);
    } else {
      this.pioneerHarvest(pioneer, targetRoom);
    }
  }
  
  private pioneerHarvest(pioneer: Warrior, targetRoom: Room): void {
    // Find closest source
    const source = pioneer.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (source) {
      const result = pioneer.harvestSource(source);
      if (result === OK || result === ERR_NOT_IN_RANGE) {
        pioneer.say('⛏️');
      }
    }
  }
  
  private pioneerWork(pioneer: Warrior, targetRoom: Room): void {
    // Priority 1: Build spawn if needed
    const spawnSites = targetRoom.find(FIND_MY_CONSTRUCTION_SITES, {
      filter: s => s.structureType === STRUCTURE_SPAWN
    });
    
    if (spawnSites.length > 0) {
      const result = pioneer.buildSite(spawnSites[0]);
      if (result === OK || result === ERR_NOT_IN_RANGE) {
        pioneer.say('🏗️🏛️');
        return;
      }
    }
    
    // Priority 2: Upgrade controller
    if (targetRoom.controller && targetRoom.controller.my) {
      const result = pioneer.upgradeController();
      if (result === OK || result === ERR_NOT_IN_RANGE) {
        pioneer.say('⚡');
        return;
      }
    }
    
    // Priority 3: Build other structures
    const constructionSites = targetRoom.find(FIND_MY_CONSTRUCTION_SITES);
    if (constructionSites.length > 0) {
      const result = pioneer.buildSite(constructionSites[0]);
      if (result === OK || result === ERR_NOT_IN_RANGE) {
        pioneer.say('🏗️');
      }
    }
  }
  
  private calculateDesiredClaimers(): number {
    // If already claimed/reserved, don't need claimers
    if (this.memory.status === 'complete' || this.memory.status === 'reserved') {
      return 0;
    }
    
    // Keep trying with 1 claimer until successful
    return 1;
  }
  
  private calculateDesiredPioneers(): number {
    // Only send pioneers after claiming
    if (this.memory.status !== 'complete') {
      return 0;
    }
    
    const targetRoom = Game.rooms[this.targetRoom];
    if (!targetRoom) return 0;
    
    // If new room has its own spawn, pioneers can return home
    const spawns = targetRoom.find(FIND_MY_SPAWNS);
    if (spawns.length > 0) {
      return 0;
    }
    
    // Send 2-3 pioneers to bootstrap
    return 3;
  }
  
  private requestClaimer(): void {
    const body = this.calculateClaimerBody();
    const name = `Herald_${this.targetRoom}_${Game.time}`;
    
    this.requestSpawn(body, name, {
      role: ROLES.Warrior_CLAIMER,
      targetRoom: this.targetRoom
    } as any);
  }
  
  private requestPioneer(): void {
    const body = this.calculatePioneerBody();
    const name = `Vanguard_${this.targetRoom}_${Game.time}`;
    
    this.requestSpawn(body, name, {
      role: ROLES.Warrior_PIONEER,
      targetRoom: this.targetRoom,
      working: false
    } as any);
  }
  
  private calculateClaimerBody(): BodyPartConstant[] {
    const energy = this.Nexus.energyCapacity;
    
    // Claimer needs CLAIM and MOVE parts
    // Basic claimer: 650 energy (1 CLAIM, 1 MOVE)
    if (energy < 1300) {
      return [CLAIM, MOVE];
    }
    
    // Fast claimer: 1300 energy (2 CLAIM, 2 MOVE)
    return [CLAIM, CLAIM, MOVE, MOVE];
  }
  
  private calculatePioneerBody(): BodyPartConstant[] {
    // Pioneers are general workers for bootstrapping new rooms
    // Use capacity when not bootstrapping for full-size bodies
    const totalCreeps = this.room.find(FIND_MY_CREEPS).length;
    const energy = (this.Nexus.isBootstrapping || totalCreeps === 0) ? 
      this.Nexus.energyAvailable : 
      this.Nexus.energyCapacity;
    
    return BodyBuilder.worker(energy);
  }
  
  protected getCreepsForRole(): Creep[] {
    const claimerCreeps = this.room.find(FIND_MY_CREEPS, {
      filter: (creep) => 
        (creep.memory.arbiter === this.ref) ||
        (creep.memory.role === ROLES.Warrior_CLAIMER && (creep.memory as any).targetRoom === this.targetRoom) ||
        (creep.memory.role === ROLES.Warrior_PIONEER && (creep.memory as any).targetRoom === this.targetRoom)
    });
    
    return claimerCreeps;
  }
  
  refresh(): void {
    super.refresh();
    
    // Separate claimers and pioneers
    this.claimers = this.warriors.filter(e => 
      e.memory.role === ROLES.Warrior_CLAIMER
    );
    this.pioneers = this.warriors.filter(e => 
      e.memory.role === ROLES.Warrior_PIONEER
    );
  }
}
