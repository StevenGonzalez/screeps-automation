/**
 * NEXUS - Colony Manager
 * 
 * "My life for Aiur!"
 * 
 * The Nexus represents a controlled room and all its operations.
 * Each Nexus coordinates its Arbiters, Gateways, and Warriors to achieve
 * the goals set by the Khala.
 */

/// <reference types="@types/screeps" />

// Forward declaration to avoid circular dependency
import type { Khala } from './Khala';
import { Arbiter } from '../arbiters/Arbiter';
import { ProbeArbiter } from '../arbiters/ProbeArbiter';
import { ZealotArbiter } from '../arbiters/ZealotArbiter';
import { AdeptArbiter } from '../arbiters/AdeptArbiter';
import { SentryArbiter } from '../arbiters/SentryArbiter';
import { EngineerArbiter } from '../arbiters/EngineerArbiter';
import { ZealotArbiter } from '../arbiters/ZealotArbiter';
import { ObserverArbiter } from '../arbiters/ObserverArbiter';
import { DragoonArbiter } from '../arbiters/DragoonArbiter';
import { RemoteDefenderArbiter } from '../arbiters/RemoteDefenderArbiter';
import { StalkerArbiter } from '../arbiters/StalkerArbiter';
import { ExcavatorArbiter } from '../arbiters/ExcavatorArbiter';
import { TerminalArbiter } from '../arbiters/TerminalArbiter';
import { ObserverArbiter } from '../arbiters/ObserverArbiter';
import { ImmortalArbiter } from '../arbiters/ImmortalArbiter';
import { PioneerArbiter } from '../expansion/PioneerArbiter';
import { Gateway } from '../structures/Gateway';
import { MiningGateway } from '../structures/MiningGateway';
import { CommandGateway } from '../structures/CommandGateway';
import { IntelligenceGateway } from '../structures/IntelligenceGateway';
import { DefenseGateway } from '../structures/DefenseGateway';
import { ForgeGateway } from '../structures/ForgeGateway';
import { BoostGateway } from '../structures/BoostGateway';
import { PowerGateway } from '../structures/PowerGateway';
import { LinkGateway } from '../structures/LinkGateway';
import { PylonNetwork } from '../logistics/PylonNetwork';
import { RoomPlanner } from '../planning/RoomPlanner';
import { AutoPlanner } from '../planning/AutoPlanner';
import { RoadBuilder } from '../planning/RoadBuilder';
import { ProtossVisuals } from '../visuals/ProtossVisuals';
import { Profiler, TickBudget } from '../utils/Profiler';
import { CacheSystem, StructureCache } from '../utils/CacheSystem';
import { WarCouncil } from '../military/WarCouncil';
import { SafeModeManager } from '../defense/SafeModeManager';
import { MarketManager } from '../market/MarketManager';
import { TerminalNetwork } from '../market/TerminalNetwork';
import { RemoteOperations } from '../operations/RemoteOperations';
import { DepositOperations } from '../operations/DepositOperations';
import { DepositHarvesterArbiter } from '../arbiters/DepositHarvesterArbiter';
import { SPAWN_NAMES } from '../utils/SpawnNames';
import { PowerManager } from '../power/PowerManager';
import { PowerCreepManager } from '../power/PowerCreepManager';
import { BoostManager } from '../boost/BoostManager';
import { FactoryManager } from '../factory/FactoryManager';
import { SpawnQueue } from '../spawning/SpawnQueue';

export interface NexusMemory {
  level: number;
  phase: 'bootstrap' | 'developing' | 'mature' | 'powerhouse';
  lastBuilt: number;
  statistics: {
    energyIncome: number;
    energySpent: number;
    creepCount: number;
  };
  remote?: any; // Remote operations memory
  deposits?: any; // Deposit operations memory
  powerProcessing?: {
    totalOpsGenerated: number;
    totalPowerConsumed: number;
    processingTicks: number;
    efficiency: number;
  };
  factory?: {
    totalProduced: number;
    productionsByType: { [commodity: string]: number };
    totalCooldown: number;
    lastProduction: number;
  };
  spawnQueue?: {
    queue: any[];
    spawnedThisTick: number;
    totalSpawned: number;
    statistics: any;
  };
  autoPlanner?: {
    lastRCL: number;
    trafficMap: { [key: string]: number };
    lastTrafficUpdate: number;
    defensePlanned: boolean;
    roadPlannedAt: number;
  };
  powerCreeps?: {
    totalOpsGenerated: number;
    totalAbilitiesUsed: number;
  };
}

