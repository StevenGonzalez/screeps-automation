/**
 * REMOTE DEFENDER ARBITER - Guardian of Distant Harvest
 * 
 * "The Zealots protect what the Seekers gather"
 * 
 * Manages defensive creeps for remote mining operations.
 * Spawns defenders to protect miners from hostile threats.
 */

/// <reference types="@types/screeps" />

import { Arbiter, ArbiterPriority, ArbiterMemory } from './Arbiter';
import { Nexus } from '../core/Nexus';
import { Warrior } from '../Warriors/Warrior';
import { SpawnPriority } from '../spawning/SpawnQueue';
import { BodyBuilder } from '../utils/BodyBuilder';

interface RemoteDefenderMemory extends ArbiterMemory {
  targetRoom: string;
  threatLevel: number;
  lastThreatCheck: number;
}

/**
 * Remote Defender Arbiter - Protects remote mining operations
 */
export class RemoteDefenderArbiter extends Arbiter {
  targetRoom: string;
  defenders: Warrior[];
  
  constructor(Nexus: Nexus, targetRoom: string) {
    super(Nexus, `remoteDefender_${targetRoom}`, ArbiterPriority.defense.melee);
    this.targetRoom = targetRoom;
    this.defenders = [];
    
    // Initialize memory
    const rdMemory = this.memory as RemoteDefenderMemory;
    if (!rdMemory.targetRoom) {
      rdMemory.targetRoom = targetRoom;
      rdMemory.threatLevel = 0;
      rdMemory.lastThreatCheck = 0;
    }
  }
  
  init(): void {
    this.refresh();
    
    // Check threat level every 10 ticks
    if (Game.time - (this.memory as RemoteDefenderMemory).lastThreatCheck > 10) {
      this.assessThreat();
      (this.memory as RemoteDefenderMemory).lastThreatCheck = Game.time;
    }
    
    const rdMemory = this.memory as RemoteDefenderMemory;
    
    // Only spawn defenders if threat detected
    if (rdMemory.threatLevel > 0) {
      const desiredDefenders = this.calculateDesiredDefenders();
      if (this.defenders.length < desiredDefenders) {
        this.requestDefender();
      }
    }
  }
  
  run(): void {
    const rdMemory = this.memory as RemoteDefenderMemory;
    
    // No threat - defenders can rest in home room
    if (rdMemory.threatLevel === 0) {
      for (const defender of this.defenders) {
        this.runDefenderIdle(defender);
      }
      return;
    }
    
    // Threat detected - send defenders to remote room
    for (const defender of this.defenders) {
      this.runDefenderActive(defender);
    }
  }
  
  private runDefenderIdle(defender: Warrior): void {
    const creep = defender.creep;
    
    // Stay near spawn in home room
    if (creep.room.name !== this.Nexus.name) {
      const exitDir = creep.room.findExitTo(this.Nexus.name);
      if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByPath(exitDir);
        if (exit) {
          defender.goTo(exit);
        }
      }
      return;
    }
    
    // Find a safe position near spawn
    const spawn = this.Nexus.primarySpawn;
    if (spawn && !creep.pos.inRangeTo(spawn, 3)) {
      defender.goTo(spawn.pos);
    }
    
