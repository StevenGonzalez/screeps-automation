/**
 * ROOM PLANNER
 * 
 * "The Hierarchs decree where the sacred structures shall stand"
 * 
 * Automated room planning and layout system. Determines optimal placement
 * for all structures based on terrain, sources, controller position, and
 * strategic considerations.
 */

/// <reference types="@types/screeps" />

export interface RoomPlan {
  anchor: RoomPosition; // Central anchor point (typically near storage)
  spawns: RoomPosition[];
  extensions: RoomPosition[];
  towers: RoomPosition[];
  storage: RoomPosition | null;
  terminal: RoomPosition | null;
  labs: RoomPosition[];
  factory: RoomPosition | null;
  powerSpawn: RoomPosition | null;
  nuker: RoomPosition | null;
  observer: RoomPosition | null;
  links: RoomPosition[];
  roads: RoomPosition[];
  ramparts: RoomPosition[];
  walls: RoomPosition[];
}

// Plan version - increment to force regeneration of all room plans
const PLAN_VERSION = 3;

export interface RoomPlannerMemory {
  plan: any;
  lastPlanned: number;
  version: number;
}

/**
 * Room Planner - Automated base layout system
 */
export class RoomPlanner {
  room: Room;
  memory: RoomPlannerMemory;
  terrain: RoomTerrain;
  
  constructor(room: Room) {
    this.room = room;
    this.terrain = new Room.Terrain(room.name);
    
    // Initialize memory
    if (!Memory.rooms[room.name]) {
      Memory.rooms[room.name] = {} as any;
    }
    const roomMem: any = Memory.rooms[room.name];
    if (!roomMem.planner) {
      roomMem.planner = {
        plan: null,
        lastPlanned: 0,
        version: 1
      };
    }
    this.memory = roomMem.planner;
  }
  
  /**
   * Get or generate the room plan
   */
  getPlan(): RoomPlan | null {
    // Check if plan version is outdated - force regeneration
    if (this.memory.version !== PLAN_VERSION) {
      console.log(`🔄 RoomPlanner ${this.room.name}: Plan version outdated (${this.memory.version} -> ${PLAN_VERSION}), regenerating...`);
      this.memory.plan = null;
    }
    
    // Return cached plan if available and not too old
    if (this.memory.plan && Game.time - this.memory.lastPlanned < 10000) {
      // CRITICAL: Reconstruct RoomPosition objects from memory
      // Memory serialization loses the RoomPosition prototype
      return this.reconstructPlan(this.memory.plan);
    }
    
    // Generate new plan
    return this.generatePlan();
  }
  
  /**
   * Reconstruct RoomPosition objects from plain memory objects
   * Memory serialization loses prototypes, so we need to recreate them
   */
  private reconstructPlan(storedPlan: any): RoomPlan {
    const reconstruct = (pos: any): RoomPosition => {
      if (!pos) return pos;
      return new RoomPosition(pos.x, pos.y, pos.roomName);
    };
    
    const reconstructArray = (arr: any[]): RoomPosition[] => {
      if (!arr) return [];
      return arr.map(pos => reconstruct(pos));
    };
    
    return {
      anchor: reconstruct(storedPlan.anchor),
      spawns: reconstructArray(storedPlan.spawns),
      extensions: reconstructArray(storedPlan.extensions),
      towers: reconstructArray(storedPlan.towers),
      storage: storedPlan.storage ? reconstruct(storedPlan.storage) : null,
      terminal: storedPlan.terminal ? reconstruct(storedPlan.terminal) : null,
      labs: reconstructArray(storedPlan.labs),
      factory: storedPlan.factory ? reconstruct(storedPlan.factory) : null,
      powerSpawn: storedPlan.powerSpawn ? reconstruct(storedPlan.powerSpawn) : null,
      nuker: storedPlan.nuker ? reconstruct(storedPlan.nuker) : null,
      observer: storedPlan.observer ? reconstruct(storedPlan.observer) : null,
      links: reconstructArray(storedPlan.links),
      roads: reconstructArray(storedPlan.roads),
      ramparts: reconstructArray(storedPlan.ramparts),
      walls: reconstructArray(storedPlan.walls)
    };
  }
  
