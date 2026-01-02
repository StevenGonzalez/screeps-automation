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
    // Return cached plan if available
    if (this.memory.plan && Game.time - this.memory.lastPlanned < 10000) {
      return this.memory.plan;
    }
    
    // Generate new plan
    return this.generatePlan();
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
    
    // Plan extensions in clusters
    this.planExtensions(plan);
    
    // Plan towers for defense coverage
    this.planTowers(plan);
    
    // Plan labs in a compact cluster
    this.planLabs(plan);
    
    // Plan links at key locations
    this.planLinks(plan);
    
    // Plan roads connecting everything
    this.planRoads(plan);
    
    // Save plan to memory
    this.memory.plan = plan;
    this.memory.lastPlanned = Game.time;
    
    console.log(`📐 Room ${this.room.name}: Generated new base plan`);
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
   * COVENANT THEME: Central sacred anchor with symmetrical holy structures
   */
  private planCoreStructures(plan: RoomPlan): void {
    const anchor = plan.anchor;
    
    // SACRED CORE: Storage at the holy anchor (High Charity's heart)
    plan.storage = anchor;
    
    // Terminal forms a cross pattern with storage (religious symbolism)
    plan.terminal = new RoomPosition(anchor.x + 2, anchor.y, this.room.name);
    
    // Factory on opposite side of the cross
    plan.factory = new RoomPosition(anchor.x - 2, anchor.y, this.room.name);
    
    // Power spawn completes the vertical cross
    plan.powerSpawn = new RoomPosition(anchor.x, anchor.y + 2, this.room.name);
    
    // HIERARCHS' THRONES: Spawns arranged in triangular formation (3 points of hierarchy)
    // North spawn (Prophet of Truth)
    plan.spawns.push(new RoomPosition(anchor.x, anchor.y - 3, this.room.name));
    // Southwest spawn (Prophet of Regret)
    plan.spawns.push(new RoomPosition(anchor.x - 3, anchor.y + 2, this.room.name));
    // Southeast spawn (Prophet of Mercy)
    plan.spawns.push(new RoomPosition(anchor.x + 3, anchor.y + 2, this.room.name));
    
    // Observer and nuker flanking the sacred core
    plan.observer = new RoomPosition(anchor.x - 1, anchor.y - 2, this.room.name);
    plan.nuker = new RoomPosition(anchor.x + 1, anchor.y - 2, this.room.name);
  }
  
  /**
   * Plan extensions in radial Covenant pattern
   * COVENANT THEME: Radiating rings like the sacred city's tiers
   */
  private planExtensions(plan: RoomPlan): void {
    const anchor = plan.anchor;
    const maxExtensions = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][this.room.controller!.level];
    
    const positions: RoomPosition[] = [];
    
    // COVENANT PATTERN: Concentric hexagonal rings emanating from sacred core
    // Create 6-fold symmetry (religious/ceremonial significance)
    const angles = [0, 60, 120, 180, 240, 300]; // 6 cardinal directions
    
    for (let ring = 1; ring <= 6 && positions.length < maxExtensions; ring++) {
      const radius = 3 + ring;
      
      // Place extensions along each of the 6 radial arms
      for (const angle of angles) {
        // Convert to radians
        const rad = (angle * Math.PI) / 180;
        
        // Create multiple extensions along this arm
        for (let dist = radius - 1; dist <= radius + 1; dist++) {
          const x = Math.round(anchor.x + Math.cos(rad) * dist);
          const y = Math.round(anchor.y + Math.sin(rad) * dist);
          
          if (x < 2 || x > 47 || y < 2 || y > 47) continue;
          if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
          
          const pos = new RoomPosition(x, y, this.room.name);
          
          if (this.isPositionReserved(pos, plan)) continue;
          if (positions.some(p => p.x === pos.x && p.y === pos.y)) continue;
          
          positions.push(pos);
          
          if (positions.length >= maxExtensions) break;
        }
        if (positions.length >= maxExtensions) break;
      }
    }
    
    plan.extensions = positions;
  }
  
  /**
   * Plan towers in defensive perimeter
   * COVENANT THEME: Towers arranged as guardian sentinels
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
   * COVENANT THEME: Labs arranged in a research sanctum
   */
  private planLabs(plan: RoomPlan): void {
    const anchor = plan.anchor;
    const maxLabs = CONTROLLER_STRUCTURES[STRUCTURE_LAB][this.room.controller!.level];
    
    // RESEARCH SANCTUM: Labs form a tight ceremonial cluster
    // Arranged in a 'flower' pattern for optimal reaction efficiency
    const labPositions: RoomPosition[] = [
      // Central labs (reagent sources)
      new RoomPosition(anchor.x + 4, anchor.y, this.room.name),
      new RoomPosition(anchor.x + 5, anchor.y, this.room.name),
      
      // Surrounding reaction labs (hexagonal pattern)
      new RoomPosition(anchor.x + 4, anchor.y - 1, this.room.name),
      new RoomPosition(anchor.x + 5, anchor.y - 1, this.room.name),
      new RoomPosition(anchor.x + 4, anchor.y + 1, this.room.name),
      new RoomPosition(anchor.x + 5, anchor.y + 1, this.room.name),
      new RoomPosition(anchor.x + 3, anchor.y, this.room.name),
      new RoomPosition(anchor.x + 6, anchor.y, this.room.name),
      new RoomPosition(anchor.x + 3, anchor.y - 1, this.room.name),
      new RoomPosition(anchor.x + 6, anchor.y + 1, this.room.name)
    ];
    
    plan.labs = labPositions.slice(0, maxLabs);
  }
  
  /**
   * Plan links at strategic locations
   */
  private planLinks(plan: RoomPlan): void {
    const controller = this.room.controller!;
    const sources = this.room.find(FIND_SOURCES);
    
    // Storage link (at storage)
    if (plan.storage) {
      plan.links.push(new RoomPosition(plan.storage.x - 1, plan.storage.y, this.room.name));
    }
    
    // Controller link (near controller)
    const controllerLink = controller.pos.findClosestByRange(
      controller.pos.findInRange(FIND_EXIT, 3)
        .map(exit => new RoomPosition(exit.x, exit.y, this.room.name))
        .filter(pos => this.terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL)
    );
    if (controllerLink) {
      plan.links.push(controllerLink);
    }
    
    // Source links (near each source) - handled by MiningTemple
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
   * Visualize the room plan
   */
  visualize(): void {
    const plan = this.getPlan();
    if (!plan) return;
    
    const visual = this.room.visual;
    
    // Draw anchor
    visual.circle(plan.anchor, { fill: 'yellow', radius: 0.5 });
    
    // Draw storage
    if (plan.storage) {
      visual.circle(plan.storage, { fill: 'gold', radius: 0.4 });
      visual.text('S', plan.storage, { color: 'black', font: 0.5 });
    }
    
    // Draw terminal
    if (plan.terminal) {
      visual.circle(plan.terminal, { fill: 'cyan', radius: 0.4 });
      visual.text('T', plan.terminal, { color: 'black', font: 0.5 });
    }
    
    // Draw spawns
    for (const pos of plan.spawns) {
      visual.circle(pos, { fill: 'purple', radius: 0.4 });
      visual.text('Sp', pos, { color: 'white', font: 0.4 });
    }
    
    // Draw towers
    for (const pos of plan.towers) {
      visual.circle(pos, { fill: 'red', radius: 0.4 });
      visual.text('Tw', pos, { color: 'white', font: 0.4 });
    }
    
    // Draw extensions (simplified - just circles)
    for (const pos of plan.extensions) {
      visual.circle(pos, { fill: 'blue', radius: 0.3 });
    }
    
    // Draw labs
    for (const pos of plan.labs) {
      visual.circle(pos, { fill: 'green', radius: 0.3 });
      visual.text('L', pos, { color: 'white', font: 0.3 });
    }
  }
}
