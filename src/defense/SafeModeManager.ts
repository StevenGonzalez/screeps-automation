/**
 * SAFE MODE MANAGER
 * 
 * "When the sanctum is breached, the Gods themselves intervene"
 * 
 * Monitors threats and automatically activates safe mode when the High Charity
 * is in critical danger. Prevents loss of vital structures and creeps.
 */

/// <reference types="@types/screeps" />

import { HighCharity } from '../core/HighCharity';

export interface ThreatAssessment {
  level: number; // 0-10 scale
  hostileCount: number;
  hostileDamage: number; // Total damage per tick
  structuresUnderAttack: number;
  criticalStructuresAtRisk: boolean;
  spawnsAtRisk: boolean;
  storageAtRisk: boolean;
  recommendation: 'none' | 'alert' | 'emergency' | 'safe_mode';
}

export interface SafeModeManagerMemory {
  lastThreatAssessment: number;
  threatHistory: number[]; // Last 10 threat levels
  safeModeUsed: number; // Game time when last used
  autoSafeModeEnabled: boolean;
  alertsSent: string[]; // Recent alerts
}

/**
 * Safe Mode Manager - Monitors threats and manages safe mode activation
 */
export class SafeModeManager {
  highCharity: HighCharity;
  room: Room;
  memory: SafeModeManagerMemory;
  
  constructor(highCharity: HighCharity) {
    this.highCharity = highCharity;
    this.room = highCharity.room;
    
    // Initialize memory
    const roomMem: any = Memory.rooms[this.room.name];
    if (!roomMem.safeMode) {
      roomMem.safeMode = {
        lastThreatAssessment: 0,
        threatHistory: [],
        safeModeUsed: 0,
        autoSafeModeEnabled: true,
        alertsSent: []
      };
    }
    this.memory = roomMem.safeMode;
  }
  
  /**
   * Assess current threat level and take action
   */
  assess(): ThreatAssessment {
    const assessment = this.evaluateThreat();
    
    // Update threat history
    this.memory.threatHistory.push(assessment.level);
    if (this.memory.threatHistory.length > 10) {
      this.memory.threatHistory.shift();
    }
    this.memory.lastThreatAssessment = Game.time;
    
    // Take action based on recommendation
    if (assessment.recommendation === 'safe_mode') {
      this.activateSafeMode(assessment);
    } else if (assessment.recommendation === 'emergency') {
      this.triggerEmergencyResponse(assessment);
    } else if (assessment.recommendation === 'alert') {
      this.sendAlert(assessment);
    }
    
    return assessment;
  }
  
  /**
   * Get current threat level (0-10)
   * Used by arbiters to adjust behavior during combat
   */
  getThreatLevel(): number {
    // Return most recent assessment if available and recent
    if (this.memory.threatHistory.length > 0 && 
        Game.time - this.memory.lastThreatAssessment < 10) {
      return this.memory.threatHistory[this.memory.threatHistory.length - 1];
    }
    
    // Otherwise do a quick check
    const hostiles = this.room.find(FIND_HOSTILE_CREEPS);
    if (hostiles.length === 0) return 0;
    
    // Quick threat calculation
    let threat = Math.min(hostiles.length * 0.5, 3);
    
    // Check if near critical structures
    const spawns = this.room.find(FIND_MY_SPAWNS);
    if (spawns.length > 0) {
      const nearSpawn = hostiles.some(h => h.pos.getRangeTo(spawns[0]) <= 5);
      if (nearSpawn) threat += 2;
    }
    
    return Math.min(Math.round(threat), 10);
  }
  
