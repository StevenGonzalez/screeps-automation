/**
 * ROAD BUILDER - Automatic Road Network Construction
 * 
 * "The sacred pathways shall be paved for the KHALA's might"
 * 
 * Analyzes creep traffic patterns and automatically builds roads
 * where they are most beneficial for efficiency.
 */

/// <reference types="@types/screeps" />

interface RoadBuilderMemory {
  trafficMap: { [pos: string]: number };
  lastRoadCheck: number;
  builtRoads: string[];
}

/**
 * Road Builder - Automatic road network construction based on traffic analysis
 */
export class RoadBuilder {
  room: Room;
  memory: RoadBuilderMemory;
  
  constructor(room: Room) {
    this.room = room;
    
    // Initialize memory
    if (!Memory.rooms[room.name]) {
      Memory.rooms[room.name] = {} as any;
    }
    const roomMem: any = Memory.rooms[room.name];
    if (!roomMem.roadBuilder) {
      roomMem.roadBuilder = {
        trafficMap: {},
        lastRoadCheck: 0,
        builtRoads: []
      };
    }
    this.memory = roomMem.roadBuilder;
  }
  
  /**
   * Record creep movement for traffic analysis
   */
  recordTraffic(): void {
    const creeps = this.room.find(FIND_MY_CREEPS);
    
    for (const creep of creeps) {
      // Only track creeps that move frequently (miners don't need roads)
      if (creep.memory.role === 'Warrior_miner' || creep.memory.role === 'miner') {
        continue;
      }
      
      const posKey = `${creep.pos.x},${creep.pos.y}`;
      
      // Don't count positions on existing roads
      const hasRoad = creep.pos.lookFor(LOOK_STRUCTURES).some(s => s.structureType === STRUCTURE_ROAD);
      const hasRoadSite = creep.pos.lookFor(LOOK_CONSTRUCTION_SITES).some(s => s.structureType === STRUCTURE_ROAD);
      
      if (!hasRoad && !hasRoadSite) {
        this.memory.trafficMap[posKey] = (this.memory.trafficMap[posKey] || 0) + 1;
      }
    }
    
    // Decay old traffic data (every 1000 ticks, reduce by 50%)
    if (Game.time % 1000 === 0) {
      for (const key in this.memory.trafficMap) {
        this.memory.trafficMap[key] = Math.floor(this.memory.trafficMap[key] * 0.5);
        if (this.memory.trafficMap[key] <= 1) {
          delete this.memory.trafficMap[key];
        }
      }
    }
  }
  
