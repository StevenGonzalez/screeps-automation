/**
 * VANGUARD ARBITER - Offensive Combat Operations
 * 
 * "The blade of the Covenant strikes true"
 * 
 * Manages offensive combat units for attacking enemy positions.
 * Coordinates attackers and healers in assault squads with advanced tactics.
 */

/// <reference types="@types/screeps" />

import { Arbiter, ArbiterPriority } from './Arbiter';
import { HighCharity } from '../core/HighCharity';
import { Elite } from '../elites/Elite';
import { SquadCoordinator, CombatRole, TacticMode, SquadFormation } from '../military/SquadCoordinator';

export interface VanguardMemory {
  targetRoom?: string;
  squadId?: string;
  role: CombatRole;
  rallyPoint?: { x: number; y: number; roomName: string };
  formation?: SquadFormation;
  tactic?: TacticMode;
}

/**
 * Vanguard Arbiter - Manages offensive combat units with advanced squad tactics
 */
export class VanguardArbiter extends Arbiter {
  attackers: Elite[];
  healers: Elite[];
  targetRoom: string | null;
  private squad: SquadCoordinator | null;
  private formation: SquadFormation;
  private tactic: TacticMode;
  
  constructor(highCharity: HighCharity, targetRoom?: string, formation: SquadFormation = 'box', tactic: TacticMode = 'assault') {
    super(highCharity, 'vanguard', ArbiterPriority.defense.melee);
    
    this.attackers = [];
    this.healers = [];
    this.targetRoom = targetRoom || null;
    this.squad = null;
    this.formation = formation;
    this.tactic = tactic;
    
    // Initialize squad if we have a target
    if (this.targetRoom) {
      this.initializeSquad();
    }
  }
  
  /**
   * Initialize squad coordinator
   */
  private initializeSquad(): void {
    if (!this.targetRoom) return;
    
    const rallyPoint = new RoomPosition(25, 25, this.highCharity.name);
    
    this.squad = new SquadCoordinator({
      formation: this.formation,
      tactic: this.tactic,
      rallyPoint: rallyPoint,
      targetRoom: this.targetRoom,
      engageRange: 3,
      fallbackThreshold: 40 // Retreat at 40% health
    });
  }
  
  init(): void {
    this.refresh();
    
    // Separate attackers and healers
    this.attackers = this.elites.filter(e => e.memory.role === 'attacker');
    this.healers = this.elites.filter(e => e.memory.role === 'healer');
    
    // Request boosts for newly spawned combat creeps
    for (const attacker of this.attackers) {
      if (!attacker.creep.ticksToLive || attacker.creep.ticksToLive >= 1450) {
        // Newly spawned, request boosts
        if (this.highCharity.boostManager) {
          this.highCharity.boostManager.requestBoosts(attacker.creep, 'attacker');
        }
      }
    }
    
    for (const healer of this.healers) {
      if (!healer.creep.ticksToLive || healer.creep.ticksToLive >= 1450) {
        // Newly spawned, request boosts
        if (this.highCharity.boostManager) {
          this.highCharity.boostManager.requestBoosts(healer.creep, 'healer');
        }
      }
    }
    
    // Add members to squad
    if (this.squad) {
      for (const attacker of this.attackers) {
        this.squad.addMember(attacker.creep, 'attacker');
      }
      for (const healer of this.healers) {
        this.squad.addMember(healer.creep, 'healer');
      }
    }
    
    // Request units if we have a target
    if (this.targetRoom && Game.time % 50 === 0) {
      const desiredAttackers = 4;  // More units for coordinated assault
      const desiredHealers = 2;
      
      if (this.attackers.length < desiredAttackers) {
        this.requestAttacker();
      }
      if (this.healers.length < desiredHealers) {
        this.requestHealer();
      }
    }
  }
  
  run(): void {
    // Use squad coordinator if initialized
    if (this.squad) {
      this.squad.run();
    } else {
      // Fallback to simple coordination
      for (const attacker of this.attackers) {
        this.runAttacker(attacker);
      }
      
      for (const healer of this.healers) {
        this.runHealer(healer);
      }
    }
  }
  
