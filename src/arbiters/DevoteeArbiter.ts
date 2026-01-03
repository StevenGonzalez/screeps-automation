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
import { RoleHelpers } from '../constants/Roles';

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
    
    console.log(`📚 ${this.print}: ${currentWorkers}/${desiredWorkers} workers (phase: ${this.highCharity.memory.phase})`);
    
    // Request immediately if we have 0 but need some, otherwise every 10 ticks
    if (currentWorkers < desiredWorkers && (currentWorkers === 0 || Game.time % 10 === 0)) {
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
    // Priority: Upgrader Link > Containers > Storage > Harvest directly
    
    // Check for upgrader/controller link first
    if (this.highCharity.linkTemple?.isActive()) {
      const upgraderLink = this.highCharity.linkTemple.getUpgraderLink();
      if (upgraderLink && upgraderLink.store.getUsedCapacity(RESOURCE_ENERGY) > 50) {
        worker.withdrawFrom(upgraderLink);
        worker.say('⚡');
        return;
      }
    }
    
    // Find nearby container with energy
    const container = worker.pos.findClosestByPath(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
                     s.store.getUsedCapacity(RESOURCE_ENERGY) > 50
    }) as StructureContainer | null;
    
    if (container) {
      worker.withdrawFrom(container);
      worker.say('🔋');
      return;
    }
    
    // Use storage if available and we're high RCL
    if (this.highCharity.storage && 
        this.highCharity.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 5000) {
      worker.withdrawFrom(this.highCharity.storage);
      worker.say('🏦');
      return;
    }
    
    // Find dropped resources
    const dropped = worker.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
      filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50
    });
    
    if (dropped) {
      if (worker.pos.isNearTo(dropped)) {
        worker.pickup(dropped);
      } else {
        worker.goTo(dropped);
      }
      worker.say('💎');
      return;
    }
    
    // Last resort: Harvest directly (early game)
    const source = worker.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (source) {
      worker.harvestSource(source);
      worker.say('⛏️');
    }
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
    const name = `Devotee_${Game.time}`;
    
    // Workers are ECONOMY priority (can wait until energy is flowing)
    const priority = SpawnPriority.ECONOMY;
    const important = false;
    
    this.requestSpawn(body, name, {
      role: 'elite_worker', // Covenant themed role
      upgrading: false
    } as any, priority, important);
  }
  
  private calculateWorkerBody(): BodyPartConstant[] {
    // Use available energy if bootstrapping, otherwise use capacity
    const totalCreeps = this.room.find(FIND_MY_CREEPS).length;
    const energy = totalCreeps === 0 ? this.highCharity.energyAvailable : this.highCharity.energyCapacity;
    
    // Emergency: Minimal worker (200 energy)
    if (energy < 300) {
      return [WORK, CARRY, MOVE];
    }
    
    // Early game: Small worker (250 energy)
    if (energy < 450) {
      return [WORK, CARRY, MOVE, MOVE];
    }
    
    // Mid game: Balanced worker (450 energy)
    if (energy < 800) {
      return [WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE];
    }
    
    // Late game: Large worker (3 WORK per CARRY for efficiency)
    const pattern: BodyPartConstant[] = [WORK, WORK, WORK, CARRY, MOVE, MOVE];
    return this.calculateBody(pattern, 5);
  }
  
  protected getCreepsForRole(): Creep[] {
    return this.room.find(FIND_MY_CREEPS, {
      filter: (creep) => 
        creep.memory.arbiter === this.ref ||
        RoleHelpers.isUpgrader(creep.memory.role || '')
    });
  }
}
