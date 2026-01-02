/**
 * WAR COUNCIL - Combat Operations Manager
 * 
 * "Let none stand against the Covenant"
 * 
 * Manages offensive military operations including room scanning,
 * target selection, attack squad composition, and coordinated assaults.
 */

/// <reference types="@types/screeps" />

import { HighCharity } from '../core/HighCharity';

export interface WarTarget {
  roomName: string;
  owner?: string;
  lastScanned: number;
  hostileCount: number;
  towerCount: number;
  spawnCount: number;
  controllerLevel: number;
  threatLevel: number; // 0-10 scale
  priority: number; // Lower = higher priority
}

export interface AttackSquad {
  id: string;
  targetRoom: string;
  attackers: string[]; // Creep names
  healers: string[]; // Creep names
  status: 'forming' | 'moving' | 'engaging' | 'retreating' | 'victorious';
  launchedTick: number;
}

/**
 * War Council - Manages all combat operations for a High Charity
 */
export class WarCouncil {
  private highCharity: HighCharity;
  private targets: Map<string, WarTarget>;
  private squads: Map<string, AttackSquad>;
  
  constructor(highCharity: HighCharity) {
    this.highCharity = highCharity;
    this.targets = new Map();
    this.squads = new Map();
    
    // Initialize from memory
    this.loadFromMemory();
  }
  
  init(): void {
    // Scan nearby rooms for targets
    if (Game.time % 100 === 0) {
      this.scanNearbyRooms();
    }
    
    // Update existing targets
    if (Game.time % 500 === 0) {
      this.updateTargets();
    }
    
    // Check if we should launch an attack
    if (this.shouldLaunchAttack()) {
      this.launchAttack();
    }
  }
  
  run(): void {
    // Manage active squads
    for (const [id, squad] of this.squads) {
      this.manageSquad(squad);
    }
    
    // Save to memory
    this.saveToMemory();
  }
  
  /**
   * Scan nearby rooms for potential targets
   */
  private scanNearbyRooms(): void {
    const room = this.highCharity.room;
    const range = 3; // Scan 3 rooms away
    
    // Get all rooms within range
    const roomsToScan: string[] = [];
    
    for (let x = -range; x <= range; x++) {
      for (let y = -range; y <= range; y++) {
        const targetRoom = this.getRoomNameAtOffset(room.name, x, y);
        if (targetRoom) {
          roomsToScan.push(targetRoom);
        }
      }
    }
    
    // Analyze rooms we have vision in
    for (const roomName of roomsToScan) {
      const targetRoom = Game.rooms[roomName];
      if (targetRoom) {
        this.analyzeRoom(targetRoom);
      }
    }
  }
  
  /**
   * Analyze a room for attack potential
   */
  private analyzeRoom(room: Room): void {
    // Skip if it's our room or an ally's
    if (room.controller?.my || room.controller?.reservation?.username === 'Invader') {
      return;
    }
    
    // Skip if no controller or neutral
    if (!room.controller || !room.controller.owner) {
      return;
    }
    
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    const towers = room.find(FIND_HOSTILE_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_TOWER
    });
    const spawns = room.find(FIND_HOSTILE_SPAWNS);
    
    const threatLevel = this.calculateThreatLevel(
      room.controller.level,
      towers.length,
      hostiles.length
    );
    
    const priority = this.calculatePriority(
      room,
      room.controller.level,
      threatLevel
    );
    
    const target: WarTarget = {
      roomName: room.name,
      owner: room.controller.owner.username,
      lastScanned: Game.time,
      hostileCount: hostiles.length,
      towerCount: towers.length,
      spawnCount: spawns.length,
      controllerLevel: room.controller.level,
      threatLevel,
      priority
    };
    
    this.targets.set(room.name, target);
    
