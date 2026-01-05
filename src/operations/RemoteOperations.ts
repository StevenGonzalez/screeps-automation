/**
 * REMOTE OPERATIONS - Resource Extraction from Distant Rooms
 * 
 * "The Covenant's reach extends beyond its borders"
 * 
 * Manages remote mining operations in unowned rooms to maximize
 * resource income and support rapid expansion.
 */

/// <reference types="@types/screeps" />

import { HighCharity } from '../core/HighCharity';

export interface RemoteRoom {
  roomName: string;
  sourceIds: Id<Source>[];
  distance: number; // Path length to home room
  threat: number; // Threat level from intel
  reserved: boolean; // Has keeper/reserver
  active: boolean; // Currently mining
  disabled: boolean; // Temporarily disabled (too dangerous)
}

export interface RemoteMemory {
  rooms: { [roomName: string]: RemoteRoom };
  lastScan: number;
}

/**
 * Remote Operations Manager - Coordinates remote mining
 */
export class RemoteOperations {
  private highCharity: HighCharity;
  
  private get memory(): RemoteMemory {
    if (!this.highCharity.memory.remote) {
      this.highCharity.memory.remote = {
        rooms: {},
        lastScan: 0
      };
    }
    return this.highCharity.memory.remote as RemoteMemory;
  }
  
  constructor(highCharity: HighCharity) {
    this.highCharity = highCharity;
  }
  
  /**
   * Run remote operations
   */
  run(): void {
    // Only operate at RCL 4+ with stable economy
    if ((this.highCharity.controller?.level || 0) < 4) return;
    
    // Scan for remote rooms periodically
    if (Game.time - this.memory.lastScan > 500) {
      this.scanForRemoteRooms();
      this.memory.lastScan = Game.time;
    }
    
    // Cleanup stale remote room data every 10000 ticks
    if (Game.time % 10000 === 0) {
      this.cleanupStaleRemoteRooms();
    }
    
    // Manage active remote rooms
    this.manageRemoteRooms();
    
    // Update threat levels from intel
    this.updateThreatLevels();
  }
  
  /**
   * Scan adjacent rooms for remote mining opportunities
   */
  private scanForRemoteRooms(): void {
    const adjacentRooms = this.getAdjacentRoomNames(this.highCharity.name);
    
    for (const roomName of adjacentRooms) {
      // Check if we already know about this room
      if (this.memory.rooms[roomName]) continue;
      
      // Get intel if available
      const intel = Memory.intel?.[roomName];
      if (!intel) continue;
      
      // Skip owned rooms
      if (intel.owner) continue;
      
      // Skip if no sources
      if (!intel.sources || intel.sources.length === 0) continue;
      
      // Calculate path distance
      const distance = this.calculatePathDistance(roomName);
      if (distance > 150) continue; // Too far
      
      // Calculate profitability score
      const profitability = this.calculateProfitability(roomName, intel, distance);
      if (profitability < 0.3) {
        console.log(`❌ Skipping unprofitable room: ${roomName} (score: ${profitability.toFixed(2)})`);
        continue;
      }
      
      // Add to remote rooms
      const sourceIds = intel.sources.map((s: any) => s.id as Id<Source>);
      this.memory.rooms[roomName] = {
        roomName,
        sourceIds,
        distance,
        threat: intel.threat || 0,
        reserved: false,
        active: false,
        disabled: false
      };
      
      console.log(`🌍 Discovered remote room: ${roomName} (${sourceIds.length} sources, ${distance} distance, profit score: ${profitability.toFixed(2)})`);
    }
  }
  
  /**
   * Calculate profitability score for a remote room (0-1)
   */
  private calculateProfitability(roomName: string, intel: any, distance: number): number {
    let score = 0.5; // Base score
    
    // More sources = more profit
    const sourceCount = intel.sources?.length || 0;
    score += sourceCount * 0.2;
    
    // Closer rooms are more profitable
    if (distance < 50) score += 0.3;
    else if (distance < 100) score += 0.15;
    
    // Safe rooms are more valuable
    const threat = intel.threat || 0;
    if (threat === 0) score += 0.2;
    else if (threat < 3) score += 0.1;
    else score -= threat * 0.1; // Dangerous rooms lose value
    
    // No hostile controller is good
    if (!intel.controller?.owner) score += 0.1;
    
    // No hostile reservation is good
    if (!intel.controller?.reservation || intel.controller.reservation.username === this.highCharity.room.controller?.owner?.username) {
      score += 0.1;
    }
    
    return Math.max(0, Math.min(1, score));
  }
  