  /**
   * Build roads in high-traffic areas
   */
  buildRoads(): void {
    // Only check every 100 ticks
    if (Game.time - this.memory.lastRoadCheck < 100) return;
    this.memory.lastRoadCheck = Game.time;
    
    // Need RCL 3+ for roads
    if (!this.room.controller || this.room.controller.level < 3) return;
    
    const level = this.room.controller.level;
    const maxRoads = CONTROLLER_STRUCTURES[STRUCTURE_ROAD][level];
    
    // Count existing roads
    const existingRoads = this.room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_ROAD
    }).length;
    
    const roadSites = this.room.find(FIND_MY_CONSTRUCTION_SITES, {
      filter: s => s.structureType === STRUCTURE_ROAD
    }).length;
    
    // Don't build more if at limit
    if (existingRoads + roadSites >= maxRoads) return;
    
    // Find high-traffic positions
    const trafficThreshold = 50; // Minimum traffic count to build road
    const highTrafficPositions: { pos: RoomPosition; traffic: number }[] = [];
    
    for (const posKey in this.memory.trafficMap) {
      const traffic = this.memory.trafficMap[posKey];
      if (traffic >= trafficThreshold) {
        const [x, y] = posKey.split(',').map(Number);
        const pos = new RoomPosition(x, y, this.room.name);
        
        // Don't build on walls or structures
        const terrain = new Room.Terrain(this.room.name);
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
        
        const hasStructure = pos.lookFor(LOOK_STRUCTURES).length > 0;
        if (hasStructure) continue;
        
        highTrafficPositions.push({ pos, traffic });
      }
    }
    
    // Sort by traffic (highest first)
    highTrafficPositions.sort((a, b) => b.traffic - a.traffic);
    
    // Build roads on highest traffic positions (limit to 5 per check to avoid spam)
    let roadsPlaced = 0;
    for (const { pos, traffic } of highTrafficPositions) {
      if (roadsPlaced >= 5) break;
      if (existingRoads + roadSites + roadsPlaced >= maxRoads) break;
      
      const result = this.room.createConstructionSite(pos, STRUCTURE_ROAD);
      if (result === OK) {
        roadsPlaced++;
        this.memory.builtRoads.push(`${pos.x},${pos.y}`);
        console.log(`🛤️ [RoadBuilder ${this.room.name}] Building road at ${pos.x},${pos.y} (traffic: ${traffic})`);
      }
    }
  }
  
  /**
   * Build critical roads immediately (controller, sources, storage)
   */
  buildCriticalRoads(): void {
    if (!this.room.controller || this.room.controller.level < 3) return;
    
    const spawns = this.room.find(FIND_MY_SPAWNS);
    if (spawns.length === 0) return;
    
    const spawn = spawns[0];
    const controller = this.room.controller;
    const sources = this.room.find(FIND_SOURCES);
    const storage = this.room.storage;
    
    // Build roads from spawn to controller
    this.buildPathRoads(spawn.pos, controller.pos);
    
    // Build roads from spawn to sources
    for (const source of sources) {
      this.buildPathRoads(spawn.pos, source.pos);
    }
    
    // Build roads from storage to sources and controller (if storage exists)
    if (storage) {
      this.buildPathRoads(storage.pos, controller.pos);
      for (const source of sources) {
        this.buildPathRoads(storage.pos, source.pos);
      }
    }
  }
  
  /**
   * Build roads along a path between two positions
   */
  private buildPathRoads(from: RoomPosition, to: RoomPosition): void {
    const path = from.findPathTo(to, {
      ignoreCreeps: true,
      plainCost: 2,
      swampCost: 10
    });
    
    for (const step of path) {
      const pos = new RoomPosition(step.x, step.y, this.room.name);
      
      // Don't place roads on sources, minerals, or controllers
      const hasSource = pos.lookFor(LOOK_SOURCES).length > 0;
      const hasMineral = pos.lookFor(LOOK_MINERALS).length > 0;
      const hasController = pos.lookFor(LOOK_STRUCTURES).some(s => s.structureType === STRUCTURE_CONTROLLER);
      
      if (hasSource || hasMineral || hasController) continue;
      
      // Skip tiles with structures (roads and containers can coexist with roads, so they're ok)
      const structures = pos.lookFor(LOOK_STRUCTURES);
      const hasBlockingStructure = structures.some(s => 
        s.structureType !== STRUCTURE_ROAD && 
        s.structureType !== STRUCTURE_CONTAINER
      );
      
      if (hasBlockingStructure) continue;
      
      // Check if road already exists
      const hasRoad = structures.some(s => s.structureType === STRUCTURE_ROAD);
      const hasRoadSite = pos.lookFor(LOOK_CONSTRUCTION_SITES).some(s => s.structureType === STRUCTURE_ROAD);
      
      if (!hasRoad && !hasRoadSite) {
        this.room.createConstructionSite(pos, STRUCTURE_ROAD);
      }
    }
  }
  
  /**
   * Visualize traffic heatmap
   */
  visualize(): void {
    if (!this.memory.trafficMap) return;
    
    const visual = this.room.visual;
    
    // Find max traffic for color scaling
    let maxTraffic = 1;
    for (const key in this.memory.trafficMap) {
      maxTraffic = Math.max(maxTraffic, this.memory.trafficMap[key]);
    }
    
    // Draw heatmap
    for (const posKey in this.memory.trafficMap) {
      const traffic = this.memory.trafficMap[posKey];
      const [x, y] = posKey.split(',').map(Number);
      
      // Color intensity based on traffic (blue = low, red = high)
      const intensity = traffic / maxTraffic;
      const color = intensity > 0.5 
        ? `rgba(255, ${Math.floor(255 * (1 - intensity))}, 0, 0.3)`
        : `rgba(0, ${Math.floor(255 * intensity)}, 255, 0.3)`;
      
      visual.circle(x, y, { radius: 0.3, fill: color, opacity: 0.5 });
      
      // Show traffic count on high-traffic tiles
      if (traffic >= 30) {
        visual.text(`${traffic}`, x, y, { font: 0.3, color: 'white' });
      }
    }
  }
}
