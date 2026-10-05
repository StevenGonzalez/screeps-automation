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
    // Queued by auto production rather than from the console.
    auto?: boolean;
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
    // The auto target the queued chain is building, and auto targets benched
    // until a tick after their chain stalled.
    plannedTarget?: string;
    benchedUntil?: Record<string, number>;
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
    requiredMelee: number;
    requiredRanged: number;
    requiredHealers: number;
    requiredSiege: number;
    requiredDrainers?: number;
    clearedSince?: number;
    regroupSince?: number;
    retreatSince?: number;
  }

  interface DefenseOp {
    room: string;
    startedAt: number;
    lastThreatTick: number;
    threatScore: number;
    requiredMelee: number;
    requiredRanged: number;
    requiredHealers: number;
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
    requiredMelee: number;
    requiredRanged: number;
    requiredHealers: number;
    requiredSiege: number;
    requiredDrainers?: number;
    queuedAt: number;
  }

  interface RemoteSourceData {
    sourceId: Id<Source>;
    containerId?: Id<StructureContainer>;
    // Path from home to this source, measured once and refreshed rarely. The
    // key is origin and target ids, so a new storage or container re-measures.
    pathLength?: number;
    pathKey?: string;
    pathTick?: number;
    // The path's tiles inside the remote room, "x,y" joined by ";".
    roadTiles?: string;
    // The last tick this home picked the source to work.
    pickedAt?: number;
  }

  interface RemoteRoomData {
    roomName: string;
    sources: RemoteSourceData[];
    lastSeen: number;
    hostile: boolean;
    hostileUntil?: number;
    hostileStrikes?: number;
    // The player whose creeps or reservation made the remote hostile, if known.
    rival?: string;
    invaderUntil?: number;
    // Last Invader force seen there (creeps plus any core), to size the defenders.
    invaderStrength?: { heal: number; damage: number; hits: number };
  }

  // A cottage by its top-left corner; the walls run round the 5x5 edge, the
  // door is one edge tile and the 3x3 inside is beds.
  interface TownCottage {
    x: number;
    y: number;
    door: string;
    name: string;
    // Placed outside the perimeter ring, so the ring is re-planned around it.
    outside?: boolean;
  }

  interface TownMemory {
    posts: string[];
    square: string[];
    fountain?: string;
    cottages: TownCottage[];
    // The perimeter plan the posts were laid against; a new ring moves them.
    perimeterAt?: number;
    failedAt?: number;
  }

  interface CreepMemory {
    role: string;
    // Foes this creep has helped strike down (services.herald).
    kills?: number;
    // Gold a merchant has brought home over its life (services.herald).
    hauled?: number;
    // Townsfolk: "militia" sleep in cottages and man the walls, "lookout"
    // stands in a neighbouring room.
    job?: "militia" | "lookout";
    lookoutPos?: string;
    // A town tile (bed, watch post, square) this creep holds, and the last tick
    // it used it; a claim goes stale a tick after the creep stops using it.
    townSpot?: string;
    townSpotTick?: number;
    working?: boolean;
    // The structure a blacksmith is mending, or none when it found nothing to
    // mend, held until repairUntil (role.repairer).
    repairId?: Id<AnyStructure>;
    repairUntil?: number;
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
    // Ticks a remote creep took to walk out to its post, or 0 when it turned
    // back on the way and the walk was not measured (services.creep noteWalk).
    walk?: number;
    // Set once a remote creep has cried out and turned for home; cleared when the remote is safe.
    fled?: boolean;
    // The remote a knight has ridden out to defend; cleared once it is safe.
    sortie?: string;
    fillTargetId?: string;
    // The container a merchant or porter is on its way to load at; ignored once it is full.
    haulFromId?: Id<StructureContainer>;
    coreRelief?: boolean;
    constructionSiteId?: Id<ConstructionSite>;
    energySourceId?: Id<AnyStoreStructure>;
    boostCompound?: string;
    boostQueue?: string[];
    boosted?: boolean;
    offensiveTarget?: string;
    drainRetreat?: boolean;
    defensiveTarget?: string;
    retreatUntil?: number;
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
    // Controller level the herald last proclaimed (services.herald).
    heraldLevel?: number;
    // Level the herald last told was near (services.herald).
    heraldStirred?: number;
    // Count of each notable structure type the herald last saw (services.herald).
    heraldWorks?: Record<string, number>;
    // Remotes whose paved road the herald has told of (services.herald).
    heraldRoads?: string[];
    // Whether the castle's mineral vein was dug dry when the herald last looked
    // (services.herald).
    heraldVeinDry?: boolean;
    // Set once a new keep's first creep of its own was proclaimed (services.herald).
    heraldBorn?: boolean;
    // That first creep's name while it lives, so its death is told (services.herald).
    firstBorn?: string;
    // Set once the herald has seen the castle's vendors on the road, whether or
    // not it told of their setting out (services.herald).
    heraldVendors?: boolean;
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
    perimeterTiles?: string[];
    lastRcl?: number;
    controllerLinkIds?: Id<StructureLink>[];
    controllerLinkScanTick?: number;
    lastTowerTargetId?: Id<Creep>;
    labSystem?: LabSystemMemory;
    nextMarketBuyTick?: number;
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
    spawnHold?: { role: string; since: number; lastTick: number };
    // Per role: tick the extensions last gained energy while it waited for a
    // full body, and the energy seen then (orchestrator.spawning.shared).
    bodyWait?: Record<string, { since: number; energy: number }>;
    town?: TownMemory;
    blueprint?: BlueprintMemory;
  }

  // The room's plan for every age (see docs/BLUEPRINT.md).
  interface BlueprintMemory {
    // Planner version; a newer planner plans the room again.
    v: number;
    // Tick the plan was made.
    at: number;
    anchor: { x: number; y: number };
    hub: { x: number; y: number };
    // Entries as "<type letter>x,y,rcl[,tag]" joined by ";".
    s: string;
    // Exit roads by side, as "x,y" joined by ";".
    exits: Partial<Record<"top" | "right" | "bottom" | "left", string>>;
    // Exit sides with remote traffic, whose roads are built and repaired.
    lanes?: Array<"top" | "right" | "bottom" | "left">;
  }

  interface Memory {
    // GCL the herald last proclaimed (services.herald).
    heraldGcl?: number;
    // Most gold any merchant has brought home in its life, and who brought it
    // (services.herald).
    richestHaul?: number;
    richestHauler?: string;
    // The creep that slew the most foes in its life (services.herald).
    greatestSlayer?: { name: string; kills: number };
    // Gold the merchants of each castle have brought home from each remote,
    // keyed "home>remote" (services.herald).
    roadGold?: Record<string, number>;
    // The warlord who raids each remote: when its last raid began, how many
    // raids it has led there, how many of its raiders have fallen and whether
    // that broke its band (services.chronicle).
    warbands?: Record<string, { name: string; at: number; raids?: number; slain?: number; broken?: boolean }>;
    // The last warband broken: its warlord, the remote it raided and the creep
    // who struck the breaking blow alone, if one did (services.herald).
    lastRout?: { band: string; room: string; slayer?: string };
    // News the realm's creeps repeat in their chatter until it goes stale
    // (services.herald).
    gossip?: { line: string; until: number };
    // Last tick whose market trades the herald has chronicled (services.herald).
    heraldTradeAt?: number;
    // Season the herald last proclaimed (services.herald).
    heraldSeason?: string;
    // Remote sources the CPU governor has set aside, latest last, and the
    // bucket at its last check (orchestrator.spawning.remote).
    remoteShed?: {
      ids: Array<{ id: string; home: string; room: string }>;
      at: number;
      bucket: number;
    };
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
    // Expansion targets whose claim timed out, keyed to the tick they may be retried.
    claimFailures?: Record<string, number>;
    militaryOp?: MilitaryOp;
    militaryOps?: Record<string, MilitaryOp>;
    militaryQueue?: QueuedMilitaryOp[];
    // Cleared rooms whose controller is still hostile, keyed by room name.
    unclaimTargets?: Record<string, UnclaimTarget>;
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
    // Auto-expansion runs unless this is false.
    autoExpand?: boolean;
    // The castle saving for the next keep in the queue, and that keep.
    expansionSavings?: { room: string; target: string };
    empire?: EmpireMemory;
    profileRoles?: boolean;
    // The castles and chronicle summed up for the realm viewer, as JSON: the
    // server streams a Memory path only as a string or a number.
    digest?: string;
  }

  /** A castle as the realm viewer shows it (see writeDigest). */
  interface CastleDigest {
    name: string;
    level: number;
    phase: string;
    // Toward the next level, 0 to 1, or null at the last.
    progress: number | null;
    // Gold in the barracks and its stores, and the most they hold.
    gold: number;
    goldCap: number;
    // Gold in the treasury and its change a tick, null without one.
    treasury: number | null;
    trend: number | null;
    // Gold a tick by where it came from and where it went (services.exchequer).
    income: Partial<Record<string, number>>;
    spend: Partial<Record<string, number>>;
    // The keep this castle is founding or saving for, if any.
    keep: string | null;
    // The castle's people by title, at home and abroad (describeCensus).
    home: string;
    abroad: string;
    townsfolk: number;
    raiders: number;
    mustering: { name: string; ticks: number } | null;
  }

  interface RealmDigest {
    time: number;
    castles: Record<string, CastleDigest>;
    // The latest entries of the Royal Chronicle, newest last.
    chronicle: Array<{ when: string; text: string }>;
  }

  interface UnclaimTarget {
    homeRoom: string;
    // Give up after this tick.
    until: number;
    // Last known tick the controller accepts another attack.
    blockedUntil?: number;
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
