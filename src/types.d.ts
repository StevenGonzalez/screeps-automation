declare global {
  interface CreepMemory {
    role: string;
    working?: boolean;
    room?: string;
    sourceId?: string;
    targetId?: string;
    assignedSourceId?: Id<Source>;
    assignedContainerId?: Id<StructureContainer>;
  }

  interface RoomMemory {
    spawnId?: Id<StructureSpawn>;
    lastScan?: number;
    sourceIds?: Id<Source>[];
    mineralId?: Id<Mineral>;
    containerIds?: Id<StructureContainer>[];
    minerContainerIds?: Id<StructureContainer>[];
    mineralContainerId?: Id<StructureContainer>;
    terminalId?: Id<StructureTerminal>;
    extractorId?: Id<StructureExtractor>;
    lastStructurePlanTick?: number;
    towerIds?: Id<StructureTower>[];
    plannedStructures?: Record<string, string[]>;
    plannedStructuresMeta?: Record<string, { createdAt: number }>;
    upgradeContainerId?: Id<StructureContainer>;
    storagePositions?: string[];
  }

  interface Memory {
    initialized?: boolean;
    uuid: number;
    log: any;
    threatNotifyLastTick?: {
      [roomName: string]: number;
    };
    sources?: {
      [roomName: string]: Id<Source>[];
    };
    sourcesLastScan?: {
      [roomName: string]: number;
    };
  }

  var _: _.LoDashStatic;
}

export {};
