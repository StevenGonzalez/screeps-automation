/**
 * COVENANT - Main AI Coordinator
 * 
 * "The will of the Prophets guides all"
 * 
 * The Covenant is the central intelligence that manages all High Charities (colonies),
 * coordinates Arbiters (overlords), and executes Crusades (directives) across the game world.
 * 
 * Inspired by Halo's Covenant - a powerful collective with distributed intelligence.
 */

/// <reference types="@types/screeps" />

import { HighCharity } from './HighCharity';
import { Arbiter } from '../arbiters/Arbiter';
import { Crusade } from '../crusades/Crusade';
import { CovenantCommands } from '../utils/CovenantCommands';
import { ObserverNetwork } from '../intel/ObserverNetwork';
import { ReclaimationCouncil } from '../expansion/ReclaimationCouncil';
import { TerminalNetwork } from '../network/TerminalNetwork';

interface CovenantMemory {
  version: string;
  lastTick: number;
  highCharities: { [roomName: string]: any };
  visualize?: { [roomName: string]: boolean }; // Toggle base plan visualization
  stats: {
    gcl: number;
    gclProgress: number;
    cpu: number;
    bucket: number;
    credits: number;
  };
}

/**
 * The Covenant - Central AI that manages everything
 */
export class Covenant {
  static instance: Covenant;
  
  memory: CovenantMemory;
  highCharities: { [roomName: string]: HighCharity };
  arbiters: { [ref: string]: Arbiter };
  crusades: { [name: string]: Crusade };
  observerNetwork: ObserverNetwork;
  reclaimationCouncil: ReclaimationCouncil;
  terminalNetwork: TerminalNetwork;
  
  shouldBuild: boolean;
  cache: any; // Will hold cached data for the tick
  
  // Console commands
  commands: CovenantCommands;
  
  constructor() {
    this.memory = Memory as any;
    this.highCharities = {};
    this.arbiters = {};
    this.crusades = {};
    this.shouldBuild = true;
    this.cache = {};
    this.observerNetwork = new ObserverNetwork();
    this.reclaimationCouncil = new ReclaimationCouncil(this);
    this.terminalNetwork = new TerminalNetwork(this);
    
    // Initialize console commands
    this.commands = new CovenantCommands(this);
    
    // Initialize memory structure
    this.initializeMemory();
  }
  
  /**
   * Get the singleton instance
   */
  static getInstance(): Covenant {
    if (!Covenant.instance) {
      Covenant.instance = new Covenant();
    }
    return Covenant.instance;
  }
  
  /**
   * Initialize memory structure
   */
  private initializeMemory(): void {
    if (!this.memory.version) {
      this.memory.version = '1.0.0';
    }
    if (!this.memory.highCharities) {
      this.memory.highCharities = {};
    }
    if (!this.memory.stats) {
      this.memory.stats = {
        gcl: Game.gcl.level,
        gclProgress: Game.gcl.progress / Game.gcl.progressTotal,
        cpu: 0,
        bucket: Game.cpu.bucket,
        credits: 0
      };
    }
  }
  
  /**
   * Build phase - construct all High Charities and their components
   */
  build(): void {
    if (!this.shouldBuild) return;
    
    const startCpu = Game.cpu.getUsed();
    
    // Clean up memory of dead creeps
    this.cleanupMemory();
    
    // Build High Charities for each owned room
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (room.controller && room.controller.my) {
        this.highCharities[roomName] = new HighCharity(room, this);
      }
    }
    
    // Build phase for all High Charities
    for (const roomName in this.highCharities) {
      this.highCharities[roomName].build();
    }
    
    // Process flags into Crusades
    this.buildCrusades();
    
    const buildCpu = Game.cpu.getUsed() - startCpu;
    if (Game.time % 100 === 0) {
      console.log(`⚡ COVENANT Build Phase: ${buildCpu.toFixed(2)} CPU`);
    }
    
