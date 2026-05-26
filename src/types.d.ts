declare global {
  interface RemoteSourceData {
    sourceId: Id<Source>;
    containerId?: Id<StructureContainer>;
  }

  interface RemoteRoomData {
    roomName: string;
    sources: RemoteSourceData[];
    lastSeen: number;
    hostile: boolean;
    hostileUntil?: number;
  }

  interface CreepMemory {
    role: string;
    working?: boolean;
    room?: string;
    sourceId?: string;
    targetId?: string;
    assignedSourceId?: Id<Source>;
    assignedContainerId?: Id<StructureContainer>;
    // Remote harvesting
    homeRoom?: string;
    targetRoom?: string;
    remoteSourceId?: Id<Source>;
    // Per-creep target caches to avoid repeated findClosestByPath
    fillTargetId?: string;
    constructionSiteId?: Id<ConstructionSite>;
    energySourceId?: Id<AnyStoreStructure>;
  }

  interface RoomMemory {
    spawnId?: Id<StructureSpawn>;
    lastScan?: number;
    lastSigned?: number;
    sourceIds?: Id<Source>[];
    mineralId?: Id<Mineral>;
    containerIds?: Id<StructureContainer>[];
    minerContainerIds?: Id<StructureContainer>[];
    mineralContainerId?: Id<StructureContainer>;
    terminalId?: Id<StructureTerminal>;
    extractorId?: Id<StructureExtractor>;
    lastStructurePlanTick?: number;
    towerIds?: Id<StructureTower>[];
    linkIds?: Id<StructureLink>[];
    plannedStructures?: Record<string, string[]>;
    plannedStructuresMeta?: Record<string, { createdAt: number }>;
    upgradeContainerId?: Id<StructureContainer>;
    storagePositions?: string[];
    // Remote harvesting
    pendingScoutRooms?: string[];
    remoteRooms?: RemoteRoomData[];
    // Castle stamp planner
    castleAnchor?: { x: number; y: number };
    lastRcl?: number;
    // Cached controller link IDs (refreshed every ~200 ticks)
    controllerLinkIds?: Id<StructureLink>[];
    controllerLinkScanTick?: number;
  }

  interface Memory {
    initialized?: boolean;
    uuid: number;
    log: any;
    creeps: Record<string, CreepMemory>;
    rooms: Record<string, RoomMemory>;
    threatNotifyLastTick?: Record<string, number>;
    sources?: Record<string, Id<Source>[]>;
    sourcesLastScan?: Record<string, number>;
  }

  var _: _.LoDashStatic;
}

export {};
