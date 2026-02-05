/**
 * Type definitions for the Olympus project
 */

interface Memory {
  initialized?: boolean;
  creeps: { [name: string]: CreepMemory };
  rooms: { [name: string]: RoomMemory };
  spawns: { [name: string]: SpawnMemory };
}

interface CreepMemory {
  role: string;
  working: boolean;
  room: string;
  targetId?: string;
}

interface RoomMemory {
  // Add room-specific memory here
}

interface SpawnMemory {
  // Add spawn-specific memory here
}
