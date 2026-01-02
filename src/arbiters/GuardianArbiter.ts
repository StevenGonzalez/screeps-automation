/**
 * REPAIRER ARBITER - Fortification Maintenance
 * 
 * "The sacred barriers must endure"
 * 
 * Specialized Arbiter for maintaining walls and ramparts.
 * Activated at higher RCL when fortifications require constant attention.
 */

/// <reference types="@types/screeps" />

import { Arbiter, ArbiterPriority, ArbiterMemory } from './Arbiter';
import { HighCharity } from '../core/HighCharity';
import { Elite } from '../elites/Elite';

/**
 * Repairer Arbiter - Manages fortification maintenance
 */
export class GuardianArbiter extends Arbiter {
  repairers: Elite[];
  
  constructor(highCharity: HighCharity) {
    super(highCharity, 'repairer', ArbiterPriority.support.repairer);
    this.repairers = [];
  }
  
  init(): void {
    this.refresh();
    
    // Update repairers list from elites
    this.repairers = this.elites;
    
    // Only spawn repairers at RCL 5+ when fortifications become important
    if (this.room.controller!.level < 5) return;
    
    // Request repairers based on fortification count
    const desiredRepairers = this.calculateDesiredRepairers();
    const currentRepairers = this.repairers.length;
    
    if (currentRepairers < desiredRepairers) {
      this.requestRepairer();
    }
  }
  
  run(): void {
    for (const repairer of this.repairers) {
      this.runRepairer(repairer);
    }
  }
  
  private runRepairer(repairer: Elite): void {
    // State machine: harvesting → repairing
    if (repairer.memory.repairing && repairer.needsEnergy) {
      repairer.memory.repairing = false;
    }
    if (!repairer.memory.repairing && repairer.isFull) {
      repairer.memory.repairing = true;
    }
    
    if (repairer.memory.repairing) {
      this.repair(repairer);
    } else {
      this.getEnergy(repairer);
    }
  }
  
  private repair(repairer: Elite): void {
    const defenseTemple = this.highCharity.defenseTemple;
    
    // Focus on ramparts and walls
    const ramparts = defenseTemple.getRampartsNeedingRepair();
    const walls = defenseTemple.getWallsNeedingRepair();
    
    // Combine and sort by HP
    const targets = [...ramparts, ...walls].sort((a, b) => a.hits - b.hits);
    
    if (targets.length === 0) {
      // No fortifications need repair, help with other structures
      const damaged = this.room.find(FIND_STRUCTURES, {
        filter: s => s.hits < s.hitsMax * 0.9 && 
                     s.structureType !== STRUCTURE_WALL &&
                     s.structureType !== STRUCTURE_RAMPART
      });
      
      if (damaged.length > 0) {
        repairer.repairStructure(damaged[0]);
        repairer.say('🔧');
      } else {
        repairer.say('✋');
      }
      return;
    }
    
    // Find closest target
    const target = repairer.pos.findClosestByPath(targets);
    if (!target) {
      repairer.say('❓');
      return;
    }
    
    const result = repairer.repairStructure(target);
    
    if (result === OK || result === ERR_NOT_IN_RANGE) {
      if (target.structureType === STRUCTURE_RAMPART) {
        repairer.say('🛡️');
      } else {
        repairer.say('🧱');
      }
    }
  }
  
  private getEnergy(repairer: Elite): void {
    // Priority: Storage > Containers > Terminal
    
    if (this.highCharity.storage && 
        this.highCharity.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 5000) {
      repairer.withdrawFrom(this.highCharity.storage);
      repairer.say('🏦');
      return;
    }
    
    const container = repairer.pos.findClosestByPath(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
                     s.store.getUsedCapacity(RESOURCE_ENERGY) > 100
    }) as StructureContainer | null;
    
    if (container) {
      repairer.withdrawFrom(container);
      repairer.say('📦');
      return;
    }
    
    if (this.highCharity.terminal && 
        this.highCharity.terminal.store.getUsedCapacity(RESOURCE_ENERGY) > 5000) {
      repairer.withdrawFrom(this.highCharity.terminal);
      repairer.say('💼');
      return;
    }
    
    // Last resort: harvest
    const source = repairer.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (source) {
      repairer.harvestSource(source);
      repairer.say('⛏️');
    }
  }
  
  private calculateDesiredRepairers(): number {
    const defenseTemple = this.highCharity.defenseTemple;
    const level = this.room.controller!.level;
    const phase = this.highCharity.memory.phase;
    
    // Count fortifications needing repair
    const ramparts = defenseTemple.getRampartsNeedingRepair();
    const walls = defenseTemple.getWallsNeedingRepair();
    const totalNeeded = ramparts.length + walls.length;
    
    // No fortifications need repair
    if (totalNeeded === 0) return 0;
    
    // RCL 5-6: 1 repairer if needed
    if (level < 7) {
      return totalNeeded > 10 ? 1 : 0;
    }
    
    // RCL 7: 1-2 repairers
    if (level < 8) {
      if (totalNeeded < 20) return 1;
      if (totalNeeded < 50) return 2;
      return 3;
    }
    
    // RCL 8: Scale with fortification count
    if (phase === 'powerhouse') {
      // Mature RCL 8 with lots of fortifications
      if (totalNeeded < 30) return 2;
      if (totalNeeded < 60) return 3;
      return 4;
    }
    
    return 2;
  }
  
  private requestRepairer(): void {
    const body = this.calculateRepairerBody();
    const name = `Guardian_${Game.time}`;
    
    this.requestSpawn(body, name, {
      role: 'elite_repairer', // Covenant themed role
      repairing: false
    } as any);
  }
  
  private calculateRepairerBody(): BodyPartConstant[] {
    const energy = this.highCharity.energyCapacity;
    
    // Repairer: WORK for repair speed, CARRY for energy capacity, MOVE for mobility
    
    if (energy < 550) {
      return [WORK, WORK, CARRY, CARRY, MOVE, MOVE];
    }
    
    if (energy < 1000) {
      return [WORK, WORK, WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE];
    }
    
    // Large repairer: 10 WORK, 10 CARRY, 10 MOVE
    const pattern: BodyPartConstant[] = [WORK, CARRY, MOVE];
    return this.calculateBody(pattern, 10);
  }
  
  protected getCreepsForRole(): Creep[] {
    return this.room.find(FIND_MY_CREEPS, {
      filter: (creep) => 
        creep.memory.arbiter === this.ref ||
        creep.memory.role === 'repairer'
    });
  }
}
