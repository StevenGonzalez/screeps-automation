/**
 * SQUAD COORDINATOR - Advanced Military Operations
 * 
 * "United in purpose, unstoppable in war"
 * 
 * Provides advanced squad coordination with formation movement,
 * tactical behaviors, and intelligent combat decisions.
 */

/// <reference types="@types/screeps" />

export type SquadFormation = 'line' | 'box' | 'wedge' | 'scatter';
export type CombatRole = 'attacker' | 'healer' | 'ranged' | 'tank' | 'dismantler';
export type TacticMode = 'assault' | 'siege' | 'raid' | 'defend' | 'retreat';

export interface SquadMember {
  creep: Creep;
  role: CombatRole;
  formationOffset: { x: number; y: number };
  health: number;
  maxHealth: number;
}

export interface SquadConfig {
  formation: SquadFormation;
  tactic: TacticMode;
  rallyPoint: RoomPosition;
  targetRoom: string;
  engageRange: number;
  fallbackThreshold: number; // Average health % to trigger retreat
}

export interface CombatTarget {
  target: Creep | Structure;
  priority: number;
  threatLevel: number;
}

/**
 * Squad Coordinator - Manages tactical squad operations
 */
export class SquadCoordinator {
  private members: Map<string, SquadMember>;
  private config: SquadConfig;
  private leader: Creep | null;
  private targetLock: Id<Creep | Structure> | null;
  
  constructor(config: SquadConfig) {
    this.members = new Map();
    this.config = config;
    this.leader = null;
    this.targetLock = null;
  }
  
  /**
   * Add creep to squad
   */
  addMember(creep: Creep, role: CombatRole): void {
    const member: SquadMember = {
      creep: creep,
      role: role,
      formationOffset: this.calculateFormationOffset(role, this.members.size),
      health: creep.hits,
      maxHealth: creep.hitsMax
    };
    
    this.members.set(creep.name, member);
    
    // First member becomes leader
    if (!this.leader) {
      this.leader = creep;
    }
  }
  
  /**
   * Remove dead/missing creeps
   */
  cleanupMembers(): void {
    for (const [name, member] of this.members) {
      if (!member.creep || member.creep.hits === 0) {
        this.members.delete(name);
        
        // Reassign leader if needed
        if (this.leader && this.leader.name === name) {
          this.leader = this.members.values().next().value?.creep || null;
        }
      }
    }
  }
  
  /**
   * Execute squad tactics
   */
  run(): void {
    this.cleanupMembers();
    
    if (this.members.size === 0) return;
    
    // Update health status
    this.updateMemberHealth();
    
    // Check if we should retreat
    if (this.shouldRetreat()) {
      this.config.tactic = 'retreat';
    }
    
    // Execute tactic
    switch (this.config.tactic) {
      case 'assault':
        this.executeAssault();
        break;
      case 'siege':
        this.executeSiege();
        break;
      case 'raid':
        this.executeRaid();
        break;
      case 'defend':
        this.executeDefend();
        break;
      case 'retreat':
        this.executeRetreat();
        break;
    }
  }
  
  /**
   * Calculate formation offset for a role
   */
  private calculateFormationOffset(role: CombatRole, index: number): { x: number; y: number } {
    switch (this.config.formation) {
      case 'line':
        return { x: index % 5 - 2, y: Math.floor(index / 5) };
      
      case 'box':
        // Tanks front, healers center, ranged back
        if (role === 'tank') return { x: index - 1, y: -1 };
        if (role === 'healer') return { x: index - 1, y: 0 };
        if (role === 'ranged') return { x: index - 1, y: 1 };
        return { x: index, y: 0 };
      
      case 'wedge':
        // V-shape with leader at point
        const row = Math.floor(Math.sqrt(index));
        const col = index - (row * row);
        return { x: col - row, y: row };
      
      case 'scatter':
        // Random spread
        return {
          x: (index * 7) % 5 - 2,
          y: (index * 3) % 5 - 2
        };
      
      default:
        return { x: 0, y: 0 };
    }
  }
  
  /**
   * Update health status for all members
   */
  private updateMemberHealth(): void {
    for (const member of this.members.values()) {
      member.health = member.creep.hits;
      member.maxHealth = member.creep.hitsMax;
    }
  }
  
