/**
 * POWER HARVESTER ARBITER - PowerBank Operations
 * 
 * "Claim the power of the ancients"
 * 
 * Manages specialized squads for attacking PowerBanks and collecting
 * power resources. Coordinates attackers, healers, and haulers.
 */

/// <reference types="@types/screeps" />

import { Arbiter, ArbiterPriority } from './Arbiter';
import { HighCharity } from '../core/HighCharity';
import { Elite } from '../elites/Elite';

export interface PowerSquad {
  targetRoom: string;
  attackers: Elite[];
  healers: Elite[];
  haulers: Elite[];
  status: 'forming' | 'moving' | 'attacking' | 'collecting' | 'returning' | 'complete';
  powerBankDestroyed: boolean;
}

/**
 * Power Harvester Arbiter - Manages PowerBank operations
 */
export class PowerHarvesterArbiter extends Arbiter {
  squad: PowerSquad | null;
  targetRoom: string | null;
  
  constructor(highCharity: HighCharity, targetRoom?: string) {
    super(highCharity, 'powerHarvester', ArbiterPriority.expansion.scout);
    
    this.squad = null;
    this.targetRoom = targetRoom || null;
    
    if (targetRoom) {
      this.initializeSquad(targetRoom);
    }
  }
  
  init(): void {
    this.refresh();
    
    if (!this.squad || !this.targetRoom) return;
    
    // Update squad members
    this.updateSquad();
    
    // Request squad members if still forming
    if (this.squad.status === 'forming') {
      this.requestSquadMembers();
    }
  }
  
  run(): void {
    if (!this.squad || !this.targetRoom) return;
    
    // Run squad based on status
    switch (this.squad.status) {
      case 'forming':
        this.checkFormationComplete();
        break;
      case 'moving':
        this.moveToTarget();
        break;
      case 'attacking':
        this.attackPowerBank();
        break;
      case 'collecting':
        this.collectPower();
        break;
      case 'returning':
        this.returnHome();
        break;
      case 'complete':
        // Mission complete, can be cleaned up
        break;
    }
  }
  
  /**
   * Initialize squad for target room
   */
  private initializeSquad(targetRoom: string): void {
    this.squad = {
      targetRoom,
      attackers: [],
      healers: [],
      haulers: [],
      status: 'forming',
      powerBankDestroyed: false
    };
  }
  
  /**
   * Update squad members from elites
   */
  private updateSquad(): void {
    if (!this.squad) return;
    
    this.squad.attackers = this.elites.filter(e => e.memory.role === 'power_attacker');
    this.squad.healers = this.elites.filter(e => e.memory.role === 'power_healer');
    this.squad.haulers = this.elites.filter(e => e.memory.role === 'power_hauler');
  }
  
  /**
   * Request squad members
   */
  private requestSquadMembers(): void {
    const desiredAttackers = 2;
    const desiredHealers = 2;
    const desiredHaulers = 2;
    
    // Request spawn whenever we need more squad members (removed tick throttle)
    // SpawnQueue handles deduplication, so it's safe to request every tick
    if (this.squad!.attackers.length < desiredAttackers) {
      this.requestPowerAttacker();
    }
    if (this.squad!.healers.length < desiredHealers) {
      this.requestPowerHealer();
    }
    if (this.squad!.haulers.length < desiredHaulers) {
      this.requestPowerHauler();
    }
  }
  
  /**
   * Check if squad formation is complete
   */
  private checkFormationComplete(): void {
    if (!this.squad) return;
    
    const ready = this.squad.attackers.length >= 2 &&
                  this.squad.healers.length >= 2 &&
                  this.squad.haulers.length >= 2;
    
    if (ready) {
      this.squad.status = 'moving';
      console.log(`⚡ PowerHarvester: Squad formed, moving to ${this.targetRoom}`);
    }
  }
  
  /**
   * Move squad to target room
   */
  private moveToTarget(): void {
    if (!this.squad || !this.targetRoom) return;
    
    let allInRoom = true;
    
    // Move all units to target room
    for (const unit of [...this.squad.attackers, ...this.squad.healers, ...this.squad.haulers]) {
      if (unit.room.name !== this.targetRoom) {
        unit.goToRoom(this.targetRoom);
        unit.say('⚡→');
        allInRoom = false;
      }
    }
    
    // If all units in room, start attacking
    if (allInRoom) {
      this.squad.status = 'attacking';
      console.log(`⚡ PowerHarvester: Arrived at ${this.targetRoom}, beginning attack`);
    }
  }
  