  /**
   * Run attacker logic
   */
  private runAttacker(attacker: Elite): void {
    if (!this.targetRoom) {
      // No target, return to home
      if (attacker.room.name !== this.highCharity.name) {
        attacker.goToRoom(this.highCharity.name);
      }
      return;
    }
    
    // Move to target room
    if (attacker.room.name !== this.targetRoom) {
      attacker.goToRoom(this.targetRoom);
      attacker.say('⚔️➡️');
      return;
    }
    
    // In target room - engage hostiles
    const hostiles = attacker.room.find(FIND_HOSTILE_CREEPS);
    const hostileStructures = attacker.room.find(FIND_HOSTILE_STRUCTURES, {
      filter: s => s.structureType !== STRUCTURE_CONTROLLER
    });
    
    // Priority: Hostile creeps > Spawns > Towers > Other structures
    let target: Creep | Structure | null = null;
    
    if (hostiles.length > 0) {
      // Target closest hostile
      target = attacker.pos.findClosestByRange(hostiles);
    } else if (hostileStructures.length > 0) {
      // Target priority structures
      const spawns = hostileStructures.filter(s => s.structureType === STRUCTURE_SPAWN);
      const towers = hostileStructures.filter(s => s.structureType === STRUCTURE_TOWER);
      
      if (spawns.length > 0) {
        target = attacker.pos.findClosestByRange(spawns);
      } else if (towers.length > 0) {
        target = attacker.pos.findClosestByRange(towers);
      } else {
        target = attacker.pos.findClosestByRange(hostileStructures);
      }
    }
    
    if (target) {
      const attackResult = attacker.creep.attack(target);
      if (attackResult === ERR_NOT_IN_RANGE) {
        attacker.goTo(target.pos);
        attacker.say('⚔️');
      } else if (attackResult === OK) {
        attacker.say('💥');
      }
      
      // Also try ranged attack if available
      attacker.creep.rangedAttack(target);
    } else {
      // No targets, attack controller to downgrade
      if (attacker.room.controller && attacker.room.controller.owner) {
        const result = attacker.creep.attackController(attacker.room.controller);
        if (result === ERR_NOT_IN_RANGE) {
          attacker.goTo(attacker.room.controller.pos);
        }
        attacker.say('🎯');
      }
    }
  }
  
  /**
   * Run healer logic
   */
  private runHealer(healer: Elite): void {
    if (!this.targetRoom) {
      // No target, return home
      if (healer.room.name !== this.highCharity.name) {
        healer.goToRoom(this.highCharity.name);
      }
      return;
    }
    
    // Stay with attackers
    const nearbyAttackers = healer.pos.findInRange(this.attackers.map(a => a.creep), 3);
    
    if (nearbyAttackers.length === 0) {
      // No attackers nearby, go to target room
      if (healer.room.name !== this.targetRoom) {
        healer.goToRoom(this.targetRoom);
        healer.say('➕➡️');
      } else if (this.attackers.length > 0) {
        // Follow closest attacker
        const closestAttacker = healer.pos.findClosestByRange(this.attackers.map(a => a.creep));
        if (closestAttacker) {
          healer.goTo(closestAttacker.pos);
        }
      }
      return;
    }
    
    // Heal injured friendlies
    const injured = healer.room.find(FIND_MY_CREEPS, {
      filter: c => c.hits < c.hitsMax
    }).sort((a, b) => a.hits - b.hits);
    
    if (injured.length > 0) {
      const target = injured[0];
      const healResult = healer.creep.heal(target);
      
      if (healResult === ERR_NOT_IN_RANGE) {
        healer.goTo(target.pos);
        healer.creep.rangedHeal(target);
      }
      
      healer.say('➕');
    } else {
      // No one injured, follow attackers
      if (this.attackers.length > 0) {
        const closestAttacker = healer.pos.findClosestByRange(this.attackers.map(a => a.creep));
        if (closestAttacker && healer.pos.getRangeTo(closestAttacker) > 2) {
          healer.goTo(closestAttacker.pos);
        }
      }
    }
  }
  