    if (Game.time % 100 === 0) {
      console.log(`⚔️ War Council: Scanned ${room.name} - RCL${target.controllerLevel}, Threat: ${threatLevel}, Priority: ${priority}`);
    }
  }
  
  /**
   * Calculate threat level (0-10)
   */
  private calculateThreatLevel(rcl: number, towers: number, hostiles: number): number {
    let threat = rcl * 0.5; // Base threat from RCL
    threat += towers * 2; // Towers are significant
    threat += hostiles * 0.5; // Hostile creeps
    
    return Math.min(10, Math.round(threat));
  }
  
  /**
   * Calculate attack priority (lower = higher priority)
   */
  private calculatePriority(room: Room, rcl: number, threat: number): number {
    let priority = 100;
    
    // Prefer closer rooms
    const distance = Game.map.getRoomLinearDistance(this.highCharity.name, room.name);
    priority += distance * 10;
    
    // Prefer weaker rooms
    priority += rcl * 5;
    priority += threat * 3;
    
    // Prefer rooms with resources
    const sources = room.find(FIND_SOURCES);
    priority -= sources.length * 10;
    
    // Prefer rooms with minerals
    const minerals = room.find(FIND_MINERALS);
    if (minerals.length > 0) {
      priority -= 20;
    }
    
    return priority;
  }
  
  /**
   * Check if we should launch an attack
   */
  private shouldLaunchAttack(): boolean {
    // Only at powerhouse phase
    if (this.highCharity.memory.phase !== 'powerhouse') {
      return false;
    }
    
    // Need sufficient resources
    if (!this.highCharity.storage || 
        this.highCharity.storage.store.getUsedCapacity(RESOURCE_ENERGY) < 50000) {
      return false;
    }
    
    // Don't launch if we already have active squads
    if (this.squads.size > 0) {
      return false;
    }
    
    // Need targets
    if (this.targets.size === 0) {
      return false;
    }
    
    // Launch attack every 1000 ticks if conditions are met
    return Game.time % 1000 === 0;
  }
  
  /**
   * Launch an attack on the highest priority target
   */
  private launchAttack(): void {
    // Find best target
    const sortedTargets = Array.from(this.targets.values())
      .sort((a, b) => a.priority - b.priority);
    
    if (sortedTargets.length === 0) return;
    
    const target = sortedTargets[0];
    
    // Calculate squad composition
    const squadSize = this.calculateSquadSize(target);
    
    const squadId = `squad_${Game.time}`;
    const squad: AttackSquad = {
      id: squadId,
      targetRoom: target.roomName,
      attackers: [],
      healers: [],
      status: 'forming',
      launchedTick: Game.time
    };
    
    this.squads.set(squadId, squad);
    
    console.log(`⚔️ War Council: Launching attack on ${target.roomName} (RCL${target.controllerLevel}, Threat: ${target.threatLevel})`);
    console.log(`📋 Squad composition: ${squadSize.attackers} attackers, ${squadSize.healers} healers`);
    
    // Request squad members (would integrate with spawn queue)
    // For now, just log the request
  }
  
  /**
   * Calculate optimal squad size based on target
   */
  private calculateSquadSize(target: WarTarget): { attackers: number; healers: number } {
    let attackers = 2;
    let healers = 1;
    
    // Scale up for tougher targets
    if (target.threatLevel > 5) {
      attackers = 4;
      healers = 2;
    }
    if (target.threatLevel > 8) {
      attackers = 6;
      healers = 3;
    }
    
    return { attackers, healers };
  }
  
  /**
   * Manage an active squad
   */
  private manageSquad(squad: AttackSquad): void {
    // Get squad creeps
    const attackers = squad.attackers
      .map(name => Game.creeps[name])
      .filter(c => c);
    const healers = squad.healers
      .map(name => Game.creeps[name])
      .filter(c => c);
    
    // Remove squad if all members are dead
    if (attackers.length === 0 && healers.length === 0) {
      this.squads.delete(squad.id);
      console.log(`⚔️ War Council: Squad ${squad.id} disbanded`);
      return;
    }
    
    // Update squad status based on members
    // (Actual squad AI would go here)
  }
  
  /**
   * Get room name at offset from current room
   */
  private getRoomNameAtOffset(roomName: string, xOffset: number, yOffset: number): string | null {
    const match = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
    if (!match) return null;
    
    const [, xDir, xNum, yDir, yNum] = match;
    
    let x = parseInt(xNum);
    let y = parseInt(yNum);
    
    if (xDir === 'W') x = -x;
    if (yDir === 'S') y = -y;
    
    x += xOffset;
    y += yOffset;
    
    const newXDir = x >= 0 ? 'E' : 'W';
    const newYDir = y >= 0 ? 'N' : 'S';
    
    return `${newXDir}${Math.abs(x)}${newYDir}${Math.abs(y)}`;
  }
  
  /**
   * Update existing targets
   */
  private updateTargets(): void {
    for (const [roomName, target] of this.targets) {
      const room = Game.rooms[roomName];
      if (room) {
        this.analyzeRoom(room);
      }
      
      // Remove stale targets (not scanned in 5000 ticks)
      if (Game.time - target.lastScanned > 5000) {
        this.targets.delete(roomName);
      }
    }
  }
  
  /**
   * Load war data from memory
   */
  private loadFromMemory(): void {
    const mem: any = Memory.rooms[this.highCharity.name];
    if (!mem.warCouncil) {
      mem.warCouncil = { targets: {}, squads: {} };
    }
    
    // Load targets
    for (const [roomName, target] of Object.entries(mem.warCouncil.targets || {})) {
      this.targets.set(roomName, target as WarTarget);
    }
    
    // Load squads
    for (const [id, squad] of Object.entries(mem.warCouncil.squads || {})) {
      this.squads.set(id, squad as AttackSquad);
    }
  }
  
  /**
   * Save war data to memory
   */
  private saveToMemory(): void {
    const mem: any = Memory.rooms[this.highCharity.name];
    if (!mem.warCouncil) {
      mem.warCouncil = {};
    }
    
    // Convert Map to object manually for ES2018 compatibility
    mem.warCouncil.targets = {};
    for (const [key, value] of this.targets) {
      mem.warCouncil.targets[key] = value;
    }
    
    mem.warCouncil.squads = {};
    for (const [key, value] of this.squads) {
      mem.warCouncil.squads[key] = value;
    }
  }
  
  /**
   * Get current war status
   */
  getStatus(): { targets: number; activeSquads: number } {
    return {
      targets: this.targets.size,
      activeSquads: this.squads.size
    };
  }
}
