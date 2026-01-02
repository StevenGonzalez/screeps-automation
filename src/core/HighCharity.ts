/**
 * HIGH CHARITY - Colony Manager
 * 
 * "The holy city, seat of the Hierarchs"
 * 
 * High Charity represents a controlled room and all its operations.
 * Each High Charity coordinates its Arbiters, Temples, and Elites to achieve
 * the goals set by the Covenant.
 */

/// <reference types="@types/screeps" />

import { Arbiter } from '../arbiters/Arbiter';
import { ExtractorArbiter } from '../arbiters/ExtractorArbiter';
import { StewardArbiter } from '../arbiters/StewardArbiter';
import { DevoteeArbiter } from '../arbiters/DevoteeArbiter';
import { ArtisanArbiter } from '../arbiters/ArtisanArbiter';
import { ZealotArbiter } from '../arbiters/ZealotArbiter';
import { SeekerArbiter } from '../arbiters/SeekerArbiter';
import { GuardianArbiter } from '../arbiters/GuardianArbiter';
import { ExcavatorArbiter } from '../arbiters/ExcavatorArbiter';
import { TerminalArbiter } from '../arbiters/TerminalArbiter';
import { HeraldArbiter } from '../arbiters/HeraldArbiter';
import { Temple } from '../temples/Temple';
import { MiningTemple } from '../temples/MiningTemple';
import { CommandTemple } from '../temples/CommandTemple';
import { IntelligenceTemple } from '../temples/IntelligenceTemple';
import { DefenseTemple } from '../temples/DefenseTemple';
import { LabTemple } from '../temples/LabTemple';
import { BoostTemple } from '../temples/BoostTemple';
import { ProphetsWill } from '../logistics/ProphetsWill';
import { RoomPlanner } from '../planning/RoomPlanner';
import { RoadBuilder } from '../planning/RoadBuilder';
import { CovenantVisuals } from '../visuals/CovenantVisuals';

export interface HighCharityMemory {
  level: number;
  phase: 'bootstrap' | 'developing' | 'mature' | 'powerhouse';
  lastBuilt: number;
  statistics: {
    energyIncome: number;
    energySpent: number;
    creepCount: number;
  };
}

/**
 * High Charity - The colony manager for a single room
 */
export class HighCharity {
  room: Room;
  name: string;
  memory: HighCharityMemory;
  
  // Core references
  controller: StructureController | undefined;
  spawns: StructureSpawn[];
  extensions: StructureExtension[];
  towers: StructureTower[];
  storage: StructureStorage | undefined;
  terminal: StructureTerminal | undefined;
  links: StructureLink[];
  
  // Creeps
  elites: Creep[];
  
  // Arbiters
  arbiters: { [name: string]: Arbiter };
  
  // Temples (structure clusters)
  temples: { [name: string]: Temple };
  miningTemples: MiningTemple[];
  commandTemple: CommandTemple | null;
  intelligenceTemple: IntelligenceTemple;
  defenseTemple: DefenseTemple;
  labTemple: LabTemple | null;
  boostTemple: BoostTemple | null;
  
  // Logistics
  prophetsWill: ProphetsWill;
  
  // Planning
  planner: RoomPlanner;
  roadBuilder: RoadBuilder;
  
  // Visuals
  visuals: CovenantVisuals;
  
  // Level
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  
  constructor(room: Room) {
    this.room = room;
    this.name = room.name;
    this.controller = room.controller;
    this.spawns = [];
    this.extensions = [];
    this.towers = [];
    this.links = [];
    this.elites = [];
    this.arbiters = {};
    this.temples = {};
    this.miningTemples = [];
    this.commandTemple = null;
    this.labTemple = null;
    this.boostTemple = null;
    
    // Initialize memory FIRST before any temples
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
    this.prophetsWill = new ProphetsWill(this);
    
    // Initialize temples AFTER memory is set up
    this.intelligenceTemple = new IntelligenceTemple(this);
    this.defenseTemple = new DefenseTemple(this);
    
    // Initialize lab temple if we have labs (RCL 6+)
    if (this.room.controller && this.room.controller.level >= 6) {
      this.labTemple = new LabTemple(this);
      this.boostTemple = new BoostTemple(this);
    }
    
    // Initialize room planner
    this.planner = new RoomPlanner(room);
    
    // Initialize road builder
    this.roadBuilder = new RoadBuilder(room);
    
    // Initialize visuals
    this.visuals = new CovenantVisuals(this);
    
    this.level = (room.controller?.level || 1) as any;
  }
  
