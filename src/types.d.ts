/**
 * Type definitions for the Medieval Kingdom project
 */

declare global {
  interface Memory {
    initialized?: boolean;
  }

  interface CreepMemory {
    role: string;
    working: boolean;
    room: string;
    targetId?: string;
    sourceId?: string;
  }

  interface RoomMemory {
    // Add room-specific memory here
  }

  interface SpawnMemory {
    // Add spawn-specific memory here
  }
}

export {};