  /**
   * Request an attacker
   */
  private requestAttacker(): void {
    const body = this.calculateAttackerBody();
    const name = `Vanguard_Attacker_${Game.time}`;
    
    this.requestSpawn(body, name, {
      role: 'attacker',
      targetRoom: this.targetRoom
    } as any);
  }
  
  /**
   * Request a healer
   */
  private requestHealer(): void {
    const body = this.calculateHealerBody();
    const name = `Vanguard_Healer_${Game.time}`;
    
    this.requestSpawn(body, name, {
      role: 'healer',
      targetRoom: this.targetRoom
    } as any);
  }
  
  /**
   * Calculate attacker body
   */
  private calculateAttackerBody(): BodyPartConstant[] {
    const energy = this.highCharity.energyCapacity;
    
    // T1 Attacker (1300 energy): 10 ATTACK, 10 MOVE, 5 TOUGH
    if (energy >= 1300) {
      return [
        TOUGH, TOUGH, TOUGH, TOUGH, TOUGH,
        MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
        ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
        ATTACK, ATTACK, ATTACK, ATTACK, ATTACK
      ];
    }
    
    // T2 Attacker (800 energy): 6 ATTACK, 6 MOVE, 2 TOUGH
    if (energy >= 800) {
      return [
        TOUGH, TOUGH,
        MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
        ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK
      ];
    }
    
    // T3 Attacker (400 energy): 3 ATTACK, 3 MOVE
    return [ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE];
  }
  
  /**
   * Calculate healer body
   */
  private calculateHealerBody(): BodyPartConstant[] {
    const energy = this.highCharity.energyCapacity;
    
    // T1 Healer (1300 energy): 10 HEAL, 10 MOVE
    if (energy >= 1300) {
      return [
        MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
        HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL
      ];
    }
    
    // T2 Healer (800 energy): 6 HEAL, 6 MOVE
    if (energy >= 800) {
      return [
        MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
        HEAL, HEAL, HEAL, HEAL, HEAL, HEAL
      ];
    }
    
    // T3 Healer (400 energy): 3 HEAL, 3 MOVE
    return [HEAL, HEAL, HEAL, MOVE, MOVE, MOVE];
  }
  
  /**
   * Set target room for attacks
   */
  setTarget(roomName: string, formation?: SquadFormation, tactic?: TacticMode): void {
    this.targetRoom = roomName;
    
    if (formation) {
      this.formation = formation;
    }
    if (tactic) {
      this.tactic = tactic;
    }
    
    // Reinitialize squad with new parameters
    this.initializeSquad();
    
    // Update all unit memories
    for (const elite of this.elites) {
      elite.memory.targetRoom = roomName;
      if (formation) elite.memory.formation = formation;
      if (tactic) elite.memory.tactic = tactic;
    }
  }
  
  /**
   * Change squad formation
   */
  setFormation(formation: SquadFormation): void {
    this.formation = formation;
    if (this.squad) {
      this.squad.setFormation(formation);
    }
  }
  
  /**
   * Change squad tactic
   */
  setTactic(tactic: TacticMode): void {
    this.tactic = tactic;
    if (this.squad) {
      this.squad.setTactic(tactic);
    }
  }
  
  /**
   * Clear target and recall units
   */
  recall(): void {
    this.targetRoom = null;
    this.squad = null;
    
    for (const elite of this.elites) {
      elite.memory.targetRoom = undefined;
      elite.memory.formation = undefined;
      elite.memory.tactic = undefined;
    }
  }
  
  /**
   * Get squad status
   */
  getSquadStatus(): any {
    if (!this.squad) {
      return {
        size: this.elites.length,
        status: 'no active squad'
      };
    }
    return this.squad.getStatus();
  }
  
  protected getCreepsForRole(): Creep[] {
    return this.room.find(FIND_MY_CREEPS, {
      filter: (creep) => 
        creep.memory.arbiter === this.ref ||
        (creep.memory.role === 'attacker' || creep.memory.role === 'healer')
    });
  }
}
