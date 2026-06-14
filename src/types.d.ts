declare global {
  interface PendingTerminalSend {
    resource: string;
    amount: number;     // what the receiver gets
    loadTarget: number; // how much to pre-load in terminal (amount + fee for energy; just amount for minerals)
    to: string;         // destination room name
    queuedAt?: number;  // tick the send was first attempted; used to abandon a stuck send
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
    lastProduced?: number;      // most produced-so-far seen for the active compound
    lastProgressTick?: number;  // last tick production advanced — basis for the stall abort
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
    // Set once a carrier confirms (with vision) the bank room holds no more power, so
    // the op only completes after every dropped pile has actually been hauled.
    collected?: boolean;
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
    // Set when an auto-retreat begins; bounds how long we wait for stragglers to come home.
    retreatSince?: number;
  }

  // An automatic, threat-driven defensive operation on an OWNED room. Kept separate
  // from the manual offensive Memory.militaryOp so the two never collide: a home room
  // can host a defensive squad while an offensive op runs elsewhere. Keyed by room name
  // in Memory.defenseOps. The squad rallies and fights inside its own room only.
  interface DefenseOp {
    room: string;            // the owned room under threat (also the squad's home)
    startedAt: number;
    lastThreatTick: number;  // last tick a meaningful threat was seen; drives stand-down
    threatScore: number;     // most recent threat score (scales squad composition)
    requiredKnights: number;
    requiredWizards: number;
    requiredClerics: number;
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

  // A persistent Source Keeper mining operation against one SK room.
  interface SourceKeeperOp {
    id: number;
    roomName: string;       // the SK room being mined
    homeRoom: string;       // owned room funding/receiving the operation
    phase: "forming" | "active";
    startedAt: number;
    discovered: boolean;    // true once the room's sources have been seen
    sourceIds: Id<Source>[];
    lastFailure?: number;   // tick a guardian was lost; throttles re-commitment
  }

  interface ExpansionData {
    roomName: string;
    homeRoom: string;
    phase: "claiming" | "bootstrapping" | "established";
    startedAt: number;
    establishedAt?: number;
    pausedUntil?: number;     // bootstrap paused (child room contested) until this tick
    needsDefender?: boolean;  // home room should spawn a defender for the child room
    abortReason?: string;     // why an expansion was aborted (diagnostics)
    bootstrapStartedAt?: number; // when bootstrapping actually began (not when claiming started)
  }

  // A pending expansion target waiting in the queue. homeRoom is optional: when
  // omitted the expansion orchestrator picks the closest healthy funding room at
  // pop time (so a manually queued target doesn't commit to a home that may not be
  // healthy by the time its turn comes).
  interface QueuedExpansion {
    roomName: string;
    homeRoom?: string;
    queuedAt: number;
  }

  // A pending offensive target waiting for a free home room. Mirrors the launch
  // arguments so the queue can start an identical op when a home room frees up.
  interface QueuedMilitaryOp {
    targetRoom: string;
    homeRoom?: string;        // preferred funding room; closest capable picked if absent
    formation: SquadFormation;
    tactic: SquadTactic;
    requiredKnights: number;
    requiredWizards: number;
    requiredClerics: number;
    requiredSiegers: number;
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
    // Set by a remote miner/hauler that spots an Invader (not a player) in the room, so
    // the home raises a knight to clear it. Players set `hostile` instead and we avoid.
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
    // Military defense (auto threat response): the owned room this creep defends
    defensiveTarget?: string;
    // Power bank ops
    powerOpId?: number;
    // Source Keeper mining ops
    skOpId?: number;
    skSourceId?: Id<Source>;
    // Traffic manager: stuck counter + last position (within-room key + room name)
    _st?: number;
    _lp?: number;
    _lpr?: string;
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
    // Remote harvesting
    pendingScoutRooms?: string[];
    remoteRooms?: RemoteRoomData[];
    // Castle stamp planner
    castleAnchor?: { x: number; y: number };
    lastRcl?: number;
    // Cached controller link IDs (refreshed every ~200 ticks)
    controllerLinkIds?: Id<StructureLink>[];
    controllerLinkScanTick?: number;
    // Tower focus-fire target, persisted for hysteresis (avoid per-tick target flapping)
    lastTowerTargetId?: Id<Creep>;
    // Lab / compound production
    labSystem?: LabSystemMemory;
    lastMarketBuyTick?: number;
    // Throttle for nuker-reserve ghodium market buys (orchestrator.terminal.ts)
    lastGhodiumBuyTick?: number;
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
    // Pending expansion targets. Only ONE expansion runs at a time (Memory.expansion);
    // when it clears, the orchestrator pops the head of this queue and starts it.
    expansionQueue?: QueuedExpansion[];
    // Legacy singular offensive op. Retained ONLY for live-memory migration — the
    // orchestrator folds any existing value into Memory.militaryOps on first run.
    militaryOp?: MilitaryOp;
    // Concurrent offensive ops, keyed by funding home room (mirrors defenseOps). At
    // most one offensive op per home room; different strong rooms can each run one.
    militaryOps?: Record<string, MilitaryOp>;
    // Pending offensive targets. Auto-started against the next free home room.
    militaryQueue?: QueuedMilitaryOp[];
    // Automatic threat-driven defensive ops, keyed by the owned room under threat.
    defenseOps?: Record<string, DefenseOp>;
    warCouncil?: WarCouncilMemory;
    intel?: Record<string, RoomIntelData>;
    powerOps?: PowerBankOp[];
    nextPowerOpId?: number;
    skOps?: SourceKeeperOp[];
    nextSkOpId?: number;
    // Kill-switch for the traffic manager (set true to fall back to vanilla moveTo)
    trafficDisabled?: boolean;
    // When true, the expansion orchestrator auto-claims scouted candidates (default off)
    autoExpand?: boolean;
  }

  interface PowerCreepMemory {
    homeRoom?: string;
  }

  var _: _.LoDashStatic;
}

export {};