    defender.say('😴');
  }
  
  private runDefenderActive(defender: Warrior): void {
    const creep = defender.creep;
    
    // Move to target room if not there
    if (creep.room.name !== this.targetRoom) {
      const exitDir = creep.room.findExitTo(this.targetRoom);
      if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByPath(exitDir);
        if (exit) {
          defender.goTo(exit);
          defender.say('🛡️');
        }
      }
      return;
    }
    
    // In target room - engage hostiles
    const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
    
    if (hostiles.length === 0) {
      // No hostiles - patrol around sources
      const sources = creep.room.find(FIND_SOURCES);
      if (sources.length > 0) {
        const closestSource = creep.pos.findClosestByPath(sources);
        if (closestSource && !creep.pos.inRangeTo(closestSource, 5)) {
          defender.goTo(closestSource.pos);
        }
      }
      defender.say('👁️');
      return;
    }
    
    // Find priority target
    const target = this.selectTarget(hostiles);
    
    if (target) {
      // Attack target
      if (creep.getActiveBodyparts(RANGED_ATTACK) > 0) {
        // Ranged attacker - keep distance
        if (creep.pos.getRangeTo(target) > 3) {
          defender.goTo(target.pos);
        } else if (creep.pos.getRangeTo(target) < 3) {
          // Kite away
          const flee = PathFinder.search(creep.pos, { pos: target.pos, range: 5 }, {
            flee: true,
            maxRooms: 1
          });
          if (flee.path.length > 0) {
            creep.move(creep.pos.getDirectionTo(flee.path[0]));
          }
        }
        
        // Attack
        creep.rangedAttack(target);
        defender.say('🏹');
      } else {
        // Melee attacker - close in
        if (creep.pos.isNearTo(target)) {
          creep.attack(target);
          defender.say('⚔️');
        } else {
          defender.goTo(target.pos);
        }
      }
    }
  }
  
  private selectTarget(hostiles: Creep[]): Creep | null {
    if (hostiles.length === 0) return null;
    
    // Priority 1: Attackers (most dangerous)
    const attackers = hostiles.filter(h => 
      h.body.some(p => p.type === ATTACK || p.type === RANGED_ATTACK)
    );
    if (attackers.length > 0) {
      return attackers.sort((a, b) => a.hits - b.hits)[0];
    }
    
    // Priority 2: Healers (prevent sustain)
    const healers = hostiles.filter(h => h.body.some(p => p.type === HEAL));
    if (healers.length > 0) {
      return healers[0];
    }
    
    // Priority 3: Any hostile
    return hostiles[0];
  }
  
  private assessThreat(): void {
    const rdMemory = this.memory as RemoteDefenderMemory;
    const room = Game.rooms[this.targetRoom];
    
    if (!room) {
      // No vision - assume safe
      rdMemory.threatLevel = 0;
      return;
    }
    
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    
    if (hostiles.length === 0) {
      rdMemory.threatLevel = 0;
      return;
    }
    
    // Calculate threat level based on hostile body parts
    let threat = 0;
    
    for (const hostile of hostiles) {
      const attackParts = hostile.body.filter(p => p.type === ATTACK).length;
      const rangedParts = hostile.body.filter(p => p.type === RANGED_ATTACK).length;
      const healParts = hostile.body.filter(p => p.type === HEAL).length;
      const toughParts = hostile.body.filter(p => p.type === TOUGH).length;
      
      threat += attackParts * 2; // Melee is very dangerous
      threat += rangedParts * 3; // Ranged is most dangerous
      threat += healParts * 2; // Healers make fights harder
      threat += Math.floor(toughParts / 5); // Tanks are problematic
    }
    
    rdMemory.threatLevel = threat;
    
    if (threat > 0) {
      console.log(`⚠️ Threat detected in ${this.targetRoom}: level ${threat} (${hostiles.length} hostiles)`);
    }
  }
  
  private calculateDesiredDefenders(): number {
    const rdMemory = this.memory as RemoteDefenderMemory;
    const threat = rdMemory.threatLevel;
    
    // No defenders needed if no threat
    if (threat === 0) return 0;
    
    // Scale defenders based on threat level
    if (threat < 5) return 1; // Light threat - 1 defender
    if (threat < 15) return 2; // Medium threat - 2 defenders
    return 3; // Heavy threat - 3 defenders
  }
  
  private requestDefender(): void {
    const body = this.calculateDefenderBody();
    const name = `Zealot_${this.targetRoom}_${Game.time}`;
    
    this.requestSpawn(body, name, {
      role: 'Warrior_remoteDefender',
      targetRoom: this.targetRoom
    } as any, SpawnPriority.DEFENSE);
  }
  
  private calculateDefenderBody(): BodyPartConstant[] {
    const rdMemory = this.memory as RemoteDefenderMemory;
    const threat = rdMemory.threatLevel;
    
    // Use ranged defenders, heavier if threat is high
    const useRanged = true;
    return BodyBuilder.defender(this.Nexus.energyAvailable, useRanged);
  }
  
  protected getCreepsForRole(): Creep[] {
    const creeps = this.room.find(FIND_MY_CREEPS, {
      filter: (creep) => 
        creep.memory.arbiter === this.ref ||
        (creep.memory.role === 'remoteDefender' && 
         (creep.memory as any).targetRoom === this.targetRoom)
    });
    
    this.defenders = creeps.map(c => new Warrior(c, this));
    return creeps;
  }
}
