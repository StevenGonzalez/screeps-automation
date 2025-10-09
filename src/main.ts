/**
 * Main Entry Point - Screeps Automation
 *
 * Beautiful, high-quality automation that orchestrates all room operations
 * through modular, focused systems for maximum efficiency and maintainability.
 */

/// <reference types="@types/screeps" />

import { processRoom } from "./room/orchestration";
import {
  cleanupMemory,
  initializeMemory,
  updateGlobalStats,
} from "./global.memory";

/**
 * Main game loop - executed every tick
 */
export const loop = (): void => {
  // Performance monitoring
  const startCpu = Game.cpu.getUsed();

  try {
    // PHASE 1: MEMORY MANAGEMENT
    initializeMemory();
    cleanupMemory();

    // PHASE 2: ROOM PROCESSING
    for (const roomName in Game.rooms) {
      processRoom(roomName);
    }

    // PHASE 3: GLOBAL OPERATIONS
    updateGlobalStats();
    processGlobalOperations();

    // PHASE 4: PERFORMANCE MONITORING
    if (Game.time % 100 === 0) {
      logPerformanceMetrics();
    }
  } catch (error) {
    console.log(`💥 Critical error in main loop: ${error}`);
  }
};

/**
 * Handle global operations across all rooms
 */
function processGlobalOperations(): void {
  // Market operations, inter-room logistics, etc.

  // Pixel generation - generate pixels when CPU bucket is high enough
  processPixelGeneration();

  // CPU monitoring
  const cpuUsed = Game.cpu.getUsed();
  const cpuLimit = Game.cpu.limit;

  if (cpuUsed > cpuLimit * 0.9) {
    console.log(
      `⚠️ High CPU usage: ${Math.round(cpuUsed)}/${cpuLimit} (${Math.round(
        (cpuUsed / cpuLimit) * 100
      )}%)`
    );
  }
}

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

  if (Game.time % 500 === 0) {
    const gclProgress = Math.round(
      (stats.gcl.progress / stats.gcl.progressTotal) * 100
    );
    console.log(`🎯 GCL ${stats.gcl.level} - Progress: ${gclProgress}%`);
  }
}
