/**
 * Console Fallback
 *
 * Ensure `Game.cov` exists early so console commands can be used
 * even if Covenant initialization fails during module load.
 */

/// <reference types="@types/screeps" />

try {
  if (!(Game as any).cov) {
    (Game as any).cov = {};
  }
} catch (e) {
  // Game may be unavailable in some static analysis environments; ignore
}

export {};
