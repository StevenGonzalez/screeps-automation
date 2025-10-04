declare global {
  interface RoomMemory {
    labAssignments?: {
      inputA: Id<StructureLab>;
      inputB: Id<StructureLab>;
      output: Id<StructureLab>;
    };
    lastScanned?: number;
    economy?: any;
    construction?: any;
    defense?: any;
    spawning?: any;
  }
}
/**
 * Memory Management
 *
 * Handles cleanup and management of Screeps memory objects.
 * Prevents memory leaks and maintains optimal performance.
 */

/// <reference types="@types/screeps" />

declare global {
  interface Memory {
    terminalHub?: any;
  }
}

/**
 * Clean up memory for dead creeps and obsolete data
 */
export function cleanupMemory(): void {
  // Clean up dead creeps
  for (const name in Memory.creeps) {
    if (!(name in Game.creeps)) {
      delete Memory.creeps[name];
      console.log(`🗑️ Cleaned up memory for dead creep: ${name}`);
    }
  }

  // Clean up memory for lost rooms
  for (const name in Memory.rooms || {}) {
    if (!Game.rooms[name]) {
      delete Memory.rooms[name];
      console.log(`🗑️ Cleaned up memory for lost room: ${name}`);
    }
  }

  // Clean up obsolete flags
  for (const name in Memory.flags || {}) {
    if (!Game.flags[name]) {
      delete Memory.flags[name];
      console.log(`🗑️ Cleaned up memory for removed flag: ${name}`);
    }
  }
}

/**
 * Update global statistics in memory
 */
export function updateGlobalStats(): void {
  // Use any to bypass TypeScript memory restrictions
  const mem = Memory as any;
  if (!mem.stats) mem.stats = {};

  mem.stats.tick = Game.time;
  mem.stats.cpu = {
    used: Game.cpu.getUsed(),
    limit: Game.cpu.limit,
    bucket: Game.cpu.bucket,
  };

  mem.stats.gcl = {
    level: Game.gcl.level,
    progress: Game.gcl.progress,
    progressTotal: Game.gcl.progressTotal,
  };

  mem.stats.credits = Game.market?.credits || 0;

  // Room counts
  const ownedRooms: Room[] = [];
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (room.controller?.my) {
      ownedRooms.push(room);
    }
  }

  mem.stats.rooms = {
    owned: ownedRooms.length,
    total: Object.keys(Game.rooms).length,
  };

  // Creep counts by role
  const creeps: Creep[] = [];
  for (const creepName in Game.creeps) {
    creeps.push(Game.creeps[creepName]);
  }

  mem.stats.creeps = {
    total: creeps.length,
    byRole: {} as { [role: string]: number },
  };

  creeps.forEach((creep: Creep) => {
    const role = creep.memory.role || "undefined";
    mem.stats.creeps.byRole[role] = (mem.stats.creeps.byRole[role] || 0) + 1;
  });
}

/**
 * Initialize memory structures if they don't exist
 */
export function initializeMemory(): void {
  if (!Memory.rooms) Memory.rooms = {};
  if (!Memory.creeps) Memory.creeps = {};
  if (!Memory.flags) Memory.flags = {};

  // Initialize stats using any to bypass typing
  const mem = Memory as any;
  if (!mem.stats) mem.stats = {};
}

/**
 * Get or create room memory
 */
export function getRoomMemory(roomName: string): any {
  if (!Memory.rooms) Memory.rooms = {};
  if (!Memory.rooms[roomName]) {
    Memory.rooms[roomName] = {
      lastScanned: Game.time,
      economy: {},
      construction: {},
      defense: {},
      spawning: {},
    };
  }
  return Memory.rooms[roomName];
}
