declare global {
  interface PendingTerminalSend {
    resource: string;
    amount: number;     // what the receiver gets
    loadTarget: number; // how much to pre-load in terminal (amount + fee for energy; just amount for minerals)
    to: string;         // destination room name
  }

  interface LabQueueEntry {
    compound: string;
    amount: number;
  }

  interface LabSystemMemory {
    queue: LabQueueEntry[];
    activeCompound?: string;
    inputCompounds?: [string, string];
    inputLabIds?: Id<StructureLab>[];
    outputLabIds?: Id<StructureLab>[];
    lastPlanTick?: number;
    startStock?: number;
    targetAmount?: number;
    autoEnabled?: boolean;
  }

  interface PowerBankOp {
    id: number;
    bankId?: Id<StructurePowerBank>;
    roomName: string;
    homeRoom: string;
    power: number;
    phase: "forming" | "cracking" | "collecting" | "done";
    startedAt: number;
    requiredAttackers: number;
    requiredHealers: number;
    requiredCarriers: number;
    collectingStartedAt?: number;
  }

  // Tactical squad formation: governs how members space themselves around the leader.
  type SquadFormation = "line" | "box" | "wedge" | "scatter";

  // Tactical doctrine: governs squad behavior during the attacking phase.
  type SquadTactic = "assault" | "siege" | "raid" | "defend" | "retreat";

  interface MilitaryOp {
    targetRoom: string;
    homeRoom: string;
    phase: "forming" | "rallying" | "attacking" | "retreating";
    startedAt: number;
    formation: SquadFormation;
    tactic: SquadTactic;
    requiredKnights: number;
    requiredWizards: number;
    requiredClerics: number;
    requiredSiegers: number;
    clearedSince?: number;
    // Set while the squad is split across rooms; drives the regroup watchdog.
    regroupSince?: number;
  }

  // Intelligence gathered on a non-owned room, used by the WarCouncil to rank targets.
  interface RoomIntelData {
    roomName: string;
    lastSeen: number;
    owner?: string;
    reservedBy?: string;
    rcl: number;
    towers: number;
    spawns: number;
    hostileCreeps: number;
    hostileCombatParts: number;
    hostileHealParts: number;
    safeMode?: number;
    // 0 (trivial) … 10 (fortress). Drives target ranking.
    threatLevel: number;
  }

  interface WarCouncilMemory {
    // When false (default) the council scans + ranks but never auto-launches attacks.
    autoAttack: boolean;
    lastScan?: number;
    lastAutoAttackTick?: number;
  }

  interface ExpansionData {
    roomName: string;
    homeRoom: string;
    phase: "claiming" | "bootstrapping" | "established";
    startedAt: number;
    establishedAt?: number;
  }

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
    // Lab boosting
    boostCompound?: string;
    boosted?: boolean;
    // Military offense
    offensiveTarget?: string;
    // Power bank ops
    powerOpId?: number;
  }

  interface RoomMemory {
    spawnId?: Id<StructureSpawn>;
    lastScan?: number;
    lastSigned?: number;
    townName?: string;
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
    // Lab / compound production
    labSystem?: LabSystemMemory;
    lastMarketBuyTick?: number;
    // Inter-room resource transfer
    pendingSend?: PendingTerminalSend;
    // Observer + PowerSpawn
    observerId?: Id<StructureObserver>;
    powerSpawnId?: Id<StructurePowerSpawn>;
    observerScanQueue?: string[];
    // Nuke defense: tiles ("x,y") of critical structures in a blast → required rampart HP
    nukeDefense?: { tiles: Record<string, number>; updatedAt: number };
    // Dedup state for incoming-nuke notifications
    nukeAlert?: { count: number; land: number };
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
    expansion?: ExpansionData;
    militaryOp?: MilitaryOp;
    warCouncil?: WarCouncilMemory;
    intel?: Record<string, RoomIntelData>;
    powerOps?: PowerBankOp[];
    nextPowerOpId?: number;
  }

  var _: _.LoDashStatic;
}

export {};
