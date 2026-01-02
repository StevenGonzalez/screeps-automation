/**
 * TEMPLE - Structure Cluster Base Class
 * 
 * "Sacred places of power and production"
 * 
 * Temples are clusters of related structures that work together.
 * Examples: Mining temples (source + container), Command temples (spawn + extensions),
 * War temples (towers + ramparts)
 */

/// <reference types="@types/screeps" />

import { HighCharity } from '../core/HighCharity';

/**
 * Base class for all Temples
 */
export abstract class Temple {
  highCharity: HighCharity;
  room: Room;
  pos: RoomPosition;
  memory: any;
  
  constructor(highCharity: HighCharity, pos: RoomPosition) {
    this.highCharity = highCharity;
    this.room = highCharity.room;
    this.pos = pos;
    
    // Initialize memory
    const templeName = this.constructor.name;
    if (!Memory.rooms[highCharity.name]) {
      Memory.rooms[highCharity.name] = {} as any;
    }
    const roomMem: any = Memory.rooms[highCharity.name];
    if (!roomMem.temples) {
      roomMem.temples = {};
    }
    if (!roomMem.temples[templeName]) {
      roomMem.temples[templeName] = {};
    }
    this.memory = roomMem.temples[templeName];
  }
  
  /**
   * Initialize phase - gather references
   */
  abstract init(): void;
  
  /**
   * Run phase - execute temple operations
   */
  abstract run(): void;
  
  /**
   * Get the print representation
   */
  get print(): string {
    return `<a href="#!/room/${Game.shard.name}/${this.room.name}">[${this.constructor.name}]</a>`;
  }
}