  /**
   * Manage active remote mining operations
   */
  private manageRemoteRooms(): void {
    const remoteRooms = Object.values(this.memory.rooms);
    
    // Activate rooms based on priority
    const inactiveRooms = remoteRooms
      .filter(r => !r.active && !r.disabled && r.threat < 5)
      .sort((a, b) => a.distance - b.distance);
    
    // Activate up to 2 remote rooms
    const maxRemoteRooms = Math.min(2, Math.floor((this.highCharity.controller?.level || 0) / 2));
    const activeCount = remoteRooms.filter(r => r.active).length;
    
    if (activeCount < maxRemoteRooms && inactiveRooms.length > 0) {
      const toActivate = inactiveRooms[0];
      toActivate.active = true;
      console.log(`✅ Activated remote mining in ${toActivate.roomName}`);
    }
    
    // Check if active rooms are still viable
    for (const room of remoteRooms.filter(r => r.active)) {
      // Check live room data for immediate threats
      const gameRoom = Game.rooms[room.roomName];
      if (gameRoom) {
        // Disable immediately if hostiles present
        const hostiles = gameRoom.find(FIND_HOSTILE_CREEPS);
        if (hostiles.length > 0) {
          room.active = false;
          room.disabled = true;
          room.threat = 10; // Mark as very dangerous
          console.log(`🚨 RETREAT from ${room.roomName} - hostiles detected!`);
          continue;
        }
        
        // Check for hostile structures blocking operations
        const hostileStructures = gameRoom.find(FIND_HOSTILE_STRUCTURES);
        if (hostileStructures.length > 0) {
          room.active = false;
          room.disabled = true;
          console.log(`⚠️ Disabled ${room.roomName} - hostile structures blocking`);
          continue;
        }
        
        // Check for hostile construction sites on sources
        const sources = room.sourceIds.map(id => Game.getObjectById(id)).filter(Boolean) as Source[];
        for (const source of sources) {
          const constructionSites = source.pos.lookFor(LOOK_CONSTRUCTION_SITES);
          if (constructionSites.length > 0 && !constructionSites[0].my) {
            room.active = false;
            room.disabled = true;
            console.log(`⚠️ Disabled ${room.roomName} - construction site griefing detected`);
            break;
          }
        }
        
        // Check for hostile reservations
        if (gameRoom.controller?.reservation) {
          const myUsername = Object.values(Game.spawns)[0]?.owner?.username;
          if (myUsername && gameRoom.controller.reservation.username !== myUsername) {
            room.active = false;
            room.disabled = true;
            console.log(`⚠️ Disabled ${room.roomName} - reserved by hostile player`);
            continue;
          }
        }
      }
      
      // Disable if threat too high (from intel)
      if (room.threat >= 7) {
        room.active = false;
        room.disabled = true;
        console.log(`⚠️ Disabled remote mining in ${room.roomName} (high threat: ${room.threat})`);
      }
    }
  }
  
  /**
   * Update threat levels from observer intel
   */
  private updateThreatLevels(): void {
    for (const roomName in this.memory.rooms) {
      const intel = Memory.intel?.[roomName];
      if (intel) {
        const room = this.memory.rooms[roomName];
        room.threat = intel.threat || 0;
        
        // Re-enable rooms that are safe again (every 1000 ticks)
        if (room.disabled && room.threat < 3 && Game.time % 1000 === 0) {
          room.disabled = false;
          console.log(`✅ Re-enabled remote room ${roomName} (threat dropped to ${room.threat})`);
        }
      }
    }
  }
  
  /**
   * Clean up stale remote room data to prevent memory bloat
   * Removes rooms that have been disabled for too long or are no longer viable
   */
  private cleanupStaleRemoteRooms(): void {
    const DISABLED_CLEANUP_THRESHOLD = 50000; // Remove if disabled for ~14 hours
    
    for (const roomName in this.memory.rooms) {
      const room = this.memory.rooms[roomName];
      
      // Remove rooms that have been disabled for a very long time
      if (room.disabled && room.threat >= 10) {
        // Check if intel says room is now safe
        const intel = Memory.intel?.[roomName];
        if (intel && intel.threat >= 5) {
          // Still dangerous - keep disabled but mark for potential removal
          continue;
        }
        
        // If no intel or threat is low, we might remove it
        if (!intel || intel.threat < 3) {
          // Give it another chance - re-enable instead of deleting
          room.disabled = false;
          room.threat = 0;
          console.log(`🔄 Reset remote room ${roomName} for re-evaluation`);
        }
      }
      
      // Remove rooms that are now owned by hostile players
      const intel = Memory.intel?.[roomName];
      if (intel?.controller?.owner && 
          intel.controller.owner !== this.highCharity.room.controller?.owner?.username) {
        delete this.memory.rooms[roomName];
        console.log(`🧹 Cleaned up hostile-owned remote room: ${roomName}`);
      }
    }
  }
  