/**
 * Nexus - The colony manager for a single room
 */
export class Nexus {
  room: Room;
  name: string;
  memory: NexusMemory;
  khala: Khala;
  
  // Core references
  controller: StructureController | undefined;
  spawns: StructureSpawn[];
  extensions: StructureExtension[];
  towers: StructureTower[];
  storage: StructureStorage | undefined;
  terminal: StructureTerminal | undefined;
  links: StructureLink[];
  
  // Creeps
  warriors: Creep[];
  
  // Arbiters
  arbiters: { [name: string]: Arbiter };
  
  // gateways (structure clusters)
  gateways: { [name: string]: Gateway };
  miningGateways: MiningGateway[];
  commandGateway: CommandGateway | null;
  intelligenceGateway: IntelligenceGateway;
  defenseGateway: DefenseGateway;
  forgeGateway: ForgeGateway | null;
  boostGateway: BoostGateway | null;
  powerGateway: PowerGateway | null;
  linkGateway: LinkGateway | null;
  
  // Logistics
  pylonNetwork: PylonNetwork;
  
  // Planning
  planner: RoomPlanner;
  autoPlanner: AutoPlanner;
  roadBuilder: RoadBuilder;
  
  // Military
  warCouncil: WarCouncil;
  safeModeManager: SafeModeManager;
  
  // Economy
  marketManager: MarketManager;
  terminalNetwork: TerminalNetwork;
  remoteOperations: RemoteOperations;
  depositOperations: DepositOperations;
  
  // Power
  powerManager: PowerManager;
  powerCreepManager: PowerCreepManager;
  
  // Factory
  factoryManager: FactoryManager;
  
  // Boost
  boostManager: BoostManager;
  
  // Spawning
  spawnQueue: SpawnQueue;
  
  // Visuals
  visuals: ProtossVisuals;
  
  // Level
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  
  constructor(room: Room, khala: Khala) {
    this.room = room;
    this.name = room.name;
    this.khala = KHALA;
    this.controller = room.controller;
    this.spawns = [];
    this.extensions = [];
    this.towers = [];
    this.links = [];
    this.warriors = [];
    this.arbiters = {};
    this.gateways = {};
    this.miningGateways = [];
    this.commandGateway = null;
    this.forgeGateway = null;
    this.boostGateway = null;
    this.powerGateway = null;
    
    // Initialize memory FIRST before any gateways
    if (!Memory.rooms[this.name]) {
      Memory.rooms[this.name] = {} as any;
    }
    this.memory = Memory.rooms[this.name] as any;
    
    if (!this.memory.level) {
      this.memory.level = room.controller?.level || 1;
    }
    if (!this.memory.phase) {
      this.memory.phase = 'bootstrap';
    }
    if (!this.memory.statistics) {
      this.memory.statistics = {
        energyIncome: 0,
        energySpent: 0,
        creepCount: 0
      };
    }
    
    // Initialize logistics network AFTER memory is set up
    this.pylonNetwork = new PylonNetwork(this);
    
    // Initialize gateways AFTER memory is set up
    this.intelligenceGateway = new IntelligenceGateway(this);
    this.defenseGateway = new DefenseGateway(this);
    
    // Initialize lab Gateway if we have labs (RCL 6+)
    if (this.room.controller && this.room.controller.level >= 6) {
      this.forgeGateway = new ForgeGateway(this);
      this.boostGateway = new BoostGateway(this);
    }
    
    // Initialize power Gateway at RCL 8
    if (this.room.controller && this.room.controller.level >= 8) {
      this.powerGateway = new PowerGateway(this);
    }
    
    // Defer LinkGateway initialization until build() where structures are refreshed
    this.linkGateway = null;
    
    // Initialize room planner
    this.planner = new RoomPlanner(room);
    
    // Initialize auto planner
    this.autoPlanner = new AutoPlanner(room, this.planner);
    
    // Initialize road builder
    this.roadBuilder = new RoadBuilder(room);
    
    // Initialize war council (only at powerhouse phase)
    this.warCouncil = new WarCouncil(this);
    
    // Initialize safe mode manager
    this.safeModeManager = new SafeModeManager(this);
    
    // Initialize market manager
    this.marketManager = new MarketManager(this);
    
    // Initialize terminal network
    this.terminalNetwork = new TerminalNetwork();
    
    // Initialize remote operations
    this.remoteOperations = new RemoteOperations(this);
    
    // Initialize deposit operations
    this.depositOperations = new DepositOperations(this);
    
    // Initialize power manager
    this.powerManager = new PowerManager(this);
    
    // Initialize power creep manager
    this.powerCreepManager = new PowerCreepManager(this);
    
    // Initialize factory manager
    this.factoryManager = new FactoryManager(this);
    
    // Initialize boost manager
    this.boostManager = new BoostManager(this);
    
    // Initialize spawn queue
    this.spawnQueue = new SpawnQueue(this);
    
    // Initialize visuals
    this.visuals = new ProtossVisuals(this);
    
    this.level = (room.controller?.level || 1) as any;
  }
  
