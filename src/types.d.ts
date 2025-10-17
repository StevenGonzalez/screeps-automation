declare global {
  interface CreepMemory {
    role: string;
    working?: boolean;
    sourceId?: string;
    targetId?: string;
  }

  interface RoomMemory {
    spawnId?: Id<StructureSpawn>;
    lastScan?: number;
    sourceIds?: Id<Source>[];
    mineralId?: Id<Mineral>;
    containerIds?: Id<StructureContainer>[];
    lastStructurePlanTick?: number;
    towerIds?: Id<StructureTower>[];
    plannedStructures?: Record<string, string[]>;
    plannedStructuresMeta?: Record<string, { createdAt: number }>;
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
