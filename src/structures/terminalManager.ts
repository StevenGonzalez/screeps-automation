// src/structures/terminalManager.ts
import { MemoryManager } from '../memory/memoryManager';

/**
 * Terminal Manager
 * 
 * Manages terminal operations for inter-room resource transfers.
 * Handles energy balance, resource distribution, and market operations.
 * 
 * Features:
 * - Automatic energy distribution to rooms in need
 * - Resource balancing across multiple rooms
 * - Integration point for future market operations
 */

interface TerminalMemory {
  lastEnergyCheck: number;
  pendingTransfers: Array<{
    targetRoom: string;
    resourceType: ResourceConstant;
    amount: number;
    priority: number;
  }>;
}

const ENERGY_CHECK_INTERVAL = 50;
const MIN_TERMINAL_ENERGY = 10000;
const ENERGY_TRANSFER_AMOUNT = 10000;

export class TerminalManager {
  run() {
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;
      if (!room.terminal || !room.terminal.my) continue;

      this.manageTerminal(room);
    }
  }

  private manageTerminal(room: Room) {
    const terminal = room.terminal;
    if (!terminal) return;

    const memPath = `rooms.${room.name}.terminal`;
    const memory = MemoryManager.get<TerminalMemory>(memPath, {
      lastEnergyCheck: 0,
      pendingTransfers: []
    });

    if (!memory) return;

    // Check if we need to balance energy across rooms
    if (Game.time - memory.lastEnergyCheck >= ENERGY_CHECK_INTERVAL) {
      this.checkEnergyBalance(room, terminal, memory);
      memory.lastEnergyCheck = Game.time;
      MemoryManager.set(memPath, memory);
    }

    // Process pending transfers
    this.processPendingTransfers(room, terminal, memory);
  }

  private checkEnergyBalance(room: Room, terminal: StructureTerminal, memory: TerminalMemory) {
    // Only send energy if we have excess
    const terminalEnergy = terminal.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
    const storageEnergy = room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
    const totalEnergy = terminalEnergy + storageEnergy;

    // Need substantial surplus to consider sending
    if (totalEnergy < 100000) return;
    if (terminalEnergy < MIN_TERMINAL_ENERGY * 2) return;

    // Find rooms that need energy
    const needyRooms = this.findRoomsNeedingEnergy(room.name);
    
    if (needyRooms.length > 0) {
      // Sort by priority (rooms with less energy = higher priority)
      needyRooms.sort((a, b) => a.energy - b.energy);
      
      const targetRoom = needyRooms[0];
      
      // Queue energy transfer
      memory.pendingTransfers.push({
        targetRoom: targetRoom.name,
        resourceType: RESOURCE_ENERGY,
        amount: ENERGY_TRANSFER_AMOUNT,
        priority: 5
      });
    }
  }

  private findRoomsNeedingEnergy(excludeRoom: string): Array<{ name: string; energy: number }> {
    const needyRooms: Array<{ name: string; energy: number }> = [];

    for (const roomName in Game.rooms) {
      if (roomName === excludeRoom) continue;

      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;
      if (!room.terminal) continue;

      const terminalEnergy = room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
      const storageEnergy = room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
      const totalEnergy = terminalEnergy + storageEnergy;

      // Room needs energy if below threshold
      if (totalEnergy < 50000 || terminalEnergy < MIN_TERMINAL_ENERGY) {
        needyRooms.push({
          name: roomName,
          energy: totalEnergy
        });
      }
    }

    return needyRooms;
  }

  private processPendingTransfers(room: Room, terminal: StructureTerminal, memory: TerminalMemory) {
    // Don't process if terminal is on cooldown
    if (terminal.cooldown > 0) return;

    // No pending transfers
    if (memory.pendingTransfers.length === 0) return;

    // Sort by priority (higher = more urgent)
    memory.pendingTransfers.sort((a, b) => b.priority - a.priority);

    const transfer = memory.pendingTransfers[0];
    
    // Validate transfer is still needed
    const targetRoom = Game.rooms[transfer.targetRoom];
    if (!targetRoom || !targetRoom.terminal) {
      // Remove invalid transfer
      memory.pendingTransfers.shift();
      const memPath = `rooms.${room.name}.terminal`;
      MemoryManager.set(memPath, memory);
      return;
    }

    // Check if we have enough of the resource
    const available = terminal.store.getUsedCapacity(transfer.resourceType) || 0;
    if (available < transfer.amount) {
      // Not enough resource, defer or remove
      memory.pendingTransfers.shift();
      const memPath = `rooms.${room.name}.terminal`;
      MemoryManager.set(memPath, memory);
      return;
    }

    // Attempt the transfer
    const result = terminal.send(
      transfer.resourceType,
      transfer.amount,
      transfer.targetRoom,
      `Auto-transfer from ${room.name}`
    );

    if (result === OK) {
      // Transfer successful, remove from queue
      memory.pendingTransfers.shift();
      const memPath = `rooms.${room.name}.terminal`;
      MemoryManager.set(memPath, memory);
    } else {
      // Transfer failed, keep in queue but move to back
      const failed = memory.pendingTransfers.shift();
      if (failed) {
        memory.pendingTransfers.push(failed);
      }
      const memPath = `rooms.${room.name}.terminal`;
      MemoryManager.set(memPath, memory);
    }
  }

  /**
   * Queue a resource transfer to another room
   * Higher priority transfers are processed first
   */
  queueTransfer(
    fromRoom: string,
    toRoom: string,
    resourceType: ResourceConstant,
    amount: number,
    priority: number = 5
  ) {
    const memPath = `rooms.${fromRoom}.terminal`;
    const memory = MemoryManager.get<TerminalMemory>(memPath, {
      lastEnergyCheck: 0,
      pendingTransfers: []
    });

    if (!memory) return;

    memory.pendingTransfers.push({
      targetRoom: toRoom,
      resourceType,
      amount,
      priority
    });

    MemoryManager.set(memPath, memory);
  }
}

export const terminalManager = new TerminalManager();
