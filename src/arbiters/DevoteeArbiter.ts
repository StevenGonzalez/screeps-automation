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
    
    // Don't request if body is empty (not enough energy)
    if (body.length === 0) {
      console.log(`📚 Devotee spawn SKIPPED: Not enough energy for minimum body (need 200)`);
      return;
    }
    
    const name = `Devotee_${Game.time}`;
    
    console.log(`📚 Devotee spawn requested: body=${JSON.stringify(body)}, cost=${body.reduce((sum, part) => sum + BODYPART_COST[part], 0)}`);
    
    // Workers are ECONOMY priority (can wait until energy is flowing)
    // BUT: first worker should be important to spawn without waiting for 80% energy
    const priority = SpawnPriority.ECONOMY;
    const important = this.workers.length === 0; // First worker is important
    
    console.log(`📚 Devotee spawn: priority=${priority}, important=${important}, workers.length=${this.workers.length}`);
    
    this.requestSpawn(body, name, {
      role: ROLES.ELITE_DEVOTEE, // Covenant themed role
      upgrading: false
    } as any, priority, important);
  }
  
  private calculateWorkerBody(): BodyPartConstant[] {
    // ALWAYS use capacity for body calculation - we're planning what we WANT to spawn
    // SpawnQueue will wait until we have enough energy
    // Exception: If we have no creeps at all, use available energy for emergency minimal spawn
    const totalCreeps = this.room.find(FIND_MY_CREEPS).length;
    const energy = totalCreeps === 0 ? 
      Math.max(this.highCharity.energyAvailable, 200) : // At least 200 for minimal body
      this.highCharity.energyCapacity;
    
    console.log(`📚 calculateWorkerBody: energy=${energy}, available=${this.highCharity.energyAvailable}, capacity=${this.highCharity.energyCapacity}, isBootstrapping=${this.highCharity.isBootstrapping}, totalCreeps=${totalCreeps}`);
    
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