  /**
   * Build phase - gather references and create structures
   */
  build(): void {
    Profiler.start(`Nexus_${this.name}_build`);
    
    // Rename spawns to KHALA theme (once per 500 ticks)
    if (Game.time % 500 === 0) {
      this.renameSpawns();
    }
    
    // Gather structure references
    this.refreshStructures();
    
    // Gather creep references
    this.refreshCreeps();
    
    // Determine operational phase
    this.determinePhase();
    
    // Build gateways (structure clusters)
    this.buildgateways();
    
    // Build Arbiters
    this.buildArbiters();
    
    this.memory.lastBuilt = Game.time;
    
    Profiler.end(`Nexus_${this.name}_build`);
  }
  
  /**
   * Initialize phase - prepare for execution
   */
  init(): void {
    Profiler.start(`Nexus_${this.name}_init`);
    
    // Initialize all gateways
    for (const GatewayName in this.gateways) {
      Profiler.wrap(`Gateway_${GatewayName}_init`, () => {
        this.gateways[GatewayName].init();
      });
    }
    
    // Initialize logistics network
    Profiler.wrap(`PylonNetwork_init`, () => {
      this.pylonNetwork.init();
    });
    
    // Initialize all Arbiters
    for (const arbiterName in this.arbiters) {
      Profiler.wrap(`Arbiter_${arbiterName}_init`, () => {
        this.arbiters[arbiterName].init();
      });
    }
    
    // Initialize war council
    if (this.memory.phase === 'powerhouse') {
      Profiler.wrap('WarCouncil_init', () => {
        this.warCouncil.init();
      });
    }
    
    // Debug output every 50 ticks
    if (Game.time % 50 === 0) {
      const totalCreeps = this.warriors.length;
      const arbiterCount = Object.keys(this.arbiters).length;
      const spawnStatus = this.primarySpawn ? 
        (this.primarySpawn.spawning ? `🔄 Spawning ${this.primarySpawn.spawning.name}` : '✅ Idle') : 
        '❌ No spawn';
      const warStatus = this.memory.phase === 'powerhouse' ? 
        ` | War: ${this.warCouncil.getStatus().targets} targets, ${this.warCouncil.getStatus().activeSquads} squads` : '';
      console.log(`📜 ${this.print}: RCL${this.level} ${this.memory.phase} | ${totalCreeps} creeps | ${arbiterCount} arbiters | ${spawnStatus} | Energy: ${this.energyAvailable}/${this.energyCapacity}${warStatus}`);
    }
    
    Profiler.end(`Nexus_${this.name}_init`);
  }
  
