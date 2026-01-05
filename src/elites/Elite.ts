/**
 * ELITE - Enhanced Creep Wrapper
 * 
 * "Warriors of the Covenant"
 * 
 * Elites are enhanced wrappers around Creep objects that provide additional
 * functionality for movement, tasks, boosting, and combat.
 */

/// <reference types="@types/screeps" />

import { Arbiter } from '../arbiters/Arbiter';

/**
 * Elite - Enhanced creep wrapper
 */
export class Elite {
  creep: Creep;
  arbiter: Arbiter | null;
  
  // Cached immutable properties (name and body don't change)
  private _body: BodyPartDefinition[];
  private _name: string;
  
  constructor(creep: Creep, arbiter: Arbiter | null = null) {
    this.creep = creep;
    this.arbiter = arbiter;
    
    // Cache immutable properties only (name and body never change)
    this._body = creep.body;
    this._name = creep.name;
  }
  
  // === Wrapper Properties ===
  
  get name(): string {
    return this._name;
  }
  
  get pos(): RoomPosition {
    return this.creep.pos;
  }
  
  get room(): Room {
    return this.creep.room;
  }
  
  get memory(): CreepMemory {
    return this.creep.memory;
  }
  
  set memory(value: CreepMemory) {
    this.creep.memory = value;
  }
  
  get body(): BodyPartDefinition[] {
    return this._body;
  }
  
  get hits(): number {
    return this.creep.hits;
  }
  
  get hitsMax(): number {
    return this.creep.hitsMax;
  }
  
  get carry(): StoreDefinition {
    return this.creep.carry;
  }
  
  get store(): StoreDefinition {
    return this.creep.store;
  }
  
  get carryCapacity(): number {
    return this.creep.carryCapacity;
  }
  
  get fatigue(): number {
    return this.creep.fatigue;
  }
  
  get spawning(): boolean {
    return this.creep.spawning;
  }
  
  get ticksToLive(): number | undefined {
    return this.creep.ticksToLive;
  }
  
  // === Enhanced Methods ===
  
  /**
   * Check if the Elite is idle (no task assigned)
   */
  get isIdle(): boolean {
    return !this.memory.task && !this.memory.working;
  }
  
  /**
   * Check if the Elite needs energy
   */
  get needsEnergy(): boolean {
    return this.store.getUsedCapacity(RESOURCE_ENERGY) === 0;
  }
  
  /**
   * Check if the Elite is full of energy
   */
  get isFull(): boolean {
    return this.store.getFreeCapacity(RESOURCE_ENERGY) === 0;
  }
  
  /**
   * Check if the Elite is boosted
   */
  get isBoosted(): boolean {
    return this.body.some(part => !!part.boost);
  }
  
