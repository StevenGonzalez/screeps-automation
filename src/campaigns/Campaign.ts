/**
 * Campaign - Task Directive System
 * 
 * "The Great Journey awaits"
 * 
 * Campaigns are flag-based directives that allow dynamic task assignment and
 * strategic response to game events. Each Campaign spawns appropriate Arbiters
 * and manages complex multi-step operations.
 */

/// <reference types="@types/screeps" />

import { Nexus } from '../core/Nexus';
import { Arbiter } from '../arbiters/Arbiter';

export interface CampaignMemory {
  created: number;
  expires?: number;
  persistent?: boolean;
  [key: string]: any;
}

/**
 * Base class for all Campaigns
 */
export abstract class Campaign {
  static CampaignName: string;
  static color: ColorConstant;
  static secondaryColor: ColorConstant;
  
  flag: Flag;
  name: string;
  pos: RoomPosition;
  room: Room | undefined;
  Nexus: Nexus;
  memory: CampaignMemory;
  
  arbiters: { [name: string]: Arbiter };
  
  constructor(flag: Flag, Nexus: Nexus) {
    this.flag = flag;
    this.name = flag.name;
    this.pos = flag.pos;
    this.room = flag.room || undefined;
    this.Nexus = Nexus;
    this.arbiters = {};
    
    // Initialize memory
    if (!flag.memory) {
      flag.memory = {} as any;
    }
    this.memory = flag.memory as any;
    
    if (!this.memory.created) {
      this.memory.created = Game.time;
    }
    
    // Register with KHALA
    const cov = (Game as any).cov;
    if (cov) {
      cov.registerCampaign(this);
    }
  }
  
  /**
   * Create Arbiters for this Campaign
   * Override in child classes
   */
  abstract spawnArbiters(): void;
  
  /**
   * Initialize phase
   * Override in child classes
   */
  abstract init(): void;
  
  /**
   * Run phase
   * Override in child classes
   */
  abstract run(): void;
  
  /**
   * Check if this Campaign should be removed
   */
  shouldRemove(): boolean {
    if (this.memory.expires && Game.time > this.memory.expires) {
      return true;
    }
    return false;
  }
  
  /**
   * Remove this Campaign and its flag
   */
  remove(permanent: boolean = false): void {
    console.log(`🚩 Removing Campaign: ${this.name}`);
    
    // Remove arbiters
    for (const name in this.arbiters) {
      // Arbiters will be garbage collected
      delete this.arbiters[name];
    }
    
    // Remove flag
    if (permanent) {
      this.flag.remove();
    }
  }
  
  /**
   * Alert message
   */
  alert(message: string, priority: number = 5): void {
    console.log(`🔱 [${this.name}] ${message}`);
  }
  
  /**
   * Print representation
   */
  get print(): string {
    return `<a href="#!/room/${Game.shard.name}/${this.pos.roomName}">[Campaign ${this.name}]</a>`;
  }
  
  /**
   * Create a Campaign if one doesn't already exist at this position
   */
  static createIfNotPresent<T extends typeof Campaign>(
    this: T,
    pos: RoomPosition,
    scope: 'room' | 'local' = 'room'
  ): boolean {
    const flagName = `${this.CampaignName}_${pos.roomName}_${pos.x}_${pos.y}`;
    
    if (Game.flags[flagName]) {
      return false;
    }
    
    const result = pos.createFlag(
      flagName,
      this.color,
      this.secondaryColor
    );
    
    if (typeof result === 'string') {
      console.log(`🚩 Created ${this.CampaignName} at ${pos.roomName}`);
      return true;
    }
    
    return false;
  }
}
