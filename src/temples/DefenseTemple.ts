/**
 * DEFENSE TEMPLE - Fortification Management
 * 
 * "Barriers are the will of the Gods made manifest"
 * 
 * Manages ramparts, walls, and defensive structures to protect High Charity.
 * Coordinates fortification placement and maintenance.
 */

/// <reference types="@types/screeps" />

import { HighCharity } from '../core/HighCharity';
import { Temple } from './Temple';

export interface DefenseTempleMemory {
  rampartPlan: string[];
  wallPlan: string[];
  lastPlanned: number;
  threatLevel: number;
}

/**
 * Defense Temple - Manages room fortifications
 */
export class DefenseTemple extends Temple {
  ramparts: StructureRampart[];
  walls: StructureWall[];
  
  constructor(highCharity: HighCharity) {
    // Use controller position as the defense temple anchor
    const pos = highCharity.controller?.pos || new RoomPosition(25, 25, highCharity.room.name);
    super(highCharity, pos);
    this.ramparts = [];
    this.walls = [];
  }
  
  init(): void {
    // Gather fortification references
    this.ramparts = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_RAMPART
    }) as StructureRampart[];
    
    this.walls = this.room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_WALL
    }) as StructureWall[];
    
    // Plan fortifications every 500 ticks
    if (Game.time % 500 === 0) {
      this.planFortifications();
    }
    
    // Place construction sites for planned fortifications
    if (Game.time % 100 === 0) {
      this.buildPlannedFortifications();
    }
  }
  
  run(): void {
    // Monitor threat level
    this.assessThreatLevel();
    
    // Emergency rampart reinforcement if under attack
    if (this.memory.threatLevel > 0) {
      this.emergencyReinforce();
    }
  }
  
  /**
   * Plan rampart and wall positions
   */
  private planFortifications(): void {
    const level = this.room.controller!.level;
    
    // Only start fortifying at RCL 3+
    if (level < 3) return;
    
    const memory = this.memory as any as DefenseTempleMemory;
    
    // COVENANT DEFENSIVE DOCTRINE:
    // 1. Ramparts protect all critical structures
    // 2. Walls form a perimeter barrier at chokepoints
    // 3. Layered defense with overlapping fields of fire
    
    // Find critical structures to protect with ramparts
    const criticalStructures = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => {
        return s.structureType === STRUCTURE_SPAWN ||
               s.structureType === STRUCTURE_TOWER ||
               s.structureType === STRUCTURE_STORAGE ||
               s.structureType === STRUCTURE_TERMINAL ||
               s.structureType === STRUCTURE_POWER_SPAWN ||
               s.structureType === STRUCTURE_NUKER ||
               s.structureType === STRUCTURE_LAB;
      }
    });
    
    // Add ramparts for critical structures
    const rampartPositions: string[] = [];
    for (const structure of criticalStructures) {
      rampartPositions.push(`${structure.pos.x},${structure.pos.y}`);
    }
    
    // Add ramparts for spawns' adjacent tiles (for safe spawning)
    const spawns = this.highCharity.spawns;
    for (const spawn of spawns) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const x = spawn.pos.x + dx;
          const y = spawn.pos.y + dy;
          if (x < 1 || x > 48 || y < 1 || y > 48) continue;
          rampartPositions.push(`${x},${y}`);
        }
      }
    }
    
    memory.rampartPlan = rampartPositions;
    
    // Plan perimeter walls for RCL 4+
    if (level >= 4) {
      const wallPositions = this.planPerimeterWalls();
      memory.wallPlan = wallPositions;
    } else {
      memory.wallPlan = [];
    }
    
    memory.lastPlanned = Game.time;
    
    console.log(`🛡️ ${this.highCharity.name}: Planned ${rampartPositions.length} ramparts, ${memory.wallPlan.length} walls`);
  }
  
  /**
   * Plan perimeter walls at room exits and chokepoints
   */
  private planPerimeterWalls(): string[] {
    const walls: string[] = [];
    const terrain = new Room.Terrain(this.room.name);
    
    // Find exit tiles
    const exits = this.room.find(FIND_EXIT);
    
    // For each exit, build walls 3 tiles inward
    for (const exit of exits) {
      // Calculate direction toward room center
      const centerX = 25;
      const centerY = 25;
      const dx = Math.sign(centerX - exit.x);
      const dy = Math.sign(centerY - exit.y);
      
      // Place wall 3 tiles inward
      for (let offset = 2; offset <= 4; offset++) {
        const wallX = exit.x + dx * offset;
        const wallY = exit.y + dy * offset;
        
        if (wallX < 2 || wallX > 47 || wallY < 2 || wallY > 47) continue;
        if (terrain.get(wallX, wallY) === TERRAIN_MASK_WALL) continue;
        
        const posStr = `${wallX},${wallY}`;
        
        // Don't place walls where ramparts are planned
        const memory = this.memory as any as DefenseTempleMemory;
        if (memory.rampartPlan && memory.rampartPlan.includes(posStr)) continue;
        
        // Don't place walls on critical structures
        const structures = this.room.lookForAt(LOOK_STRUCTURES, wallX, wallY);
        const hasCritical = structures.some(s => 
          s.structureType !== STRUCTURE_ROAD &&
          s.structureType !== STRUCTURE_CONTAINER &&
          s.structureType !== STRUCTURE_RAMPART
        );
        if (hasCritical) continue;
        
        walls.push(posStr);
      }
    }
    
    // Limit wall count (max 2500 total, but reasonable amount per level)
    const maxWalls = Math.min(500, this.room.controller!.level * 50);
    return walls.slice(0, maxWalls);
  }
  
  /**
   * Build planned fortifications
   */
  private buildPlannedFortifications(): void {
    const memory = this.memory as any as DefenseTempleMemory;
    if (!memory.rampartPlan) return;
    
    const level = this.room.controller!.level;
    const maxRamparts = CONTROLLER_STRUCTURES[STRUCTURE_RAMPART][level];
    const maxWalls = CONTROLLER_STRUCTURES[STRUCTURE_WALL][level];
    
    // Count existing
    const existingRamparts = this.ramparts.length;
    const existingWalls = this.walls.length;
    
    // Build ramparts (priority)
    let rampartsBuilt = 0;
    for (const posStr of memory.rampartPlan) {
      if (existingRamparts + rampartsBuilt >= maxRamparts) break;
      
      const [x, y] = posStr.split(',').map(Number);
      const pos = new RoomPosition(x, y, this.room.name);
      
      // Check if rampart already exists
      const hasRampart = pos.lookFor(LOOK_STRUCTURES).some(s => s.structureType === STRUCTURE_RAMPART);
      const hasSite = pos.lookFor(LOOK_CONSTRUCTION_SITES).some(s => s.structureType === STRUCTURE_RAMPART);
      
      if (!hasRampart && !hasSite) {
        const result = this.room.createConstructionSite(x, y, STRUCTURE_RAMPART);
        if (result === OK) rampartsBuilt++;
        if (result === ERR_FULL) break; // Hit construction site limit
      }
    }
    
    // Build walls (secondary)
    if (memory.wallPlan) {
      let wallsBuilt = 0;
      for (const posStr of memory.wallPlan) {
        if (existingWalls + wallsBuilt >= maxWalls) break;
        
        const [x, y] = posStr.split(',').map(Number);
        const pos = new RoomPosition(x, y, this.room.name);
        
        // Check if wall already exists
        const hasWall = pos.lookFor(LOOK_STRUCTURES).some(s => s.structureType === STRUCTURE_WALL);
        const hasSite = pos.lookFor(LOOK_CONSTRUCTION_SITES).some(s => s.structureType === STRUCTURE_WALL);
        
        if (!hasWall && !hasSite) {
          const result = this.room.createConstructionSite(x, y, STRUCTURE_WALL);
          if (result === OK) wallsBuilt++;
          if (result === ERR_FULL) break;
        }
      }
    }
  }
  
  /**
   * Assess current threat level
   */
  private assessThreatLevel(): void {
    const hostiles = this.room.find(FIND_HOSTILE_CREEPS);
    const memory = this.memory as any as DefenseTempleMemory;
    
    let threatLevel = 0;
    
    for (const hostile of hostiles) {
      // Count dangerous body parts
      const attackParts = hostile.body.filter(p => p.type === ATTACK).length;
      const rangedParts = hostile.body.filter(p => p.type === RANGED_ATTACK).length;
      const workParts = hostile.body.filter(p => p.type === WORK).length;
      const healParts = hostile.body.filter(p => p.type === HEAL).length;
      
      // Calculate threat contribution
      threatLevel += attackParts * 30;
      threatLevel += rangedParts * 10;
      threatLevel += workParts * 5;
      threatLevel += healParts * 15; // Healers extend combat significantly
    }
    
    memory.threatLevel = threatLevel;
    
    // Alert if under serious attack
    if (threatLevel > 500 && Game.time % 10 === 0) {
      console.log(`🚨 ${this.highCharity.name}: HIGH THREAT DETECTED! Level: ${threatLevel}`);
    }
  }
  
  /**
   * Emergency rampart reinforcement during attacks
   */
  private emergencyReinforce(): void {
    const memory = this.memory as any as DefenseTempleMemory;
    
    // Find weakest ramparts near hostiles
    const hostiles = this.room.find(FIND_HOSTILE_CREEPS);
    if (hostiles.length === 0) return;
    
    const weakRamparts = this.ramparts
      .filter(r => {
        // Only reinforce ramparts near threats
        return hostiles.some(h => r.pos.getRangeTo(h) <= 5);
      })
      .sort((a, b) => {
        // Prioritize by HP percentage
        const aPercent = a.hits / a.hitsMax;
        const bPercent = b.hits / b.hitsMax;
        return aPercent - bPercent;
      });
    
    // Towers should focus on reinforcing these
    const towers = this.highCharity.towers.filter(t => 
      t.store.getUsedCapacity(RESOURCE_ENERGY) > 100
    );
    
    for (let i = 0; i < Math.min(weakRamparts.length, towers.length); i++) {
      const rampart = weakRamparts[i];
      const tower = towers[i];
      
      // Only repair if below 50% HP during attack
      if (rampart.hits < rampart.hitsMax * 0.5) {
        tower.repair(rampart);
      }
    }
  }
  
  /**
   * Get ramparts needing repair
   */
  getRampartsNeedingRepair(): StructureRampart[] {
    const targetHP = this.getRampartTargetHP();
    
    return this.ramparts
      .filter(r => r.hits < targetHP)
      .sort((a, b) => a.hits - b.hits);
  }
  
  /**
   * Get walls needing repair
   */
  getWallsNeedingRepair(): StructureWall[] {
    const targetHP = this.getWallTargetHP();
    
    return this.walls
      .filter(w => w.hits < targetHP)
      .sort((a, b) => a.hits - b.hits);
  }
  
  /**
   * Get target HP for ramparts based on RCL
   */
  private getRampartTargetHP(): number {
    const level = this.room.controller!.level;
    if (level < 4) return 10000;
    if (level < 6) return 50000;
    if (level < 8) return 300000;
    return 1000000;
  }
  
  /**
   * Get target HP for walls based on RCL
   */
  private getWallTargetHP(): number {
    const level = this.room.controller!.level;
    if (level < 6) return 10000;
    if (level < 8) return 100000;
    return 500000;
  }
}
