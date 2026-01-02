/**
 * PILGRIM ARBITER - Sacred Journey to Distant Treasures
 * 
 * "The faithful journey far to claim the sacred gifts"
 * 
 * Manages Pilgrim squads that travel to highway deposits.
 * Pilgrims extract resources while Caravans shuttle them home.
 */

/// <reference types="@types/screeps" />

import { Arbiter, ArbiterPriority, ArbiterMemory } from './Arbiter';
import { HighCharity } from '../core/HighCharity';
import { Elite } from '../elites/Elite';
import { SpawnPriority } from '../spawning/SpawnQueue';

interface DepositHarvesterMemory extends ArbiterMemory {
  depositId: string;
  targetRoom: string;
  depositType: DepositConstant;
}

export interface DepositSquad {
  depositId: string;
  targetRoom: string;
  depositType: DepositConstant;
  harvesters: Elite[];
  haulers: Elite[];
  status: 'forming' | 'moving' | 'harvesting' | 'complete';
}

/**
 * Deposit Harvester Arbiter - Manages deposit extraction operations
 */
export class DepositHarvesterArbiter extends Arbiter {
  depositId: string;
  targetRoom: string;
  depositType: DepositConstant;
  squad: DepositSquad;
  
  constructor(highCharity: HighCharity, depositId: string, targetRoom: string, depositType: DepositConstant) {
    super(highCharity, `depositHarvester_${depositId}`, ArbiterPriority.economy.mining);
    this.depositId = depositId;
    this.targetRoom = targetRoom;
    this.depositType = depositType;
    
    // Initialize squad
    this.squad = {
      depositId: depositId,
      targetRoom: targetRoom,
      depositType: depositType,
      harvesters: [],
      haulers: [],
      status: 'forming'
    };
    
    // Initialize memory
    const dhMemory = this.memory as DepositHarvesterMemory;
    if (!dhMemory.depositId) {
      dhMemory.depositId = depositId;
      dhMemory.targetRoom = targetRoom;
      dhMemory.depositType = depositType;
    }
  }
  
  init(): void {
    this.refresh();
    
    // Update squad members
    this.updateSquad();
    
    // Request squad members if still forming
    if (this.squad.status === 'forming') {
      this.requestSquadMembers();
      this.checkFormationComplete();
    }
  }
  
  run(): void {
    // Check if deposit still exists
    const deposit = Game.getObjectById(this.depositId as Id<Deposit>);
    if (!deposit) {
      this.squad.status = 'complete';
      return;
    }
    
    // Run squad based on status
    switch (this.squad.status) {
      case 'forming':
        // Wait for squad to form
        break;
      case 'moving':
        this.moveToDeposit();
        break;
      case 'harvesting':
        this.harvestDeposit();
        break;
      case 'complete':
        // Mission complete
        break;
    }
  }
  
  /**
   * Update squad members from elites
   */
  private updateSquad(): void {
    this.squad.harvesters = this.elites.filter(e => e.memory.role === 'pilgrim');
    this.squad.haulers = this.elites.filter(e => e.memory.role === 'caravan');
  }
  
  /**
   * Request squad members
   */
  private requestSquadMembers(): void {
    const desiredHarvesters = 1; // One heavy harvester
    const desiredHaulers = 2; // Two haulers to shuttle resources
    
    if (this.squad.harvesters.length < desiredHarvesters && Game.time % 10 === 0) {
      this.requestDepositHarvester();
    }
    if (this.squad.haulers.length < desiredHaulers && Game.time % 10 === 0) {
      this.requestDepositHauler();
    }
  }
  
  /**
   * Check if squad formation is complete
   */
  private checkFormationComplete(): void {
    const ready = this.squad.harvesters.length >= 1 &&
                  this.squad.haulers.length >= 2;
    
    if (ready) {
      this.squad.status = 'moving';
      console.log(`� Pilgrim: Sacred journey begins to ${this.targetRoom}`);
    }
  }
  
  /**
   * Move squad to deposit
   */
  private moveToDeposit(): void {
    const deposit = Game.getObjectById(this.depositId as Id<Deposit>);
    if (!deposit) {
      this.squad.status = 'complete';
      return;
    }
    
    // Check if all squad members are in target room
    const allInRoom = [...this.squad.harvesters, ...this.squad.haulers]
      .every(member => member.room.name === this.targetRoom);
    
    if (allInRoom) {
      this.squad.status = 'harvesting';
      console.log(`� Pilgrim: Arrived at ${this.targetRoom}, gathering sacred resources`);
      return;
    }
    
    // Move to deposit
    for (const harvester of this.squad.harvesters) {
      if (harvester.room.name !== this.targetRoom) {
        harvester.goTo(deposit.pos, { range: 1 });
        harvester.say('💎➡️');
      }
    }
    
    for (const hauler of this.squad.haulers) {
      if (hauler.room.name !== this.targetRoom) {
        hauler.goTo(deposit.pos, { range: 3 });
        hauler.say('📦➡️');
      }
    }
  }
  