  /**
   * Run phase - execute operations
   */
  run(): void {
    Profiler.start(`Nexus_${this.name}_run`);
    
    // DEBUG: Energy investigation
    const totalCreeps = this.room.find(FIND_MY_CREEPS).length;
    if (totalCreeps === 0 || Game.time % 10 === 0) {
      const spawns = this.room.find(FIND_MY_SPAWNS);
      const extensions = this.room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_EXTENSION
      }) as StructureExtension[];
      const spawnEnergy = spawns.reduce((sum, s) => sum + s.store[RESOURCE_ENERGY], 0);
      const extensionEnergy = extensions.reduce((sum, e) => sum + e.store[RESOURCE_ENERGY], 0);
      console.log(`🔍 [${this.name}] Energy Debug - Creeps: ${totalCreeps}`);
      console.log(`   room.energyAvailable: ${this.room.energyAvailable}, room.energyCapacityAvailable: ${this.room.energyCapacityAvailable}`);
      console.log(`   Spawns: ${spawns.length} (${spawnEnergy} energy), Extensions: ${extensions.length} (${extensionEnergy} energy)`);
      console.log(`   Total actual: ${spawnEnergy + extensionEnergy}`);
    }
    
    // Process spawn queue first (critical for colony function)
    Profiler.wrap('SpawnQueue_run', () => {
      this.spawnQueue.run();
    });
    
    // Run auto planner (construction automation)
    Profiler.wrap('AutoPlanner_run', () => {
      this.autoPlanner.run();
    });
    
    // Run all gateways
    for (const GatewayName in this.gateways) {
      Profiler.wrap(`Gateway_${GatewayName}_run`, () => {
        this.gateways[GatewayName].run();
      });
    }
    
    // Run logistics network
    Profiler.wrap(`PylonNetwork_run`, () => {
      this.pylonNetwork.run();
    });
    
    // Run all Arbiters (with CPU budget awareness)
    for (const arbiterName in this.arbiters) {
      // Skip expensive arbiters if over budget
      if (TickBudget.shouldSkipExpensive(0.85)) {
        continue;
      }
      
      Profiler.wrap(`Arbiter_${arbiterName}_run`, () => {
        this.arbiters[arbiterName].run();
      });
    }
    
    // Run war council (skip if over budget)
    if (this.memory.phase === 'powerhouse' && !TickBudget.shouldSkipExpensive(0.9)) {
      Profiler.wrap('WarCouncil_run', () => {
        this.warCouncil.run();
      });
    }
    
    // Assess threats and manage safe mode
    if (!TickBudget.shouldSkipExpensive(0.85)) {
      Profiler.wrap('SafeModeManager_assess', () => {
        this.safeModeManager.assess();
      });
    }
    
    // Run market operations (mature+ colonies with terminal)
    if ((this.memory.phase === 'mature' || this.memory.phase === 'powerhouse') && 
        this.terminal && !TickBudget.shouldSkipExpensive(0.9)) {
      Profiler.wrap('MarketManager_run', () => {
        this.marketManager.run();
      });
      
      // Run terminal network (resource distribution across empire)
      Profiler.wrap('TerminalNetwork_run', () => {
        this.terminalNetwork.run();
      });
    }
    
    // Run remote operations (mature+ colonies)
    if ((this.memory.phase === 'mature' || this.memory.phase === 'powerhouse') && 
        !TickBudget.shouldSkipExpensive(0.85)) {
      Profiler.wrap('RemoteOperations_run', () => {
        this.remoteOperations.run();
      });
    }
    
    // Run deposit operations (powerhouse colonies)
    if (this.memory.phase === 'powerhouse' && !TickBudget.shouldSkipExpensive(0.85)) {
      Profiler.wrap('DepositOperations_run', () => {
        this.depositOperations.run();
      });
    }
    
    // Run power processing (RCL 8 colonies)
    if (this.level === 8 && !TickBudget.shouldSkipExpensive(0.85)) {
      Profiler.wrap('PowerManager_run', () => {
        this.powerManager.run();
      });
      
      // Run power creep operations
      Profiler.wrap('PowerCreepManager_run', () => {
        this.powerCreepManager.run();
      });
    }
    
    // Run factory production (RCL 7+ colonies)
    if (this.level >= 7 && !TickBudget.shouldSkipExpensive(0.85)) {
      Profiler.wrap('FactoryManager_run', () => {
        this.factoryManager.run();
      });
    }
    
    // Run boost manager (RCL 6+ with labs)
    if (this.level >= 6 && this.forgeGateway && !TickBudget.shouldSkipExpensive(0.85)) {
      Profiler.wrap('BoostManager_run', () => {
        this.boostManager.run();
      });
    }
    
    // Automatic road building (skip if over budget)
    if (!TickBudget.shouldSkipExpensive(0.9)) {
      this.roadBuilder.recordTraffic();
      
      // Build critical roads immediately at RCL 3
      if (this.level === 3 && Game.time % 500 === 0) {
        this.roadBuilder.buildCriticalRoads();
      }
      
      // Build traffic-based roads at mature colonies
      if (this.memory.phase === 'mature' || this.memory.phase === 'powerhouse') {
        this.roadBuilder.buildRoads();
      }
    }
    
    // Draw visuals (skip if over budget)
    if (Game.time % 5 === 0 && !TickBudget.shouldSkipExpensive(0.95)) {
      this.visuals.drawHUD();
    }
    
    // Update statistics
    this.updateStatistics();
    
    Profiler.end(`Nexus_${this.name}_run`);
  }
  
  /**
   * Refresh structure references (cached)
   */
  private refreshStructures(): void {
    // Use cached structure lookups (TTL: 10 ticks)
    this.spawns = StructureCache.getMyStructures<StructureSpawn>(
      this.room, STRUCTURE_SPAWN, 10
    );
    this.extensions = StructureCache.getMyStructures<StructureExtension>(
      this.room, STRUCTURE_EXTENSION, 10
    );
    this.towers = StructureCache.getMyStructures<StructureTower>(
      this.room, STRUCTURE_TOWER, 10
    );
    this.links = StructureCache.getMyStructures<StructureLink>(
      this.room, STRUCTURE_LINK, 10
    );
    
    this.storage = this.room.storage;
    this.terminal = this.room.terminal;
  }
  
  /**
   * Refresh creep references
   */
  private refreshCreeps(): void {
    this.warriors = this.room.find(FIND_MY_CREEPS);
  }
  
  /**
   * Determine the operational phase of this Nexus
   */
  private determinePhase(): void {
    const level = this.level;
    const energyCapacity = this.room.energyCapacityAvailable;
    const hasStorage = !!this.storage;
    
    if (level < 3 || energyCapacity < 550) {
      this.memory.phase = 'bootstrap';
    } else if (level < 6 || !hasStorage) {
      this.memory.phase = 'developing';
    } else if (level < 8) {
      this.memory.phase = 'mature';
    } else {
      this.memory.phase = 'powerhouse';
    }
  }
  
  /**
   * Build gateways for this Nexus
   */
  protected buildgateways(): void {
    // Build Mining gateways for each source
    const sources = this.room.find(FIND_SOURCES);
    this.miningGateways = [];
    
    for (const source of sources) {
      const Gateway = new MiningGateway(this, source);
      this.gateways[`mining_${source.id}`] = Gateway;
      this.miningGateways.push(Gateway);
    }
    
    // Build Command Gateway (core colony management)
    this.commandGateway = new CommandGateway(this);
    this.gateways['command'] = this.commandGateway;
    
    // Build Defense Gateway (fortifications)
    this.gateways['defense'] = this.defenseGateway;
    
    // Build Lab Gateway (reactions) if available
    if (this.forgeGateway) {
      this.gateways['lab'] = this.forgeGateway;
    }
    
    // Build Boost Gateway (creep enhancement) if available
    if (this.boostGateway) {
      this.gateways['boost'] = this.boostGateway;
    }
    
    // Build Power Gateway (power harvesting) if available
    if (this.powerGateway) {
      this.gateways['power'] = this.powerGateway;
    }
    
    // Build Link Gateway (energy conduits) if available
    // Initialize LinkGateway now that structures have been refreshed (RCL 5+ and at least 2 links)
    if (this.room.controller && this.room.controller.level >= 5 && this.links.length >= 2) {
      if (!this.linkGateway) {
        this.linkGateway = new LinkGateway(this);
      }
      this.gateways['link'] = this.linkGateway;
    }
    
    // Scan for remote mining opportunities (mature colonies only)
    if (this.memory.phase === 'mature' || this.memory.phase === 'powerhouse') {
      this.intelligenceGateway.scan();
    }
  }
  
  /**
   * Build Arbiters for this Nexus
   */
  protected buildArbiters(): void {
    // Build Grunt Arbiter FIRST (early game energy collection)
    // This is critical for bootstrap - grunts directly collect and deliver energy
    new ZealotArbiter(this);
    
    // Build Drone Arbiters for each source (static miners on containers)
    const sources = this.room.find(FIND_SOURCES);
    for (const source of sources) {
      new ProbeArbiter(this, source);
    }
    
    // Build core Arbiters
    new AdeptArbiter(this);  // Energy logistics (haulers)
    new SentryArbiter(this);  // Controller upgrading
    new EngineerArbiter(this); // Construction and repair
    new ZealotArbiter(this); // Military defense
    new StalkerArbiter(this); // Fortification maintenance (RCL 5+)
    
    // Build Excavator Arbiter (RCL 6+)
    if (this.room.controller && this.room.controller.level >= 6) {
      const minerals = this.room.find(FIND_MINERALS);
      if (minerals.length > 0) {
        new ExcavatorArbiter(this, minerals[0]);
      }
      
      // Build Terminal Arbiter if we have a terminal
      if (this.terminal) {
        new TerminalArbiter(this);
      }
    }
    
    // Build Remote Mining Arbiters (mature+ colonies only)
    if (this.memory.phase === 'mature' || this.memory.phase === 'powerhouse') {
      // Build Ranger Arbiter for room vision
      new DragoonArbiter(this);
      
      this.buildObserverArbiters();
      
      // Build Deposit Harvester Arbiters (powerhouse colonies)
      if (this.memory.phase === 'powerhouse') {
        this.buildDepositHarvesterArbiters();
      }
      
      // Build Pioneer Arbiters for expansion
      this.buildPioneerArbiters();
      
      // Build Herald Arbiters for expansion (powerhouse colonies only)
      if (this.memory.phase === 'powerhouse' && this.level === 8) {
        this.buildObserverArbiters();
      }
      
      // Build Power Harvester Arbiter (powerhouse colonies with power Gateway)
      if (this.memory.phase === 'powerhouse' && this.powerGateway) {
        new ImmortalArbiter(this);
      }
    }
  }
  
  /**
   * Build Seeker Arbiters for profitable nearby sources
   */
  private buildObserverArbiters(): void {
    // Use RemoteOperations to get active remote rooms
    const activeRooms = this.remoteOperations.getActiveRemoteRooms();
    
    for (const room of activeRooms) {
      for (const sourceId of room.sourceIds) {
        const arbiterName = `remoteMining_${room.roomName}_${sourceId}`;
        
        // Don't create duplicate arbiters
        if (this.arbiters[arbiterName]) continue;
        
        new ObserverArbiter(this, room.roomName, sourceId);
      }
      
      // Build RemoteDefenderArbiter for this room
      const defenderName = `remoteDefender_${room.roomName}`;
      if (!this.arbiters[defenderName]) {
        new RemoteDefenderArbiter(this, room.roomName);
      }
    }
  }
  
  /**
   * Build Herald Arbiters for expansion targets
   */
  private buildObserverArbiters(): void {
    const targets = this.intelligenceGateway.getExpansionTargets();
    
    // Limit to 1 active expansion at a time
    for (const target of targets.slice(0, 1)) {
      const arbiterName = `claimer_${target.roomName}`;
      
      // Don't create duplicate arbiters
      if (this.arbiters[arbiterName]) continue;
      
      // Only expand if we have spare capacity (>50% storage, >100k energy)
      if (this.storage && this.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 100000) {
        console.log(`[Nexus ${this.room.name}] 🎯 The Hierarchs have decreed expansion to ${target.roomName}!`);
        new ObserverArbiter(this, target.roomName);
      }
    }
  }
  
  /**
   * Build Deposit Harvester Arbiters for active deposits
   */
  private buildDepositHarvesterArbiters(): void {
    const activeDeposits = this.depositOperations.getActiveDeposits();
    
    for (const deposit of activeDeposits) {
      const arbiterName = `depositHarvester_${deposit.depositId}`;
      
      // Don't create duplicate arbiters
      if (this.arbiters[arbiterName]) continue;
      
      new DepositHarvesterArbiter(this, deposit.depositId, deposit.roomName, deposit.depositType);
    }
  }
  
  /**
   * Build Pioneer Arbiters for active expansions
   */
  private buildPioneerArbiters(): void {
    const expansionTarget = this.khala.reclaimationCouncil.getStatus();
    
    // Only spawn pioneers if there's an active expansion
    if (!expansionTarget) return;
    
    // Only the nearest colony spawns pioneers
    if (expansionTarget.claimingFrom !== this.room.name) return;
    
    // Create pioneer arbiter for this expansion
    const arbiterName = `pioneer_${expansionTarget.roomName}`;
    if (this.arbiters[arbiterName]) return; // Already exists
    
    new PioneerArbiter(this, expansionTarget.roomName);
  }
  
  /**
   * Update statistics for this Nexus
   */
  private updateStatistics(): void {
    this.memory.statistics.creepCount = this.warriors.length;
  }
  
  /**
   * Get the primary spawn for this Nexus
   */
  get primarySpawn(): StructureSpawn | undefined {
    return this.spawns[0];
  }
  
  /**
   * Check if this Nexus is in bootstrap mode
   */
  get isBootstrapping(): boolean {
    return this.memory.phase === 'bootstrap';
  }
  
  /**
   * Get available energy for spawning
   */
  get energyAvailable(): number {
    // CRITICAL FIX: room.energyAvailable is unreliable and often reports incorrect values
    // Manually calculate actual energy in spawns + extensions
    const spawns = this.room.find(FIND_MY_SPAWNS);
    const extensions = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_EXTENSION
    }) as StructureExtension[];
    
    const spawnEnergy = spawns.reduce((sum, s) => sum + s.store[RESOURCE_ENERGY], 0);
    const extensionEnergy = extensions.reduce((sum, e) => sum + e.store[RESOURCE_ENERGY], 0);
    
    return spawnEnergy + extensionEnergy;
  }
  
  /**
   * Get total energy capacity
   */
  get energyCapacity(): number {
    // CRITICAL FIX: room.energyCapacityAvailable may be unreliable
    // Manually calculate actual capacity in spawns + extensions
    const spawns = this.room.find(FIND_MY_SPAWNS);
    const extensions = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_EXTENSION
    }) as StructureExtension[];
    
    const spawnCapacity = spawns.reduce((sum, s) => sum + s.store.getCapacity(RESOURCE_ENERGY), 0);
    const extensionCapacity = extensions.reduce((sum, e) => sum + e.store.getCapacity(RESOURCE_ENERGY), 0);
    
    return spawnCapacity + extensionCapacity;
  }
  
  /**
   * Rename spawns to KHALA-themed names
   */
  private renameSpawns(): void {
    const spawns = this.room.find(FIND_MY_SPAWNS);
    
    for (let i = 0; i < spawns.length; i++) {
      const spawn = spawns[i];
      const desiredName = SPAWN_NAMES[i] || `Sanctum-${i + 1}`;
      
      // Check if spawn already has a KHALA-themed name
      if (!SPAWN_NAMES.includes(spawn.name) && !spawn.name.startsWith('Sanctum-')) {
        // Can't directly rename, but we can inform the user
        if (Game.time % 1000 === 0) {
          console.log(`🔱 ${this.print}: Spawn '${spawn.name}' could be renamed to '${desiredName}' (destroy and rebuild to rename)`);
        }
      }
    }
  }
  
  /**
   * Print representation
   */
  get print(): string {
    return `<a href="#!/room/${Game.shard.name}/${this.name}">[Nexus ${this.name}]</a>`;
  }
}