  /**
   * Build phase - gather references and create structures
   */
  build(): void {
    // Gather structure references
    this.refreshStructures();
    
    // Gather creep references
    this.refreshCreeps();
    
    // Determine operational phase
    this.determinePhase();
    
    // Build Temples (structure clusters)
    this.buildTemples();
    
    // Build Arbiters
    this.buildArbiters();
    
    this.memory.lastBuilt = Game.time;
  }
  
  /**
   * Initialize phase - prepare for execution
   */
  init(): void {
    // Initialize all Temples
    for (const templeName in this.temples) {
      this.temples[templeName].init();
    }
    
    // Initialize logistics network
    this.prophetsWill.init();
    
    // Initialize all Arbiters
    for (const arbiterName in this.arbiters) {
      this.arbiters[arbiterName].init();
    }
    
    // Debug output every 50 ticks
    if (Game.time % 50 === 0) {
      const totalCreeps = this.elites.length;
      const arbiterCount = Object.keys(this.arbiters).length;
      const spawnStatus = this.primarySpawn ? 
        (this.primarySpawn.spawning ? `🔄 Spawning ${this.primarySpawn.spawning.name}` : '✅ Idle') : 
        '❌ No spawn';
      console.log(`📜 ${this.print}: RCL${this.level} ${this.memory.phase} | ${totalCreeps} creeps | ${arbiterCount} arbiters | ${spawnStatus} | Energy: ${this.energyAvailable}/${this.energyCapacity}`);
    }
  }
  
  /**
   * Run phase - execute operations
   */
  run(): void {
    // Run all Temples
    for (const templeName in this.temples) {
      this.temples[templeName].run();
    }
    
    // Run logistics network
    this.prophetsWill.run();
    
    // Run all Arbiters
    for (const arbiterName in this.arbiters) {
      this.arbiters[arbiterName].run();
    }
    
    // Automatic road building
    this.roadBuilder.recordTraffic();
    
    // Build critical roads immediately at RCL 3
    if (this.level === 3 && Game.time % 500 === 0) {
      this.roadBuilder.buildCriticalRoads();
    }
    
    // Build traffic-based roads at mature colonies
    if (this.memory.phase === 'mature' || this.memory.phase === 'powerhouse') {
      this.roadBuilder.buildRoads();
    }
    
    // Draw visuals
    if (Game.time % 5 === 0) {
      this.visuals.drawHUD();
    }
    
    // Update statistics
    this.updateStatistics();
  }
  
