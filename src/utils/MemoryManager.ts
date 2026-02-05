/**
 * The Royal Archives
 * Manages memory and record-keeping
 */

export function initializeMemory(): void {
  console.log('📜 Opening the Royal Archives...');
  
  Memory.creeps = Memory.creeps || {};
  Memory.rooms = Memory.rooms || {};
  Memory.spawns = Memory.spawns || {};
  Memory.initialized = true;
  
  console.log('✨ The Archives are ready');
}

export function cleanMemory(): void {
  // Clean up memory of dead creeps
  for (const name in Memory.creeps) {
    if (!(name in Game.creeps)) {
      console.log(`⚰️ ${name} has fallen in service to the Crown`);
      delete Memory.creeps[name];
    }
  }
}