  /**
   * Generate a complete room plan
   */
  private generatePlan(): RoomPlan | null {
    const controller = this.room.controller;
    if (!controller || !controller.my) {
      return null;
    }
    
    // Find optimal anchor point (central location near controller)
    const anchor = this.findAnchorPosition();
    if (!anchor) {
      console.log(`⚠️ Room ${this.room.name}: Could not find anchor position`);
      return null;
    }
    
    const plan: RoomPlan = {
      anchor,
      spawns: [],
      extensions: [],
      towers: [],
      storage: null,
      terminal: null,
      labs: [],
      factory: null,
      powerSpawn: null,
      nuker: null,
      observer: null,
      links: [],
      roads: [],
      ramparts: [],
      walls: []
    };
    
    // Plan core structures around anchor
    this.planCoreStructures(plan);
    
    // Plan labs in a compact cluster (BEFORE extensions to reserve space)
    this.planLabs(plan);
    
    // Plan extensions in clusters
    this.planExtensions(plan);
    
    // Plan towers for defense coverage
    this.planTowers(plan);
    
    // Plan links at key locations
    this.planLinks(plan);
    
    // Plan roads connecting everything
    this.planRoads(plan);
    
    // Save plan to memory
    this.memory.plan = plan;
    this.memory.lastPlanned = Game.time;
    this.memory.version = PLAN_VERSION;
    
    console.log(`📐 Room ${this.room.name}: Generated new base plan (v${PLAN_VERSION})`);
    return plan;
  }
  
  /**
   * Find optimal anchor position for base
   * Should be centrally located and accessible
   */
  private findAnchorPosition(): RoomPosition | null {
    const controller = this.room.controller!;
    const sources = this.room.find(FIND_SOURCES);
    
    // Find position that balances distance to controller and sources
    let bestPos: RoomPosition | null = null;
    let bestScore = Infinity;
    
    // Search in a grid around center of room
    for (let x = 20; x < 30; x++) {
      for (let y = 20; y < 30; y++) {
        const pos = new RoomPosition(x, y, this.room.name);
        
        // Skip walls
        if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) {
          continue;
        }
        
        // Check if area has enough space (5x5 clear area)
        if (!this.hasOpenSpace(pos, 5)) {
          continue;
        }
        
        // Calculate score (lower is better)
        const distToController = pos.getRangeTo(controller);
        const avgDistToSources = sources.reduce((sum, s) => sum + pos.getRangeTo(s), 0) / sources.length;
        const score = distToController + avgDistToSources;
        
        if (score < bestScore) {
          bestScore = score;
          bestPos = pos;
        }
      }
    }
    