  /**
   * Check if squad should retreat
   */
  private shouldRetreat(): boolean {
    if (this.members.size === 0) return true;
    
    let totalHealth = 0;
    let totalMaxHealth = 0;
    
    for (const member of this.members.values()) {
      totalHealth += member.health;
      totalMaxHealth += member.maxHealth;
    }
    
    const avgHealthPercent = (totalHealth / totalMaxHealth) * 100;
    return avgHealthPercent < this.config.fallbackThreshold;
  }
  
  /**
   * Execute assault tactic - aggressive push
   */
  private executeAssault(): void {
    if (!this.leader) return;
    
    const targets = this.identifyTargets();
    
    for (const member of this.members.values()) {
      // Move in formation
      this.moveInFormation(member);
      
      // Combat actions based on role
      this.executeCombatRole(member, targets);
    }
  }
  
  /**
   * Execute siege tactic - dismantle structures
   */
  private executeSiege(): void {
    if (!this.leader) return;
    
    for (const member of this.members.values()) {
      this.moveInFormation(member);
      
      if (member.role === 'dismantler') {
        // Target structures
        const structures = member.creep.room.find(FIND_HOSTILE_STRUCTURES, {
          filter: s => s.structureType !== STRUCTURE_CONTROLLER &&
                      s.structureType !== STRUCTURE_RAMPART
        });
        
        if (structures.length > 0) {
          const target = member.creep.pos.findClosestByPath(structures);
          if (target) {
            if (member.creep.dismantle(target) === ERR_NOT_IN_RANGE) {
              member.creep.moveTo(target, { visualizePathStyle: { stroke: '#ffaa00' } });
            }
            member.creep.say('🔧');
          }
        }
      } else {
        // Other roles provide support
        const targets = this.identifyTargets();
        this.executeCombatRole(member, targets);
      }
    }
  }
  
  /**
   * Execute raid tactic - hit and run
   */
  private executeRaid(): void {
    if (!this.leader) return;
    
    const targets = this.identifyTargets();
    const hasTarget = this.targetLock && Game.getObjectById(this.targetLock);
    
    for (const member of this.members.values()) {
      if (!hasTarget) {
        // No target, find one
        if (targets.length > 0) {
          this.targetLock = targets[0].target.id as Id<Creep | Structure>;
        }
      }
      
      // Quick strike on target, then pull back
      const target = hasTarget ? Game.getObjectById(this.targetLock!) : null;
      if (target) {
        this.executeCombatRole(member, [{ target, priority: 10, threatLevel: 5 }]);
        
        // Check if target destroyed
        if (!Game.getObjectById(this.targetLock!)) {
          this.targetLock = null;
          // Pull back after kill
          member.creep.moveTo(this.config.rallyPoint, { visualizePathStyle: { stroke: '#00ff00' } });
        }
      } else {
        // Return to rally point between strikes
        member.creep.moveTo(this.config.rallyPoint, { visualizePathStyle: { stroke: '#00ff00' } });
      }
    }
  }
  
  /**
   * Execute defend tactic - hold position
   */
  private executeDefend(): void {
    const targets = this.identifyTargets();
    
    for (const member of this.members.values()) {
      // Stay near rally point
      if (member.creep.pos.getRangeTo(this.config.rallyPoint) > 3) {
        member.creep.moveTo(this.config.rallyPoint, { visualizePathStyle: { stroke: '#0000ff' } });
      }
      
      // Engage nearby hostiles
      this.executeCombatRole(member, targets);
    }
  }
  
  /**
   * Execute retreat tactic - fall back to safety
   */
  private executeRetreat(): void {
    for (const member of this.members.values()) {
      // Everyone moves to rally point
      member.creep.moveTo(this.config.rallyPoint, {
        visualizePathStyle: { stroke: '#ff0000' },
        ignoreCreeps: false
      });
      
      // Healers heal while retreating
      if (member.role === 'healer') {
        this.healNearby(member);
      }
      
      // Ranged units cover retreat
      if (member.role === 'ranged') {
        const hostiles = member.creep.pos.findInRange(FIND_HOSTILE_CREEPS, 3);
        if (hostiles.length > 0) {
          member.creep.rangedAttack(hostiles[0]);
          member.creep.say('🏃');
        }
      }
      
      member.creep.say('⚠️');
    }
  }
  