  /**
   * Get list of active remote rooms
   */
  getActiveRemoteRooms(): RemoteRoom[] {
    return Object.values(this.memory.rooms).filter(r => r.active);
  }
  
  /**
   * Get remote room by name
   */
  getRemoteRoom(roomName: string): RemoteRoom | null {
    return this.memory.rooms[roomName] || null;
  }
  
  /**
   * Calculate path distance to a room
   */
  private calculatePathDistance(roomName: string): number {
    const route = Game.map.findRoute(this.highCharity.name, roomName);
    if (route === ERR_NO_PATH) return 999;
    
    // Estimate: 50 tiles per room + route length * 50
    return route.length * 50 + 50;
  }
  
  /**
   * Get adjacent room names
   */
  private getAdjacentRoomNames(roomName: string): string[] {
    const parsed = /^([WE])([0-9]+)([NS])([0-9]+)$/.exec(roomName);
    if (!parsed) return [];
    
    const [, hor, x, ver, y] = parsed;
    const xNum = parseInt(x);
    const yNum = parseInt(y);
    
    const adjacent: string[] = [];
    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    
    for (const [dx, dy] of dirs) {
      let newX = xNum + dx;
      let newY = yNum + dy;
      let newHor = hor;
      let newVer = ver;
      
      if (newX < 0) {
        newHor = hor === 'W' ? 'E' : 'W';
        newX = Math.abs(newX + 1);
      }
      if (newY < 0) {
        newVer = ver === 'N' ? 'S' : 'N';
        newY = Math.abs(newY + 1);
      }
      
      adjacent.push(`${newHor}${newX}${newVer}${newY}`);
    }
    
    return adjacent;
  }
  
  /**
   * Get required remote harvesters for a source
   */
  getRequiredHarvesters(sourceId: Id<Source>): number {
    // Find which room this source is in
    for (const roomName in this.memory.rooms) {
      const room = this.memory.rooms[roomName];
      if (room.sourceIds.includes(sourceId) && room.active) {
        // Need 1-2 harvesters depending on distance
        return room.distance > 100 ? 2 : 1;
      }
    }
    return 0;
  }
  
  /**
   * Get required remote haulers for a room
   */
  getRequiredHaulers(roomName: string): number {
    const room = this.memory.rooms[roomName];
    if (!room || !room.active) return 0;
    
    // 1 hauler per source + 1 extra for long distances
    const baseHaulers = room.sourceIds.length;
    const extraHaulers = room.distance > 100 ? 1 : 0;
    
    return baseHaulers + extraHaulers;
  }
  
  /**
   * Enable/disable remote mining in a room
   */
  setRemoteRoomActive(roomName: string, active: boolean): void {
    const room = this.memory.rooms[roomName];
    if (!room) {
      console.log(`❌ Unknown remote room: ${roomName}`);
      return;
    }
    
    room.active = active;
    room.disabled = !active;
    console.log(`${active ? '✅' : '❌'} Remote mining ${active ? 'enabled' : 'disabled'} in ${roomName}`);
  }
  
  /**
   * Get status summary
   */
  getStatus(): string {
    const rooms = Object.values(this.memory.rooms);
    const active = rooms.filter(r => r.active);
    const available = rooms.filter(r => !r.active && !r.disabled && r.threat < 5);
    
    let status = `\n📍 ${this.highCharity.name} - Remote Operations`;
    status += `\n  Active rooms: ${active.length}`;
    status += `\n  Available rooms: ${available.length}`;
    status += `\n  Total discovered: ${rooms.length}`;
    
    if (active.length > 0) {
      status += `\n  Active:`;
      for (const room of active) {
        status += `\n    ${room.roomName} - ${room.sourceIds.length} sources, ${room.distance} dist, threat ${room.threat}`;
      }
    }
    
    return status;
  }
}
