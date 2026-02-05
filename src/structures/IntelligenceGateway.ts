/**
 * INTELLIGENCE Gateway - Room Reconnaissance
 * 
 * "Know thy enemy, know thy terrain"
 * 
 * Gathers intelligence about nearby rooms for expansion and remote mining opportunities
 */

/// <reference types="@types/screeps" />

import { Nexus } from '../core/Nexus';

export interface RoomIntel {
  roomName: string;
  lastScanned: number;
  sourceCount: number;
  sourceIds: Id<Source>[];
  mineralType?: MineralConstant;
  controller?: {
    level?: number;
    owner?: string;
    reservation?: {
      username: string;
      ticksToEnd: number;
    };
  };
  hostiles: number;
  isSafe: boolean;
  distance: number;
}

/**
 * Intelligence Gateway - Scouts and analyzes nearby rooms
 */
export class IntelligenceGateway {
  Nexus: Nexus;
  memory: { [roomName: string]: RoomIntel };
  
  constructor(Nexus: Nexus) {
    this.Nexus = Nexus;
    
    // Initialize memory
    const hcMemory = Nexus.memory as any;
    if (!hcMemory.intel) {
      hcMemory.intel = {};
    }
    this.memory = hcMemory.intel;
  }
  
  /**
   * Scan nearby rooms for opportunities
   */
  scan(): void {
    // Scan every 100 ticks
    if (Game.time % 100 !== 0) return;
    
    // Cleanup stale intel data every 5000 ticks
    if (Game.time % 5000 === 0) {
      this.cleanupStaleIntel();
    }
    
    const homeRoom = this.Nexus.name;
    const exits = Game.map.describeExits(homeRoom);
    
    if (!exits) return;
    
    // Scan adjacent rooms
    for (const exitDir in exits) {
      const roomName = exits[exitDir as ExitKey];
      if (!roomName) continue;
      
      this.scanRoom(roomName);
    }
  }
  
  /**
   * Scan a specific room for intelligence
   */
  private scanRoom(roomName: string): void {
    const room = Game.rooms[roomName];
    
    // No vision yet
    if (!room) {
      // Mark as unknown if not in memory
      if (!this.memory[roomName]) {
        this.memory[roomName] = {
          roomName,
          lastScanned: Game.time,
          sourceCount: 0,
          sourceIds: [],
          hostiles: 0,
          isSafe: false,
          distance: this.calculateDistance(roomName)
        };
      }
      return;
    }
    
    // Have vision - gather intel
    const sources = room.find(FIND_SOURCES);
    const mineral = room.find(FIND_MINERALS)[0];
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    const controller = room.controller;
    
    const intel: RoomIntel = {
      roomName,
      lastScanned: Game.time,
      sourceCount: sources.length,
      sourceIds: sources.map(s => s.id),
      mineralType: mineral?.mineralType,
      hostiles: hostiles.length,
      isSafe: hostiles.length === 0,
      distance: this.calculateDistance(roomName)
    };
    
    // Controller info
    if (controller) {
      intel.controller = {
        level: controller.level,
        owner: controller.owner?.username
      };
      
      if (controller.reservation) {
        intel.controller.reservation = {
          username: controller.reservation.username,
          ticksToEnd: controller.reservation.ticksToEnd
        };
      }
    }
    
    this.memory[roomName] = intel;
  }
  
  /**
   * Get remote mining opportunities
   */
  getRemoteMiningTargets(): Array<{ roomName: string; sourceId: Id<Source> }> {
    const targets: Array<{ roomName: string; sourceId: Id<Source> }> = [];
    
    for (const roomName in this.memory) {
      const intel = this.memory[roomName];
      
      // Check if room is suitable for remote mining
      if (!this.isSuitableForRemoteMining(intel)) continue;
      
      // Add each source as a target
      for (const sourceId of intel.sourceIds) {
        targets.push({ roomName, sourceId });
      }
    }
    
    return targets;
  }
  
  /**
   * Check if room is suitable for remote mining
   */
  private isSuitableForRemoteMining(intel: RoomIntel): boolean {
    // Must have sources
    if (intel.sourceCount === 0) return false;
    
    // Must be safe
    if (!intel.isSafe) return false;
    
    // Don't mine from rooms with hostile controllers
    if (intel.controller?.owner && intel.controller.owner !== this.Nexus.room.controller?.owner?.username) {
      return false;
    }
    
    // Don't mine from reserved rooms (unless we reserved it)
    if (intel.controller?.reservation && 
        intel.controller.reservation.username !== this.Nexus.room.controller?.owner?.username) {
      return false;
    }
    
    // Maximum distance (2 rooms away)
    if (intel.distance > 2) return false;
    
    return true;
  }
  
  /**
   * Clean up stale intel data to prevent memory bloat
   * Removes intel for rooms that haven't been scanned in 50,000 ticks
   * and are no longer relevant (too far or owned by others)
   */
  private cleanupStaleIntel(): void {
    const STALE_THRESHOLD = 50000; // ~14 hours of game time
    const now = Game.time;
    
    for (const roomName in this.memory) {
      const intel = this.memory[roomName];
      const age = now - intel.lastScanned;
      
      // Remove very stale data
      if (age > STALE_THRESHOLD) {
        // Keep intel for rooms we're actively using
        if (intel.distance <= 2 && !intel.controller?.owner) {
          continue; // Keep nearby unowned rooms
        }
        
        delete this.memory[roomName];
        console.log(`🧹 Cleaned stale intel for ${roomName} (age: ${age} ticks)`);
      }
      
      // Remove intel for rooms that are now owned by hostile players
      if (intel.controller?.owner && 
          intel.controller.owner !== this.Nexus.room.controller?.owner?.username) {
        if (age > 10000) { // Give some time before cleanup
          delete this.memory[roomName];
          console.log(`🧹 Cleaned intel for hostile-owned room: ${roomName}`);
        }
      }
    }
  }
  
  /**
   * Calculate distance to room
   */
  private calculateDistance(roomName: string): number {
    const route = Game.map.findRoute(this.Nexus.name, roomName);
    if (route === ERR_NO_PATH) return 999;
    return Array.isArray(route) ? route.length : 1;
  }
  
  /**
   * Get expansion opportunities (claimable rooms)
   */
  getExpansionTargets(): RoomIntel[] {
    const targets: RoomIntel[] = [];
    
    for (const roomName in this.memory) {
      const intel = this.memory[roomName];
      
      // Must have controller
      if (!intel.controller) continue;
      
      // Must be unclaimed
      if (intel.controller.owner) continue;
      
      // Must be safe
      if (!intel.isSafe) continue;
      
      // Must have sources
      if (intel.sourceCount < 1) continue;
      
      // Reasonable distance
      if (intel.distance > 3) continue;
      
      targets.push(intel);
    }
    
    return targets.sort((a, b) => a.distance - b.distance);
  }
}
