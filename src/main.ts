/**
 * The Royal Keep - Main Loop
 * Where His Majesty oversees the realm
 */

import { ErrorMapper } from './utils/ErrorMapper';
import { SpawnManager } from './managers/SpawnManager';
import { CreepManager } from './managers/CreepManager';
import { TowerManager } from './managers/TowerManager';
import { initializeMemory, cleanMemory } from './utils/MemoryManager';

declare const _: any;

// The main game loop - executed every tick
export const loop = ErrorMapper.wrapLoop(() => {
  // Initialize memory on first run
  if (!Memory.initialized) {
    initializeMemory();
  }

  // Clean up memory of dead creeps and destroyed structures
  cleanMemory();

  // Manage each room (each room is a province of the kingdom)
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    
    // Recruit new subjects as needed
    SpawnManager.run(room);
    
    // Manage tower defenses
    TowerManager.run(room);
  }

  // Command all subjects
  CreepManager.runAll();
});
