/**
 * DEFENSE ARBITER - Military Operations Manager
 * 
 * "None shall breach our sanctum"
 * 
 * Manages defender Elites that protect the High Charity from hostile creeps.
 * Spawns defenders on-demand when threats are detected.
 */

/// <reference types="@types/screeps" />

import { Arbiter, ArbiterPriority } from './Arbiter';
import { HighCharity } from '../core/HighCharity';
import { Elite } from '../elites/Elite';

/**
 * Defense Arbiter - Manages room defense
 */
export class DefenseArbiter extends Arbiter {
  defenders: Elite[];
  hostiles: Creep[];
  
  constructor(highCharity: HighCharity) {
    super(highCharity, 'defense', ArbiterPriority.defense.melee);
    this.defenders = [];
    this.hostiles = [];
  }
  
  init(): void {
    this.refresh();
    
    // Detect hostiles
    this.hostiles = this.room.find(FIND_HOSTILE_CREEPS);
    
    // Request defenders if needed
    const desiredDefenders = this.calculateDesiredDefenders();
    const currentDefenders = this.defenders.length;
    
    if (currentDefenders < desiredDefenders) {
      this.requestDefender();
    }
  }
  
  run(): void {
    // No threats, defenders can help with other tasks
    if (this.hostiles.length === 0) {
      for (const defender of this.defenders) {
        defender.say('🛡️');
        // Could have them help upgrade or build
      }
      return;
    }
    
    // Combat mode
    for (const defender of this.defenders) {
      this.runDefender(defender);
    }
    
    // Coordinate towers
    this.coordinateTowers();
  }
  
  private runDefender(defender: Elite): void {
    if (this.hostiles.length === 0) return;
    
    // Find closest hostile
    const target = defender.pos.findClosestByPath(this.hostiles);
    if (!target) return;
    
    // Attack or move to attack
    if (defender.pos.isNearTo(target)) {
      defender.attack(target);
      defender.say('⚔️');
    } else {
      defender.goTo(target);
      defender.say('🏃');
    }
  }
  
  private coordinateTowers(): void {
    if (this.hostiles.length === 0) {
      // No threats - do maintenance repairs
      this.towersAutoRepair();
      return;
    }
    
    const towers = this.highCharity.towers;
    if (towers.length === 0) return;
    
    // Prioritize targets
    const targets = this.prioritizeTargets(this.hostiles);
    
    // Allocate towers to targets efficiently
    for (let i = 0; i < towers.length && i < targets.length; i++) {
      const tower = towers[i];
      const target = targets[i];
      
      if (tower.store.getUsedCapacity(RESOURCE_ENERGY) < 10) continue;
      
      // Attack the target
      const result = tower.attack(target);
      
      if (result === OK && Game.time % 10 === 0) {
        console.log(`🏹 ${this.highCharity.name}: Tower attacking ${target.owner.username}'s ${target.body[0]?.type || 'creep'}`);
      }
    }
  }
  
  /**
   * Prioritize hostile targets based on threat and proximity
   */
  private prioritizeTargets(hostiles: Creep[]): Creep[] {
    return hostiles.sort((a, b) => {
      // Priority 1: Healers are highest priority
      const aHeals = a.body.filter(p => p.type === HEAL).length;
      const bHeals = b.body.filter(p => p.type === HEAL).length;
      if (aHeals !== bHeals) return bHeals - aHeals;
      
      // Priority 2: Threat level
      const aThreat = this.calculateThreatLevel(a);
      const bThreat = this.calculateThreatLevel(b);
      if (aThreat !== bThreat) return bThreat - aThreat;
      
      // Priority 3: Proximity to critical structures
      const spawns = this.highCharity.spawns;
      if (spawns.length > 0) {
        const aDist = a.pos.getRangeTo(spawns[0]);
        const bDist = b.pos.getRangeTo(spawns[0]);
        return aDist - bDist;
      }
      
      return 0;
    });
  }
  
