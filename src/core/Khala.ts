/**
 * KHALA - Main AI Coordinator
 * 
 * "En Taro Adun! My life for Aiur!"
 * 
 * The Khala is the central intelligence that manages all Nexuses (colonies),
 * coordinates Arbiters (controllers), and executes Campaigns (directives) across the game world.
 * 
 * Inspired by StarCraft's Protoss - a powerful race connected by the psychic Khala.
 */

/// <reference types="@types/screeps" />

import { Nexus } from './Nexus';
import { Arbiter } from '../arbiters/Arbiter';
import { Campaign } from '../campaigns/Campaign';
import { KhalaCommands } from '../utils/KhalaCommands';
import { ObserverNetwork } from '../intel/ObserverNetwork';
import { ReclaimationCouncil } from '../expansion/ReclaimationCouncil';
import { TerminalNetwork } from '../network/TerminalNetwork';

interface KhalaMemory {
  version: string;
  lastTick: number;
  nexuses: { [roomName: string]: any };
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
 * The Khala - Central AI that manages everything
 */
export class Khala {
  static instance: Khala;
  
  memory: KhalaMemory;
  nexuses: { [roomName: string]: Nexus };
  arbiters: { [ref: string]: Arbiter };
  campaigns: { [name: string]: Campaign };
  observerNetwork: ObserverNetwork;
  reclaimationCouncil: ReclaimationCouncil;
  terminalNetwork: TerminalNetwork;
  
  shouldBuild: boolean;
  cache: any; // Will hold cached data for the tick
  
  // Console commands
  commands: KhalaCommands;
  
  constructor() {
    this.memory = Memory as any;
    this.nexuses = {};
    this.arbiters = {};
    this.campaigns = {};
    this.shouldBuild = true;
    this.cache = {};
    this.observerNetwork = new ObserverNetwork();
    this.reclaimationCouncil = new ReclaimationCouncil(this);
    this.terminalNetwork = new TerminalNetwork(this);
    
    // Initialize console commands
    this.commands = new KhalaCommands(this);
    
    // Initialize memory structure
    this.initializeMemory();
  }
  
  /**
   * Get the singleton instance
   */
  static getInstance(): Khala {
    if (!Khala.instance) {
      Khala.instance = new Khala();
    }
    return Khala.instance;
  }
  
  /**
   * Initialize memory structure
   */
  private initializeMemory(): void {
    if (!this.memory.version) {
      this.memory.version = '1.0.0';
    }
    if (!this.memory.nexuses) {
      this.memory.nexuses = {};
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
   * Build phase - construct all Nexuses and their components
   */
  build(): void {
    if (!this.shouldBuild) return;
    
    const startCpu = Game.cpu.getUsed();
    
    // Clean up memory of dead creeps
    this.cleanupMemory();
    
    // Build Nexuses for each owned room
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (room.controller && room.controller.my) {
        this.nexuses[roomName] = new Nexus(room, this);
      }
    }
    
    // Build phase for all Nexuses
    for (const roomName in this.nexuses) {
      this.nexuses[roomName].build();
    }
    
    // Process flags into Campaigns
    this.buildCampaigns();
    
    const buildCpu = Game.cpu.getUsed() - startCpu;
    if (Game.time % 100 === 0) {
      console.log(`⚡ KHALA Build Phase: ${buildCpu.toFixed(2)} CPU`);
    }
    
    this.shouldBuild = false;
  }
  
  /**
   * Initialize phase - prepare all systems for execution
   */
  init(): void {
    const startCpu = Game.cpu.getUsed();
    
    // Initialize all Nexuses
    for (const roomName in this.nexuses) {
      this.nexuses[roomName].init();
    }
    
    // Initialize all Campaigns
    for (const name in this.campaigns) {
      this.campaigns[name].init();
    }
    
    // Initialize all Arbiters
    for (const ref in this.arbiters) {
      this.arbiters[ref].init();
    }
    
    const initCpu = Game.cpu.getUsed() - startCpu;
    if (Game.time % 100 === 0) {
      console.log(`🔧 KHALA Init Phase: ${initCpu.toFixed(2)} CPU`);
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
    
    // Run all Nexuses
    for (const roomName in this.nexuses) {
      this.nexuses[roomName].run();
    }
    
    // Run all Campaigns
    for (const name in this.campaigns) {
      this.campaigns[name].run();
    }
    
    // Run all Arbiters
    for (const ref in this.arbiters) {
      this.arbiters[ref].run();
    }
    
    const runCpu = Game.cpu.getUsed() - startCpu;
    if (Game.time % 100 === 0) {
      console.log(`🎯 KHALA Run Phase: ${runCpu.toFixed(2)} CPU`);
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
   * Build Campaigns from flags
   */
  private buildCampaigns(): void {
    // Will implement flag-based directive system
    // For now, placeholder
    for (const flagName in Game.flags) {
      const flag = Game.flags[flagName];
      // Parse flag color and create appropriate Campaign
      // TODO: Implement Campaign factory
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
    // Draw connection lines between Nexuses
    // Draw Campaign markers
    // TODO: Implement visual system
  }
  
  /**
   * Report performance metrics
   */
  private reportPerformance(): void {
    const stats = this.memory.stats;
    const nexusCount = Object.keys(this.nexuses).length;
    const arbiterCount = Object.keys(this.arbiters).length;
    const campaignCount = Object.keys(this.campaigns).length;
    
    console.log(`
╔════════════════════════════════════════════════════════╗
║           ⚡ KHALA STATUS REPORT ⚡                     ║
╠════════════════════════════════════════════════════════╣
║ GCL: ${stats.gcl} (${(stats.gclProgress * 100).toFixed(1)}%)
║ Nexuses: ${nexusCount}
║ Arbiters: ${arbiterCount}
║ Active Campaigns: ${campaignCount}
║ CPU: ${stats.cpu.toFixed(1)}/${Game.cpu.limit} (Bucket: ${stats.bucket})
║ Credits: ${stats.credits.toLocaleString()}
╚════════════════════════════════════════════════════════╝
    `.trim());
  }
  
  /**
   * Register an Arbiter with the Khala
   */
  registerArbiter(arbiter: Arbiter): void {
    this.arbiters[arbiter.ref] = arbiter;
  }
  
  /**
   * Register a Campaign with the Khala
   */
  registerCampaign(campaign: Campaign): void {
    this.campaigns[campaign.name] = campaign;
  }
}

// Global accessor
export const Kha = Khala.getInstance();
