declare global {
  interface CreepMemory {
    role: string;
    working?: boolean;
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
    lastStructurePlanTick?: number;
    towerIds?: Id<StructureTower>[];
    plannedStructures?: Record<string, string[]>;
    plannedStructuresMeta?: Record<string, { createdAt: number }>;
    upgraderContainerId?: Id<StructureContainer>;
    storagePositions?: string[];
  }

  interface Memory {
    uuid: number;
    log: any;
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
