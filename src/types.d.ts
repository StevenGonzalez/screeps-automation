declare global {
  interface PendingTerminalSend {
    resource: string;
    amount: number;
    loadTarget: number;
    to: string;
    queuedAt?: number;
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
    lastProduced?: number;
    lastProgressTick?: number;
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
    crackingStartedAt?: number;
    collectingStartedAt?: number;
    collected?: boolean;
  }

  interface DepositOp {
    id: number;
    depositId?: Id<Deposit>;
    roomName: string;
    homeRoom: string;
    depositType: DepositConstant;
    phase: "mining" | "done";
    startedAt: number;
    lastCooldown: number;
    requiredMiners: number;
    requiredHaulers: number;
  }

  type SquadFormation = "line" | "box" | "wedge" | "scatter";

  type SquadTactic = "assault" | "siege" | "raid" | "defend" | "retreat";

  interface MilitaryOp {
    targetRoom: string;
    homeRoom: string;
    phase: "forming" | "rallying" | "attacking" | "retreating";
    startedAt: number;
    formation: SquadFormation;
    tactic: SquadTactic;
    requiredEnforcers: number;
    requiredTriggermen: number;
    requiredMedics: number;
    requiredWreckers: number;
    requiredDecoys?: number;
    clearedSince?: number;
    regroupSince?: number;
    retreatSince?: number;
  }

  interface DefenseOp {
    room: string;
    startedAt: number;
    lastThreatTick: number;
    threatScore: number;
    requiredEnforcers: number;
    requiredTriggermen: number;
    requiredMedics: number;
  }

  interface DrainOp {
    targetRoom: string;
    homeRoom: string;
    startedAt: number;
    drainers: number;
  }

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
    threatLevel: number;
  }

  interface WarCouncilMemory {
    autoAttack: boolean;
    lastScan?: number;
    lastAutoAttackTick?: number;
  }

  interface SourceKeeperOp {
    id: number;
    roomName: string;
    homeRoom: string;
    phase: "forming" | "active";
    startedAt: number;
    discovered: boolean;
    sourceIds: Id<Source>[];
    lastFailure?: number;
  }

  interface ExpansionData {
    roomName: string;
    homeRoom: string;
    phase: "claiming" | "bootstrapping" | "established";
    startedAt: number;
    establishedAt?: number;
    pausedUntil?: number;
    needsDefender?: boolean;
    abortReason?: string;
    bootstrapStartedAt?: number;
  }

  interface QueuedExpansion {
    roomName: string;
    homeRoom?: string;
    queuedAt: number;
  }

  interface QueuedMilitaryOp {
    targetRoom: string;
    homeRoom?: string;
    formation: SquadFormation;
    tactic: SquadTactic;
    requiredEnforcers: number;
    requiredTriggermen: number;
    requiredMedics: number;
    requiredWreckers: number;
    requiredDecoys?: number;
    queuedAt: number;
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
    hostileStrikes?: number;
    invaderUntil?: number;
  }

  interface CreepMemory {
    role: string;
    working?: boolean;
    room?: string;
    sourceId?: string;
    targetId?: string;
    assignedSourceId?: Id<Source>;
    assignedContainerId?: Id<StructureContainer>;
    homeRoom?: string;
    targetRoom?: string;
    remoteSourceId?: Id<Source>;
    _hp?: number;
    remoteBackoffUntil?: number;
    fillTargetId?: string;
    constructionSiteId?: Id<ConstructionSite>;
    energySourceId?: Id<AnyStoreStructure>;
    boostCompound?: string;
    boostQueue?: string[];
    boosted?: boolean;
    offensiveTarget?: string;
    drainRetreat?: boolean;
    defensiveTarget?: string;
    powerOpId?: number;
    depositOpId?: number;
    skOpId?: number;
    skSourceId?: Id<Source>;
    _st?: number;
    _lp?: number;
    _lpr?: string;
  }

  interface RoomMemory {
    spawnId?: Id<StructureSpawn>;
    lastScan?: number;
    lastSigned?: number;
    lastSignedIndex?: number;
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
    pendingScoutRooms?: string[];
    remoteRooms?: RemoteRoomData[];
    castleAnchor?: { x: number; y: number };
    lastRcl?: number;
    controllerLinkIds?: Id<StructureLink>[];
    controllerLinkScanTick?: number;
    lastTowerTargetId?: Id<Creep>;
    labSystem?: LabSystemMemory;
    lastMarketBuyTick?: number;
    lastGhodiumBuyTick?: number;
    lastCommoditySaleTick?: number;
    pendingSend?: PendingTerminalSend;
    observerId?: Id<StructureObserver>;
    powerSpawnId?: Id<StructurePowerSpawn>;
    observerScanQueue?: string[];
    scoreScanQueue?: string[];
    nukeDefense?: { tiles: Record<string, number>; updatedAt: number };
    nukeAlert?: { count: number; land: number };
    blockade?: {
      detectedAt: number;
      until: number;
      manual?: boolean;
      guards?: number;
    };
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
    sigRotation?: number;
    expansionQueue?: QueuedExpansion[];
    militaryOp?: MilitaryOp;
    militaryOps?: Record<string, MilitaryOp>;
    militaryQueue?: QueuedMilitaryOp[];
    defenseOps?: Record<string, DefenseOp>;
    drainOps?: Record<string, DrainOp>;
    warCouncil?: WarCouncilMemory;
    intel?: Record<string, RoomIntelData>;
    powerOps?: PowerBankOp[];
    nextPowerOpId?: number;
    depositOps?: DepositOp[];
    nextDepositOpId?: number;
    skOps?: SourceKeeperOp[];
    nextSkOpId?: number;
    trafficDisabled?: boolean;
    debugHaulers?: string;
    autoExpand?: boolean;
    empire?: EmpireMemory;
    profileRoles?: boolean;
  }

  type EmpirePosture = "EXPAND" | "TURTLE" | "WAR" | "RECOVER";

  interface EmpireMemory {
    posture: EmpirePosture;
    updatedAt: number;
    reason?: string;
    warTargetRoom?: string;
    warTargetPlayer?: string;
    roomPosture?: Record<string, EmpirePosture>;
  }

  interface PowerCreepMemory {
    homeRoom?: string;
  }

  var _: _.LoDashStatic;
}

export {};