  /**
   * Move creep in formation relative to leader
   */
  private moveInFormation(member: SquadMember): void {
    if (!this.leader || member.creep === this.leader) {
      // Leader moves to target
      if (member.creep.room.name !== this.config.targetRoom) {
        const exitDir = member.creep.room.findExitTo(this.config.targetRoom);
        if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
          const exit = member.creep.pos.findClosestByPath(exitDir);
          if (exit) {
            member.creep.moveTo(exit, { visualizePathStyle: { stroke: '#ffffff' } });
          }
        }
      }
      return;
    }
    
    // Calculate formation position
    const formationPos = new RoomPosition(
      this.leader.pos.x + member.formationOffset.x,
      this.leader.pos.y + member.formationOffset.y,
      this.leader.pos.roomName
    );
    
    // Move to formation position if not there
    if (member.creep.pos.getRangeTo(formationPos) > 0) {
      member.creep.moveTo(formationPos, {
        visualizePathStyle: { stroke: '#00ffff' },
        range: 0,
        ignoreCreeps: false
      });
    }
  }
  
  /**
   * Execute combat role actions
   */
  private executeCombatRole(member: SquadMember, targets: CombatTarget[]): void {
    if (targets.length === 0) return;
    
    const primaryTarget = targets[0].target;
    
    switch (member.role) {
      case 'attacker':
        if (member.creep.attack(primaryTarget) === ERR_NOT_IN_RANGE) {
          member.creep.moveTo(primaryTarget, { visualizePathStyle: { stroke: '#ff0000' } });
        }
        member.creep.rangedAttack(primaryTarget); // Use ranged if available
        member.creep.say('⚔️');
        break;
      
      case 'ranged':
        const range = member.creep.pos.getRangeTo(primaryTarget);
        if (range > 3) {
          member.creep.moveTo(primaryTarget, { visualizePathStyle: { stroke: '#ffaa00' } });
        } else if (range < 2) {
          // Kite back
          const direction = member.creep.pos.getDirectionTo(primaryTarget);
          const opposite = ((direction + 3) % 8) + 1;
          member.creep.move(opposite as DirectionConstant);
        }
        
        if (targets.length >= 3 && range <= 3) {
          member.creep.rangedMassAttack();
        } else {
          member.creep.rangedAttack(primaryTarget);
        }
        member.creep.say('🏹');
        break;
      
      case 'healer':
        this.healNearby(member);
        break;
      
      case 'tank':
        // Tanks engage to draw fire
        if (member.creep.attack(primaryTarget) === ERR_NOT_IN_RANGE) {
          member.creep.moveTo(primaryTarget, { visualizePathStyle: { stroke: '#0000ff' } });
        }
        member.creep.say('🛡️');
        break;
      
      case 'dismantler':
        // Already handled in siege tactic
        break;
    }
  }
  
  /**
   * Heal nearby injured allies
   */
  private healNearby(healer: SquadMember): void {
    const injured = healer.creep.pos.findInRange(FIND_MY_CREEPS, 3, {
      filter: c => c.hits < c.hitsMax
    }).sort((a, b) => (a.hits / a.hitsMax) - (b.hits / b.hitsMax));
    
    if (injured.length > 0) {
      const target = injured[0];
      if (healer.creep.pos.getRangeTo(target) <= 1) {
        healer.creep.heal(target);
      } else {
        healer.creep.rangedHeal(target);
        healer.creep.moveTo(target, { visualizePathStyle: { stroke: '#00ff00' } });
      }
      healer.creep.say('💚');
    } else {
      // Heal self if damaged
      if (healer.creep.hits < healer.creep.hitsMax) {
        healer.creep.heal(healer.creep);
        healer.creep.say('💚');
      }
    }
  }
  
  /**
   * Identify and prioritize targets
   */
  private identifyTargets(): CombatTarget[] {
    if (!this.leader) return [];
    
    const room = this.leader.room;
    const targets: CombatTarget[] = [];
    
    // Hostile creeps
    const hostileCreeps = room.find(FIND_HOSTILE_CREEPS);
    for (const creep of hostileCreeps) {
      const priority = this.calculateCreepPriority(creep);
      const threatLevel = this.calculateCreepThreat(creep);
      targets.push({ target: creep, priority, threatLevel });
    }
    
    // Hostile structures
    const hostileStructures = room.find(FIND_HOSTILE_STRUCTURES, {
      filter: s => s.structureType !== STRUCTURE_CONTROLLER
    });
    
    for (const structure of hostileStructures) {
      const priority = this.calculateStructurePriority(structure);
      const threatLevel = this.calculateStructureThreat(structure);
      targets.push({ target: structure, priority, threatLevel });
    }
    
    // Sort by priority (lower = higher priority)
    return targets.sort((a, b) => a.priority - b.priority);
  }
  
  /**
   * Calculate creep target priority
   */
  private calculateCreepPriority(creep: Creep): number {
    let priority = 50;
    
    // Healers are high priority
    if (creep.getActiveBodyparts(HEAL) > 0) priority -= 20;
    
    // Attackers are high priority
    if (creep.getActiveBodyparts(ATTACK) > 0) priority -= 15;
    if (creep.getActiveBodyparts(RANGED_ATTACK) > 0) priority -= 15;
    
    // Weak creeps are easy targets
    if (creep.hits < creep.hitsMax * 0.5) priority -= 10;
    
    // Close creeps are priority
    if (this.leader) {
      const range = this.leader.pos.getRangeTo(creep);
      priority += range;
    }
    
    return priority;
  }
  
  /**
   * Calculate structure target priority
   */
  private calculateStructurePriority(structure: Structure): number {
    let priority = 100;
    
    switch (structure.structureType) {
      case STRUCTURE_SPAWN:
        priority = 10;
        break;
      case STRUCTURE_TOWER:
        priority = 15;
        break;
      case STRUCTURE_LAB:
        priority = 30;
        break;
      case STRUCTURE_TERMINAL:
        priority = 25;
        break;
      case STRUCTURE_STORAGE:
        priority = 35;
        break;
      case STRUCTURE_NUKER:
        priority = 20;
        break;
      case STRUCTURE_POWER_SPAWN:
        priority = 40;
        break;
      case STRUCTURE_EXTENSION:
        priority = 60;
        break;
      case STRUCTURE_LINK:
        priority = 70;
        break;
    }
    
    return priority;
  }
  
  /**
   * Calculate creep threat level
   */
  private calculateCreepThreat(creep: Creep): number {
    let threat = 0;
    threat += creep.getActiveBodyparts(ATTACK) * 2;
    threat += creep.getActiveBodyparts(RANGED_ATTACK) * 1.5;
    threat += creep.getActiveBodyparts(HEAL) * 1;
    return threat;
  }
  
  /**
   * Calculate structure threat level
   */
  private calculateStructureThreat(structure: Structure): number {
    if (structure.structureType === STRUCTURE_TOWER) {
      return 5;
    }
    return 0;
  }
  
  /**
   * Get squad status
   */
  getStatus(): {
    size: number;
    avgHealth: number;
    tactic: TacticMode;
    formation: SquadFormation;
    inTargetRoom: boolean;
  } {
    let totalHealth = 0;
    let totalMaxHealth = 0;
    let inTargetRoom = 0;
    
    for (const member of this.members.values()) {
      totalHealth += member.health;
      totalMaxHealth += member.maxHealth;
      if (member.creep.room.name === this.config.targetRoom) {
        inTargetRoom++;
      }
    }
    
    return {
      size: this.members.size,
      avgHealth: this.members.size > 0 ? (totalHealth / totalMaxHealth) * 100 : 0,
      tactic: this.config.tactic,
      formation: this.config.formation,
      inTargetRoom: inTargetRoom === this.members.size
    };
  }
  
  /**
   * Change tactic mode
   */
  setTactic(tactic: TacticMode): void {
    this.config.tactic = tactic;
  }
  
  /**
   * Change formation
   */
  setFormation(formation: SquadFormation): void {
    this.config.formation = formation;
    
    // Recalculate formation offsets
    let index = 0;
    for (const member of this.members.values()) {
      member.formationOffset = this.calculateFormationOffset(member.role, index++);
    }
  }
  
  /**
   * Set new target room
   */
  setTarget(roomName: string): void {
    this.config.targetRoom = roomName;
  }
  
  /**
   * Set rally point
   */
  setRallyPoint(pos: RoomPosition): void {
    this.config.rallyPoint = pos;
  }
}
