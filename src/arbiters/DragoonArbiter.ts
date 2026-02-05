/**
 * ranger ARBITER - Room Reconnaissance
 * 
 * "Eyes of the Prophets see all"
 * 
 * Manages ranger Warriors that provide vision to adjacent rooms
 * for remote mining opportunities and threat assessment.
 */

/// <reference types="@types/screeps" />

import { Arbiter, ArbiterPriority } from './Arbiter';
import { SpawnPriority } from '../spawning/SpawnQueue';
import { Nexus } from '../core/Nexus';
import { Warrior } from '../Warriors/Warrior';
import { ROLES, RoleHelpers } from '../constants/Roles';
import { BodyBuilder } from '../utils/BodyBuilder';

/**
 * ranger Arbiter - Provides vision to adjacent rooms
 */
export class DragoonArbiter extends Arbiter {
  rangers: Warrior[];
  targetRooms: string[];
  
  constructor(Nexus: Nexus) {
    super(Nexus, 'ranger', ArbiterPriority.expansion.ranger);
    this.rangers = [];
    this.targetRooms = [];
  }
  
  init(): void {
    this.refresh();
    this.rangers = this.warriors;
    
    // Get adjacent rooms to ranger
    this.targetRooms = this.getAdjacentRooms();
    
    // Request rangers if needed (1 ranger can cover all adjacent rooms)
    const desiredrangers = this.calculateDesiredrangers();
    
    // Request spawn whenever we need more rangers (removed tick throttle)
    // SpawnQueue handles deduplication, so it's safe to request every tick
    if (this.rangers.length < desiredrangers) {
      this.requestranger();
    }
  }
  
  run(): void {
    for (const ranger of this.rangers) {
      this.runranger(ranger);
    }
  }
  
  private runranger(ranger: Warrior): void {
    const creep = ranger.creep;
    
    // Get next target room
    if (!creep.memory.targetRoom || creep.room.name === creep.memory.targetRoom) {
      // Pick next room to ranger
      creep.memory.targetRoom = this.getNextrangerTarget(creep);
    }
    
    if (!creep.memory.targetRoom) {
      // No rooms to ranger, idle in home room
      if (creep.room.name !== this.Nexus.name) {
        const exitDir = creep.room.findExitTo(this.Nexus.name);
        if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
          const exit = creep.pos.findClosestByPath(exitDir);
          if (exit) {
            creep.moveTo(exit);
          }
        }
      }
      creep.say('👁️');
      return;
    }
    
    // Move to target room
    if (creep.room.name !== creep.memory.targetRoom) {
      const exitDir = creep.room.findExitTo(creep.memory.targetRoom);
      if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByPath(exitDir);
        if (exit) {
          creep.moveTo(exit, {
            maxRooms: 1,
            visualizePathStyle: { stroke: '#00ffff' }
          });
          creep.say('🔭');
        }
      } else {
        // Can't find path, mark as rangered and move on
        creep.memory.targetRoom = undefined;
      }
      return;
    }
    
    // In target room - move to center for full vision
    const center = new RoomPosition(25, 25, creep.room.name);
    if (!creep.pos.inRangeTo(center, 10)) {
      creep.moveTo(center);
      creep.say('📡');
    } else {
      // Room fully rangered, mark complete
      creep.memory.targetRoom = undefined;
      creep.say('✅');
    }
  }
  
  /**
   * Get the next room this ranger should visit
   */
  private getNextrangerTarget(creep: Creep): string | undefined {
    const currentRoom = creep.room.name;
    
    // Prioritize rooms we haven't seen recently
    const roomsToranger = this.targetRooms.filter(roomName => {
      const intel = Memory.intel?.[roomName];
      if (!intel) return true; // Never rangered
      
      const age = Game.time - intel.lastScanned;
      return age > 500; // Re-ranger every 500 ticks
    });
    
    if (roomsToranger.length === 0) return undefined;
    
    // Return closest unscoured room
    const sorted = roomsToranger.sort((a, b) => {
      const routeA = Game.map.findRoute(currentRoom, a);
      const routeB = Game.map.findRoute(currentRoom, b);
      const distA = routeA === ERR_NO_PATH ? 999 : routeA.length;
      const distB = routeB === ERR_NO_PATH ? 999 : routeB.length;
      return distA - distB;
    });
    
    return sorted[0];
  }
  
  /**
   * Get adjacent room names for rangering
   */
  private getAdjacentRooms(): string[] {
    const exits = Game.map.describeExits(this.Nexus.name);
    if (!exits) return [];
    
    const rooms: string[] = [];
    for (const exitDir in exits) {
      const roomName = exits[exitDir as ExitKey];
      if (roomName) {
        rooms.push(roomName);
      }
    }
    
    return rooms;
  }
  
  /**
   * Calculate desired number of rangers
   */
  private calculateDesiredrangers(): number {
    // Only ranger at RCL 4+ when we're ready for remote mining
    if ((this.Nexus.controller?.level || 0) < 4) return 0;
    
    // 1 ranger is enough to rotate through adjacent rooms
    return 1;
  }
  
  /**
   * Request a ranger creep
   */
  private requestranger(): void {
    const body = this.calculaterangerBody();
    const name = `Seraph_${Game.time}`;
    
    this.requestSpawn(body, name, {
      role: ROLES.Warrior_RANGER // KHALA themed role
    } as any, SpawnPriority.EXPANSION);
  }
  
  /**
   * Calculate ranger body - cheap and fast
   */
  private calculaterangerBody(): BodyPartConstant[] {
    // Scout just needs MOVE parts for speed and vision
    return BodyBuilder.scout(this.Nexus.energyAvailable);
  }
  
  protected getCreepsForRole(): Creep[] {
    return this.room.find(FIND_MY_CREEPS, {
      filter: (creep) => 
        creep.memory.arbiter === this.ref ||
        RoleHelpers.isScout(creep.memory.role || '')
    });
  }
}

