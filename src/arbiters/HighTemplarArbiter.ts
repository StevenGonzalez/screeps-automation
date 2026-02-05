/**
 * PROPHET ARBITER - Defensive Healer Operations
 * 
 * "Through the grace of the Prophets, we are restored"
 * 
 * Manages healer Warriors that provide medical support for defensive operations.
 * Designed to support Zealots during high-threat scenarios like power bank defense,
 * SK lair operations, or sustained defensive actions where tower support is insufficient.
 */

/// <reference types="@types/screeps" />

import { Arbiter, ArbiterPriority } from './Arbiter';
import { Nexus } from '../core/Nexus';
import { Warrior } from '../Warriors/Warrior';
import { RoleHelpers } from '../constants/Roles';
import { BodyBuilder } from '../utils/BodyBuilder';

/**
 * Prophet Arbiter - Manages defensive healer operations
 */
export class HighTemplarArbiter extends Arbiter {
  healers: Warrior[];
  injured: Creep[];
  
  constructor(Nexus: Nexus) {
    super(Nexus, 'prophet', ArbiterPriority.defense.ranged);
    this.healers = [];
    this.injured = [];
  }
  
  init(): void {
    this.refresh();
    
    // Update healers list from Warriors
    this.healers = this.warriors;
    
    // Find injured friendly creeps
    this.injured = this.room.find(FIND_MY_CREEPS, {
      filter: c => c.hits < c.hitsMax
    }).sort((a, b) => {
      // Sort by health percentage (lowest first)
      const aPercent = a.hits / a.hitsMax;
      const bPercent = b.hits / b.hitsMax;
      return aPercent - bPercent;
    });
    
    // Request healers if needed
    const desiredHealers = this.calculateDesiredHealers();
    const currentHealers = this.healers.length;
    
    if (currentHealers < desiredHealers && Game.time % 50 === 0) {
      this.requestHealer();
    }
    
    // Request boosts for newly spawned healers
    for (const healer of this.healers) {
      if (!healer.creep.ticksToLive || healer.creep.ticksToLive >= 1450) {
        if (this.Nexus.boostManager) {
          this.Nexus.boostManager.requestBoosts(healer.creep, 'healer');
        }
      }
    }
  }
  
  run(): void {
    // No injured units and no hostiles - stand by
    const hostiles = this.room.find(FIND_HOSTILE_CREEPS);
    if (this.injured.length === 0 && hostiles.length === 0) {
      for (const healer of this.healers) {
        healer.say('➕🛡️');
        // Position near spawn or rally point
        const spawns = this.Nexus.spawns;
        if (spawns.length > 0 && healer.pos.getRangeTo(spawns[0]) > 3) {
          healer.goTo(spawns[0].pos, { range: 3 });
        }
      }
      return;
    }
    
    // Active healing mode
    for (const healer of this.healers) {
      this.runHealer(healer);
    }
  }
  
  /**
   * Run individual healer logic
   */
  private runHealer(healer: Warrior): void {
    // Priority 1: Heal injured friendlies
    if (this.injured.length > 0) {
      const target = healer.pos.findClosestByRange(this.injured);
      if (!target) return;
      
      const healResult = healer.creep.heal(target);
      
      if (healResult === ERR_NOT_IN_RANGE) {
        // Try ranged heal while moving
        healer.creep.rangedHeal(target);
        healer.goTo(target.pos);
        healer.say('➕🏃');
      } else if (healResult === OK) {
        healer.say('➕');
        
        // If we're adjacent and target is being healed, check for other injured in range
        const otherInjured = healer.pos.findInRange(this.injured, 3).filter(c => c.id !== target.id);
        if (otherInjured.length > 0) {
          healer.creep.rangedHeal(otherInjured[0]);
        }
      }
      return;
    }
    
    // Priority 2: Support Zealots near hostiles
    const hostiles = this.room.find(FIND_HOSTILE_CREEPS);
    if (hostiles.length > 0) {
      // Find Zealots in combat
      const zealots = this.room.find(FIND_MY_CREEPS, {
        filter: c => RoleHelpers.isDefender(c.memory.role || '') || 
                     c.memory.role?.includes('zealot')
      });
      
      if (zealots.length > 0) {
        const closestZealot = healer.pos.findClosestByRange(zealots);
        if (closestZealot) {
          // Stay near the Zealot (range 2-3 for heal/rangedHeal coverage)
          const range = healer.pos.getRangeTo(closestZealot);
          if (range > 3) {
            healer.goTo(closestZealot.pos, { range: 2 });
            healer.say('➕➡️');
          } else if (range === 0) {
            // Too close, give some space
            const direction = closestZealot.pos.getDirectionTo(healer.pos);
            healer.creep.move(direction);
          } else {
            // In good position, preemptively heal the Zealot
            if (closestZealot.hits < closestZealot.hitsMax) {
              if (range <= 1) {
                healer.creep.heal(closestZealot);
              } else {
                healer.creep.rangedHeal(closestZealot);
              }
              healer.say('➕🛡️');
            } else {
              healer.say('🛡️');
            }
          }
          return;
        }
      }
      
      // No Zealots, position defensively near spawn
      const spawns = this.Nexus.spawns;
      if (spawns.length > 0) {
        const range = healer.pos.getRangeTo(spawns[0]);
        if (range > 5) {
          healer.goTo(spawns[0].pos, { range: 3 });
        }
      }
    }
  }
  
