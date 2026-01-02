/**
 * RECLAIMATION COUNCIL - Colony Expansion System
 * 
 * "The Great Journey awaits - new worlds to claim"
 * 
 * Manages colony expansion, claiming new rooms, and coordinating
 * pioneer operations to establish new High Charities.
 */

/// <reference types="@types/screeps" />

import { Covenant } from '../core/Covenant';
import { RoomIntel } from '../intel/ObserverNetwork';

export interface ExpansionTarget {
  roomName: string;
  score: number;
  distance: number;
  sources: number;
  mineral: MineralConstant | undefined;
  threat: number;
  claimingFrom: string; // Which colony is claiming this
  status: 'evaluating' | 'claiming' | 'bootstrapping' | 'established';
  claimedAt?: number;
  pioneerCount?: number;
}

export interface ReclaimationMemory {
  currentTarget?: ExpansionTarget;
  history: { roomName: string; claimedAt: number; success: boolean }[];
  lastEvaluation: number;
}

/**
 * Reclaimation Council - Coordinates colony expansion
 */
export class ReclaimationCouncil {
  private covenant: Covenant;
  
  private get memory(): ReclaimationMemory {
    if (!Memory.expansion) {
      Memory.expansion = {
        history: [],
        lastEvaluation: 0
      };
    }
    return Memory.expansion as ReclaimationMemory;
  }
  
  constructor(covenant: Covenant) {
    this.covenant = covenant;
  }
  
  /**
   * Run expansion system
   */
  run(): void {
    // Only evaluate expansion periodically
    if (Game.time - this.memory.lastEvaluation < 1000) {
      // Still monitor current expansion
      if (this.memory.currentTarget) {
        this.monitorExpansion();
      }
      return;
    }
    
    this.memory.lastEvaluation = Game.time;
    
    // Check if we should expand
    if (!this.shouldExpand()) return;
    
    // Find best expansion target
    const target = this.findBestExpansionTarget();
    if (!target) {
      console.log('📡 No suitable expansion targets found');
      return;
    }
    
    // Start expansion
    this.initiateExpansion(target);
  }
  
