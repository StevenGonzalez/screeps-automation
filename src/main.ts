/**
 * Main Entry Point - Screeps Automation
 *
 * Beautiful, high-quality automation that orchestrates all room operations
 * through modular, focused systems for maximum efficiency and maintainability.
 */

/// <reference types="@types/screeps" />

import { processRoom } from "./room.orchestration";
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

  // Performance reporting
  const cpuUsed = Game.cpu.getUsed() - startCpu;
  if (Game.time % 10 === 0) {
    console.log(`⚡ CPU Usage: ${cpuUsed.toFixed(2)} / ${Game.cpu.limit}`);
  }
};

/**
 * Handle global operations across all rooms
 */
function processGlobalOperations(): void {
  // Market operations, inter-room logistics, etc.

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

  // Bucket monitoring
  if (Game.cpu.bucket < 1000) {
    console.log(`🪣 Low CPU bucket: ${Game.cpu.bucket}/10000`);
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