  /**
   * Refresh structure references
   */
  private refreshStructures(): void {
    this.spawns = this.room.find(FIND_MY_SPAWNS);
    this.extensions = this.room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_EXTENSION
    }) as StructureExtension[];
    this.towers = this.room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_TOWER
    }) as StructureTower[];
    this.links = this.room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_LINK
    }) as StructureLink[];
    
    this.storage = this.room.storage;
    this.terminal = this.room.terminal;
  }
  
  /**
   * Refresh creep references
   */
  private refreshCreeps(): void {
    this.elites = this.room.find(FIND_MY_CREEPS);
  }
  
  /**
   * Determine the operational phase of this High Charity
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
   * Build Temples for this High Charity
   */
  protected buildTemples(): void {
    // Build Mining Temples for each source
    const sources = this.room.find(FIND_SOURCES);
    this.miningTemples = [];
    
    for (const source of sources) {
      const temple = new MiningTemple(this, source);
      this.temples[`mining_${source.id}`] = temple;
      this.miningTemples.push(temple);
    }
    
    // Build Command Temple (core colony management)
    this.commandTemple = new CommandTemple(this);
    this.temples['command'] = this.commandTemple;
    
    // Build Defense Temple (fortifications)
    this.temples['defense'] = this.defenseTemple;
    
    // Build Lab Temple (reactions) if available
    if (this.labTemple) {
      this.temples['lab'] = this.labTemple;
    }
    
    // Build Boost Temple (creep enhancement) if available
    if (this.boostTemple) {
      this.temples['boost'] = this.boostTemple;
    }
    
    // Scan for remote mining opportunities (mature colonies only)
    if (this.memory.phase === 'mature' || this.memory.phase === 'powerhouse') {
      this.intelligenceTemple.scan();
    }
  }
  
  /**
   * Build Arbiters for this High Charity
   */
  protected buildArbiters(): void {
    // Build Extractor Arbiters for each source
    const sources = this.room.find(FIND_SOURCES);
    for (const source of sources) {
      new ExtractorArbiter(this, source);
    }
    
    // Build core Arbiters
    new StewardArbiter(this);  // Energy logistics
    new DevoteeArbiter(this);  // Controller upgrading
    new ArtisanArbiter(this); // Construction and repair
    new ZealotArbiter(this); // Military defense
    new GuardianArbiter(this); // Fortification maintenance (RCL 5+)
    
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
      this.buildSeekerArbiters();
      
      // Build Herald Arbiters for expansion (powerhouse colonies only)
      if (this.memory.phase === 'powerhouse' && this.level === 8) {
        this.buildHeraldArbiters();
      }
    }
  }
  
  /**
   * Build Seeker Arbiters for profitable nearby sources
   */
  private buildSeekerArbiters(): void {
    const targets = this.intelligenceTemple.getRemoteMiningTargets();
    
    // Limit to 3 remote sources maximum
    for (const target of targets.slice(0, 3)) {
      const arbiterName = `remoteMining_${target.roomName}_${target.sourceId}`;
      
      // Don't create duplicate arbiters
      if (this.arbiters[arbiterName]) continue;
      
      new SeekerArbiter(this, target.roomName, target.sourceId);
    }
  }
  
  /**
   * Build Herald Arbiters for expansion targets
   */
  private buildHeraldArbiters(): void {
    const targets = this.intelligenceTemple.getExpansionTargets();
    
    // Limit to 1 active expansion at a time
    for (const target of targets.slice(0, 1)) {
      const arbiterName = `claimer_${target.roomName}`;
      
      // Don't create duplicate arbiters
      if (this.arbiters[arbiterName]) continue;
      
      // Only expand if we have spare capacity (>50% storage, >100k energy)
      if (this.storage && this.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 100000) {
        console.log(`[HighCharity ${this.room.name}] 🎯 The Hierarchs have decreed expansion to ${target.roomName}!`);
        new HeraldArbiter(this, target.roomName);
      }
    }
  }
  
  /**
   * Update statistics for this High Charity
   */
  private updateStatistics(): void {
    this.memory.statistics.creepCount = this.elites.length;
  }
  
  /**
   * Get the primary spawn for this High Charity
   */
  get primarySpawn(): StructureSpawn | undefined {
    return this.spawns[0];
  }
  
  /**
   * Check if this High Charity is in bootstrap mode
   */
  get isBootstrapping(): boolean {
    return this.memory.phase === 'bootstrap';
  }
  
  /**
   * Get available energy for spawning
   */
  get energyAvailable(): number {
    return this.room.energyAvailable;
  }
  
  /**
   * Get total energy capacity
   */
  get energyCapacity(): number {
    return this.room.energyCapacityAvailable;
  }
  
  /**
   * Print representation
   */
  get print(): string {
    return `<a href="#!/room/${Game.shard.name}/${this.name}">[HighCharity ${this.name}]</a>`;
  }
}