  /**
   * Determine if we should expand
   */
  private shouldExpand(): boolean {
    // Don't expand if already expanding
    if (this.memory.currentTarget) return false;
    
    // Count established colonies
    const colonies = Object.keys(Game.rooms).filter(roomName => {
      const room = Game.rooms[roomName];
      return room.controller && room.controller.my;
    });
    
    // GCL check - can we support another colony?
    if (colonies.length >= Game.gcl.level) {
      return false;
    }
    
    // Economic readiness - at least one colony must be RCL 5+
    const hasStrongColony = colonies.some(roomName => {
      const room = Game.rooms[roomName];
      return room.controller && room.controller.level >= 5;
    });
    
    if (!hasStrongColony) {
      return false;
    }
    
    // Energy reserve check - need 10k energy for claiming
    const hasEnergy = colonies.some(roomName => {
      const room = Game.rooms[roomName];
      return room.storage && room.storage.store[RESOURCE_ENERGY] > 20000;
    });
    
    if (!hasEnergy) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Find the best room to expand to
   */
  private findBestExpansionTarget(): ExpansionTarget | null {
    const candidates = this.covenant.observerNetwork.getExpansionCandidates();
    
    if (candidates.length === 0) return null;
    
    // Score candidates
    const scored = candidates.map(intel => this.scoreExpansionTarget(intel));
    
    // Filter out low-scoring targets
    const viable = scored.filter(t => t.score >= 50);
    
    if (viable.length === 0) return null;
    
    // Sort by score
    viable.sort((a, b) => b.score - a.score);
    
    return viable[0];
  }
  
  /**
   * Score an expansion target (0-100)
   */
  private scoreExpansionTarget(intel: RoomIntel): ExpansionTarget {
    let score = 0;
    
    // Source count (critical)
    const sources = intel.sources?.length || 0;
    if (sources >= 2) {
      score += 40; // 2+ sources is essential
    } else if (sources === 1) {
      score += 10; // 1 source is poor
    }
    
    // Mineral type value
    const mineralValue: { [key: string]: number } = {
      [RESOURCE_CATALYST]: 20,
      [RESOURCE_HYDROGEN]: 15,
      [RESOURCE_OXYGEN]: 15,
      [RESOURCE_LEMERGIUM]: 15,
      [RESOURCE_KEANIUM]: 15,
      [RESOURCE_ZYNTHIUM]: 15,
      [RESOURCE_UTRIUM]: 15,
      [RESOURCE_GHODIUM]: 10
    };
    
    if (intel.mineral?.type) {
      score += mineralValue[intel.mineral.type] || 10;
    }
    
    // Distance penalty (closer is better)
    const distance = this.calculateDistanceToNearestColony(intel.roomName);
    if (distance <= 1) {
      score += 20; // Adjacent room
    } else if (distance === 2) {
      score += 10; // Close
    } else if (distance >= 5) {
      score -= 20; // Too far
    }
    
    // Threat penalty
    const threat = intel.threat || 0;
    score -= threat * 5; // -5 per threat level
    
    // Controller position (central is better)
    // This would require room scan data - skip for now
    
    return {
      roomName: intel.roomName,
      score: Math.max(0, Math.min(100, score)),
      distance,
      sources,
      mineral: intel.mineral?.type,
      threat,
      claimingFrom: this.findNearestColony(intel.roomName),
      status: 'evaluating'
    };
  }
  
  /**
   * Calculate distance to nearest colony
   */
  private calculateDistanceToNearestColony(roomName: string): number {
    const colonies = Object.keys(Game.rooms).filter(rn => {
      const room = Game.rooms[rn];
      return room.controller && room.controller.my;
    });
    
    let minDistance = 999;
    for (const colonyName of colonies) {
      const route = Game.map.findRoute(colonyName, roomName);
      if (route !== ERR_NO_PATH) {
        minDistance = Math.min(minDistance, route.length);
      }
    }
    
    return minDistance;
  }
  
  /**
   * Find nearest colony to a room
   */
  private findNearestColony(roomName: string): string {
    const colonies = Object.keys(Game.rooms).filter(rn => {
      const room = Game.rooms[rn];
      return room.controller && room.controller.my;
    });
    
    let nearest = colonies[0];
    let minDistance = 999;
    
    for (const colonyName of colonies) {
      const route = Game.map.findRoute(colonyName, roomName);
      if (route !== ERR_NO_PATH && route.length < minDistance) {
        minDistance = route.length;
        nearest = colonyName;
      }
    }
    
    return nearest;
  }
  
  /**
   * Start expansion to a target room
   */
  private initiateExpansion(target: ExpansionTarget): void {
    this.memory.currentTarget = target;
    this.memory.currentTarget.status = 'claiming';
    this.memory.currentTarget.claimedAt = Game.time;
    
    console.log(`═══════════════════════════════════════════════════════`);
    console.log(`🚀 INITIATING EXPANSION`);
    console.log(`═══════════════════════════════════════════════════════`);
    console.log(`Target: ${target.roomName}`);
    console.log(`Score: ${target.score}/100`);
    console.log(`Sources: ${target.sources}`);
    console.log(`Mineral: ${target.mineral || 'unknown'}`);
    console.log(`Distance: ${target.distance} rooms`);
    console.log(`Claiming from: ${target.claimingFrom}`);
    console.log(`═══════════════════════════════════════════════════════`);
  }
  
  /**
   * Monitor ongoing expansion
   */
  private monitorExpansion(): void {
    const target = this.memory.currentTarget!;
    const room = Game.rooms[target.roomName];
    
    // Check if room is claimed
    if (room && room.controller && room.controller.my) {
      if (target.status === 'claiming') {
        target.status = 'bootstrapping';
        console.log(`✅ ${target.roomName} claimed! Beginning bootstrap phase...`);
      }
      
      // Check if room has spawn
      const spawns = room.find(FIND_MY_SPAWNS);
      if (spawns.length > 0) {
        target.status = 'established';
        console.log(`🏰 ${target.roomName} established! Colony is self-sufficient.`);
        
        // Record success
        this.memory.history.push({
          roomName: target.roomName,
          claimedAt: target.claimedAt!,
          success: true
        });
        
        // Clear current target
        delete this.memory.currentTarget;
      }
    }
    
    // Timeout check (abandon after 50k ticks)
    if (Game.time - target.claimedAt! > 50000) {
      console.log(`❌ Expansion to ${target.roomName} timed out - abandoning`);
      this.memory.history.push({
        roomName: target.roomName,
        claimedAt: target.claimedAt!,
        success: false
      });
      delete this.memory.currentTarget;
    }
  }
  
  /**
   * Get current expansion status
   */
  getStatus(): ExpansionTarget | null {
    return this.memory.currentTarget || null;
  }
  
  /**
   * Get expansion history
   */
  getHistory(): Array<{ roomName: string; claimedAt: number; success: boolean }> {
    return this.memory.history;
  }
  
  /**
   * Cancel current expansion
   */
  cancelExpansion(): void {
    if (this.memory.currentTarget) {
      console.log(`❌ Cancelling expansion to ${this.memory.currentTarget.roomName}`);
      delete this.memory.currentTarget;
    }
  }
}