  /**
   * Evaluate current threat level
   */
  private evaluateThreat(): ThreatAssessment {
    const controller = this.room.controller!;
    
    // Find all hostiles
    const hostiles = this.room.find(FIND_HOSTILE_CREEPS);
    
    // Calculate total hostile damage potential
    let totalDamage = 0;
    let healPower = 0;
    
    for (const hostile of hostiles) {
      for (const part of hostile.body) {
        if (part.type === ATTACK && part.hits > 0) {
          totalDamage += 30; // ATTACK does 30 damage
        } else if (part.type === RANGED_ATTACK && part.hits > 0) {
          totalDamage += 10; // RANGED_ATTACK does 10 damage at range 1
        } else if (part.type === HEAL && part.hits > 0) {
          healPower += 12; // HEAL heals 12 HP
        }
      }
    }
    
    // Check which structures are under attack or at risk
    const criticalStructures = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_SPAWN ||
                   s.structureType === STRUCTURE_STORAGE ||
                   s.structureType === STRUCTURE_TERMINAL ||
                   s.structureType === STRUCTURE_TOWER
    });
    
    let structuresUnderAttack = 0;
    let spawnsAtRisk = false;
    let storageAtRisk = false;
    let criticalStructuresAtRisk = false;
    
    for (const structure of criticalStructures) {
      const nearbyHostiles = structure.pos.findInRange(hostiles, 3);
      if (nearbyHostiles.length > 0) {
        structuresUnderAttack++;
        
        if (structure.structureType === STRUCTURE_SPAWN) {
          spawnsAtRisk = true;
          criticalStructuresAtRisk = true;
        } else if (structure.structureType === STRUCTURE_STORAGE) {
          storageAtRisk = true;
          criticalStructuresAtRisk = true;
        }
        
        // Check if structure is actually taking damage
        const rampart = structure.pos.lookFor(LOOK_STRUCTURES).find(
          s => s.structureType === STRUCTURE_RAMPART
        ) as StructureRampart | undefined;
        
        if (!rampart || rampart.hits < 50000) {
          criticalStructuresAtRisk = true;
        }
      }
    }
    
    // Calculate threat level (0-10)
    let threatLevel = 0;
    
    // Base threat from hostile count
    threatLevel += Math.min(hostiles.length * 0.5, 3);
    
    // Threat from damage potential
    threatLevel += Math.min(totalDamage / 100, 3);
    
    // Threat from heal power (harder to kill)
    threatLevel += Math.min(healPower / 100, 2);
    
    // Extra threat if structures at risk
    if (structuresUnderAttack > 0) {
      threatLevel += structuresUnderAttack * 0.5;
    }
    
    // Critical multiplier
    if (criticalStructuresAtRisk) {
      threatLevel *= 1.5;
    }
    
    // Cap at 10
    threatLevel = Math.min(Math.round(threatLevel), 10);
    
    // Determine recommendation
    let recommendation: 'none' | 'alert' | 'emergency' | 'safe_mode' = 'none';
    
    if (threatLevel === 0) {
      recommendation = 'none';
    } else if (threatLevel <= 3) {
      recommendation = 'alert';
    } else if (threatLevel <= 6) {
      recommendation = 'emergency';
    } else {
      // Only recommend safe mode if:
      // 1. Critical structures at risk
      // 2. Safe mode is available
      // 3. Haven't used safe mode recently (last 5000 ticks)
      const canUseSafeMode = controller.safeModeAvailable > 0 &&
                             (!this.memory.safeModeUsed || Game.time - this.memory.safeModeUsed > 5000);
      
      if (criticalStructuresAtRisk && canUseSafeMode && this.memory.autoSafeModeEnabled) {
        recommendation = 'safe_mode';
      } else {
        recommendation = 'emergency';
      }
    }
    
    return {
      level: threatLevel,
      hostileCount: hostiles.length,
      hostileDamage: totalDamage,
      structuresUnderAttack,
      criticalStructuresAtRisk,
      spawnsAtRisk,
      storageAtRisk,
      recommendation
    };
  }
  
  /**
   * Activate safe mode
   */
  private activateSafeMode(assessment: ThreatAssessment): void {
    const controller = this.room.controller!;
    
    if (controller.safeModeAvailable > 0) {
      const result = controller.activateSafeMode();
      
      if (result === OK) {
        this.memory.safeModeUsed = Game.time;
        
        console.log(
          `🛡️ SAFE MODE ACTIVATED in ${this.room.name}!\n` +
          `   Threat Level: ${assessment.level}/10\n` +
          `   Hostiles: ${assessment.hostileCount}\n` +
          `   Damage Potential: ${assessment.hostileDamage}/tick\n` +
          `   Critical structures at risk: ${assessment.criticalStructuresAtRisk}`
        );
        
        // Send game notification if available
        if (Game.notify) {
          Game.notify(
            `⚠️ SAFE MODE ACTIVATED - ${this.room.name}\n` +
            `Threat Level: ${assessment.level}/10\n` +
            `${assessment.hostileCount} hostiles detected\n` +
            `Critical structures under attack!`,
            120 // Group notifications for 2 hours
          );
        }
      } else {
        console.log(`❌ Failed to activate safe mode in ${this.room.name}: ${result}`);
      }
    }
  }
  
  /**
   * Trigger emergency defensive response
   */
  private triggerEmergencyResponse(assessment: ThreatAssessment): void {
    // Alert every 100 ticks
    if (Game.time % 100 !== 0) return;
    
    const alertKey = `emergency_${this.room.name}_${Math.floor(Game.time / 100)}`;
    if (this.memory.alertsSent.includes(alertKey)) return;
    
    this.memory.alertsSent.push(alertKey);
    if (this.memory.alertsSent.length > 10) {
      this.memory.alertsSent.shift();
    }
    
    console.log(
      `⚠️ EMERGENCY - ${this.room.name} under attack!\n` +
      `   Threat Level: ${assessment.level}/10\n` +
      `   Hostiles: ${assessment.hostileCount}\n` +
      `   Structures at risk: ${assessment.structuresUnderAttack}\n` +
      `   Spawning emergency defenders...`
    );
    
    // Boost defender spawn priority
    const zealotArbiter = this.highCharity.arbiters['defense'];
    if (zealotArbiter) {
      // Emergency defenders get highest priority
      (zealotArbiter as any).emergencyMode = true;
    }
  }
  
  /**
   * Send alert about threat
   */
  private sendAlert(assessment: ThreatAssessment): void {
    // Alert every 200 ticks
    if (Game.time % 200 !== 0) return;
    
    const alertKey = `alert_${this.room.name}_${Math.floor(Game.time / 200)}`;
    if (this.memory.alertsSent.includes(alertKey)) return;
    
    this.memory.alertsSent.push(alertKey);
    if (this.memory.alertsSent.length > 10) {
      this.memory.alertsSent.shift();
    }
    
    console.log(
      `⚠️ Alert - ${this.room.name}: ${assessment.hostileCount} hostiles detected (Threat: ${assessment.level}/10)`
    );
  }
  
  /**
   * Get current threat level
   */
  getThreatLevel(): number {
    if (this.memory.threatHistory.length === 0) return 0;
    return this.memory.threatHistory[this.memory.threatHistory.length - 1];
  }
  
  /**
   * Check if safe mode is available
   */
  canUseSafeMode(): boolean {
    const controller = this.room.controller!;
    return controller.safeModeAvailable > 0 &&
           (!this.memory.safeModeUsed || Game.time - this.memory.safeModeUsed > 5000);
  }
  
  /**
   * Enable/disable auto safe mode
   */
  setAutoSafeMode(enabled: boolean): void {
    this.memory.autoSafeModeEnabled = enabled;
    console.log(`Safe mode auto-activation ${enabled ? 'enabled' : 'disabled'} for ${this.room.name}`);
  }
  
  /**
   * Get status report
   */
  getStatus(): string {
    const controller = this.room.controller!;
    const threatLevel = this.getThreatLevel();
    const avgThreat = this.memory.threatHistory.length > 0 ?
      this.memory.threatHistory.reduce((a, b) => a + b, 0) / this.memory.threatHistory.length : 0;
    
    return (
      `Safe Mode Manager - ${this.room.name}\n` +
      `  Current Threat: ${threatLevel}/10\n` +
      `  Average Threat: ${avgThreat.toFixed(1)}/10\n` +
      `  Safe Mode Available: ${controller.safeModeAvailable}\n` +
      `  Safe Mode Cooldown: ${controller.safeModeCooldown || 0} ticks\n` +
      `  Auto Safe Mode: ${this.memory.autoSafeModeEnabled ? 'ON' : 'OFF'}\n` +
      `  Last Used: ${this.memory.safeModeUsed ? `${Game.time - this.memory.safeModeUsed} ticks ago` : 'Never'}`
    );
  }
}