    this.shouldBuild = false;
  }
  
  /**
   * Initialize phase - prepare all systems for execution
   */
  init(): void {
    const startCpu = Game.cpu.getUsed();
    
    // Initialize all High Charities
    for (const roomName in this.highCharities) {
      this.highCharities[roomName].init();
    }
    
    // Initialize all Crusades
    for (const name in this.crusades) {
      this.crusades[name].init();
    }
    
    // Initialize all Arbiters
    for (const ref in this.arbiters) {
      this.arbiters[ref].init();
    }
    
    const initCpu = Game.cpu.getUsed() - startCpu;
    if (Game.time % 100 === 0) {
      console.log(`🔧 COVENANT Init Phase: ${initCpu.toFixed(2)} CPU`);
    }
  }
  
  /**
   * Run phase - execute all operations
   */
  run(): void {
    const startCpu = Game.cpu.getUsed();
    
    // Run observer network (intel gathering)
    if (Game.time % 5 === 0) { // Run every 5 ticks
      this.observerNetwork.run();
    }
    
    // Run expansion system (colony growth)
    this.reclaimationCouncil.run();
    
    // Run terminal network (resource sharing)
    this.terminalNetwork.run();
    
    // Run all High Charities
    for (const roomName in this.highCharities) {
      this.highCharities[roomName].run();
    }
    
    // Run all Crusades
    for (const name in this.crusades) {
      this.crusades[name].run();
    }
    
    // Run all Arbiters
    for (const ref in this.arbiters) {
      this.arbiters[ref].run();
    }
    
    const runCpu = Game.cpu.getUsed() - startCpu;
    if (Game.time % 100 === 0) {
      console.log(`🎯 COVENANT Run Phase: ${runCpu.toFixed(2)} CPU`);
    }
  }
  
  /**
   * End of tick operations
   */
  endOfTick(): void {
    // Update stats
    this.updateStats();
    
    // Clean old intel (every 1000 ticks)
    if (Game.time % 1000 === 0) {
      this.observerNetwork.cleanOldIntel();
    }
    
    // Visuals
    if (Game.time % 10 === 0) {
      this.drawVisuals();
    }
    
    // Report performance
    if (Game.time % 100 === 0) {
      this.reportPerformance();
    }
    
    this.memory.lastTick = Game.time;
  }
  
  /**
   * Clean up memory of dead creeps and missing flags
   */
  private cleanupMemory(): void {
    // Clean up dead creeps
    for (const name in Memory.creeps) {
      if (!Game.creeps[name]) {
        delete Memory.creeps[name];
      }
    }
    
    // Clean up removed flags
    for (const name in Memory.flags) {
      if (!Game.flags[name]) {
        delete Memory.flags[name];
      }
    }
  }
  
  /**
   * Build Crusades from flags
   */
  private buildCrusades(): void {
    // Will implement flag-based directive system
    // For now, placeholder
    for (const flagName in Game.flags) {
      const flag = Game.flags[flagName];
      // Parse flag color and create appropriate Crusade
      // TODO: Implement Crusade factory
    }
  }
  
  /**
   * Update global statistics
   */
  private updateStats(): void {
    this.memory.stats.gcl = Game.gcl.level;
    this.memory.stats.gclProgress = Game.gcl.progress / Game.gcl.progressTotal;
    this.memory.stats.cpu = Game.cpu.getUsed();
    this.memory.stats.bucket = Game.cpu.bucket;
    
    if (Game.market) {
      this.memory.stats.credits = Game.market.credits;
    }
  }
  
  /**
   * Draw visuals for debugging
   */
  private drawVisuals(): void {
    // Draw connection lines between High Charities
    // Draw Crusade markers
    // TODO: Implement visual system
  }
  
  /**
   * Report performance metrics
   */
  private reportPerformance(): void {
    const stats = this.memory.stats;
    const charityCount = Object.keys(this.highCharities).length;
    const arbiterCount = Object.keys(this.arbiters).length;
    const crusadeCount = Object.keys(this.crusades).length;
    
    console.log(`
╔════════════════════════════════════════════════════════╗
║           🔱 COVENANT STATUS REPORT 🔱                 ║
╠════════════════════════════════════════════════════════╣
║ GCL: ${stats.gcl} (${(stats.gclProgress * 100).toFixed(1)}%)
║ High Charities: ${charityCount}
║ Arbiters: ${arbiterCount}
║ Active Crusades: ${crusadeCount}
║ CPU: ${stats.cpu.toFixed(1)}/${Game.cpu.limit} (Bucket: ${stats.bucket})
║ Credits: ${stats.credits.toLocaleString()}
╚════════════════════════════════════════════════════════╝
    `.trim());
  }
  
  /**
   * Register an Arbiter with the Covenant
   */
  registerArbiter(arbiter: Arbiter): void {
    this.arbiters[arbiter.ref] = arbiter;
  }
  
  /**
   * Register a Crusade with the Covenant
   */
  registerCrusade(crusade: Crusade): void {
    this.crusades[crusade.name] = crusade;
  }
}

// Global accessor
export const Cov = Covenant.getInstance();
