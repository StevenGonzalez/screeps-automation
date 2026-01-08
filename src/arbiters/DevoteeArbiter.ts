/**
 * WORKER ARBITER - Controller Upgrading Manager
 * 
 * "For the glory of the Prophets"
 * 
 * Manages worker Elites that upgrade the room controller.
 * Critical for RCL progression and maintaining downgrade timer.
 */

/// <reference types="@types/screeps" />

import { Arbiter, ArbiterPriority } from './Arbiter';
import { SpawnPriority } from '../spawning/SpawnQueue';
import { HighCharity } from '../core/HighCharity';
import { Elite } from '../elites/Elite';
import { ROLES, RoleHelpers } from '../constants/Roles';
import { BodyBuilder } from '../utils/BodyBuilder';

// Covenant-themed controller signs
const COVENANT_SIGNS = [
  "🔱 The Covenant's will is absolute",
  "⚡ By the Prophets' grace, this world ascends",
  "🌟 The Great Journey begins here",
  "🔥 Heretics shall be purged",
  "✨ The Forerunners smile upon this place",
  "⚔️ Sacred ground of the Covenant",
  "🛡️ Protected by the Hierarchs' decree",
  "💫 The Path is clear, the Journey ordained",
  "🔱 Glory to the Covenant Empire",
  "⚡ This realm serves the Prophets"
];

/**
 * Worker Arbiter - Manages controller upgrading
 */
export class DevoteeArbiter extends Arbiter {
  workers: Elite[];
  
  constructor(highCharity: HighCharity) {
    super(highCharity, 'worker', ArbiterPriority.economy.upgrading);
    this.workers = [];
  }
  
  init(): void {
    this.refresh();
    
    // Update workers list from elites
    this.workers = this.elites;
    
    // Request boosts for workers at mature colonies
    if (this.highCharity.memory.phase === 'powerhouse' && this.highCharity.boostTemple?.isReady()) {
      for (const worker of this.workers) {
        // Only boost workers that aren't already boosted
        if (!this.highCharity.boostTemple.isCreepBoosted(worker.name)) {
          this.highCharity.boostTemple.requestBoost(worker.name, 'elite_upgrader', ArbiterPriority.economy.upgrading);
        }
      }
    }
    
    // Request workers if needed
    const desiredWorkers = this.calculateDesiredWorkers();
    const currentWorkers = this.workers.length;
    
    // Debug logging (throttled)
    if (Game.time % 50 === 0) {
      console.log(`📚 ${this.print}: ${currentWorkers}/${desiredWorkers} workers (phase: ${this.highCharity.memory.phase})`);
    }
    
    // Request spawn whenever we need more workers
    // SpawnQueue handles deduplication, so it's safe to request every tick
    if (currentWorkers < desiredWorkers) {
      this.requestWorker();
    }
  }
  
  run(): void {
    for (const worker of this.workers) {
      this.runWorker(worker);
    }
  }
  
  private runWorker(worker: Elite): void {
    const controller = this.room.controller;
    if (!controller) return;
    
    // Sign the controller if not signed or sign is old
    if (controller.my) {
      const needsSigning = !controller.sign || 
                          controller.sign.username !== worker.creep.owner.username ||
                          Game.time - controller.sign.time > 100000; // Re-sign every 100k ticks
      
      if (needsSigning && worker.pos.isNearTo(controller)) {
        const randomSign = COVENANT_SIGNS[Math.floor(Math.random() * COVENANT_SIGNS.length)];
        worker.creep.signController(controller, randomSign);
      }
    }
    
    // State machine: harvesting → upgrading
    if (worker.memory.upgrading && worker.needsEnergy) {
      worker.memory.upgrading = false;
    }
    if (!worker.memory.upgrading && worker.isFull) {
      worker.memory.upgrading = true;
    }
    
    if (worker.memory.upgrading) {
      // Upgrade the controller
      const result = worker.upgradeController();
      if (result === OK) {
        worker.say('⚡');
      }
    } else {
      // Get energy
      this.getEnergy(worker);
    }
  }
  
  private getEnergy(worker: Elite): void {
    // Check for upgrader/controller link first (highest priority for workers)
    if (this.highCharity.linkTemple?.isActive()) {
      const upgraderLink = this.highCharity.linkTemple.getUpgraderLink();
      if (upgraderLink && upgraderLink.store.getUsedCapacity(RESOURCE_ENERGY) > 50) {
        worker.withdrawFrom(upgraderLink);
        worker.say('⚡');
        return;
      }
    }
    
    // Use Elite's smart energy collection for everything else
    // Priority: Containers > Storage > Dropped > Harvest
    // Workers can now use containers - they shouldn't sit idle if energy is available
    worker.collectEnergy({
      useLinks: false, // Already checked upgrader link above
      useContainers: true, // Use containers if available
      useStorage: true,
      useDropped: true,
      harvestIfNeeded: true,
      storageMinEnergy: 1000
    });
  }
  
  private calculateDesiredWorkers(): number {
    const phase = this.highCharity.memory.phase;
    const controller = this.room.controller;
    
    if (!controller) return 0;
    
    // Adjust based on downgrade timer
    const ticksToDowngrade = controller.ticksToDowngrade || 0;
    const urgentUpgrade = ticksToDowngrade < 5000;
    
    // Bootstrap: 1-2 workers
    if (phase === 'bootstrap') {
      return urgentUpgrade ? 2 : 1;
    }
    
    // Developing: 2-3 workers
    if (phase === 'developing') {
      return urgentUpgrade ? 3 : 2;
    }
    
    // Mature: 2-4 workers (push for RCL 8)
    if (phase === 'mature') {
      return urgentUpgrade ? 4 : 3;
    }
    
    // Powerhouse: 1-2 workers (just maintain)
    return urgentUpgrade ? 2 : 1;
  }
  
  private requestWorker(): void {
    const body = this.calculateWorkerBody();
    
    // Don't request if body is empty (not enough energy)
    if (body.length === 0) {
      return;
    }
    
    const name = `Devotee_${Game.time}`;
    
    // Workers are ECONOMY priority (can wait until energy is flowing)
    // BUT: first worker should be important to spawn without waiting for 80% energy
    const priority = SpawnPriority.ECONOMY;
    const important = this.workers.length === 0; // First worker is important
    
    this.requestSpawn(body, name, {
      role: ROLES.ELITE_DEVOTEE, // Covenant themed role
      upgrading: false
    } as any, priority, important);
  }
  
  private calculateWorkerBody(): BodyPartConstant[] {
    // Use available energy if no workers exist (emergency spawn)
    // OR if room doesn't have at least 90% energy capacity (still accumulating)
    const noWorkers = this.workers.length === 0;
    const energyRatio = this.highCharity.energyAvailable / this.highCharity.energyCapacity;
    const useAvailable = noWorkers || energyRatio < 0.9;
    
    const energy = useAvailable ? 
      Math.max(this.highCharity.energyAvailable, 200) : // At least 200 for minimal body
      this.highCharity.energyCapacity;
    
    // Use BodyBuilder for flexible upgrader body
    return BodyBuilder.upgrader(energy);
  }
  
  protected getCreepsForRole(): Creep[] {
    return this.room.find(FIND_MY_CREEPS, {
      filter: (creep) => 
        creep.memory.arbiter === this.ref ||
        RoleHelpers.isUpgrader(creep.memory.role || '')
    });
  }
}
