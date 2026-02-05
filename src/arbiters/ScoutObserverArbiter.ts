/**
 * REMOTE MINING ARBITER - Distant Harvest Operations
 * 
 * "The Prophets' reach extends beyond our borders"
 * 
 * Manages remote mining operations in adjacent rooms.
 * Coordinates remote miners and haulers to extract energy from distant sources.
 */

/// <reference types="@types/screeps" />

import { Arbiter, ArbiterPriority, ArbiterMemory } from './Arbiter';
import { Nexus } from '../core/Nexus';
import { Warrior } from '../Warriors/Warrior';
import { BodyBuilder } from '../utils/BodyBuilder';
import { ROLES } from '../constants/Roles';

interface RemoteMiningMemory extends ArbiterMemory {
  targetRoom: string;
  sourceId: string;
  active: boolean;
  lastCheck: number;
}

/**
 * Remote Mining Arbiter - Manages one remote source
 */
export class ObserverArbiter extends Arbiter {
  targetRoom: string;
  sourceId: Id<Source>;
  miners: Warrior[];
  haulers: Warrior[];
  
  constructor(Nexus: Nexus, targetRoom: string, sourceId: Id<Source>) {
    super(Nexus, `remoteMining_${targetRoom}_${sourceId}`, ArbiterPriority.economy.mining);
    this.targetRoom = targetRoom;
    this.sourceId = sourceId;
    this.miners = [];
    this.haulers = [];
    
    // Initialize memory
    const rmMemory = this.memory as RemoteMiningMemory;
    if (!rmMemory.targetRoom) {
      rmMemory.targetRoom = targetRoom;
      rmMemory.sourceId = sourceId;
      rmMemory.active = true;
      rmMemory.lastCheck = Game.time;
    }
  }
  
  init(): void {
    this.refresh();
    
    // Check if remote room is still safe
    if (Game.time % 50 === 0) {
      this.checkRoomSafety();
    }
    
    const rmMemory = this.memory as RemoteMiningMemory;
    if (!rmMemory.active) {
      // Room is unsafe, recall all creeps
      return;
    }
    
    // Request miners
    const desiredMiners = 1; // One dedicated miner per source
    if (this.miners.length < desiredMiners) {
      this.requestRemoteMiner();
    }
    
    // Request haulers based on distance
    const desiredHaulers = this.calculateHaulerCount();
    if (this.haulers.length < desiredHaulers) {
      this.requestRemoteHauler();
    }
  }
  
  run(): void {
    const rmMemory = this.memory as RemoteMiningMemory;
    if (!rmMemory.active) return;
    
    // Run miners
    for (const miner of this.miners) {
      this.runRemoteMiner(miner);
    }
    
    // Run haulers
    for (const hauler of this.haulers) {
      this.runRemoteHauler(hauler);
    }
  }
  
  private runRemoteMiner(miner: Warrior): void {
    const creep = miner.creep;
    
    // Move to target room if not there
    if (creep.room.name !== this.targetRoom) {
      const exitDir = creep.room.findExitTo(this.targetRoom);
      if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByPath(exitDir);
        if (exit) {
          miner.goTo(exit);
          miner.say('🚀');
        }
      }
      return;
    }
    
    // In target room - mine the source
    const source = Game.getObjectById(this.sourceId);
    if (!source) {
      console.log(`⚠️ Remote source ${this.sourceId} not found in ${this.targetRoom}`);
      return;
    }
    
