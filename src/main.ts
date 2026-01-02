/**
 * Main Entry Point - COVENANT System
 *
 * "The Great Journey begins with a single step"
 * 
 * The COVENANT system manages all High Charities, Arbiters, and Crusades
 * to dominate the Screeps world with superior strategy and coordination.
 */

/// <reference types="@types/screeps" />

import { Covenant } from "./core/Covenant";
import { Profiler } from "./utils/Profiler";
import { CacheSystem, PathCache } from "./utils/CacheSystem";

// Initialize global Covenant instance
const Cov = Covenant.getInstance();

// Store in Game object for global access with console commands
(Game as any).cov = Cov;

// Add console command shortcuts as properties
(Game as any).cov.profile = (minCpu?: number) => Cov.commands.profile(minCpu);
(Game as any).cov.resetProfile = () => Cov.commands.resetProfile();
(Game as any).cov.cacheStats = () => Cov.commands.cacheStats();
(Game as any).cov.clearCache = () => Cov.commands.clearCache();
(Game as any).cov.cpuStatus = () => Cov.commands.cpuStatus();
(Game as any).cov.topCpu = (count?: number) => Cov.commands.topCpu(count);
(Game as any).cov.colony = (room: string) => Cov.commands.colony(room);
(Game as any).cov.colonies = () => Cov.commands.colonies();
(Game as any).cov.war = (room?: string) => Cov.commands.war(room);
(Game as any).cov.power = (room?: string) => Cov.commands.power(room);
(Game as any).cov.showPlan = (room?: string) => Cov.commands.showPlan(room);
(Game as any).cov.defense = (room?: string) => Cov.commands.defense(room);
(Game as any).cov.safeMode = (room: string, enable?: boolean) => Cov.commands.safeMode(room, enable);
(Game as any).cov.market = (room?: string) => Cov.commands.market(room);
(Game as any).cov.price = (resource: ResourceConstant, room?: string) => Cov.commands.price(resource, room);
(Game as any).cov.trade = (room: string, enable?: boolean) => Cov.commands.trade(room, enable);
(Game as any).cov.labs = (room?: string) => Cov.commands.labs(room);
(Game as any).cov.produce = (compound: MineralCompoundConstant, amount: number, room?: string) => Cov.commands.produce(compound, amount, room);
(Game as any).cov.autoLabs = (room: string, enable?: boolean) => Cov.commands.autoLabs(room, enable);
(Game as any).cov.intel = (room?: string) => Cov.commands.intel(room);
(Game as any).cov.expand = () => Cov.commands.expand();
(Game as any).cov.threats = () => Cov.commands.threats();
(Game as any).cov.help = () => Cov.commands.help();

/**
 * Main game loop - executed every tick
 */
export const loop = (): void => {
  // Performance monitoring
  const startCpu = Game.cpu.getUsed();

  try {
    // COVENANT ARCHITECTURE
    Profiler.start('Covenant_build');
    // Phase 1: Build - Construct all High Charities, Arbiters, and Crusades
    Cov.build();
    Profiler.end('Covenant_build');
    
    Profiler.start('Covenant_init');
    // Phase 2: Init - Initialize all systems
    Cov.init();
    Profiler.end('Covenant_init');
    
    Profiler.start('Covenant_run');
    // Phase 3: Run - Execute all operations
    Cov.run();
    Profiler.end('Covenant_run');
    
    Profiler.start('Covenant_endOfTick');
    // Phase 4: End of tick - Stats and cleanup
    Cov.endOfTick();
    Profiler.end('Covenant_endOfTick');
    
    // CACHE CLEANUP
    if (Game.time % 10 === 0) {
      CacheSystem.cleanExpired();
    }
    if (Game.time % 100 === 0) {
      PathCache.cleanOld();
    }
    
    // PERFORMANCE MONITORING
    if (Game.time % 100 === 0) {
      logPerformanceMetrics();
    }
  } catch (error) {
    console.log(`💥 Critical error in main loop: ${error}`);
  }
};

/**
 * Process pixel generation when CPU bucket is sufficiently high
 */
function processPixelGeneration(): void {
  // Generate pixels if bucket is high enough
  // Safe threshold: keep at least 5000 bucket for normal operations
  const PIXEL_GENERATION_THRESHOLD = 5000;
  const PIXEL_COST = 5000; // Cost to generate 1 pixel

  if (Game.cpu.bucket >= PIXEL_GENERATION_THRESHOLD + PIXEL_COST) {
    const result = Game.cpu.generatePixel();
    if (result === OK) {
      console.log(`💎 Generated 1 pixel! Bucket: ${Game.cpu.bucket}/10000`);

      // Track pixel generation in memory for stats
      if (!(Memory as any).stats) (Memory as any).stats = {};
      if (!(Memory as any).stats.pixels)
        (Memory as any).stats.pixels = { generated: 0, lastGenerated: 0 };
      (Memory as any).stats.pixels.generated++;
      (Memory as any).stats.pixels.lastGenerated = Game.time;
    }
  }

  // Log pixel status occasionally
  if (Game.time % 1000 === 0 && (Memory as any).stats?.pixels) {
    const pixelStats = (Memory as any).stats.pixels;
    const timeSinceLastPixel = pixelStats.lastGenerated
      ? Game.time - pixelStats.lastGenerated
      : "never";
    console.log(
      `💎 Pixels generated: ${pixelStats.generated}, Last: ${timeSinceLastPixel} ticks ago`
    );
  }
}

/**
 * Log performance metrics and status
 */
function logPerformanceMetrics(): void {
  const stats = {
    cpu: {
      used: Math.round(Game.cpu.getUsed()),
      limit: Game.cpu.limit,
      bucket: Game.cpu.bucket,
    },
    rooms: Object.keys(Game.rooms).length,
    creeps: Object.keys(Game.creeps).length,
    gcl: {
      level: Game.gcl.level,
      progress: Game.gcl.progress,
      progressTotal: Game.gcl.progressTotal,
    },
  };

  console.log(
    `📊 Global Status - CPU: ${stats.cpu.used}/${stats.cpu.limit}, Bucket: ${stats.cpu.bucket}, Rooms: ${stats.rooms}, Creeps: ${stats.creeps}`
  );
  
  // Show top CPU consumers
  const topConsumers = Profiler.getTopConsumers(3);
  if (topConsumers.length > 0) {
    console.log('🔥 Top CPU: ' + topConsumers.map(c => `${c.name}(${c.cpu.toFixed(2)})`).join(', '));
  }

  if (Game.time % 500 === 0) {
    const gclProgress = Math.round(
      (stats.gcl.progress / stats.gcl.progressTotal) * 100
    );
    console.log(`🎯 GCL ${stats.gcl.level} - Progress: ${gclProgress}%`);
  }
}
