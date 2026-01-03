/**
 * REMOTE HARVESTER ARBITER - Remote Mining Operations
 * 
 * "Through distant lands, resources flow"
 * 
 * Manages remote harvesters that mine sources in unowned rooms.
 */

/// <reference types="@types/screeps" />

import { Arbiter } from './Arbiter';
import { HighCharity } from '../core/HighCharity';
import { Elite } from '../elites/Elite';
import { BodyBuilder } from '../utils/BodyBuilder';

export class RemoteHarvesterArbiter extends Arbiter {
  sourceId: Id<Source>;
  remoteRoom: string;
  
  constructor(highCharity: HighCharity, sourceId: Id<Source>, remoteRoom: string) {
    const source = Game.getObjectById(sourceId);
    const ref = `remote_harvester_${remoteRoom}_${sourceId}`;
    super(highCharity, ref, 305); // Priority between hauler and upgrader
    
    this.sourceId = sourceId;
    this.remoteRoom = remoteRoom;
  }
  
  init(): void {
    this.gatherElites();
  }
  
  run(): void {
    for (const harvester of this.elites) {
      this.runHarvester(harvester);
    }
  }
  
  private runHarvester(harvester: Elite): void {
    const source = Game.getObjectById(this.sourceId);
    if (!source) return;
    
    // SAFETY CHECK: Retreat immediately if hostiles detected
    const hostiles = harvester.creep.room.find(FIND_HOSTILE_CREEPS);
    if (hostiles.length > 0) {
      // Flee to home room
      if (harvester.creep.room.name !== this.highCharity.name) {
        const exit = harvester.creep.pos.findClosestByPath(FIND_EXIT);
        if (exit) {
          harvester.creep.moveTo(exit, { 
            maxRooms: 1,
            visualizePathStyle: { stroke: '#ff0000' }
          });
        }
      }
      return;
    }
    
    // Move to source room if not there
    if (harvester.creep.room.name !== this.remoteRoom) {
      harvester.creep.moveTo(source.pos, {
        reusePath: 50,
        visualizePathStyle: { stroke: '#ffaa00' }
      });
      return;
    }
    
    // Check if source is blocked by construction site
    const constructionSites = source.pos.lookFor(LOOK_CONSTRUCTION_SITES);
    if (constructionSites.length > 0 && !constructionSites[0].my) {
      // Source is griefed, return home
      const exit = harvester.creep.pos.findClosestByPath(FIND_EXIT);
      if (exit) {
        harvester.creep.moveTo(exit);
      }
      return;
    }
    
    // Harvest
    if (harvester.creep.store.getFreeCapacity() > 0) {
      if (harvester.creep.harvest(source) === ERR_NOT_IN_RANGE) {
        harvester.creep.moveTo(source.pos, {
          reusePath: 10,
          visualizePathStyle: { stroke: '#ffaa00' }
        });
      }
    } else {
      // Drop resources for haulers
      for (const resourceType in harvester.creep.store) {
        harvester.creep.drop(resourceType as ResourceConstant);
      }
    }
  }
  
  getSpawnRequest(): any {
    const remoteOps = this.highCharity.remoteOperations;
    const required = remoteOps.getRequiredHarvesters(this.sourceId);
    const current = this.elites.length;
    
    if (current >= required) return null;
    
    // Remote harvester: flexible miner body capped at 800 energy to minimize losses
    const energy = Math.min(this.highCharity.room.energyCapacityAvailable, 800);
    const body = BodyBuilder.miner(energy);
    
    return {
      body,
      memory: {
        role: 'remote_harvester',
        arbiter: this.ref,
        sourceId: this.sourceId,
        targetRoom: this.remoteRoom
      },
      priority: 305, // Between hauler and upgrader
      name: `RH_${this.remoteRoom}_${Game.time % 1000}`
    };
  }
  
  protected gatherElites(): void {
    this.elites = [];
    
    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      if (
        creep.memory.arbiter === this.ref ||
        (creep.memory.role === 'remote_harvester' && 
         creep.memory.sourceId === this.sourceId)
      ) {
        this.elites.push(new Elite(creep, this));
      }
    }
  }
}