    return bestPos;
  }
  
  /**
   * Check if position has open space around it
   */
  private hasOpenSpace(pos: RoomPosition, radius: number): boolean {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const x = pos.x + dx;
        const y = pos.y + dy;
        
        if (x < 1 || x > 48 || y < 1 || y > 48) {
          return false;
        }
        
        if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) {
          return false;
        }
      }
    }
    return true;
  }
  
  /**
   * Plan core structures (storage, terminal, factory, power spawn)
   * KHALA THEME: Central sacred anchor with symmetrical holy structures
   */
  private planCoreStructures(plan: RoomPlan): void {
    const anchor = plan.anchor;
    
    // SACRED CORE: Storage at the holy anchor (Nexus's heart)
    plan.storage = anchor;
    
    // Terminal forms a cross pattern with storage (religious symbolism)
    plan.terminal = new RoomPosition(anchor.x + 2, anchor.y, this.room.name);
    
    // Factory on opposite side of the cross
    plan.factory = new RoomPosition(anchor.x - 2, anchor.y, this.room.name);
    
    // Power spawn completes the vertical cross
    plan.powerSpawn = new RoomPosition(anchor.x, anchor.y + 2, this.room.name);
    
    // HIERARCHS' THRONES: Spawns arranged in triangular formation (3 points of hierarchy)
    // North spawn (Hierarch Artanis)
    plan.spawns.push(new RoomPosition(anchor.x, anchor.y - 3, this.room.name));
    // Southwest spawn (Executor Tassadar)
    plan.spawns.push(new RoomPosition(anchor.x - 3, anchor.y + 2, this.room.name));
    // Southeast spawn (Praetor Fenix)
    plan.spawns.push(new RoomPosition(anchor.x + 3, anchor.y + 2, this.room.name));
    
    // Observer and nuker flanking the sacred core
    plan.observer = new RoomPosition(anchor.x - 1, anchor.y - 2, this.room.name);
    plan.nuker = new RoomPosition(anchor.x + 1, anchor.y - 2, this.room.name);
  }
  
  /**
   * Plan extensions in radial KHALA pattern
   * KHALA THEME: RINGS OF Nexus - Sacred geometric tiers
   * Forms distinctive hexagonal mandala pattern representing the holy city's layers
   */
  private planExtensions(plan: RoomPlan): void {
    const anchor = plan.anchor;
    const maxExtensions = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][this.room.controller!.level];
    
    const positions: RoomPosition[] = [];
    
    // RINGS OF Nexus: 6-fold sacred symmetry (KHALA religious architecture)
    // Each ring represents a tier of the holy city, extensions are prayer shrines
    const baseAngles = [0, 60, 120, 180, 240, 300]; // Primary cardinal directions
    
    // Ring 1: Inner Sanctum - 6 extensions forming perfect hexagon
    for (const angle of baseAngles) {
      const rad = (angle * Math.PI) / 180;
      const dist = 4;
      const x = Math.round(anchor.x + Math.cos(rad) * dist);
      const y = Math.round(anchor.y + Math.sin(rad) * dist);
      
      if (x >= 2 && x <= 47 && y >= 2 && y <= 47) {
        if (this.terrain.get(x, y) !== TERRAIN_MASK_WALL) {
          const pos = new RoomPosition(x, y, this.room.name);
          if (!this.isPositionReserved(pos, plan) && !positions.some(p => p.x === pos.x && p.y === pos.y)) {
            positions.push(pos);
          }
        }
      }
    }
    
    // Rings 2-4: Middle Tiers - Extensions between cardinal points (12-fold symmetry)
    const secondaryAngles = [30, 90, 150, 210, 270, 330]; // Secondary directions
    for (let ring = 2; ring <= 4 && positions.length < maxExtensions; ring++) {
      const radius = 3 + ring;
      
      // Primary cardinal points (stronger)
      for (const angle of baseAngles) {
        for (let offset = -0.5; offset <= 0.5; offset += 0.5) {
          const rad = ((angle + offset * 15) * Math.PI) / 180;
          const x = Math.round(anchor.x + Math.cos(rad) * radius);
          const y = Math.round(anchor.y + Math.sin(rad) * radius);
          
          if (x >= 2 && x <= 47 && y >= 2 && y <= 47) {
            if (this.terrain.get(x, y) !== TERRAIN_MASK_WALL) {
              const pos = new RoomPosition(x, y, this.room.name);
              if (!this.isPositionReserved(pos, plan) && !positions.some(p => p.x === pos.x && p.y === pos.y)) {
                positions.push(pos);
                if (positions.length >= maxExtensions) break;
              }
            }
          }
        }
        if (positions.length >= maxExtensions) break;
      }
      
      // Secondary points (filling gaps)
      if (ring >= 3) {
        for (const angle of secondaryAngles) {
          const rad = (angle * Math.PI) / 180;
          const x = Math.round(anchor.x + Math.cos(rad) * radius);
          const y = Math.round(anchor.y + Math.sin(rad) * radius);
          
          if (x >= 2 && x <= 47 && y >= 2 && y <= 47) {
            if (this.terrain.get(x, y) !== TERRAIN_MASK_WALL) {
              const pos = new RoomPosition(x, y, this.room.name);
              if (!this.isPositionReserved(pos, plan) && !positions.some(p => p.x === pos.x && p.y === pos.y)) {
                positions.push(pos);
                if (positions.length >= maxExtensions) break;
              }
            }
          }
        }
      }
      if (positions.length >= maxExtensions) break;
    }
    
    // Rings 5-6: Outer Tiers - Dense spiral pattern for remaining extensions
    for (let ring = 5; ring <= 6 && positions.length < maxExtensions; ring++) {
      const radius = 3 + ring;
      const angleCount = 18; // More positions in outer rings
      
      for (let i = 0; i < angleCount && positions.length < maxExtensions; i++) {
        const angle = (360 / angleCount) * i;
        const rad = (angle * Math.PI) / 180;
        const x = Math.round(anchor.x + Math.cos(rad) * radius);
        const y = Math.round(anchor.y + Math.sin(rad) * radius);
        
        if (x >= 2 && x <= 47 && y >= 2 && y <= 47) {
          if (this.terrain.get(x, y) !== TERRAIN_MASK_WALL) {
            const pos = new RoomPosition(x, y, this.room.name);
            if (!this.isPositionReserved(pos, plan) && !positions.some(p => p.x === pos.x && p.y === pos.y)) {
              positions.push(pos);
            }
          }
        }
      }
    }
    
    plan.extensions = positions.slice(0, maxExtensions);
  }
  
  /**
   * Plan towers in defensive perimeter
   * KHALA THEME: Towers arranged as guardian sentinels
   */
  private planTowers(plan: RoomPlan): void {
    const anchor = plan.anchor;
    const maxTowers = CONTROLLER_STRUCTURES[STRUCTURE_TOWER][this.room.controller!.level];
    
    // DEFENSIVE FORMATION: Towers form a protective ring
    // Positioned to create overlapping fields of fire
    const towerPositions: RoomPosition[] = [
      // Inner defensive ring
      new RoomPosition(anchor.x, anchor.y - 4, this.room.name),     // North guardian
      new RoomPosition(anchor.x + 3, anchor.y - 2, this.room.name), // Northeast guardian
      new RoomPosition(anchor.x + 3, anchor.y + 2, this.room.name), // Southeast guardian
      new RoomPosition(anchor.x, anchor.y + 4, this.room.name),     // South guardian
      new RoomPosition(anchor.x - 3, anchor.y + 2, this.room.name), // Southwest guardian
      new RoomPosition(anchor.x - 3, anchor.y - 2, this.room.name)  // Northwest guardian
    ];
    
    plan.towers = towerPositions.slice(0, maxTowers);
  }
  
  /**
   * Plan labs in compact cluster for reactions
   * KHALA THEME: Labs arranged in a research sanctum
   */
  private planLabs(plan: RoomPlan): void {
    const anchor = plan.anchor;
    const maxLabs = CONTROLLER_STRUCTURES[STRUCTURE_LAB][this.room.controller!.level];
    
    // RESEARCH SANCTUM: Labs form a tight ceremonial cluster
    // Positioned at distance 10+ from anchor to avoid extension rings (which go up to radius 9)
    // Arranged in a compact 'flower' pattern for optimal reaction efficiency
    const labPositions: RoomPosition[] = [
      // Central labs (reagent sources) - placed to the right of base
      new RoomPosition(anchor.x + 10, anchor.y, this.room.name),
      new RoomPosition(anchor.x + 11, anchor.y, this.room.name),
      
      // Surrounding reaction labs (compact pattern)
      new RoomPosition(anchor.x + 10, anchor.y - 1, this.room.name),
      new RoomPosition(anchor.x + 11, anchor.y - 1, this.room.name),
      new RoomPosition(anchor.x + 10, anchor.y + 1, this.room.name),
      new RoomPosition(anchor.x + 11, anchor.y + 1, this.room.name),
      new RoomPosition(anchor.x + 9, anchor.y, this.room.name),
      new RoomPosition(anchor.x + 12, anchor.y, this.room.name),
      new RoomPosition(anchor.x + 9, anchor.y - 1, this.room.name),
      new RoomPosition(anchor.x + 12, anchor.y + 1, this.room.name)
    ];
    
    plan.labs = labPositions.slice(0, maxLabs);
  }
  
  /**
   * Plan links at strategic locations
   * RCL 5: 2 links (storage + controller)
   * RCL 6: 3 links (storage + controller + 1 source)
   * RCL 7: 4 links (storage + controller + 2 sources)
   * RCL 8: 6 links (all sources + extras)
   */
  private planLinks(plan: RoomPlan): void {
    const controller = this.room.controller!;
    const sources = this.room.find(FIND_SOURCES);
    const maxLinks = CONTROLLER_STRUCTURES[STRUCTURE_LINK][controller.level];
    
    // Priority 1: Storage link (next to storage for easy hauler access)
    if (plan.storage && plan.links.length < maxLinks) {
      // Find valid position adjacent to storage
      const candidates = this.findAdjacentPositions(plan.storage, 1);
      if (candidates.length > 0) {
        plan.links.push(candidates[0]);
      }
    }
    
    // Priority 2: Controller link (range 2-3 from controller for upgraders)
    if (plan.links.length < maxLinks) {
      const candidates = this.findAdjacentPositions(controller.pos, 3)
        .filter(pos => pos.getRangeTo(controller.pos) >= 2); // Min range 2 to leave space
      if (candidates.length > 0) {
        plan.links.push(candidates[0]);
      }
    }
    
    // Priority 3: Source links (one per source, range 2)
    for (const source of sources) {
      if (plan.links.length >= maxLinks) break;
      
      const candidates = this.findAdjacentPositions(source.pos, 2)
        .filter(pos => !this.isPositionReserved(pos, plan));
      
      if (candidates.length > 0) {
        plan.links.push(candidates[0]);
      }
    }
  }
  
  /**
   * Find valid adjacent positions within range
   */
  private findAdjacentPositions(center: RoomPosition, maxRange: number): RoomPosition[] {
    const positions: RoomPosition[] = [];
    
    for (let dx = -maxRange; dx <= maxRange; dx++) {
      for (let dy = -maxRange; dy <= maxRange; dy++) {
        if (dx === 0 && dy === 0) continue;
        
        const x = center.x + dx;
        const y = center.y + dy;
        
        // Check bounds
        if (x < 2 || x > 47 || y < 2 || y > 47) continue;
        
        const pos = new RoomPosition(x, y, this.room.name);
        
        // Check terrain
        if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
        
        // Valid position
        positions.push(pos);
      }
    }
    
    return positions;
  }
  
  /**
   * Plan road network
   */
  private planRoads(plan: RoomPlan): void {
    // Roads will be built dynamically based on traffic
    // Just plan main roads between key structures
    const controller = this.room.controller!;
    const sources = this.room.find(FIND_SOURCES);
    
    // Roads from anchor to controller
    const pathToController = plan.anchor.findPathTo(controller, { ignoreCreeps: true });
    plan.roads.push(...pathToController.map(step => new RoomPosition(step.x, step.y, this.room.name)));
    
    // Roads from anchor to sources
    for (const source of sources) {
      const pathToSource = plan.anchor.findPathTo(source, { ignoreCreeps: true });
      plan.roads.push(...pathToSource.map(step => new RoomPosition(step.x, step.y, this.room.name)));
    }
  }
  
  /**
   * Check if position is reserved for another structure
   */
  private isPositionReserved(pos: RoomPosition, plan: RoomPlan): boolean {
    const reserved = [
      plan.storage,
      plan.terminal,
      plan.factory,
      plan.powerSpawn,
      plan.observer,
      plan.nuker,
      ...plan.spawns,
      ...plan.towers,
      ...plan.labs,
      ...plan.links
    ].filter(p => p !== null) as RoomPosition[];
    
    return reserved.some(p => p.x === pos.x && p.y === pos.y);
  }
  
  /**
   * Visualize the room plan with KHALA Protoss Architecture
   */
  visualize(): void {
    const plan = this.getPlan();
    if (!plan) return;
    
    const visual = this.room.visual;
    const anchor = plan.anchor;
    
    // SACRED CORE: Draw cross pattern (religious symbolism)
    visual.line(anchor.x - 3, anchor.y, anchor.x + 3, anchor.y, {
      color: '#FFD700',
      width: 0.05,
      opacity: 0.5
    });
    visual.line(anchor.x, anchor.y - 3, anchor.x, anchor.y + 3, {
      color: '#FFD700',
      width: 0.05,
      opacity: 0.5
    });
    
    // RINGS OF Nexus: Draw concentric hexagons
    const hexColors = ['#9370DB', '#8A2BE2', '#9400D3', '#8B008B'];
    for (let ring = 1; ring <= 4; ring++) {
      const radius = 3 + ring;
      const points: {x: number, y: number}[] = [];
      
      for (let i = 0; i <= 6; i++) {
        const angle = (i * 60 * Math.PI) / 180;
        const x = anchor.x + Math.cos(angle) * radius;
        const y = anchor.y + Math.sin(angle) * radius;
        points.push({x, y});
      }
      
      for (let i = 0; i < points.length - 1; i++) {
        visual.line(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, {
          color: hexColors[ring - 1] || '#9370DB',
          width: 0.03,
          opacity: 0.3
        });
      }
    }
    
    // HIERARCHS' TRIANGLE: Draw lines connecting spawns
    if (plan.spawns.length >= 3) {
      for (let i = 0; i < 3; i++) {
        const start = plan.spawns[i];
        const end = plan.spawns[(i + 1) % 3];
        visual.line(start, end, {
          color: '#FF00FF',
          width: 0.08,
          opacity: 0.4
        });
      }
    }
    
    // GUARDIAN RING: Draw hexagon connecting towers
    if (plan.towers.length >= 6) {
      for (let i = 0; i < 6; i++) {
        visual.line(plan.towers[i], plan.towers[(i + 1) % 6], {
          color: '#FF0000',
          width: 0.05,
          opacity: 0.3
        });
      }
    }
    
    // Draw anchor (Holy Center)
    visual.circle(anchor, { 
      fill: '#FFD700', 
      radius: 0.6,
      opacity: 0.8
    });
    visual.text('⚜', anchor, { 
      color: '#FFFFFF', 
      font: 0.7,
      stroke: '#000000',
      strokeWidth: 0.05
    });
    
    // Draw storage (Sacred Vault)
    if (plan.storage) {
      visual.circle(plan.storage, { 
        fill: '#FFD700', 
        radius: 0.45,
        opacity: 0.8 
      });
      visual.text('💎', plan.storage, { font: 0.5 });
    }
    
    // Draw terminal (Trade Sanctum)
    if (plan.terminal) {
      visual.circle(plan.terminal, { 
        fill: '#00CED1', 
        radius: 0.4,
        opacity: 0.8
      });
      visual.text('📡', plan.terminal, { font: 0.5 });
    }
    
    // Draw factory (Forge)
    if (plan.factory) {
      visual.circle(plan.factory, { 
        fill: '#FF8C00', 
        radius: 0.4,
        opacity: 0.8
      });
      visual.text('⚙', plan.factory, { font: 0.5 });
    }
    
    // Draw power spawn (Ancient Power)
    if (plan.powerSpawn) {
      visual.circle(plan.powerSpawn, { 
        fill: '#FF1493', 
        radius: 0.4,
        opacity: 0.8
      });
      visual.text('⚡', plan.powerSpawn, { font: 0.5 });
    }
    
    // Draw spawns (Hierarchs' Thrones)
    for (let i = 0; i < plan.spawns.length; i++) {
      const pos = plan.spawns[i];
      visual.circle(pos, { 
        fill: '#9370DB', 
        radius: 0.5,
        opacity: 0.8
      });
      visual.text('👑', pos, { font: 0.6 });
    }
    
    // Draw towers (Guardian Sentinels)
    for (const pos of plan.towers) {
      visual.circle(pos, { 
        fill: '#DC143C', 
        radius: 0.4,
        opacity: 0.8
      });
      visual.text('🗼', pos, { font: 0.5 });
    }
    
    // Draw extensions (Prayer Shrines) with tier coloring
    const tierColors = ['#4169E1', '#1E90FF', '#87CEEB', '#B0E0E6'];
    for (let i = 0; i < plan.extensions.length; i++) {
      const pos = plan.extensions[i];
      const tier = Math.floor(i / 15); // Color by tier
      const color = tierColors[Math.min(tier, tierColors.length - 1)];
      
      visual.circle(pos, { 
        fill: color, 
        radius: 0.25,
        opacity: 0.7
      });
    }
    
    // Draw labs (Research Sanctum)
    for (const pos of plan.labs) {
      visual.circle(pos, { 
        fill: '#32CD32', 
        radius: 0.35,
        opacity: 0.8
      });
      visual.text('🧪', pos, { font: 0.4 });
    }
    
    // Draw observer and nuker
    if (plan.observer) {
      visual.circle(plan.observer, {
        fill: '#4B0082',
        radius: 0.35,
        opacity: 0.8
      });
      visual.text('👁', plan.observer, { font: 0.5 });
    }
    
    if (plan.nuker) {
      visual.circle(plan.nuker, {
        fill: '#8B0000',
        radius: 0.35,
        opacity: 0.8
      });
      visual.text('☢', plan.nuker, { font: 0.5 });
    }
    
    // Draw legend
    visual.text('⚜ KHALA BASE LAYOUT ⚜', 25, 1, {
      color: '#FFD700',
      font: 0.6,
      align: 'center',
      stroke: '#000000',
      strokeWidth: 0.1
    });
  }
}
