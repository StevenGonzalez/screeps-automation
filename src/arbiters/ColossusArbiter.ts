/**
 * VANGUARD ARBITER - Offensive Combat Operations
 * 
 * "The blade of the KHALA strikes true"
 * 
 * Manages offensive combat units for attacking enemy positions.
 * Coordinates attackers and healers in assault squads with advanced tactics.
 */

/// <reference types="@types/screeps" />

import { Arbiter, ArbiterPriority } from './Arbiter';
import { Nexus } from '../core/Nexus';
import { Warrior } from '../Warriors/Warrior';
import { SquadCoordinator, CombatRole, TacticMode, SquadFormation } from '../military/SquadCoordinator';
import { BodyBuilder } from '../utils/BodyBuilder';

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
export class ColossusArbiter extends Arbiter {
  attackers: Warrior[];
  healers: Warrior[];
  targetRoom: string | null;
  private squad: SquadCoordinator | null;
  private formation: SquadFormation;
  private tactic: TacticMode;
  
  constructor(Nexus: Nexus, targetRoom?: string, formation: SquadFormation = 'box', tactic: TacticMode = 'assault') {
    super(Nexus, 'vanguard', ArbiterPriority.defense.melee);
    
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
    
    const rallyPoint = new RoomPosition(25, 25, this.Nexus.name);
    
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
    this.attackers = this.warriors.filter(e => e.memory.role === 'attacker');
    this.healers = this.warriors.filter(e => e.memory.role === 'healer');
    
    // Request boosts for newly spawned combat creeps
    for (const attacker of this.attackers) {
      if (!attacker.creep.ticksToLive || attacker.creep.ticksToLive >= 1450) {
        // Newly spawned, request boosts
        if (this.Nexus.boostManager) {
          this.Nexus.boostManager.requestBoosts(attacker.creep, 'attacker');
        }
      }
    }
    
    for (const healer of this.healers) {
      if (!healer.creep.ticksToLive || healer.creep.ticksToLive >= 1450) {
        // Newly spawned, request boosts
        if (this.Nexus.boostManager) {
          this.Nexus.boostManager.requestBoosts(healer.creep, 'healer');
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
  private runAttacker(attacker: Warrior): void {
    if (!this.targetRoom) {
      // No target, return to home
      if (attacker.room.name !== this.Nexus.name) {
        attacker.goToRoom(this.Nexus.name);
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
  private runHealer(healer: Warrior): void {
    if (!this.targetRoom) {
      // No target, return home
      if (healer.room.name !== this.Nexus.name) {
        healer.goToRoom(this.Nexus.name);
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
    // Melee attackers with TOUGH for armor
    return BodyBuilder.defender(this.Nexus.energyAvailable, false);
  }
  
  /**
   * Calculate healer body
   */
  private calculateHealerBody(): BodyPartConstant[] {
    const energy = this.Nexus.energyAvailable;
    // Healers: HEAL + MOVE pattern, min 300 energy (1H, 1M)
    const pattern: BodyPartConstant[] = [HEAL, MOVE];
    return BodyBuilder.repeat(pattern, energy, 25);
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
    for (const Warrior of this.warriors) {
      Warrior.memory.targetRoom = roomName;
      if (formation) Warrior.memory.formation = formation;
      if (tactic) Warrior.memory.tactic = tactic;
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
    
    for (const Warrior of this.warriors) {
      Warrior.memory.targetRoom = undefined;
      Warrior.memory.formation = undefined;
      Warrior.memory.tactic = undefined;
    }
  }
  
  /**
   * Get squad status
   */
  getSquadStatus(): any {
    if (!this.squad) {
      return {
        size: this.warriors.length,
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
