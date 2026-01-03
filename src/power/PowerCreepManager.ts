/**
 * POWER CREEP MANAGER
 * 
 * "The Hierarchs' chosen avatars, wielding divine power"
 * 
 * Manages power creeps - powerful immortal units that provide significant
 * boosts to colony operations. Handles spawning, positioning, ability usage,
 * and renewal to maximize colony efficiency.
 * 
 * Power Creep Abilities Strategy:
 * - OPERATE_SPAWN: Reduce spawn time by 50% (critical for rapid response)
 * - OPERATE_TOWER: Increase tower range and power (defense boost)
 * - OPERATE_EXTENSION: Fill extensions/spawns with energy (economy boost)
 * - OPERATE_LAB: Boost reaction speeds (production boost)
 * - OPERATE_FACTORY: Boost commodity production (economy boost)
 * - GENERATE_OPS: Generate ops from energy (ops sustainability)
 */

/// <reference types="@types/screeps" />

import { HighCharity } from '../core/HighCharity';

// Extend PowerCreepMemory interface
declare global {
  interface PowerCreepMemory {
    homeRoom?: string;
    role?: 'operator';
    task?: string;
    opsGenerated?: number;
    abilitiesUsed?: number;
    stationed?: boolean;
  }
}

export interface PowerCreepStats {
  name: string;
  level: number;
  opsGenerated: number;
  abilitiesUsed: number;
  powers: { [power: number]: { level: number; cooldown: number } };
  stationed: boolean;
}

/**
 * Power Creep Manager - Automates power creep operations
 */
export class PowerCreepManager {
  private colony: HighCharity;
  private powerCreeps: PowerCreep[];
  
  constructor(colony: HighCharity) {
    this.colony = colony;
    this.powerCreeps = [];
  }
  
  /**
   * Run power creep operations
   */
  run(): void {
    // Find our power creeps
    this.powerCreeps = Object.values(Game.powerCreeps).filter(
      pc => pc.my && pc.memory.homeRoom === this.colony.name
    );
    
    // Create power creep if we don't have one and conditions are met
    if (this.powerCreeps.length === 0 && this.shouldCreatePowerCreep()) {
      this.createPowerCreep();
    }
    
    // Operate each power creep
    for (const powerCreep of this.powerCreeps) {
      this.operatePowerCreep(powerCreep);
    }
  }
  
