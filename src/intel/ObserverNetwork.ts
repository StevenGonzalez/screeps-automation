/**
 * OBSERVER NETWORK - Intelligence Gathering System
 * 
 * "Knowledge is the path to victory"
 * 
 * Automated room scanning and intelligence gathering using observers.
 * Provides strategic intel for combat, expansion, and trade decisions.
 */

/// <reference types="@types/screeps" />

export interface RoomIntel {
  roomName: string;
  scannedAt: number;
  
  // Basic info
  owner?: string;
  level?: number;
  safeMode?: number;
  
  // Resources
  sources?: { id: string; pos: { x: number; y: number } }[];
  mineral?: { type: MineralConstant; amount: number };
  
  // Military
  hostileCreeps?: number;
  hostileTowers?: number;
  ramparts?: number;
  
  // Structures
  spawns?: number;
  extensions?: number;
  labs?: number;
  storage?: boolean;
  terminal?: boolean;
  
  // Strategic value
  score?: number; // Overall room value (0-100)
  threat?: number; // Threat level (0-10)
}

/**
 * Observer Network - Automated intelligence gathering
 */
export class ObserverNetwork {
  private observers: StructureObserver[] = [];
  private scanQueue: string[] = [];
  private currentIndex: number = 0;
  
  // Intel memory stored globally
  private get intel(): { [roomName: string]: RoomIntel } {
    if (!Memory.intel) Memory.intel = {};
    return Memory.intel as { [roomName: string]: RoomIntel };
  }
  
  constructor() {
    this.gatherObservers();
  }
  