  /**
   * Get the boost labs for this Elite's room
   */
  getBoostLabs(): StructureLab[] {
    return this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_LAB
    }) as StructureLab[];
  }
  
  /**
   * Move to nearest boost lab
   */
  goToBoostLab(): number {
    const labs = this.getBoostLabs();
    if (labs.length === 0) return ERR_NOT_FOUND;
    
    const nearestLab = this.pos.findClosestByPath(labs);
    if (!nearestLab) return ERR_NOT_FOUND;
    
    return this.goTo(nearestLab);
  }
  
  /**
   * Smart movement to a target with path caching
   */
  goTo(target: RoomPosition | { pos: RoomPosition }, options: MoveToOpts = {}): number {
    const targetPos = target instanceof RoomPosition ? target : target.pos;
    
    // Default options with longer path reuse for CPU savings
    const moveOpts: MoveToOpts = {
      visualizePathStyle: { stroke: '#ffffff' },
      reusePath: 20, // Increased from 5 for better CPU performance
      ...options
    };
    
    return this.creep.moveTo(targetPos, moveOpts);
  }
  
  /**
   * Go to a room
   */
  goToRoom(roomName: string): number {
    const exitDir = this.room.findExitTo(roomName);
    if (exitDir === ERR_NO_PATH || exitDir === ERR_INVALID_ARGS) {
      return ERR_NO_PATH;
    }
    
    const exit = this.pos.findClosestByPath(exitDir);
    if (!exit) return ERR_NO_PATH;
    
    return this.goTo(exit);
  }
  
  /**
   * Harvest from a source
   */
  harvestSource(source: Source | null): number {
    if (!source) return ERR_INVALID_TARGET;
    
    if (!this.pos.inRangeTo(source, 1)) {
      this.goTo(source);
      return ERR_NOT_IN_RANGE;
    }
    
    return this.creep.harvest(source);
  }
  
  /**
   * Harvest from a mineral
   */
  harvestMineral(mineral: Mineral | null): number {
    if (!mineral) return ERR_INVALID_TARGET;
    
    if (!this.pos.inRangeTo(mineral, 1)) {
      this.goTo(mineral);
      return ERR_NOT_IN_RANGE;
    }
    
    return this.creep.harvest(mineral);
  }
  
  /**
   * Transfer resources to a target
   */
  transferTo(
    target: Structure | Creep,
    resourceType: ResourceConstant = RESOURCE_ENERGY,
    amount?: number
  ): number {
    if (!this.pos.inRangeTo(target, 1)) {
      this.goTo(target);
      return ERR_NOT_IN_RANGE;
    }
    
    return this.creep.transfer(target, resourceType, amount);
  }
  
  /**
   * Withdraw resources from a target
   */
  withdrawFrom(
    target: Structure | Tombstone | Ruin,
    resourceType: ResourceConstant = RESOURCE_ENERGY,
    amount?: number
  ): number {
    if (!this.pos.inRangeTo(target, 1)) {
      this.goTo(target);
      return ERR_NOT_IN_RANGE;
    }
    
    return this.creep.withdraw(target, resourceType, amount);
  }
  
  /**
   * Build a construction site
   */
  buildSite(site: ConstructionSite | null): number {
    if (!site) return ERR_INVALID_TARGET;
    
    if (!this.pos.inRangeTo(site, 3)) {
      this.goTo(site);
      return ERR_NOT_IN_RANGE;
    }
    
    return this.creep.build(site);
  }
  
  /**
   * Repair a structure
   */
  repairStructure(structure: Structure | null): number {
    if (!structure) return ERR_INVALID_TARGET;
    
    if (!this.pos.inRangeTo(structure, 3)) {
      this.goTo(structure);
      return ERR_NOT_IN_RANGE;
    }
    
    return this.creep.repair(structure);
  }
  
  /**
   * Upgrade the controller
   */
  upgradeController(): number {
    const controller = this.room.controller;
    if (!controller) return ERR_INVALID_TARGET;
    
    if (!this.pos.inRangeTo(controller, 3)) {
      this.goTo(controller);
      return ERR_NOT_IN_RANGE;
    }
    
    return this.creep.upgradeController(controller);
  }
  
  /**
   * Say something (with emoji support)
   */
  say(message: string, isPublic: boolean = false): number {
    return this.creep.say(message, isPublic);
  }
  
  /**
   * Smart energy collection - tries multiple sources in priority order
   * Returns true if energy was collected/being collected, false if no source found
   * 
   * Priority: Storage Link > Containers > Storage > Dropped resources > Harvest
   */
  collectEnergy(options?: {
    useLinks?: boolean;
    useStorage?: boolean;
    useContainers?: boolean;
    useDropped?: boolean;
    harvestIfNeeded?: boolean;
    storageMinEnergy?: number;
  }): boolean {
    const opts = {
      useLinks: true,
      useStorage: true,
      useContainers: true,
      useDropped: true,
      harvestIfNeeded: true,
      storageMinEnergy: 1000,
      ...options
    };
    
    // Try storage link first (if link temple is active)
    if (opts.useLinks) {
      const links = this.room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_LINK && 
                     s.store.getUsedCapacity(RESOURCE_ENERGY) > 100
      }) as StructureLink[];
      
      if (links.length > 0) {
        const nearest = this.pos.findClosestByPath(links);
        if (nearest) {
          this.withdrawFrom(nearest);
          this.say('⚡');
          return true;
        }
      }
    }
    
    // Try containers
    if (opts.useContainers) {
      const container = this.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
                       s.store.getUsedCapacity(RESOURCE_ENERGY) > 50
      }) as StructureContainer | null;
      
      if (container) {
        this.withdrawFrom(container);
        this.say('🔋');
        return true;
      }
    }
    
    // Try storage
    if (opts.useStorage && this.room.storage && 
        this.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > opts.storageMinEnergy) {
      this.withdrawFrom(this.room.storage);
      this.say('🏦');
      return true;
    }
    
    // Try terminal
    if (opts.useStorage && this.room.terminal && 
        this.room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) > opts.storageMinEnergy) {
      this.withdrawFrom(this.room.terminal);
      this.say('💼');
      return true;
    }
    
    // Try dropped resources
    if (opts.useDropped) {
      const dropped = this.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50
      });
      
      if (dropped) {
        if (this.pos.isNearTo(dropped)) {
          this.pickup(dropped);
        } else {
          this.goTo(dropped);
        }
        this.say('💎');
        return true;
      }
    }
    
    // Last resort: harvest directly
    if (opts.harvestIfNeeded) {
      const source = this.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
      if (source) {
        this.harvestSource(source);
        this.say('⛏️');
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Reassign this Elite to a new Arbiter
   */
  reassign(newArbiter: Arbiter, newRole?: string): void {
    this.arbiter = newArbiter;
    this.memory.arbiter = newArbiter.ref;
    if (newRole) {
      this.memory.role = newRole;
    }
    // Clear task
    delete this.memory.task;
    delete this.memory.working;
  }
  
  /**
   * Print representation
   */
  get print(): string {
    return `<a href="#!/room/${Game.shard.name}/${this.pos.roomName}">[Elite ${this.name}]</a>`;
  }
  
  // === Wrapper for all other Creep methods ===
  
  attack(target: Creep | Structure): number {
    return this.creep.attack(target);
  }
  
  rangedAttack(target: Creep | Structure): number {
    return this.creep.rangedAttack(target);
  }
  
  heal(target: Creep): number {
    return this.creep.heal(target);
  }
  
  rangedHeal(target: Creep): number {
    return this.creep.rangedHeal(target);
  }
  
  pickup(resource: Resource): number {
    return this.creep.pickup(resource);
  }
  
  drop(resourceType: ResourceConstant, amount?: number): number {
    return this.creep.drop(resourceType, amount);
  }
  
  claimController(controller: StructureController): number {
    return this.creep.claimController(controller);
  }
  
  reserveController(controller: StructureController): number {
    return this.creep.reserveController(controller);
  }
}
