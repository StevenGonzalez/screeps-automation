/**
 * Main Entry Point - KHALA System
 *
 * "En Taro Adun! For Aiur!"
 * 
 * The KHALA system manages all Nexuses, Arbiters, and Campaigns
 * to dominate the Screeps world with superior strategy and coordination.
 */

/// <reference types="@types/screeps" />
import './utils/ConsoleFallback';
import { Khala } from "./core/Khala";
import { Profiler } from "./utils/Profiler";
import { CacheSystem, PathCache } from "./utils/CacheSystem";
import { CPUMonitor } from "./utils/CPUMonitor";

// Initialize global Khala instance
const Kha = Khala.getInstance();

// Store in Game object for global access with console commands
(Game as any).kha = Kha;

// Add console command shortcuts as properties
(Game as any).kha.profile = (minCpu?: number) => Kha.commands.profile(minCpu);
(Game as any).kha.resetProfile = () => Kha.commands.resetProfile();
(Game as any).kha.cacheStats = () => Kha.commands.cacheStats();
(Game as any).kha.clearCache = () => Kha.commands.clearCache();
(Game as any).kha.cpuStatus = () => Kha.commands.cpuStatus();
(Game as any).kha.topCpu = (count?: number) => Kha.commands.topCpu(count);
(Game as any).kha.colony = (room: string) => Kha.commands.colony(room);
(Game as any).kha.colonies = () => Kha.commands.colonies();
(Game as any).kha.war = (room?: string) => Kha.commands.war(room);
(Game as any).kha.power = (room?: string) => Kha.commands.power(room);
(Game as any).kha.showPlan = (room?: string) => Kha.commands.showPlan(room);
(Game as any).kha.defense = (room?: string) => Kha.commands.defense(room);
(Game as any).kha.safeMode = (room: string, enable?: boolean) => Kha.commands.safeMode(room, enable);
(Game as any).kha.market = (room?: string) => Kha.commands.market(room);
(Game as any).kha.price = (resource: ResourceConstant, room?: string) => Kha.commands.price(resource, room);
(Game as any).kha.trade = (room: string, enable?: boolean) => Kha.commands.trade(room, enable);
(Game as any).kha.labs = (room?: string) => Kha.commands.labs(room);
(Game as any).kha.produce = (compound: MineralCompoundConstant, amount: number, room?: string) => Kha.commands.produce(compound, amount, room);
(Game as any).kha.autoLabs = (room: string, enable?: boolean) => Kha.commands.autoLabs(room, enable);
(Game as any).kha.intel = (room?: string) => Kha.commands.intel(room);
(Game as any).kha.expand = () => Kha.commands.expand();
(Game as any).kha.threats = () => Kha.commands.threats();
(Game as any).kha.remote = (room?: string) => Kha.commands.remote(room);
(Game as any).kha.remoteToggle = (home: string, remote: string, enable: boolean) => Kha.commands.remoteToggle(home, remote, enable);
(Game as any).kha.deposits = (room?: string) => Kha.commands.deposits(room);
(Game as any).kha.depositToggle = (home: string, depositId: string, enable: boolean) => Kha.commands.depositToggle(home, depositId, enable);
(Game as any).kha.network = () => Kha.commands.network();
(Game as any).kha.sendEnergy = (targetRoom: string, amount?: number) => Kha.commands.sendEnergy(targetRoom, amount);
(Game as any).kha.powerProcessing = () => Kha.commands.powerProcessing();
(Game as any).kha.factories = () => Kha.commands.factories();
(Game as any).kha.spawns = (room?: string) => Kha.commands.spawns(room);
(Game as any).kha.powerCreeps = (room?: string) => Kha.commands.powerCreeps(room);
(Game as any).kha.layout = (room?: string) => Kha.commands.layout(room);
(Game as any).kha.squads = (room?: string) => Kha.commands.squads(room);
(Game as any).kha.attack = (targetRoom: string, formation?: string, tactic?: string) => Kha.commands.attack(targetRoom, formation, tactic);
(Game as any).kha.recall = () => Kha.commands.recall();
(Game as any).kha.formation = (formation: string) => Kha.commands.formation(formation);
(Game as any).kha.tactic = (tactic: string) => Kha.commands.tactic(tactic);
(Game as any).kha.boosts = (room?: string) => Kha.commands.boosts(room);
(Game as any).kha.militaryBoosts = (enabled: boolean) => Kha.commands.militaryBoosts(enabled);
(Game as any).kha.help = () => Kha.commands.help();

