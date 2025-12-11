// src/utils/roomCache.ts

/**
 * Room-level cache for expensive queries.
 * Caches results for the current tick to avoid repeated room.find() calls.
 * Can save 50-100 CPU per tick by eliminating redundant searches.
 */

interface RoomCacheData {
  tick: number;
  myStructures?: Structure[];
  mySpawns?: StructureSpawn[];
  myExtensions?: StructureExtension[];
  myTowers?: StructureTower[];
  allStructures?: Structure[];
  constructionSites?: ConstructionSite[];
  myConstructionSites?: ConstructionSite[];
  sources?: Source[];
  activeSources?: Source[];
  droppedResources?: Resource[];
  hostileCreeps?: Creep[];
  myCreeps?: Creep[];
  containers?: StructureContainer[];
  damagedStructures?: Structure[];
}

const roomCaches = new Map<string, RoomCacheData>();

function getCache(roomName: string): RoomCacheData {
  let cache = roomCaches.get(roomName);
  
  // Reset cache if it's from a previous tick
  if (!cache || cache.tick !== Game.time) {
    cache = { tick: Game.time };
    roomCaches.set(roomName, cache);
  }
  
  return cache;
}

export class RoomCache {
  static getMyStructures(room: Room): Structure[] {
    const cache = getCache(room.name);
    if (!cache.myStructures) {
      cache.myStructures = room.find(FIND_MY_STRUCTURES);
    }
    return cache.myStructures;
  }

  static getMySpawns(room: Room): StructureSpawn[] {
    const cache = getCache(room.name);
    if (!cache.mySpawns) {
      cache.mySpawns = room.find(FIND_MY_SPAWNS);
    }
    return cache.mySpawns;
  }

  static getMyExtensions(room: Room): StructureExtension[] {
    const cache = getCache(room.name);
    if (!cache.myExtensions) {
      cache.myExtensions = this.getMyStructures(room).filter(
        s => s.structureType === STRUCTURE_EXTENSION
      ) as StructureExtension[];
    }
    return cache.myExtensions;
  }

  static getMyTowers(room: Room): StructureTower[] {
    const cache = getCache(room.name);
    if (!cache.myTowers) {
      cache.myTowers = this.getMyStructures(room).filter(
        s => s.structureType === STRUCTURE_TOWER
      ) as StructureTower[];
    }
    return cache.myTowers;
  }

  static getAllStructures(room: Room): Structure[] {
    const cache = getCache(room.name);
    if (!cache.allStructures) {
      cache.allStructures = room.find(FIND_STRUCTURES);
    }
    return cache.allStructures;
  }

  static getConstructionSites(room: Room): ConstructionSite[] {
    const cache = getCache(room.name);
    if (!cache.constructionSites) {
      cache.constructionSites = room.find(FIND_CONSTRUCTION_SITES);
    }
    return cache.constructionSites;
  }

  static getMyConstructionSites(room: Room): ConstructionSite[] {
    const cache = getCache(room.name);
    if (!cache.myConstructionSites) {
      cache.myConstructionSites = room.find(FIND_MY_CONSTRUCTION_SITES);
    }
    return cache.myConstructionSites;
  }

  static getSources(room: Room): Source[] {
    const cache = getCache(room.name);
    if (!cache.sources) {
      cache.sources = room.find(FIND_SOURCES);
    }
    return cache.sources;
  }

  static getActiveSources(room: Room): Source[] {
    const cache = getCache(room.name);
    if (!cache.activeSources) {
      cache.activeSources = room.find(FIND_SOURCES_ACTIVE);
    }
    return cache.activeSources;
  }

  static getDroppedResources(room: Room): Resource[] {
    const cache = getCache(room.name);
    if (!cache.droppedResources) {
      cache.droppedResources = room.find(FIND_DROPPED_RESOURCES);
    }
    return cache.droppedResources;
  }

  static getHostileCreeps(room: Room): Creep[] {
    const cache = getCache(room.name);
    if (!cache.hostileCreeps) {
      cache.hostileCreeps = room.find(FIND_HOSTILE_CREEPS);
    }
    return cache.hostileCreeps;
  }

  static getMyCreeps(room: Room): Creep[] {
    const cache = getCache(room.name);
    if (!cache.myCreeps) {
      cache.myCreeps = room.find(FIND_MY_CREEPS);
    }
    return cache.myCreeps;
  }

  static getContainers(room: Room): StructureContainer[] {
    const cache = getCache(room.name);
    if (!cache.containers) {
      cache.containers = this.getAllStructures(room).filter(
        s => s.structureType === STRUCTURE_CONTAINER
      ) as StructureContainer[];
    }
    return cache.containers;
  }

  static getDamagedStructures(room: Room, threshold: number = 1): Structure[] {
    const cache = getCache(room.name);
    const key = `damaged_${threshold}`;
    
    if (!(cache as any)[key]) {
      (cache as any)[key] = this.getAllStructures(room).filter(
        s => s.hits !== undefined && s.hitsMax !== undefined && s.hits < s.hitsMax * threshold
      );
    }
    return (cache as any)[key];
  }

  // Clean up old caches (call from main loop)
  static cleanup(): void {
    for (const [roomName, cache] of roomCaches.entries()) {
      if (cache.tick < Game.time - 1) {
        roomCaches.delete(roomName);
      }
    }
  }
}