  /**
   * Check if we should create a new power creep
   */
  private shouldCreatePowerCreep(): boolean {
    // Need RCL 8
    if (this.colony.level < 8) return false;
    
    // Need GPL (Global Power Level) 1+
    if (Game.gpl.level < 1) return false;
    
    // Check if we already have max power creeps
    const maxPowerCreeps = Game.gpl.level;
    const currentPowerCreeps = Object.keys(Game.powerCreeps).filter(
      name => Game.powerCreeps[name].my
    ).length;
    
    if (currentPowerCreeps >= maxPowerCreeps) return false;
    
    // Need power spawn
    const powerSpawn = this.colony.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_POWER_SPAWN
    })[0];
    
    return !!powerSpawn;
  }
  
  /**
   * Create a new power creep
   */
  private createPowerCreep(): void {
    const name = `${this.colony.name}_Operator`;
    
    // Create power creep (costs no resources, just GPL)
    const result = PowerCreep.create(name, POWER_CLASS.OPERATOR);
    
    if (result === OK) {
      console.log(`⚡ PowerCreepManager: Created power creep ${name}`);
    } else if (result === ERR_NAME_EXISTS) {
      // Already exists, just not spawned yet
      console.log(`⚡ PowerCreepManager: Power creep ${name} exists but not spawned`);
    } else {
      console.log(`⚠️ PowerCreepManager: Failed to create power creep: ${result}`);
    }
  }
  
  /**
   * Operate a power creep
   */
  private operatePowerCreep(powerCreep: PowerCreep): void {
    // Initialize memory if needed
    if (!powerCreep.memory.homeRoom) {
      powerCreep.memory.homeRoom = this.colony.name;
      powerCreep.memory.role = 'operator';
      powerCreep.memory.opsGenerated = 0;
      powerCreep.memory.abilitiesUsed = 0;
      powerCreep.memory.stationed = false;
    }
    
    // Spawn power creep if not spawned
    if (!powerCreep.spawnCooldownTime && !powerCreep.ticksToLive) {
      this.spawnPowerCreep(powerCreep);
      return;
    }
    
    // Not spawned yet
    if (!powerCreep.room) return;
    
    // Renew if needed (< 1000 ticks remaining)
    if (powerCreep.ticksToLive && powerCreep.ticksToLive < 1000) {
      this.renewPowerCreep(powerCreep);
      return;
    }
    
    // Move to home room if not there
    if (powerCreep.room.name !== this.colony.name) {
      powerCreep.moveTo(new RoomPosition(25, 25, this.colony.name));
      return;
    }
    
    // Station near power spawn
    if (!powerCreep.memory.stationed) {
      this.stationPowerCreep(powerCreep);
    }
    
    // Use abilities
    this.useAbilities(powerCreep);
  }
  
  /**
   * Spawn power creep at power spawn
   */
  private spawnPowerCreep(powerCreep: PowerCreep): void {
    const powerSpawn = this.colony.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_POWER_SPAWN
    })[0] as StructurePowerSpawn;
    
    if (!powerSpawn) return;
    
    const result = powerCreep.spawn(powerSpawn);
    
    if (result === OK) {
      console.log(`⚡ PowerCreepManager: Spawning ${powerCreep.name} at ${this.colony.name}`);
    } else if (result === ERR_BUSY) {
      // Power spawn is processing power, wait
    } else {
      console.log(`⚠️ PowerCreepManager: Failed to spawn ${powerCreep.name}: ${result}`);
    }
  }
  
  /**
   * Renew power creep at power spawn
   */
  private renewPowerCreep(powerCreep: PowerCreep): void {
    const powerSpawn = this.colony.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_POWER_SPAWN
    })[0] as StructurePowerSpawn;
    
    if (!powerSpawn) return;
    
    if (powerCreep.pos.isNearTo(powerSpawn)) {
      const result = powerCreep.renew(powerSpawn);
      
      if (result === OK) {
        console.log(`⚡ PowerCreepManager: Renewed ${powerCreep.name} (${powerCreep.ticksToLive} ticks)`);
      }
    } else {
      powerCreep.moveTo(powerSpawn, { range: 1 });
    }
  }
  
  /**
   * Station power creep near power spawn
   */
  private stationPowerCreep(powerCreep: PowerCreep): void {
    const powerSpawn = this.colony.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_POWER_SPAWN
    })[0];
    
    if (!powerSpawn) return;
    
    // Move to range 3 of power spawn (central location)
    if (powerCreep.pos.getRangeTo(powerSpawn) > 3) {
      powerCreep.moveTo(powerSpawn, { range: 3 });
    } else {
      powerCreep.memory.stationed = true;
    }
  }
  
  /**
   * Use power creep abilities strategically
   */
  private useAbilities(powerCreep: PowerCreep): void {
    // Priority order of abilities:
    // 1. OPERATE_SPAWN (fastest spawn times)
    // 2. OPERATE_TOWER (strongest defense)
    // 3. OPERATE_EXTENSION (free energy)
    // 4. OPERATE_LAB (faster reactions)
    // 5. OPERATE_FACTORY (faster production)
    // 6. GENERATE_OPS (sustainability)
    
    // OPERATE_SPAWN: Reduce spawn time by 50%
    if (this.hasAbility(powerCreep, PWR_OPERATE_SPAWN)) {
      if (this.useOperateSpawn(powerCreep)) return;
    }
    
    // OPERATE_TOWER: Increase tower effectiveness
    if (this.hasAbility(powerCreep, PWR_OPERATE_TOWER)) {
      if (this.useOperateTower(powerCreep)) return;
    }
    
    // OPERATE_EXTENSION: Fill extensions with energy
    if (this.hasAbility(powerCreep, PWR_OPERATE_EXTENSION)) {
      if (this.useOperateExtension(powerCreep)) return;
    }
    
    // OPERATE_LAB: Speed up reactions
    if (this.hasAbility(powerCreep, PWR_OPERATE_LAB)) {
      if (this.useOperateLab(powerCreep)) return;
    }
    
    // OPERATE_FACTORY: Speed up production
    if (this.hasAbility(powerCreep, PWR_OPERATE_FACTORY)) {
      if (this.useOperateFactory(powerCreep)) return;
    }
    
    // GENERATE_OPS: Convert energy to ops
    if (this.hasAbility(powerCreep, PWR_GENERATE_OPS)) {
      this.useGenerateOps(powerCreep);
    }
  }
  
  /**
   * Check if power creep has an ability
   */
  private hasAbility(powerCreep: PowerCreep, power: PowerConstant): boolean {
    return powerCreep.powers[power] !== undefined && 
           powerCreep.powers[power].level > 0;
  }
  
  /**
   * Check if ability is on cooldown
   */
  private isOnCooldown(powerCreep: PowerCreep, power: PowerConstant): boolean {
    const powerInfo = powerCreep.powers[power];
    return powerInfo?.cooldown ? powerInfo.cooldown > 0 : false;
  }
  
  /**
   * Use OPERATE_SPAWN ability
   */
  private useOperateSpawn(powerCreep: PowerCreep): boolean {
    if (this.isOnCooldown(powerCreep, PWR_OPERATE_SPAWN)) return false;
    
    // Find spawning spawn
    const spawn = this.colony.spawns.find(s => s.spawning);
    
    if (!spawn) return false;
    
    // Move to spawn and use ability
    if (powerCreep.pos.getRangeTo(spawn) > 3) {
      powerCreep.moveTo(spawn, { range: 3 });
      return true;
    }
    
    const result = powerCreep.usePower(PWR_OPERATE_SPAWN, spawn);
    
    if (result === OK) {
      powerCreep.memory.abilitiesUsed = (powerCreep.memory.abilitiesUsed || 0) + 1;
      console.log(`⚡ ${powerCreep.name}: OPERATE_SPAWN on ${spawn.name} (50% faster)`);
      return true;
    }
    
    return false;
  }
  
  /**
   * Use OPERATE_TOWER ability
   */
  private useOperateTower(powerCreep: PowerCreep): boolean {
    if (this.isOnCooldown(powerCreep, PWR_OPERATE_TOWER)) return false;
    
    // Find tower that doesn't have effect
    const tower = this.colony.towers.find(t => 
      !t.effects || !t.effects.some(e => (e as PowerEffect).power === PWR_OPERATE_TOWER)
    );
    
    if (!tower) return false;
    
    // Prioritize if hostiles present
    const hostiles = this.colony.room.find(FIND_HOSTILE_CREEPS);
    if (hostiles.length === 0) return false;
    
    // Move to tower and use ability
    if (powerCreep.pos.getRangeTo(tower) > 3) {
      powerCreep.moveTo(tower, { range: 3 });
      return true;
    }
    
    const result = powerCreep.usePower(PWR_OPERATE_TOWER, tower);
    
    if (result === OK) {
      powerCreep.memory.abilitiesUsed = (powerCreep.memory.abilitiesUsed || 0) + 1;
      console.log(`⚡ ${powerCreep.name}: OPERATE_TOWER (200% range & power)`);
      return true;
    }
    
    return false;
  }
  
  /**
   * Use OPERATE_EXTENSION ability
   */
  private useOperateExtension(powerCreep: PowerCreep): boolean {
    if (this.isOnCooldown(powerCreep, PWR_OPERATE_EXTENSION)) return false;
    
    // Only use if we have storage with energy
    if (!this.colony.storage || this.colony.storage.store.energy < 10000) {
      return false;
    }
    
    // Find spawn or extension that needs energy
    const target = this.colony.room.find(FIND_MY_STRUCTURES, {
      filter: s => (s.structureType === STRUCTURE_SPAWN || 
                    s.structureType === STRUCTURE_EXTENSION) &&
                   s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    })[0];
    
    if (!target) return false;
    
    // Move to storage and use ability (fills from storage)
    const storage = this.colony.storage;
    if (powerCreep.pos.getRangeTo(storage) > 3) {
      powerCreep.moveTo(storage, { range: 3 });
      return true;
    }
    
    const result = powerCreep.usePower(PWR_OPERATE_EXTENSION, storage);
    
    if (result === OK) {
      powerCreep.memory.abilitiesUsed = (powerCreep.memory.abilitiesUsed || 0) + 1;
      console.log(`⚡ ${powerCreep.name}: OPERATE_EXTENSION (filled extensions)`);
      return true;
    }
    
    return false;
  }
  
  /**
   * Use OPERATE_LAB ability
   */
  private useOperateLab(powerCreep: PowerCreep): boolean {
    if (this.isOnCooldown(powerCreep, PWR_OPERATE_LAB)) return false;
    
    // Find lab running reaction without effect
    const lab = this.colony.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_LAB &&
                   (s as StructureLab).cooldown > 0 &&
                   (!s.effects || !s.effects.some(e => (e as PowerEffect).power === PWR_OPERATE_LAB))
    })[0] as StructureLab;
    
    if (!lab) return false;
    
    // Move to lab and use ability
    if (powerCreep.pos.getRangeTo(lab) > 3) {
      powerCreep.moveTo(lab, { range: 3 });
      return true;
    }
    
    const result = powerCreep.usePower(PWR_OPERATE_LAB, lab);
    
    if (result === OK) {
      powerCreep.memory.abilitiesUsed = (powerCreep.memory.abilitiesUsed || 0) + 1;
      console.log(`⚡ ${powerCreep.name}: OPERATE_LAB (4x reaction speed)`);
      return true;
    }
    
    return false;
  }
  
  /**
   * Use OPERATE_FACTORY ability
   */
  private useOperateFactory(powerCreep: PowerCreep): boolean {
    if (this.isOnCooldown(powerCreep, PWR_OPERATE_FACTORY)) return false;
    
    // Find factory without effect
    const factory = this.colony.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_FACTORY &&
                   (!s.effects || !s.effects.some(e => (e as PowerEffect).power === PWR_OPERATE_FACTORY))
    })[0] as StructureFactory;
    
    if (!factory) return false;
    
    // Move to factory and use ability
    if (powerCreep.pos.getRangeTo(factory) > 3) {
      powerCreep.moveTo(factory, { range: 3 });
      return true;
    }
    
    const result = powerCreep.usePower(PWR_OPERATE_FACTORY, factory);
    
    if (result === OK) {
      powerCreep.memory.abilitiesUsed = (powerCreep.memory.abilitiesUsed || 0) + 1;
      console.log(`⚡ ${powerCreep.name}: OPERATE_FACTORY (cooldown reduced)`);
      return true;
    }
    
    return false;
  }
  
  /**
   * Use GENERATE_OPS ability
   */
  private useGenerateOps(powerCreep: PowerCreep): boolean {
    if (this.isOnCooldown(powerCreep, PWR_GENERATE_OPS)) return false;
    
    // Only generate if we have energy and low on ops
    if (!this.colony.storage || this.colony.storage.store.energy < 50000) {
      return false;
    }
    
    // Check current ops
    const ops = this.colony.storage.store[RESOURCE_OPS] || 0;
    if (ops > 5000) return false; // Don't generate if we have enough
    
    const result = powerCreep.usePower(PWR_GENERATE_OPS);
    
    if (result === OK) {
      powerCreep.memory.opsGenerated = (powerCreep.memory.opsGenerated || 0) + 1;
      if (Game.time % 100 === 0) {
        console.log(`⚡ ${powerCreep.name}: GENERATE_OPS (created ops from energy)`);
      }
      return true;
    }
    
    return false;
  }
  
  /**
   * Get power creep statistics
   */
  getStatus(): PowerCreepStats[] {
    const stats: PowerCreepStats[] = [];
    
    for (const powerCreep of this.powerCreeps) {
      const powers: { [power: number]: { level: number; cooldown: number } } = {};
      
      for (const powerKey in powerCreep.powers) {
        const power = parseInt(powerKey);
        powers[power] = {
          level: powerCreep.powers[power].level,
          cooldown: powerCreep.powers[power].cooldown || 0
        };
      }
      
      stats.push({
        name: powerCreep.name,
        level: powerCreep.level,
        opsGenerated: powerCreep.memory.opsGenerated || 0,
        abilitiesUsed: powerCreep.memory.abilitiesUsed || 0,
        powers,
        stationed: powerCreep.memory.stationed || false
      });
    }
    
    return stats;
  }
  
  /**
   * Check if colony should have power creeps
   */
  public static shouldHavePowerCreeps(colony: HighCharity): boolean {
    return colony.level === 8 && Game.gpl.level > 0;
  }
}
