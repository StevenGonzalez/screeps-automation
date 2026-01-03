/**
 * HAULER ARBITER - Energy Logistics Manager
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

/**
 * Hauler Arbiter - Manages energy distribution
 */
export class StewardArbiter extends Arbiter {
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
    
    if (currentHaulers < desiredHaulers && Game.time % 10 === 0) {
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
    // Priority: Containers > Dropped resources > Storage
    
    // Find containers with energy
    const containers = this.room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
                     s.store.getUsedCapacity(RESOURCE_ENERGY) > 100
    }) as StructureContainer[];
    
    if (containers.length > 0) {
      const closest = hauler.pos.findClosestByPath(containers);
      if (closest) {
        hauler.withdrawFrom(closest);
        hauler.say('🔋');
        return;
      }
    }
    
    // Find dropped energy
    const dropped = hauler.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
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
    // Priority: Spawns/Extensions > Towers > Storage
    
    // Find structures needing energy
    const targets = this.room.find(FIND_MY_STRUCTURES, {
      filter: (s) => {
        if (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) {
          return s.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
        }
        if (s.structureType === STRUCTURE_TOWER) {
          return s.store.getFreeCapacity(RESOURCE_ENERGY) > 200;
        }
        return false;
      }
    });
    
    if (targets.length > 0) {
      const closest = hauler.pos.findClosestByPath(targets);
      if (closest) {
        hauler.transferTo(closest);
        hauler.say('⚡');
        return;
      }
    }
    
    // No priority targets, store in storage
    if (this.highCharity.storage) {
      hauler.transferTo(this.highCharity.storage);
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
    
    // Check if there are containers near sources (Extractors active)
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
    const name = `Steward_${Game.time}`;
    
    // Stewards are CRITICAL during bootstrap (extractors need haulers to function)
    const priority = this.highCharity.isBootstrapping && this.haulers.length === 0 ?
      SpawnPriority.CRITICAL :
      SpawnPriority.ECONOMY;
    
    const important = this.highCharity.isBootstrapping && this.haulers.length === 0;
    
    this.requestSpawn(body, name, {
      role: 'elite_hauler', // Covenant themed role
      collecting: true
    } as any, priority, important);
  }
  
  private calculateHaulerBody(): BodyPartConstant[] {
    // Use capacity for body planning (not current available energy)
    // SpawnQueue will handle waiting for enough energy
    const energy = this.highCharity.energyCapacity;
    
    // Emergency: Minimal hauler (150 energy)
    if (energy < 250) {
      return [CARRY, MOVE];
    }
    
    // Early game: Small hauler (200 energy)
    if (energy < 400) {
      return [CARRY, CARRY, MOVE, MOVE];
    }
    
    // Mid game: Medium hauler
    if (energy < 800) {
      return [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE];
    }
    
    // Late game: Large hauler (balanced carry/move)
    const pattern: BodyPartConstant[] = [CARRY, CARRY, MOVE];
    return this.calculateBody(pattern, 8);
  }
  
  protected getCreepsForRole(): Creep[] {
    return this.room.find(FIND_MY_CREEPS, {
      filter: (creep) => 
        creep.memory.arbiter === this.ref ||
        creep.memory.role === 'elite_hauler' ||
        creep.memory.role === 'hauler'
    });
  }
}
