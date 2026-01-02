/**
 * PowerManager
 * 
 * Manages automated power processing in Power Spawns to generate ops.
 * Power is essential for operating Power Creeps which provide significant
 * boosts to colony operations.
 * 
 * Features:
 * - Automatic power processing when available
 * - Requests power from Terminal Network when low
 * - Tracks ops generation and efficiency
 * - Monitors power reserves across colonies
 */

import { HighCharity } from '../core/HighCharity';

export interface PowerStats {
  totalOpsGenerated: number;
  totalPowerConsumed: number;
  processingTicks: number;
  efficiency: number; // ops per power
}

export class PowerManager {
  private colony: HighCharity;
  private powerSpawn: StructurePowerSpawn | null;

  constructor(colony: HighCharity) {
    this.colony = colony;
    this.powerSpawn = this.findPowerSpawn();
    this.initializeMemory();
  }

  /**
   * Main execution loop - runs every tick
   */
  public run(): void {
    if (!this.powerSpawn) {
      this.powerSpawn = this.findPowerSpawn();
      return;
    }

    // Process power if conditions are met
    if (this.shouldProcessPower()) {
      this.processPower();
    }

    // Request power from terminal if running low
    if (this.needsPowerDelivery()) {
      this.requestPowerFromNetwork();
    }

    // Update statistics
    this.updateStatistics();
  }

  /**
   * Find the Power Spawn in this colony
   */
  private findPowerSpawn(): StructurePowerSpawn | null {
    const powerSpawns = this.colony.room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_POWER_SPAWN
    }) as StructurePowerSpawn[];

    return powerSpawns.length > 0 ? powerSpawns[0] : null;
  }

  /**
   * Check if we should process power this tick
   */
  private shouldProcessPower(): boolean {
    if (!this.powerSpawn) return false;

    // Need both power and energy to process
    if (this.powerSpawn.store[RESOURCE_POWER] === 0) return false;
    if (this.powerSpawn.store[RESOURCE_ENERGY] === 0) return false;

    // Don't process if we're low on energy (< 50k in storage)
    const storage = this.colony.room.storage;
    if (storage && storage.store[RESOURCE_ENERGY] < 50000) return false;

    // Don't process if terminal is struggling with energy
    const terminal = this.colony.room.terminal;
    if (terminal && terminal.store[RESOURCE_ENERGY] < 10000) return false;

    return true;
  }

  /**
   * Process power into ops
   */
  private processPower(): void {
    if (!this.powerSpawn) return;

    const result = this.powerSpawn.processPower();

    if (result === OK) {
      // Processing consumes 50 energy and 1 power, generates 1 ops
      const memory = this.getMemory();
      memory.totalOpsGenerated++;
      memory.totalPowerConsumed++;
      memory.processingTicks++;
    }
  }

  /**
   * Check if we need power delivered from the network
   */
  private needsPowerDelivery(): boolean {
    if (!this.powerSpawn) return false;
    
    const terminal = this.colony.room.terminal;
    if (!terminal) return false;

    const powerInSpawn = this.powerSpawn.store[RESOURCE_POWER];
    const powerInTerminal = terminal.store[RESOURCE_POWER] || 0;
    const totalPower = powerInSpawn + powerInTerminal;

    // Request power if we have less than 5k total
    // This triggers terminal network to send power
    return totalPower < 5000;
  }

  /**
   * Request power delivery from terminal network
   */
  private requestPowerFromNetwork(): void {
    const terminal = this.colony.room.terminal;
    if (!terminal) return;

    // The terminal network will pick this up automatically
    // when it scans for resource needs
    // We just need to ensure our power level is low enough
    // to be detected (< 5k triggers medium priority)
  }

  /**
   * Update statistics and efficiency metrics
   */
  private updateStatistics(): void {
    const memory = this.getMemory();
    
    // Calculate efficiency (ops generated per power consumed)
    if (memory.totalPowerConsumed > 0) {
      memory.efficiency = memory.totalOpsGenerated / memory.totalPowerConsumed;
    }
  }

  /**
   * Get current power status
   */
  public getStatus(): {
    hasPowerSpawn: boolean;
    powerInSpawn: number;
    powerInTerminal: number;
    powerInStorage: number;
    energyInSpawn: number;
    opsAvailable: number;
    isProcessing: boolean;
    statistics: PowerStats;
  } {
    const terminal = this.colony.room.terminal;
    const storage = this.colony.room.storage;
    
    return {
      hasPowerSpawn: this.powerSpawn !== null,
      powerInSpawn: this.powerSpawn?.store[RESOURCE_POWER] || 0,
      powerInTerminal: terminal?.store[RESOURCE_POWER] || 0,
      powerInStorage: storage?.store[RESOURCE_POWER] || 0,
      energyInSpawn: this.powerSpawn?.store[RESOURCE_ENERGY] || 0,
      opsAvailable: terminal?.store[RESOURCE_OPS] || 0,
      isProcessing: this.shouldProcessPower(),
      statistics: this.getMemory()
    };
  }

  /**
   * Initialize memory structure
   */
  private initializeMemory(): void {
    if (!this.colony.memory.powerProcessing) {
      this.colony.memory.powerProcessing = {
        totalOpsGenerated: 0,
        totalPowerConsumed: 0,
        processingTicks: 0,
        efficiency: 1.0
      };
    }
  }

  /**
   * Get memory reference
   */
  private getMemory(): PowerStats {
    if (!this.colony.memory.powerProcessing) {
      this.initializeMemory();
    }
    return this.colony.memory.powerProcessing!;
  }

  /**
   * Transfer power from terminal to power spawn
   */
  public transferPowerToSpawn(): void {
    if (!this.powerSpawn) return;
    
    const terminal = this.colony.room.terminal;
    if (!terminal) return;

    const powerInTerminal = terminal.store[RESOURCE_POWER] || 0;
    const powerInSpawn = this.powerSpawn.store[RESOURCE_POWER] || 0;
    const spawnCapacity = this.powerSpawn.store.getCapacity(RESOURCE_POWER) || 0;
    const spawnFreeSpace = spawnCapacity - powerInSpawn;

    if (powerInTerminal > 0 && spawnFreeSpace > 0) {
      const amountToTransfer = Math.min(powerInTerminal, spawnFreeSpace, 1000);
      terminal.send(RESOURCE_POWER, amountToTransfer, this.colony.name);
    }
  }

  /**
   * Check if colony is ready for power processing
   */
  public static isColonyReady(colony: HighCharity): boolean {
    // Needs RCL 8 for power spawn
    if (colony.room.controller && colony.room.controller.level < 8) {
      return false;
    }

    // Needs terminal for power delivery
    if (!colony.room.terminal) {
      return false;
    }

    // Needs storage for energy reserves
    if (!colony.room.storage) {
      return false;
    }

    // Needs power spawn built
    const powerSpawns = colony.room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_POWER_SPAWN
    });

    return powerSpawns.length > 0;
  }
}
