/**
 * JACKAL ARBITER - Energy Logistics Manager
 * 
 * "The supply lines must remain unbroken"
 * 
 * Manages hauler Elites that transport energy from containers/storage
 * to spawns, extensions, and towers. Critical for colony operations.
 */

/// <reference types="@types/screeps" />

import { Arbiter, ArbiterPriority } from './Arbiter';
import { SpawnPriority } from '../spawning/SpawnQueue';
import { HighCharity } from '../core/HighCharity';
import { Elite } from '../elites/Elite';
import { LogisticsRequest, RequestPriority, RequestType } from '../logistics/LogisticsRequest';
import { ROLES, RoleHelpers } from '../constants/Roles';
import { BodyBuilder } from '../utils/BodyBuilder';

/**
 * JACKAL ARBITER - Manages energy distribution
 */
export class JackalArbiter extends Arbiter {
  haulers: Elite[];
  
  constructor(highCharity: HighCharity) {
    super(highCharity, 'hauler', ArbiterPriority.economy.hauling);
    this.haulers = [];
  }
  
  init(): void {
    this.refresh();
    
    // Update haulers list from elites
    this.haulers = this.elites;
    
    // Request haulers if needed (once per 10 ticks to avoid spam)
    const desiredHaulers = this.calculateDesiredHaulers();
    const currentHaulers = this.haulers.length;
    
    const sources = this.room.find(FIND_SOURCES);
    let sourceContainers = 0;
    for (const source of sources) {
      const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: s => s.structureType === STRUCTURE_CONTAINER
      });
      if (containers.length > 0) sourceContainers++;
    }
    // Debug logging (throttled)
    if (Game.time % 50 === 0) {
      console.log(`🚚 ${this.print}: ${currentHaulers}/${desiredHaulers} haulers (source containers: ${sourceContainers})`);
    }
    
    // Request spawn whenever we need more haulers
    // SpawnQueue handles deduplication, so it's safe to request every tick
    if (currentHaulers < desiredHaulers) {
      this.requestHauler();
    }
  }
  
  run(): void {
    for (const hauler of this.haulers) {
      this.runHauler(hauler);
    }
  }
  
  private runHauler(hauler: Elite): void {
    // State machine: collecting → delivering
    if (hauler.memory.collecting && hauler.isFull) {
      hauler.memory.collecting = false;
    }
    if (!hauler.memory.collecting && hauler.needsEnergy) {
      hauler.memory.collecting = true;
    }
    
    if (hauler.memory.collecting) {
      this.collectEnergy(hauler);
    } else {
      this.deliverEnergy(hauler);
    }
  }
  
  private collectEnergy(hauler: Elite): void {
    // Priority: Storage Link > Containers > Dropped resources > Storage
    
    // Check for storage link first (instant energy distribution)
    if (this.highCharity.linkTemple?.isActive()) {
      const storageLink = this.highCharity.linkTemple.getStorageLink();
      if (storageLink && storageLink.store.getUsedCapacity(RESOURCE_ENERGY) > 100) {
        hauler.withdrawFrom(storageLink);
        hauler.say('⚡');
        return;
      }
    }
    
    // Find containers with energy - prioritize by energy amount, then range
    const containers = this.room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
                     s.store.getUsedCapacity(RESOURCE_ENERGY) > 100
    }) as StructureContainer[];
    
    if (containers.length > 0) {
      // Sort by energy amount (most first), then by range (closest first)
      const sorted = containers.sort((a, b) => {
        const aEnergy = a.store.getUsedCapacity(RESOURCE_ENERGY);
        const bEnergy = b.store.getUsedCapacity(RESOURCE_ENERGY);
        
        // Prioritize containers with >500 energy significantly
        if (aEnergy > 500 && bEnergy <= 500) return -1;
        if (bEnergy > 500 && aEnergy <= 500) return 1;
        
        // Otherwise prefer more energy
        if (Math.abs(aEnergy - bEnergy) > 200) {
          return bEnergy - aEnergy;
        }
        
        // If similar amounts, prefer closer
        return hauler.pos.getRangeTo(a) - hauler.pos.getRangeTo(b);
      });
      
      const target = sorted[0];
      if (target) {
        hauler.withdrawFrom(target);
        hauler.say('🔋');
        return;
      }
    }
    
    // Find dropped energy
    const dropped = hauler.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
      filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50
    });
    
    if (dropped) {
      if (hauler.pos.isNearTo(dropped)) {
        hauler.pickup(dropped);
      } else {
        hauler.goTo(dropped);
      }
      hauler.say('💎');
      return;
    }
    
    // Use storage if available
    if (this.highCharity.storage && 
        this.highCharity.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 1000) {
      hauler.withdrawFrom(this.highCharity.storage);
      hauler.say('🏦');
      return;
    }
    
    // Nothing to collect, idle
    hauler.say('💤');
  }
  
  private deliverEnergy(hauler: Elite): void {
    const storage = this.highCharity.storage;
    
    // Priority 1: Fill spawns and extensions first (always)
    const spawnExtensions = this.room.find(FIND_MY_STRUCTURES, {
      filter: (s) => (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
                     s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });
    
    if (spawnExtensions.length > 0) {
      const closest = hauler.pos.findClosestByRange(spawnExtensions);
      if (closest) {
        hauler.transferTo(closest);
        hauler.say('⚡');
        return;
      }
    }
    
    // Priority 2: Fill towers if low
    const towers = this.room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_TOWER &&
                     s.store.getFreeCapacity(RESOURCE_ENERGY) > 200
    }) as StructureTower[];
    
    if (towers.length > 0) {
      const closest = hauler.pos.findClosestByRange(towers);
      if (closest) {
        hauler.transferTo(closest);
        hauler.say('🗼');
        return;
      }
    }
    
    // Priority 3: Fill storage with surplus
    if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
      hauler.transferTo(storage);
      hauler.say('📦');
      return;
    }
    
    // Nothing to do
    hauler.say('✋');
  }
  
  /**
   * Get logistics requests from this Arbiter
   */
  getLogisticsRequests(): LogisticsRequest[] {
    const requests: LogisticsRequest[] = [];
    
    // Create withdraw requests for spawns and extensions
    const spawnExtensions = this.room.find(FIND_MY_STRUCTURES, {
      filter: (s) => {
        if (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) {
          return s.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
        }
        return false;
      }
    });
    
    for (const structure of spawnExtensions) {
      const store = (structure as StructureSpawn | StructureExtension).store;
      requests.push(new LogisticsRequest({
        id: `hauler_spawn_${structure.id}`,
        target: structure,
        resourceType: RESOURCE_ENERGY,
        amount: store.getFreeCapacity(RESOURCE_ENERGY),
        priority: RequestPriority.CRITICAL,
        type: RequestType.WITHDRAW,
        arbiterName: this.ref
      }));
    }
    
    // Create withdraw requests for towers
    const towers = this.highCharity.towers.filter(t => 
      t.store.getFreeCapacity(RESOURCE_ENERGY) > 200
    );
    
    for (const tower of towers) {
      requests.push(new LogisticsRequest({
        id: `hauler_tower_${tower.id}`,
        target: tower,
        resourceType: RESOURCE_ENERGY,
        amount: tower.store.getFreeCapacity(RESOURCE_ENERGY),
        priority: RequestPriority.HIGH,
        type: RequestType.WITHDRAW,
        arbiterName: this.ref
      }));
    }
    
    return requests;
  }
  
  private calculateDesiredHaulers(): number {
    const phase = this.highCharity.memory.phase;
    const hasStorage = !!this.highCharity.storage;
    
    // Check if there are containers near sources (Drone active)
    const sources = this.room.find(FIND_SOURCES);
    let sourceContainers = 0;
    for (const source of sources) {
      const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: s => s.structureType === STRUCTURE_CONTAINER
      });
      if (containers.length > 0) sourceContainers++;
    }
    
    // No source containers = Acolytes handling energy themselves
    if (sourceContainers === 0) {
      return 0; // Acolytes deliver directly, no haulers needed
    }
    
    // Bootstrap: 1-2 haulers once miners are active
    if (phase === 'bootstrap') {
      return sourceContainers >= 2 ? 2 : 1;
    }
    
    // Developing: 2-3 haulers
    if (phase === 'developing') {
      return hasStorage ? 2 : 3;
    }
    
    // Mature: 2 haulers (storage available)
    if (phase === 'mature') {
      return 2;
    }
    
    // Powerhouse: 1-2 haulers (highly efficient)
    return 2;
  }
  
  private requestHauler(): void {
    const body = this.calculateHaulerBody();
    const name = `Jackal_${Game.time}`;
    
    // Check if we have any miners active (Jackals need miners to exist first!)
    const hasMiners = this.room.find(FIND_MY_CREEPS, {
      filter: c => RoleHelpers.isMiner(c.memory.role || '')
    }).length > 0;
    
    // Jackals are CRITICAL if no haulers exist at all (colony is stuck!)
    // Otherwise ECONOMY priority
    const noHaulers = this.haulers.length === 0;
    const priority = (hasMiners && noHaulers) ?
      SpawnPriority.CRITICAL :
      SpawnPriority.ECONOMY;
    
    // Important if no haulers - we need at least one to move energy!
    const important = noHaulers;
    
    this.requestSpawn(body, name, {
      role: ROLES.ELITE_JACKAL, // Covenant themed role
      collecting: true
    } as any, priority, important);
  }
  
  private calculateHaulerBody(): BodyPartConstant[] {
    // Use available energy if no haulers exist (emergency) or during bootstrap
    // OR if room doesn't have at least 90% energy capacity (still accumulating)
    const noHaulers = this.haulers.length === 0;
    const energyRatio = this.highCharity.energyAvailable / this.highCharity.energyCapacity;
    const useAvailable = this.highCharity.isBootstrapping || noHaulers || energyRatio < 0.9;
    
    const energy = useAvailable ? 
      this.highCharity.energyAvailable : 
      this.highCharity.energyCapacity;
    
    // Use BodyBuilder to create flexible hauler body
    return BodyBuilder.hauler(energy);
  }
  
  protected getCreepsForRole(): Creep[] {
    return this.room.find(FIND_MY_CREEPS, {
      filter: (creep) => 
        creep.memory.arbiter === this.ref ||
        RoleHelpers.isHauler(creep.memory.role || '')
    });
  }
}