  /**
   * Calculate desired number of healers based on threat and injuries
   */
  private calculateDesiredHealers(): number {
    const hostiles = this.room.find(FIND_HOSTILE_CREEPS);
    const injuredCount = this.injured.length;
    
    // No threats or injuries - no healers needed (towers sufficient)
    if (hostiles.length === 0 && injuredCount === 0) {
      return 0;
    }
    
    // Calculate total hostile threat
    const totalThreat = hostiles.reduce((sum, h) => {
      let threat = 0;
      for (const part of h.body) {
        if (part.type === ATTACK) threat += 30;
        if (part.type === RANGED_ATTACK) threat += 10;
        if (part.type === WORK) threat += 5;
      }
      return sum + threat;
    }, 0);
    
    // Spawn healers based on threat level and injured count
    if (totalThreat > 500 || injuredCount > 3) {
      return 2; // High threat or many injuries
    } else if (totalThreat > 200 || injuredCount > 1) {
      return 1; // Medium threat
    }
    
    return 0;
  }
  
  /**
   * Request a healer spawn
   */
  private requestHealer(): void {
    const body = this.calculateHealerBody();
    const name = `Prophet_${Game.time}`;
    
    this.requestSpawn(body, name, {
      role: 'Warrior_prophet'
    } as any);
  }
  
  /**
   * Calculate healer body based on available energy
   */
  private calculateHealerBody(): BodyPartConstant[] {
    const totalCreeps = this.room.find(FIND_MY_CREEPS).length;
    const energyRatio = this.Nexus.energyAvailable / this.Nexus.energyCapacity;
    const useAvailable = this.Nexus.isBootstrapping || totalCreeps === 0 || energyRatio < 0.9;
    
    const energy = useAvailable ? 
      this.Nexus.energyAvailable : 
      this.Nexus.energyCapacity;
    
    // Healer body: HEAL + MOVE pattern for maximum mobility
    // Minimum: 1 HEAL + 1 MOVE (300 energy)
    // Maximum: 25 HEAL + 25 MOVE (12,500 energy)
    const pattern: BodyPartConstant[] = [HEAL, MOVE];
    return BodyBuilder.repeat(pattern, energy, 25);
  }
  
  /**
   * Manual activation - force spawn a healer
   */
  activate(): void {
    console.log(`🔱 ${this.Nexus.name}: Prophet Arbiter activated - spawning healer`);
    this.requestHealer();
  }
  
  /**
   * Get status of healer operations
   */
  getStatus(): any {
    return {
      healers: this.healers.length,
      injured: this.injured.length,
      active: this.healers.length > 0
    };
  }
  
  protected getCreepsForRole(): Creep[] {
    return this.room.find(FIND_MY_CREEPS, {
      filter: (creep) => 
        creep.memory.arbiter === this.ref ||
        creep.memory.role === 'Warrior_prophet' ||
        creep.memory.role === 'prophet'
    });
  }
}