  /**
   * Attack power bank
   */
  private attackPowerBank(): void {
    if (!this.squad || !this.targetRoom) return;
    
    // Find power bank
    const room = Game.rooms[this.targetRoom];
    if (!room) return;
    
    const powerBank = room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_POWER_BANK
    })[0] as StructurePowerBank | undefined;
    
    if (!powerBank) {
      // Power bank destroyed
      this.squad.powerBankDestroyed = true;
      this.squad.status = 'collecting';
      console.log(`⚡ PowerHarvester: PowerBank destroyed, collecting power`);
      return;
    }
    
    // Attackers attack the power bank
    for (const attacker of this.squad.attackers) {
      const result = attacker.creep.attack(powerBank);
      if (result === ERR_NOT_IN_RANGE) {
        attacker.goTo(powerBank.pos);
      }
      attacker.say('💥');
    }
    
    // Healers support attackers
    for (const healer of this.squad.healers) {
      const injured = this.squad.attackers.find(a => a.hits < a.hitsMax);
      if (injured) {
        const result = healer.creep.heal(injured.creep);
        if (result === ERR_NOT_IN_RANGE) {
          healer.goTo(injured.pos);
          healer.creep.rangedHeal(injured.creep);
        }
        healer.say('➕');
      } else {
        // Stay near attackers
        const closest = healer.pos.findClosestByRange(this.squad.attackers.map(a => a.creep));
        if (closest && healer.pos.getRangeTo(closest) > 3) {
          healer.goTo(closest.pos);
        }
      }
    }
    
    // Haulers wait nearby
    for (const hauler of this.squad.haulers) {
      if (hauler.pos.getRangeTo(powerBank) > 5) {
        hauler.goTo(powerBank.pos, { range: 3 });
      }
    }
  }
  
  /**
   * Collect power from ground
   */
  private collectPower(): void {
    if (!this.squad || !this.targetRoom) return;
    
    const room = Game.rooms[this.targetRoom];
    if (!room) return;
    
    // Find power resources
    const powerResources = room.find(FIND_DROPPED_RESOURCES, {
      filter: r => r.resourceType === RESOURCE_POWER
    });
    
    if (powerResources.length === 0) {
      // All power collected
      this.squad.status = 'returning';
      console.log(`⚡ PowerHarvester: Power collected, returning home`);
      return;
    }
    
    // Haulers pick up power
    for (const hauler of this.squad.haulers) {
      if (hauler.isFull) {
        hauler.say('💼');
        continue;
      }
      
      const nearest = hauler.pos.findClosestByPath(powerResources);
      if (nearest) {
        if (hauler.pos.isNearTo(nearest)) {
          hauler.pickup(nearest);
        } else {
          hauler.goTo(nearest);
        }
        hauler.say('⚡');
      }
    }
  }
  
  /**
   * Return squad home
   */
  private returnHome(): void {
    if (!this.squad) return;
    
    const homeRoom = this.highCharity.name;
    let allHome = true;
    
    for (const unit of [...this.squad.attackers, ...this.squad.healers, ...this.squad.haulers]) {
      if (unit.room.name !== homeRoom) {
        unit.goToRoom(homeRoom);
        unit.say('⚡←');
        allHome = false;
      } else {
        // Haulers deliver power to storage
        if (unit.memory.role === 'power_hauler' && !unit.needsEnergy) {
          const storage = this.highCharity.storage;
          if (storage) {
            unit.transferTo(storage);
          }
        }
      }
    }
    
    if (allHome) {
      this.squad.status = 'complete';
      console.log(`⚡ PowerHarvester: Mission complete!`);
    }
  }
  
  /**
   * Request power attacker
   */
  private requestPowerAttacker(): void {
    const body = this.calculatePowerAttackerBody();
    const name = `PowerAttacker_${Game.time}`;
    
    this.requestSpawn(body, name, {
      role: 'power_attacker',
      targetRoom: this.targetRoom
    } as any);
  }
  
  /**
   * Request power healer
   */
  private requestPowerHealer(): void {
    const body = this.calculatePowerHealerBody();
    const name = `PowerHealer_${Game.time}`;
    
    this.requestSpawn(body, name, {
      role: 'power_healer',
      targetRoom: this.targetRoom
    } as any);
  }
  
  /**
   * Request power hauler
   */
  private requestPowerHauler(): void {
    const body = this.calculatePowerHaulerBody();
    const name = `PowerHauler_${Game.time}`;
    
    this.requestSpawn(body, name, {
      role: 'power_hauler',
      targetRoom: this.targetRoom
    } as any);
  }
  
  /**
   * Calculate power attacker body (heavy attack focus)
   */
  private calculatePowerAttackerBody(): BodyPartConstant[] {
    // PowerBanks have 2M hits, need heavy attack
    // 20 ATTACK parts = 20 * 80 = 1600 damage per tick
    const body: BodyPartConstant[] = [];
    
    // Add tough parts for protection
    for (let i = 0; i < 10; i++) body.push(TOUGH);
    
    // Add attack parts
    for (let i = 0; i < 20; i++) body.push(ATTACK);
    
    // Add move parts (1:1 ratio for plains speed)
    for (let i = 0; i < 20; i++) body.push(MOVE);
    
    return body;
  }
  
  /**
   * Calculate power healer body (heavy heal focus)
   */
  private calculatePowerHealerBody(): BodyPartConstant[] {
    const body: BodyPartConstant[] = [];
    
    // Add heal parts
    for (let i = 0; i < 25; i++) body.push(HEAL);
    
    // Add move parts
    for (let i = 0; i < 25; i++) body.push(MOVE);
    
    return body;
  }
  
  /**
   * Calculate power hauler body (pure carry)
   */
  private calculatePowerHaulerBody(): BodyPartConstant[] {
    const body: BodyPartConstant[] = [];
    
    // Add carry parts
    for (let i = 0; i < 25; i++) body.push(CARRY);
    
    // Add move parts
    for (let i = 0; i < 25; i++) body.push(MOVE);
    
    return body;
  }
  
  protected getCreepsForRole(): Creep[] {
    return this.room.find(FIND_MY_CREEPS, {
      filter: (creep) => 
        creep.memory.arbiter === this.ref ||
        creep.memory.role === 'power_attacker' ||
        creep.memory.role === 'power_healer' ||
        creep.memory.role === 'power_hauler'
    });
  }
}