    // Build container if needed
    if (miner.isFull) {
      const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: s => s.structureType === STRUCTURE_CONTAINER
      })[0] as StructureContainer | undefined;
      
      if (container) {
        miner.transferTo(container);
      } else {
        // Check for construction site
        const site = source.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 1, {
          filter: s => s.structureType === STRUCTURE_CONTAINER
        })[0];
        
        if (site) {
          miner.buildSite(site);
        } else {
          // Place construction site
          const adjacentPos = source.pos.findInRange(FIND_EXIT, 1)
            .filter(pos => pos instanceof RoomPosition)
            .find(pos => {
              const terrain = new Room.Terrain(this.targetRoom);
              return terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL;
            });
          
          if (adjacentPos) {
            creep.room.createConstructionSite(adjacentPos.x, adjacentPos.y, STRUCTURE_CONTAINER);
          }
        }
      }
    } else {
      miner.harvestSource(source);
      miner.say('⛏️');
    }
  }
  
  private runRemoteHauler(hauler: Warrior): void {
    const creep = hauler.creep;
    
    // State: collecting or delivering
    if (creep.memory.collecting && hauler.isFull) {
      creep.memory.collecting = false;
    }
    if (!creep.memory.collecting && hauler.needsEnergy) {
      creep.memory.collecting = true;
    }
    
    if (creep.memory.collecting) {
      // Go to remote room and collect
      if (creep.room.name !== this.targetRoom) {
        const exitDir = creep.room.findExitTo(this.targetRoom);
        if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
          const exit = creep.pos.findClosestByPath(exitDir);
          if (exit) {
            hauler.goTo(exit);
            hauler.say('🚀');
          }
        }
        return;
      }
      
      // In remote room - collect from container or ground
      const source = Game.getObjectById(this.sourceId);
      if (!source) return;
      
      const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: s => s.structureType === STRUCTURE_CONTAINER
      })[0] as StructureContainer | undefined;
      
      if (container && container.store.getUsedCapacity(RESOURCE_ENERGY) > 50) {
        hauler.withdrawFrom(container);
        hauler.say('🔋');
      } else {
        // Pick up dropped energy
        const dropped = source.pos.findInRange(FIND_DROPPED_RESOURCES, 2, {
          filter: r => r.resourceType === RESOURCE_ENERGY
        })[0];
        
        if (dropped) {
          if (hauler.pos.isNearTo(dropped)) {
            creep.pickup(dropped);
          } else {
            hauler.goTo(dropped);
          }
          hauler.say('💎');
        }
      }
    } else {
      // Return to home room and deliver
      if (creep.room.name !== this.Nexus.name) {
        const exitDir = creep.room.findExitTo(this.Nexus.name);
        if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
          const exit = creep.pos.findClosestByPath(exitDir);
          if (exit) {
            hauler.goTo(exit);
            hauler.say('🏠');
          }
        }
        return;
      }
      
      // In home room - deliver to storage or spawn/extensions
      if (this.Nexus.storage) {
        hauler.transferTo(this.Nexus.storage);
        hauler.say('📦');
      } else {
        // Deliver to spawns/extensions
        const target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
          filter: s => {
            if (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) {
              return s.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
            return false;
          }
        });
        
        if (target) {
          hauler.transferTo(target as any);
          hauler.say('⚡');
        }
      }
    }
  }
  
  private checkRoomSafety(): void {
    const rmMemory = this.memory as RemoteMiningMemory;
    
    // Check if we have vision
    const room = Game.rooms[this.targetRoom];
    if (!room) {
      // No vision - assume safe
      rmMemory.active = true;
      return;
    }
    
    // Check for hostiles
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    const dangerousHostiles = hostiles.filter(h => {
      // Check if hostile has attack parts
      return h.body.some(p => 
        p.type === ATTACK || 
        p.type === RANGED_ATTACK || 
        p.type === WORK
      );
    });
    
    if (dangerousHostiles.length > 0) {
      rmMemory.active = false;
      console.log(`⚠️ Remote mining in ${this.targetRoom} suspended due to hostiles`);
    } else {
      rmMemory.active = true;
    }
  }
  
  private calculateHaulerCount(): number {
    // Calculate based on distance
    const route = Game.map.findRoute(this.Nexus.name, this.targetRoom);
    if (route === ERR_NO_PATH) return 0;
    
    const distance = Array.isArray(route) ? route.length : 1;
    
    // More haulers for longer distances
    if (distance === 1) return 2;
    if (distance === 2) return 3;
    return Math.min(5, distance + 1);
  }
  
  private requestRemoteMiner(): void {
    const body = this.calculateMinerBody();
    const name = `Seeker_${this.targetRoom}_${Game.time}`;
    
    this.requestSpawn(body, name, {
      role: ROLES.Warrior_REMOTE_MINER,
      targetRoom: this.targetRoom,
      sourceId: this.sourceId
    } as any);
  }
  
  private requestRemoteHauler(): void {
    const body = this.calculateHaulerBody();
    const name = `Convoy_${this.targetRoom}_${Game.time}`;
    
    this.requestSpawn(body, name, {
      role: ROLES.Warrior_REMOTE_HAULER,
      targetRoom: this.targetRoom,
      sourceId: this.sourceId,
      collecting: true
    } as any);
  }
  
  private calculateMinerBody(): BodyPartConstant[] {
    // Remote miners need work parts for harvesting
    // Use capacity when not bootstrapping for full-size bodies
    const totalCreeps = this.room.find(FIND_MY_CREEPS).length;
    const energyRatio = this.Nexus.energyAvailable / this.Nexus.energyCapacity;
    const useAvailable = this.Nexus.isBootstrapping || totalCreeps === 0 || energyRatio < 0.9;
    
    const energy = useAvailable ? 
      this.Nexus.energyAvailable : 
      this.Nexus.energyCapacity;
    
    return BodyBuilder.miner(energy);
  }
  
  private calculateHaulerBody(): BodyPartConstant[] {
    // Remote haulers need large carry capacity
    // Use capacity when not bootstrapping for full-size bodies
    const totalCreeps = this.room.find(FIND_MY_CREEPS).length;
    const energyRatio = this.Nexus.energyAvailable / this.Nexus.energyCapacity;
    const useAvailable = this.Nexus.isBootstrapping || totalCreeps === 0 || energyRatio < 0.9;
    
    const energy = useAvailable ? 
      this.Nexus.energyAvailable : 
      this.Nexus.energyCapacity;
    
    return BodyBuilder.hauler(energy);
  }
  
  protected getCreepsForRole(): Creep[] {
    const miners = this.room.find(FIND_MY_CREEPS, {
      filter: (creep) => 
        creep.memory.arbiter === this.ref ||
        (creep.memory.role === ROLES.Warrior_REMOTE_MINER && 
         (creep.memory as any).targetRoom === this.targetRoom &&
         (creep.memory as any).sourceId === this.sourceId)
    });
    
    const haulers = this.room.find(FIND_MY_CREEPS, {
      filter: (creep) => 
        creep.memory.arbiter === this.ref ||
        (creep.memory.role === ROLES.Warrior_REMOTE_HAULER && 
         (creep.memory as any).targetRoom === this.targetRoom &&
         (creep.memory as any).sourceId === this.sourceId)
    });
    
    this.miners = miners.map(c => new Warrior(c, this));
    this.haulers = haulers.map(c => new Warrior(c, this));
    
    return [...miners, ...haulers];
  }
}
