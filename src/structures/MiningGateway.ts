/**
 * MINING Gateway - Source Harvesting Cluster
 * 
 * "From these sacred springs flow the lifeblood of the KHALA"
 * 
 * A Mining Gateway manages a single source and its surrounding infrastructure:
 * - Source
 * - Container (for collection)
 * - Link (optional, for fast transport)
 * - Roads (for efficient movement)
 */

/// <reference types="@types/screeps" />

import { Gateway } from './Gateway';
import { Nexus } from '../core/Nexus';

interface MiningGatewayMemory {
  sourceId: string;
  containerPos?: { x: number; y: number };
  linkId?: string;
}

/**
 * Mining Gateway - Manages a source and its infrastructure
 */
export class MiningGateway extends Gateway {
  source: Source | null;
  container: StructureContainer | null;
  link: StructureLink | null;
  
  constructor(Nexus: Nexus, source: Source) {
    super(Nexus, source.pos);
    
    this.source = source;
    this.container = null;
    this.link = null;
    
    // Store source ID in memory
    if (!this.memory.sourceId) {
      this.memory.sourceId = source.id;
    }
  }
  
  init(): void {
    // Refresh source reference
    this.source = Game.getObjectById(this.memory.sourceId as Id<Source>);
    if (!this.source) return;
    
    // Find container
    this.findContainer();
    
    // Find link
    this.findLink();
    
    // Plan container if needed
    if (!this.container && !this.memory.containerPos) {
      this.planContainer();
    }
  }
  
  run(): void {
    // gateways are mostly passive - they provide structure references
    // The MiningArbiter handles the actual creep logic
    
    // Could implement:
    // - Auto-repair container
    // - Link energy transfer
    // - Construction site creation
  }
  
  private findContainer(): void {
    if (!this.source) return;
    
    const containers = this.source.pos.findInRange(FIND_STRUCTURES, 2, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER
    }) as StructureContainer[];
    
    this.container = containers[0] || null;
  }
  
  private findLink(): void {
    if (!this.source) return;
    
    const links = this.source.pos.findInRange(FIND_MY_STRUCTURES, 2, {
      filter: (s) => s.structureType === STRUCTURE_LINK
    }) as StructureLink[];
    
    this.link = links[0] || null;
    
    if (this.link) {
      this.memory.linkId = this.link.id;
    }
  }
  
  private planContainer(): void {
    if (!this.source) return;
    
    // Find optimal container position (adjacent to source)
    const terrain = new Room.Terrain(this.room.name);
    const positions: RoomPosition[] = [];
    
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        
        const x = this.source.pos.x + dx;
        const y = this.source.pos.y + dy;
        
        if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
          positions.push(new RoomPosition(x, y, this.room.name));
        }
      }
    }
    
    if (positions.length > 0) {
      // Pick position closest to spawn or controller
      const spawn = this.room.find(FIND_MY_SPAWNS)[0];
      const target = spawn || this.room.controller;
      
      if (target) {
        const best = target.pos.findClosestByPath(positions);
        if (best) {
          this.memory.containerPos = { x: best.x, y: best.y };
          
          // Create construction site if we have the energy
          if (this.Nexus.level >= 2) {
            best.createConstructionSite(STRUCTURE_CONTAINER);
          }
        }
      }
    }
  }
  
  /**
   * Get the optimal mining position (on the container)
   */
  get miningPos(): RoomPosition | null {
    if (this.container) {
      return this.container.pos;
    }
    
    if (this.memory.containerPos) {
      return new RoomPosition(
        this.memory.containerPos.x,
        this.memory.containerPos.y,
        this.room.name
      );
    }
    
    return null;
  }
  
  /**
   * Check if this mining site needs a hauler
   */
  get needsHauler(): boolean {
    // If we have a container with energy, we need haulers
    return !!(this.container && this.container.store.getUsedCapacity(RESOURCE_ENERGY) > 100);
  }
}
