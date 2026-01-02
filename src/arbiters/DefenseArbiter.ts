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
    if (this.hostiles.length === 0) return;
    
    const towers = this.highCharity.towers;
    if (towers.length === 0) return;
    
    // Find most dangerous hostile (highest damage potential)
    const target = this.hostiles.reduce((most, hostile) => {
      const mostDamage = this.calculateThreatLevel(most);
      const hostileDamage = this.calculateThreatLevel(hostile);
      return hostileDamage > mostDamage ? hostile : most;
    }, this.hostiles[0]);
    
    // All towers focus fire on the most dangerous target
    for (const tower of towers) {
      tower.attack(target);
    }
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
      role: 'defender'
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
