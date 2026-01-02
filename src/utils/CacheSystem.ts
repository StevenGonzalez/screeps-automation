/**
 * CACHE SYSTEM - High-Performance Data Caching
 * 
 * "The Prophets' wisdom is recorded and preserved"
 * 
 * Intelligent caching system to reduce CPU usage by storing
 * expensive operation results for reuse across ticks.
 */

/// <reference types="@types/screeps" />

interface CacheEntry<T> {
  data: T;
  expiration: number;
}

/**
 * Global cache system for expensive operations
 */
export class CacheSystem {
  private static cache: { [key: string]: CacheEntry<any> } = {};
  
  /**
   * Get cached data or execute function if not cached
   */
  static get<T>(
    key: string,
    ttl: number,
    getter: () => T
  ): T {
    const cached = this.cache[key];
    
    // Return cached if still valid
    if (cached && Game.time < cached.expiration) {
      return cached.data;
    }
    
    // Execute getter and cache result
    const data = getter();
    this.cache[key] = {
      data,
      expiration: Game.time + ttl
    };
    
    return data;
  }
  
  /**
   * Set cache entry manually
   */
  static set<T>(key: string, data: T, ttl: number): void {
    this.cache[key] = {
      data,
      expiration: Game.time + ttl
    };
  }
  
  /**
   * Invalidate specific cache entry
   */
  static invalidate(key: string): void {
    delete this.cache[key];
  }
  
  /**
   * Invalidate all cache entries matching pattern
   */
  static invalidatePattern(pattern: string): void {
    for (const key in this.cache) {
      if (key.includes(pattern)) {
        delete this.cache[key];
      }
    }
  }
  
  /**
   * Clear all expired entries
   */
  static cleanExpired(): void {
    for (const key in this.cache) {
      if (Game.time >= this.cache[key].expiration) {
        delete this.cache[key];
      }
    }
  }
  
  /**
   * Clear entire cache
   */
  static clear(): void {
    this.cache = {};
  }
  
  /**
   * Get cache statistics
   */
  static getStats(): { size: number; entries: string[] } {
    return {
      size: Object.keys(this.cache).length,
      entries: Object.keys(this.cache)
    };
  }
}

/**
 * Path caching for expensive pathfinding operations
 */
export class PathCache {
  private static paths: { [key: string]: { path: PathStep[]; tick: number } } = {};
  private static readonly MAX_AGE = 50; // Paths expire after 50 ticks
  
  /**
   * Get cached path or calculate new one
   */
  static getPath(
    from: RoomPosition,
    to: RoomPosition,
    opts?: FindPathOpts
  ): PathStep[] {
    const key = `${from.roomName}_${from.x}_${from.y}_${to.roomName}_${to.x}_${to.y}`;
    const cached = this.paths[key];
    
    // Use cache if fresh
    if (cached && Game.time - cached.tick < this.MAX_AGE) {
      return cached.path;
    }
    
    // Calculate new path
    const path = from.findPathTo(to, opts);
    this.paths[key] = { path, tick: Game.time };
    
    return path;
  }
  
  /**
   * Clear old paths to prevent memory bloat
   */
  static cleanOld(): void {
    for (const key in this.paths) {
      if (Game.time - this.paths[key].tick > this.MAX_AGE) {
        delete this.paths[key];
      }
    }
  }
  
  /**
   * Clear all paths for a room
   */
  static invalidateRoom(roomName: string): void {
    for (const key in this.paths) {
      if (key.includes(roomName)) {
        delete this.paths[key];
      }
    }
  }
}

/**
 * Structure caching for room structures
 */
export class StructureCache {
  /**
   * Get structures by type with caching
   */
  static getStructures<T extends Structure>(
    room: Room,
    structureType: StructureConstant,
    ttl: number = 10
  ): T[] {
    const key = `structures_${room.name}_${structureType}`;
    
    return CacheSystem.get(key, ttl, () => {
      return room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === structureType
      }) as unknown as T[];
    });
  }
  
  /**
   * Get my structures by type with caching
   */
  static getMyStructures<T extends Structure>(
    room: Room,
    structureType: StructureConstant,
    ttl: number = 10
  ): T[] {
    const key = `myStructures_${room.name}_${structureType}`;
    
    return CacheSystem.get(key, ttl, () => {
      return room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === structureType
      }) as unknown as T[];
    });
  }
}

/**
 * Room intelligence caching
 */
export class RoomIntelCache {
  /**
   * Cache room visibility status
   */
  static isVisible(roomName: string, ttl: number = 100): boolean {
    const key = `visible_${roomName}`;
    
    return CacheSystem.get(key, ttl, () => {
      const room = Game.rooms[roomName];
      return !!room;
    });
  }
  
  /**
   * Cache hostile count
   */
  static getHostileCount(room: Room, ttl: number = 5): number {
    const key = `hostiles_${room.name}`;
    
    return CacheSystem.get(key, ttl, () => {
      return room.find(FIND_HOSTILE_CREEPS).length;
    });
  }
  
  /**
   * Cache source positions
   */
  static getSources(room: Room, ttl: number = 1000): Source[] {
    const key = `sources_${room.name}`;
    
    return CacheSystem.get(key, ttl, () => {
      return room.find(FIND_SOURCES);
    });
  }
  
  /**
   * Cache mineral position
   */
  static getMineral(room: Room, ttl: number = 1000): Mineral | null {
    const key = `mineral_${room.name}`;
    
    return CacheSystem.get(key, ttl, () => {
      const minerals = room.find(FIND_MINERALS);
      return minerals[0] || null;
    });
  }
}