  /**
   * Harvest deposit
   */
  private harvestDeposit(): void {
    const deposit = Game.getObjectById(this.depositId as Id<Deposit>);
    if (!deposit) {
      this.squad.status = 'complete';
      console.log(`� Pilgrim: Sacred deposit exhausted, pilgrimage complete`);
      return;
    }
    
    // Harvesters extract from deposit and drop resources
    for (const harvester of this.squad.harvesters) {
      // If full, drop resources on ground for haulers
      if (harvester.store.getUsedCapacity() > 0) {
        for (const resourceType in harvester.store) {
          harvester.creep.drop(resourceType as ResourceConstant);
        }
        harvester.say('📤');
      }
      
      // Stay at deposit and harvest continuously
      const result = harvester.creep.harvest(deposit);
      if (result === ERR_NOT_IN_RANGE) {
        harvester.goTo(deposit.pos, { range: 1 });
        harvester.say('💎➡️');
      } else if (result === OK) {
        harvester.say('⛏️💎');
      } else if (result === ERR_NOT_ENOUGH_RESOURCES || result === ERR_TIRED) {
        // Deposit on cooldown - drop any carried resources
        if (harvester.store.getUsedCapacity() > 0) {
          for (const resourceType in harvester.store) {
            harvester.creep.drop(resourceType as ResourceConstant);
          }
        }
        harvester.say('💤');
      }
    }
    
    // Haulers shuttle resources back home
    for (const hauler of this.squad.haulers) {
      this.runHauler(hauler, deposit);
    }
  }
  
  /**
   * Run hauler logic
   */
  private runHauler(hauler: Elite, deposit: Deposit): void {
    // If full, return home
    if (hauler.isFull) {
      if (hauler.room.name !== this.highCharity.name) {
        const exitDir = hauler.room.findExitTo(this.highCharity.name);
        if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
          const exit = hauler.pos.findClosestByPath(exitDir);
          if (exit) {
            hauler.goTo(exit);
            hauler.say('🏠');
          }
        }
      } else {
        // Deliver to storage/terminal
        const target = this.highCharity.storage || this.highCharity.terminal;
        if (target) {
          const result = hauler.transferTo(target);
          if (result === OK) {
            hauler.say('💰');
          }
        }
      }
      return;
    }
    
    // If empty, pick up resources
    if (hauler.store.getUsedCapacity() === 0) {
      if (hauler.room.name !== this.targetRoom) {
        // Return to deposit room
        hauler.goTo(deposit.pos, { range: 3 });
        hauler.say('💎➡️');
      } else {
        // Pick up dropped resources
        const droppedResources = hauler.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
          filter: r => r.resourceType === this.depositType
        });
        
        if (droppedResources) {
          if (hauler.pos.isNearTo(droppedResources)) {
            hauler.pickup(droppedResources);
            hauler.say('📦');
          } else {
            hauler.goTo(droppedResources);
          }
        } else {
          // Wait near deposit
          if (hauler.pos.getRangeTo(deposit) > 3) {
            hauler.goTo(deposit.pos, { range: 3 });
          }
          hauler.say('⏸️');
        }
      }
    }
  }
  
  /**
   * Request deposit harvester (Pilgrim)
   */
  private requestDepositHarvester(): void {
    const body = this.calculateHarvesterBody();
    const name = `Pilgrim_${Game.time}`;
    
    this.requestSpawn(body, name, {
      role: 'pilgrim',
      targetRoom: this.targetRoom,
      depositId: this.depositId
    } as any, SpawnPriority.ECONOMY);
  }
  
  /**
   * Request deposit hauler (Caravan)
   */
  private requestDepositHauler(): void {
    const body = this.calculateHaulerBody();
    const name = `Caravan_${Game.time}`;
    
    this.requestSpawn(body, name, {
      role: 'caravan',
      targetRoom: this.targetRoom,
      depositId: this.depositId
    } as any, SpawnPriority.ECONOMY);
  }
  
  /**
   * Calculate harvester body (heavy WORK focus, minimal CARRY)
   */
  private calculateHarvesterBody(): BodyPartConstant[] {
    const energy = this.highCharity.room.energyCapacityAvailable;
    const body: BodyPartConstant[] = [];
    
    // Pilgrim harvester: maximize WORK parts for fast extraction
    // Deposits have cooldown, so extract maximum per harvest
    // Minimal CARRY (just 3) since we drop resources on ground immediately
    
    // Calculate max WORK parts (each WORK = 100 energy)
    let remainingEnergy = energy;
    
    // Add 3 CARRY + 3 MOVE first (300 energy)
    for (let i = 0; i < 3; i++) {
      body.push(CARRY);
      body.push(MOVE);
    }
    remainingEnergy -= 600;
    
    // Fill rest with WORK + MOVE pairs
    const workParts = Math.min(Math.floor(remainingEnergy / 150), 30); // Cap at 30 WORK
    for (let i = 0; i < workParts; i++) {
      body.push(WORK);
      body.push(MOVE);
    }
    
    return body;
  }
  
  /**
   * Calculate hauler body (pure CARRY + MOVE)
   */
  private calculateHaulerBody(): BodyPartConstant[] {
    const energy = this.highCharity.room.energyCapacityAvailable;
    const body: BodyPartConstant[] = [];
    
    // Hauler: maximize CARRY capacity
    // Each CARRY + MOVE = 100 energy
    const maxParts = Math.floor(energy / 100);
    const carryParts = Math.min(maxParts, 25); // Cap at 25 CARRY (1250 capacity)
    
    for (let i = 0; i < carryParts; i++) {
      body.push(CARRY);
      body.push(MOVE);
    }
    
    return body;
  }
  
  protected getCreepsForRole(): Creep[] {
    return Object.values(Game.creeps).filter(
      c => c.memory.arbiter === this.ref
    );
  }
}
