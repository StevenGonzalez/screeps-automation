/**
 * Room Cache - Cache expensive room.find() operations per tick
 * Significantly reduces CPU usage by avoiding repeated lookups
 */

interface RoomCache {
  tick: number;
  myCreeps?: Creep[];
  mySpawns?: StructureSpawn[];
  sources?: Source[];
  minerals?: Mineral[];
  constructionSites?: ConstructionSite[];
  hostileCreeps?: Creep[];
  containers?: StructureContainer[];
  towers?: StructureTower[];
  extensions?: StructureExtension[];
  labs?: StructureLab[];
  links?: StructureLink[];
  droppedResources?: Resource[];
}

const roomCaches: { [roomName: string]: RoomCache } = {};

/**
 * Get or create cache for a room
 */
function getCache(roomName: string): RoomCache {
  if (!roomCaches[roomName] || roomCaches[roomName].tick !== Game.time) {
    roomCaches[roomName] = { tick: Game.time };
  }
  return roomCaches[roomName];
}

/**
 * Cached room.find() operations
 */
export const RoomCache = {
  myCreeps(room: Room): Creep[] {
    const cache = getCache(room.name);
    if (!cache.myCreeps) {
      cache.myCreeps = room.find(FIND_MY_CREEPS);
    }
    return cache.myCreeps;
  },

  mySpawns(room: Room): StructureSpawn[] {
    const cache = getCache(room.name);
    if (!cache.mySpawns) {
      cache.mySpawns = room.find(FIND_MY_SPAWNS);
    }
    return cache.mySpawns;
  },

  sources(room: Room): Source[] {
    const cache = getCache(room.name);
    if (!cache.sources) {
      cache.sources = room.find(FIND_SOURCES);
    }
    return cache.sources;
  },

  minerals(room: Room): Mineral[] {
    const cache = getCache(room.name);
    if (!cache.minerals) {
      cache.minerals = room.find(FIND_MINERALS);
    }
    return cache.minerals;
  },

  constructionSites(room: Room): ConstructionSite[] {
    const cache = getCache(room.name);
    if (!cache.constructionSites) {
      cache.constructionSites = room.find(FIND_CONSTRUCTION_SITES);
    }
    return cache.constructionSites;
  },

  hostileCreeps(room: Room): Creep[] {
    const cache = getCache(room.name);
    if (!cache.hostileCreeps) {
      cache.hostileCreeps = room.find(FIND_HOSTILE_CREEPS);
    }
    return cache.hostileCreeps;
  },

  containers(room: Room): StructureContainer[] {
    const cache = getCache(room.name);
    if (!cache.containers) {
      cache.containers = room.find(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      }) as StructureContainer[];
    }
    return cache.containers;
  },

  towers(room: Room): StructureTower[] {
    const cache = getCache(room.name);
    if (!cache.towers) {
      cache.towers = room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_TOWER,
      }) as StructureTower[];
    }
    return cache.towers;
  },

  extensions(room: Room): StructureExtension[] {
    const cache = getCache(room.name);
    if (!cache.extensions) {
      cache.extensions = room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_EXTENSION,
      }) as StructureExtension[];
    }
    return cache.extensions;
  },

  labs(room: Room): StructureLab[] {
    const cache = getCache(room.name);
    if (!cache.labs) {
      cache.labs = room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_LAB,
      }) as StructureLab[];
    }
    return cache.labs;
  },

  links(room: Room): StructureLink[] {
    const cache = getCache(room.name);
    if (!cache.links) {
      cache.links = room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_LINK,
      }) as StructureLink[];
    }
    return cache.links;
  },

  droppedResources(room: Room): Resource[] {
    const cache = getCache(room.name);
    if (!cache.droppedResources) {
      cache.droppedResources = room.find(FIND_DROPPED_RESOURCES);
    }
    return cache.droppedResources;
  },
};
