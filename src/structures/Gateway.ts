/**
 * Gateway - Structure Cluster Base Class
 * 
 * "Sacred places of power and production"
 * 
 * gateways are clusters of related structures that work together.
 * Examples: Mining gateways (source + container), Command gateways (spawn + extensions),
 * War gateways (towers + ramparts)
 */

/// <reference types="@types/screeps" />

import { Nexus } from '../core/Nexus';

/**
 * Base class for all gateways
 */
export abstract class Gateway {
  Nexus: Nexus;
  room: Room;
  pos: RoomPosition;
  memory: any;
  
  constructor(Nexus: Nexus, pos: RoomPosition) {
    this.Nexus = Nexus;
    this.room = Nexus.room;
    this.pos = pos;
    
    // Initialize memory
    const GatewayName = this.constructor.name;
    if (!Memory.rooms[Nexus.name]) {
      Memory.rooms[Nexus.name] = {} as any;
    }
    const roomMem: any = Memory.rooms[Nexus.name];
    if (!roomMem.gateways) {
      roomMem.gateways = {};
    }
    if (!roomMem.gateways[GatewayName]) {
      roomMem.gateways[GatewayName] = {};
    }
    this.memory = roomMem.gateways[GatewayName];
  }
  
  /**
   * Initialize phase - gather references
   */
  abstract init(): void;
  
  /**
   * Run phase - execute Gateway operations
   */
  abstract run(): void;
  
  /**
   * Get the print representation
   */
  get print(): string {
    return `<a href="#!/room/${Game.shard.name}/${this.room.name}">[${this.constructor.name}]</a>`;
  }
}
