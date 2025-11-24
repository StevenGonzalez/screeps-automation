// src/memory/types.ts
// Extend global Memory types for type safety

declare global {
  interface Memory {
    rooms: Record<string, RoomMemory>;
    creeps: Record<string, CreepMemory>;
  }

  interface RoomMemory {
    plan?: any;
    economy?: any;
  }

  interface CreepMemory {
    role: string;
    task?: string;
  }
}

export {};