  /**
   * Auto-repair structures when no threats present
   */
  private towersAutoRepair(): void {
    const towers = this.highCharity.towers.filter(t => 
      t.store.getUsedCapacity(RESOURCE_ENERGY) > 400
    );
    
    if (towers.length === 0) return;
    
    // Find damaged structures (prioritize critical infrastructure)
    const damaged = this.room.find(FIND_STRUCTURES, {
      filter: (s) => {
        if (s.structureType === STRUCTURE_WALL) {
          return s.hits < this.getWallTarget();
        }
        if (s.structureType === STRUCTURE_RAMPART) {
          return s.hits < this.getRampartTarget();
        }
        // Critical structures
        if (s.structureType === STRUCTURE_SPAWN || 
            s.structureType === STRUCTURE_TOWER ||
            s.structureType === STRUCTURE_STORAGE) {
          return s.hits < s.hitsMax;
        }
        // Other structures
        return s.hits < s.hitsMax * 0.75;
      }
    });
    
    if (damaged.length === 0) return;
    
    // Sort by priority and damage
    const targets = damaged.sort((a, b) => {
      // Priority structures first
      const aPriority = this.getRepairPriority(a);
      const bPriority = this.getRepairPriority(b);
      if (aPriority !== bPriority) return bPriority - aPriority;
      
      // Then by HP percentage
      const aPercent = a.hits / a.hitsMax;
      const bPercent = b.hits / b.hitsMax;
      return aPercent - bPercent;
    });
    
    // Each tower repairs one structure
    for (let i = 0; i < Math.min(towers.length, targets.length); i++) {
      towers[i].repair(targets[i]);
    }
  }
  
  /**
   * Get repair priority for structure type
   */
  private getRepairPriority(structure: Structure): number {
    switch (structure.structureType) {
      case STRUCTURE_SPAWN: return 100;
      case STRUCTURE_TOWER: return 90;
      case STRUCTURE_STORAGE: return 80;
      case STRUCTURE_TERMINAL: return 70;
      case STRUCTURE_EXTENSION: return 60;
      case STRUCTURE_CONTAINER: return 50;
      case STRUCTURE_ROAD: return 40;
      case STRUCTURE_RAMPART: return 30;
      case STRUCTURE_WALL: return 20;
      default: return 10;
    }
  }
  
  /**
   * Get target HP for walls based on RCL
   */
  private getWallTarget(): number {
    const level = this.room.controller!.level;
    if (level < 6) return 10000;
    if (level < 8) return 100000;
    return 500000;
  }
  
  /**
   * Get target HP for ramparts based on RCL
   */
  private getRampartTarget(): number {
    const level = this.room.controller!.level;
    if (level < 4) return 10000;
    if (level < 6) return 50000;
    if (level < 8) return 300000;
    return 1000000;
  }
  
  private calculateThreatLevel(creep: Creep): number {
    let threat = 0;
    
    for (const part of creep.body) {
      if (part.type === ATTACK) threat += 30;
      if (part.type === RANGED_ATTACK) threat += 10;
      if (part.type === HEAL) threat += 12;
      if (part.type === WORK) threat += 5; // Can dismantle
    }
    
    return threat;
  }
  
  private calculateDesiredDefenders(): number {
    const hostileCount = this.hostiles.length;
    
    // No hostiles, no defenders needed (towers can handle small threats)
    if (hostileCount === 0) {
      return 0;
    }
    
    // Calculate total threat level
    const totalThreat = this.hostiles.reduce((sum, h) => sum + this.calculateThreatLevel(h), 0);
    
    // Spawn defenders based on threat
    if (totalThreat < 100) {
      return 1; // Towers can handle most of it
    } else if (totalThreat < 300) {
      return 2;
    } else if (totalThreat < 600) {
      return 3;
    } else {
      return Math.min(5, Math.ceil(totalThreat / 200)); // Cap at 5 defenders
    }
  }
  
  private requestDefender(): void {
    const body = this.calculateDefenderBody();
    const name = `defender_${Game.time}`;
    
    this.requestSpawn(body, name, {
      role: 'elite_defender' // Covenant themed role
    } as any);
  }
  
  private calculateDefenderBody(): BodyPartConstant[] {
    const energy = this.highCharity.energyCapacity;
    
    // Early game: Small defender
    if (energy < 400) {
      return [TOUGH, ATTACK, ATTACK, MOVE, MOVE];
    }
    
    // Mid game: Medium defender
    if (energy < 800) {
      return [TOUGH, TOUGH, ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE, MOVE];
    }
    
    // Late game: Large defender (balanced for speed)
    const pattern: BodyPartConstant[] = [TOUGH, ATTACK, ATTACK, MOVE, MOVE];
    return this.calculateBody(pattern, 6);
  }
  
  protected getCreepsForRole(): Creep[] {
    return this.room.find(FIND_MY_CREEPS, {
      filter: (creep) => 
        creep.memory.arbiter === this.ref ||
        creep.memory.role === 'defender'
    });
  }
}