  /**
   * Find all available observers
   */
  private gatherObservers(): void {
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      const observers = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_OBSERVER
      }) as StructureObserver[];
      
      this.observers.push(...observers);
    }
  }
  
  /**
   * Run observer network (called each tick)
   */
  run(): void {
    if (this.observers.length === 0) return;
    
    // Build scan queue if empty
    if (this.scanQueue.length === 0) {
      this.buildScanQueue();
    }
    
    // Scan with each observer
    for (const observer of this.observers) {
      if (this.scanQueue.length === 0) break;
      
      const roomName = this.scanQueue.shift()!;
      this.scanRoom(observer, roomName);
    }
  }
  
  /**
   * Build list of rooms to scan
   */
  private buildScanQueue(): void {
    const myRooms = Object.keys(Game.rooms).filter(name => Game.rooms[name].controller?.my);
    const scannedRooms = new Set<string>();
    
    // Priority 1: Rooms with flags
    for (const flagName in Game.flags) {
      const flag = Game.flags[flagName];
      if (!scannedRooms.has(flag.pos.roomName)) {
        this.scanQueue.push(flag.pos.roomName);
        scannedRooms.add(flag.pos.roomName);
      }
    }
    
    // Priority 2: Adjacent rooms to owned rooms
    for (const roomName of myRooms) {
      const adjacent = this.getAdjacentRooms(roomName);
      for (const adj of adjacent) {
        if (!scannedRooms.has(adj)) {
          this.scanQueue.push(adj);
          scannedRooms.add(adj);
        }
      }
    }
    
    // Priority 3: Rooms in scan range that haven't been scanned recently
    for (const roomName of myRooms) {
      const inRange = this.getRoomsInRange(roomName, OBSERVER_RANGE);
      for (const room of inRange) {
        if (!scannedRooms.has(room)) {
          const intel = this.intel[room];
          if (!intel || Game.time - intel.scannedAt > 1000) {
            this.scanQueue.push(room);
            scannedRooms.add(room);
          }
        }
      }
    }
  }
  
  /**
   * Scan a room and gather intel
   */
  private scanRoom(observer: StructureObserver, roomName: string): void {
    const result = observer.observeRoom(roomName);
    if (result !== OK) return;
    
    // Room might not be visible yet (takes 1 tick)
    const room = Game.rooms[roomName];
    if (!room) return;
    
    const intel: RoomIntel = {
      roomName,
      scannedAt: Game.time
    };
    
    // Controller info
    if (room.controller) {
      if (room.controller.owner) {
        intel.owner = room.controller.owner.username;
      }
      intel.level = room.controller.level;
      intel.safeMode = room.controller.safeMode;
    }
    
    // Sources
    const sources = room.find(FIND_SOURCES);
    intel.sources = sources.map(s => ({
      id: s.id,
      pos: { x: s.pos.x, y: s.pos.y }
    }));
    
    // Mineral
    const minerals = room.find(FIND_MINERALS);
    if (minerals.length > 0) {
      const mineral = minerals[0];
      intel.mineral = {
        type: mineral.mineralType,
        amount: mineral.mineralAmount
      };
    }
    
    // Hostile creeps
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    intel.hostileCreeps = hostiles.length;
    
    // Structures
    const structures = room.find(FIND_STRUCTURES);
    intel.hostileTowers = structures.filter(s => 
      s.structureType === STRUCTURE_TOWER && 
      s.my === false
    ).length;
    
    intel.ramparts = structures.filter(s => 
      s.structureType === STRUCTURE_RAMPART
    ).length;
    
    intel.spawns = structures.filter(s => 
      s.structureType === STRUCTURE_SPAWN
    ).length;
    
    intel.extensions = structures.filter(s => 
      s.structureType === STRUCTURE_EXTENSION
    ).length;
    
    intel.labs = structures.filter(s => 
      s.structureType === STRUCTURE_LAB
    ).length;
    
    intel.storage = structures.some(s => 
      s.structureType === STRUCTURE_STORAGE
    );
    
    intel.terminal = structures.some(s => 
      s.structureType === STRUCTURE_TERMINAL
    );
    
    // Calculate strategic scores
    intel.score = this.calculateRoomScore(intel);
    intel.threat = this.calculateThreatLevel(intel);
    
    // Store intel
    this.intel[roomName] = intel;
  }
  
  /**
   * Calculate room strategic value (0-100)
   */
  private calculateRoomScore(intel: RoomIntel): number {
    let score = 0;
    
    // Sources (up to 20 points)
    score += (intel.sources?.length || 0) * 10;
    
    // Mineral (10 points if present)
    if (intel.mineral) score += 10;
    
    // No owner (30 points for expansion potential)
    if (!intel.owner) score += 30;
    
    // Low level owned room (20 points for raiding)
    if (intel.owner && intel.level && intel.level < 5) {
      score += 20;
    }
    
    // Has terminal (20 points for trade)
    if (intel.terminal) score += 20;
    
    // Has storage (10 points)
    if (intel.storage) score += 10;
    
    return Math.min(100, score);
  }
  
  /**
   * Calculate threat level (0-10)
   */
  private calculateThreatLevel(intel: RoomIntel): number {
    let threat = 0;
    
    // Hostile creeps
    threat += Math.min(3, (intel.hostileCreeps || 0) / 3);
    
    // Towers
    threat += Math.min(3, (intel.hostileTowers || 0) / 2);
    
    // High level room
    if (intel.level && intel.level >= 7) threat += 2;
    
    // Safe mode (reduces threat)
    if (intel.safeMode && intel.safeMode > 0) threat -= 3;
    
    // Ramparts
    threat += Math.min(2, (intel.ramparts || 0) / 50);
    
    return Math.max(0, Math.min(10, threat));
  }
  
  /**
   * Get adjacent room names
   */
  private getAdjacentRooms(roomName: string): string[] {
    const parsed = /^([WE])([0-9]+)([NS])([0-9]+)$/.exec(roomName);
    if (!parsed) return [];
    
    const [, hor, x, ver, y] = parsed;
    const xNum = parseInt(x);
    const yNum = parseInt(y);
    
    const adjacent: string[] = [];
    
    // Adjacent rooms in all 4 directions
    const dirs = [
      [0, -1], [0, 1], [-1, 0], [1, 0]
    ];
    
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
   * Get all rooms within range
   */
  private getRoomsInRange(roomName: string, range: number): string[] {
    const parsed = /^([WE])([0-9]+)([NS])([0-9]+)$/.exec(roomName);
    if (!parsed) return [];
    
    const [, hor, x, ver, y] = parsed;
    const xNum = parseInt(x);
    const yNum = parseInt(y);
    
    const rooms: string[] = [];
    
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        if (dx === 0 && dy === 0) continue;
        
        let newX = xNum + dx;
        let newY = yNum + dy;
        let newHor = hor;
        let newVer = ver;
        
        if (hor === 'W' && dx < 0) {
          newX = Math.abs(newX);
        } else if (hor === 'E' && dx < 0) {
          if (newX < 0) {
            newHor = 'W';
            newX = Math.abs(newX + 1);
          }
        }
        
        if (ver === 'N' && dy < 0) {
          newY = Math.abs(newY);
        } else if (ver === 'S' && dy < 0) {
          if (newY < 0) {
            newVer = 'N';
            newY = Math.abs(newY + 1);
          }
        }
        
        rooms.push(`${newHor}${newX}${newVer}${newY}`);
      }
    }
    
    return rooms;
  }
  
  /**
   * Get intel for a specific room
   */
  getIntel(roomName: string): RoomIntel | null {
    return this.intel[roomName] || null;
  }
  
  /**
   * Get all intel sorted by score
   */
  getAllIntel(): RoomIntel[] {
    return Object.values(this.intel).sort((a, b) => (b.score || 0) - (a.score || 0));
  }
  
  /**
   * Get rooms with high threat
   */
  getThreats(minThreat: number = 5): RoomIntel[] {
    return Object.values(this.intel)
      .filter(i => (i.threat || 0) >= minThreat)
      .sort((a, b) => (b.threat || 0) - (a.threat || 0));
  }
  
  /**
   * Get rooms good for expansion
   */
  getExpansionCandidates(): RoomIntel[] {
    return Object.values(this.intel)
      .filter(i => !i.owner && (i.sources?.length || 0) >= 2)
      .sort((a, b) => (b.score || 0) - (a.score || 0));
  }
  
  /**
   * Clear old intel (older than 10,000 ticks)
   */
  cleanOldIntel(): void {
    for (const roomName in this.intel) {
      const intel = this.intel[roomName];
      if (Game.time - intel.scannedAt > 10000) {
        delete this.intel[roomName];
      }
    }
  }
}