// Expose all KhalaCommands methods directly on Game.kha for console convenience
try {
  const proto = Object.getPrototypeOf(Kha.commands as any);
  const methodNames = Object.getOwnPropertyNames(proto).filter(n => n !== 'constructor');
  for (const name of methodNames) {
    // Only map functions that aren't already present
    if (!(Game as any).kha[name]) {
      (Game as any).kha[name] = (...args: any[]) => (Kha.commands as any)[name](...args);
    }
  }
} catch (e) {
  // Fail silently in restricted runtimes
}

/**
 * Main game loop - executed every tick
 */
export const loop = (): void => {
  // Performance monitoring
  const startCpu = Game.cpu.getUsed();
  const throttleLevel = CPUMonitor.getThrottleLevel();

  try {
    // KHALA ARCHITECTURE
    CPUMonitor.startSystem('KHALA_build');
    Profiler.start('KHALA_build');
    // Phase 1: Build - Construct all Nexuses, Arbiters, and Campaigns
    Kha.build();
    Profiler.end('KHALA_build');
    CPUMonitor.endSystem('KHALA_build');
    
    CPUMonitor.startSystem('KHALA_init');
    Profiler.start('KHALA_init');
    // Phase 2: Init - Initialize all systems
    Kha.init();
    Profiler.end('KHALA_init');
    CPUMonitor.endSystem('KHALA_init');
    
    // CRITICAL: Check if we're in bootstrap emergency (low creeps)
    // If so, we MUST run spawn logic even during CPU emergency throttling
    const totalCreeps = Object.keys(Game.creeps).length;
    const isBootstrapEmergency = totalCreeps < 3;
    
    // Phase 3: Run - Execute operations (throttled based on CPU)
    if (throttleLevel < 3) {
      // Normal operation - run everything
      CPUMonitor.startSystem('KHALA_run');
      Profiler.start('KHALA_run');
      Kha.run();
      Profiler.end('KHALA_run');
      CPUMonitor.endSystem('KHALA_run');
    } else {
      // Emergency throttle - only spawn critical creeps
      console.log(`⚠️ CPU THROTTLE LEVEL ${throttleLevel} - Bucket: ${Game.cpu.bucket} - Emergency mode: spawning only`);
      
      // Run ONLY spawning logic for each room
      for (const roomName in Kha.nexuses) {
        const hc = Kha.nexuses[roomName];
        if (hc.spawnQueue) {
          hc.spawnQueue.run(); // Critical spawning only
        }
      }

      // Still allow essential planning tasks (roads, defense planning)
      // so we can recover from mass road loss even under CPU throttle.
      for (const roomName in Kha.nexuses) {
        const hc = Kha.nexuses[roomName];
        try {
          hc.autoPlanner.run();
        } catch (e) {
          // Ignore planner errors during emergency to avoid breaking spawn logic
        }
      }
      
      // Bootstrap emergency: also run minimal creep logic for existing creeps
      if (isBootstrapEmergency) {
        for (const name in Game.creeps) {
          const creep = Game.creeps[name];
          // Very basic harvest/transfer logic
          if (creep.store.getFreeCapacity() > 0) {
            const source = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
            if (source && creep.pos.isNearTo(source)) {
              creep.harvest(source);
            } else if (source) {
              creep.moveTo(source);
            }
          } else {
            const spawn = creep.pos.findClosestByRange(FIND_MY_SPAWNS);
            if (spawn && creep.pos.isNearTo(spawn)) {
              creep.transfer(spawn, RESOURCE_ENERGY);
            } else if (spawn) {
              creep.moveTo(spawn);
            }
          }
        }
      }
    }
    
    // Skip end of tick cleanup if emergency throttling
    if (throttleLevel < 3) {
      CPUMonitor.startSystem('KHALA_endOfTick');
      Profiler.start('KHALA_endOfTick');
      // Phase 4: End of tick - Stats and cleanup
      Kha.endOfTick();
      Profiler.end('KHALA_endOfTick');
      CPUMonitor.endSystem('KHALA_endOfTick');
    }
    
    // CACHE CLEANUP
    if (Game.time % 10 === 0) {
      CacheSystem.cleanExpired();
    }
    if (Game.time % 100 === 0) {
      PathCache.cleanOld();
    }
    
    // CPU MONITORING
    const tickCpu = Game.cpu.getUsed() - startCpu;
    CPUMonitor.recordTick(tickCpu);
    
    // PERFORMANCE MONITORING
    if (Game.time % 100 === 0) {
      logPerformanceMetrics();
    }
    
    // PIXEL GENERATION (when bucket is high)
    if (Game.time % 100 === 0) {
      processPixelGeneration();
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

      // Mark pixel generation to prevent false throttling from bucket drop
      CPUMonitor.markPixelGeneration();

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
