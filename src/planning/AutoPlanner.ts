/**
 * AUTO PLANNER
 * 
 * "The Prophets divine the perfect arrangement of our sacred structures"
 * 
 * Automated construction planning system that:
 * - Triggers construction at RCL upgrades
 * - Plans roads based on creep traffic patterns
 * - Creates defensive perimeters with ramparts and walls
 * - Integrates with RoomPlanner for optimal layouts
 */

/// <reference types="@types/screeps" />

import { RoomPlanner, RoomPlan } from './RoomPlanner';

export interface AutoPlannerMemory {
  lastRCL: number;
  trafficMap: { [key: string]: number }; // Position key -> traffic count
  lastTrafficUpdate: number;
  defensePlanned: boolean;
  roadPlannedAt: number;
}

/**
 * Automated construction planning and execution
 */
export class AutoPlanner {
  room: Room;
  planner: RoomPlanner;
  memory: AutoPlannerMemory;
  
  constructor(room: Room, planner: RoomPlanner) {
    this.room = room;
    this.planner = planner;
    
    // Initialize memory
    if (!Memory.rooms[room.name]) {
      Memory.rooms[room.name] = {} as any;
    }
    const roomMem: any = Memory.rooms[room.name];
    if (!roomMem.autoPlanner) {
      roomMem.autoPlanner = {
        lastRCL: room.controller?.level || 0,
        trafficMap: {},
        lastTrafficUpdate: 0,
        defensePlanned: false,
        roadPlannedAt: 0
      };
    }
    this.memory = roomMem.autoPlanner;
  }
  
  /**
   * Run the auto planner - called every tick
   */
  run(): void {
    const controller = this.room.controller;
    if (!controller || !controller.my) return;

    // Honor manual replan requests from console: Memory._cov_replanRequests[roomName] = tick
    if ((Memory as any)._cov_replanRequests && (Memory as any)._cov_replanRequests[this.room.name]) {
      const plan = this.planner.getPlan();
      if (plan) {
        console.log(`🛤️ ${this.room.name}: Manual road replan requested via console`);
        this.planCoreRoads(plan);
        this.memory.roadPlannedAt = Game.time;
        delete (Memory as any)._cov_replanRequests[this.room.name];
      }
    }
    
    const currentRCL = controller.level;
    
    // Detect RCL upgrade
    if (currentRCL > this.memory.lastRCL) {
      console.log(`🎉 ${this.room.name}: RCL ${currentRCL} achieved! Planning new structures...`);
      this.onRCLUpgrade(currentRCL);
      this.memory.lastRCL = currentRCL;
    }
    
    // Update traffic patterns every 100 ticks
    if (Game.time % 100 === 0) {
      this.updateTrafficMap();
    }
    
    // Plan roads based on traffic every 500 ticks
    // Allow replanning sooner after requests — reduce cooldown from 5000 to 500 ticks
    if (Game.time % 500 === 0 && Game.time - this.memory.roadPlannedAt > 500) {
      this.planTrafficRoads();
    }

    // Replan core roads periodically in case roads were destroyed (handles max RCL)
    // Run a light check every 200 ticks to detect mass road loss and re-place core roads
    if (Game.time % 200 === 0) {
      try {
        this.ensureCoreRoads();
      } catch (e) {
        console.log(`⚠️ ${this.room.name}: ensureCoreRoads failed: ${e}`);
      }
    }
    
    // Plan defense perimeter at RCL 3+
    if (currentRCL >= 3 && !this.memory.defensePlanned) {
      this.planDefensePerimeter();
    }
    
    // Cleanup roads under structures every 1000 ticks
    if (Game.time % 1000 === 0) {
      this.cleanupRoadsUnderStructures();
    }
  }
  
  /**
   * Remove roads that have structures built on top of them
   * Roads under structures (except ramparts/containers) are unusable and waste road limits
   */
  private cleanupRoadsUnderStructures(): void {
    const roads = this.room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_ROAD
    }) as StructureRoad[];
    
    let removedCount = 0;
    for (const road of roads) {
      const structures = road.pos.lookFor(LOOK_STRUCTURES);
      // Check if there's a blocking structure on top of the road
      const hasBlockingStructure = structures.some(s => 
        s.structureType !== STRUCTURE_ROAD && 
        s.structureType !== STRUCTURE_RAMPART &&
        s.structureType !== STRUCTURE_CONTAINER
      );
      
      if (hasBlockingStructure) {
        road.destroy();
        removedCount++;
      }
    }
    
    if (removedCount > 0) {
      console.log(`🧹 ${this.room.name}: Removed ${removedCount} roads under structures`);
    }
  }
  
  /**
   * Handle RCL upgrade - place new construction sites
   */
  private onRCLUpgrade(newRCL: number): void {
    const plan = this.planner.getPlan();
    if (!plan) {
      console.log(`⚠️ ${this.room.name}: No room plan available!`);
      return;
    }
    
    // Place structures appropriate for this RCL
    this.placeExtensions(plan, newRCL);
    this.placeTowers(plan, newRCL);
    this.placeSpawns(plan, newRCL);
    
    if (newRCL >= 4) {
      this.placeStorage(plan);
    }
    
    if (newRCL >= 6) {
      this.placeTerminal(plan);
      this.placeLabs(plan, newRCL);
      this.placeExtractor();
    }
    
    if (newRCL >= 7) {
      this.placeFactory(plan);
    }
    
    if (newRCL >= 8) {
      this.placePowerSpawn(plan);
      this.placeNuker(plan);
      this.placeObserver(plan);
    }
    
    // Always replan roads and ramparts after upgrade
    this.planCoreRoads(plan);
    
    console.log(`✅ ${this.room.name}: Construction sites placed for RCL ${newRCL}`);
  }
  
  /**
   * Place extensions based on RCL
   */
  private placeExtensions(plan: RoomPlan, rcl: number): void {
    const maxExtensions = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][rcl];
    const existing = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_EXTENSION
    }).length;
    
    let placed = 0;
    for (let i = existing; i < Math.min(maxExtensions, plan.extensions.length); i++) {
      const pos = plan.extensions[i];
      if (this.canPlaceConstructionSite(pos, STRUCTURE_EXTENSION)) {
        const result = this.room.createConstructionSite(pos, STRUCTURE_EXTENSION);
        if (result === OK) {
          placed++;
        } else if (result === ERR_FULL) {
          break; // Hit construction site limit
        }
      }
    }
    
    if (placed > 0) {
      console.log(`📍 ${this.room.name}: Placed ${placed} extension sites`);
    }
  }
  
  /**
   * Place towers based on RCL
   */
  private placeTowers(plan: RoomPlan, rcl: number): void {
    const maxTowers = CONTROLLER_STRUCTURES[STRUCTURE_TOWER][rcl];
    const existing = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_TOWER
    }).length;
    
    for (let i = existing; i < Math.min(maxTowers, plan.towers.length); i++) {
      const pos = plan.towers[i];
      if (this.canPlaceConstructionSite(pos, STRUCTURE_TOWER)) {
        this.room.createConstructionSite(pos, STRUCTURE_TOWER);
        console.log(`🗼 ${this.room.name}: Placed tower site at ${pos}`);
      }
    }
  }
  
  /**
   * Place spawns based on RCL
   */
  private placeSpawns(plan: RoomPlan, rcl: number): void {
    const maxSpawns = CONTROLLER_STRUCTURES[STRUCTURE_SPAWN][rcl];
    const existing = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_SPAWN
    }).length;
    
    for (let i = existing; i < Math.min(maxSpawns, plan.spawns.length); i++) {
      const pos = plan.spawns[i];
      if (this.canPlaceConstructionSite(pos, STRUCTURE_SPAWN)) {
        const spawnName = `${this.room.name}_Spawn${i + 1}`;
        this.room.createConstructionSite(pos, STRUCTURE_SPAWN, spawnName);
        console.log(`🔱 ${this.room.name}: Placed spawn site: ${spawnName}`);
      }
    }
  }
  
  /**
   * Place storage
   */
  private placeStorage(plan: RoomPlan): void {
    if (!plan.storage) return;
    
    const existing = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_STORAGE
    }).length;
    
    if (existing === 0 && this.canPlaceConstructionSite(plan.storage, STRUCTURE_STORAGE)) {
      this.room.createConstructionSite(plan.storage, STRUCTURE_STORAGE);
      console.log(`💎 ${this.room.name}: Placed storage site (Sacred Vault)`);
    }
  }
  
  /**
   * Place terminal
   */
  private placeTerminal(plan: RoomPlan): void {
    if (!plan.terminal) return;
    
    const existing = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_TERMINAL
    }).length;
    
    if (existing === 0 && this.canPlaceConstructionSite(plan.terminal, STRUCTURE_TERMINAL)) {
      this.room.createConstructionSite(plan.terminal, STRUCTURE_TERMINAL);
      console.log(`📡 ${this.room.name}: Placed terminal site (Trade Sanctum)`);
    }
  }
  
  /**
   * Place labs based on RCL
   */
  private placeLabs(plan: RoomPlan, rcl: number): void {
    const maxLabs = CONTROLLER_STRUCTURES[STRUCTURE_LAB][rcl];
    const existing = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_LAB
    }).length;
    
    for (let i = existing; i < Math.min(maxLabs, plan.labs.length); i++) {
      const pos = plan.labs[i];
      if (this.canPlaceConstructionSite(pos, STRUCTURE_LAB)) {
        this.room.createConstructionSite(pos, STRUCTURE_LAB);
      }
    }
    
    if (existing < maxLabs) {
      console.log(`🧪 ${this.room.name}: Placed ${maxLabs - existing} lab sites`);
    }
  }
  
  /**
   * Place extractor on mineral
   */
  private placeExtractor(): void {
    const minerals = this.room.find(FIND_MINERALS);
    if (minerals.length === 0) return;
    
    const mineral = minerals[0];
    const existing = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_EXTRACTOR
    }).length;
    
    if (existing === 0) {
      this.room.createConstructionSite(mineral.pos, STRUCTURE_EXTRACTOR);
      console.log(`⛏️ ${this.room.name}: Placed extractor on ${mineral.mineralType}`);
    }
  }
  
  /**
   * Place factory
   */
  private placeFactory(plan: RoomPlan): void {
    if (!plan.factory) return;
    
    const existing = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_FACTORY
    }).length;
    
    if (existing === 0 && this.canPlaceConstructionSite(plan.factory, STRUCTURE_FACTORY)) {
      this.room.createConstructionSite(plan.factory, STRUCTURE_FACTORY);
      console.log(`🏭 ${this.room.name}: Placed factory site (Forge of Creation)`);
    }
  }
  
  /**
   * Place power spawn
   */
  private placePowerSpawn(plan: RoomPlan): void {
    if (!plan.powerSpawn) return;
    
    const existing = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_POWER_SPAWN
    }).length;
    
    if (existing === 0 && this.canPlaceConstructionSite(plan.powerSpawn, STRUCTURE_POWER_SPAWN)) {
      this.room.createConstructionSite(plan.powerSpawn, STRUCTURE_POWER_SPAWN);
      console.log(`⚡ ${this.room.name}: Placed power spawn site`);
    }
  }
  
  /**
   * Place nuker
   */
  private placeNuker(plan: RoomPlan): void {
    if (!plan.nuker) return;
    
    const existing = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_NUKER
    }).length;
    
    if (existing === 0 && this.canPlaceConstructionSite(plan.nuker, STRUCTURE_NUKER)) {
      this.room.createConstructionSite(plan.nuker, STRUCTURE_NUKER);
      console.log(`☢️ ${this.room.name}: Placed nuker site (Holy Wrath)`);
    }
  }
  
  /**
   * Place observer
   */
  private placeObserver(plan: RoomPlan): void {
    if (!plan.observer) return;
    
    const existing = this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_OBSERVER
    }).length;
    
    if (existing === 0 && this.canPlaceConstructionSite(plan.observer, STRUCTURE_OBSERVER)) {
      this.room.createConstructionSite(plan.observer, STRUCTURE_OBSERVER);
      console.log(`👁️ ${this.room.name}: Placed observer site (Eye of Prophecy)`);
    }
  }
  
  /**
   * Update traffic map - tracks where creeps move
   */
  private updateTrafficMap(): void {
    // Sample creep positions to build traffic heatmap
    const creeps = this.room.find(FIND_MY_CREEPS);
    
    for (const creep of creeps) {
      const key = `${creep.pos.x},${creep.pos.y}`;
      this.memory.trafficMap[key] = (this.memory.trafficMap[key] || 0) + 1;
    }
    
    // Decay old traffic data (50% every 1000 ticks)
    if (Game.time % 1000 === 0) {
      for (const key in this.memory.trafficMap) {
        this.memory.trafficMap[key] = Math.floor(this.memory.trafficMap[key] * 0.5);
        if (this.memory.trafficMap[key] < 5) {
          delete this.memory.trafficMap[key];
        }
      }
    }
    
    this.memory.lastTrafficUpdate = Game.time;
  }
  
  /**
   * Plan roads based on traffic patterns
   */
  private planTrafficRoads(): void {
    const plan = this.planner.getPlan();
    if (!plan) return;
    
    // Find high-traffic positions
    const highTrafficPositions: RoomPosition[] = [];
    
    for (const key in this.memory.trafficMap) {
      const count = this.memory.trafficMap[key];
      if (count > 50) { // Threshold for road placement
        const [x, y] = key.split(',').map(Number);
        highTrafficPositions.push(new RoomPosition(x, y, this.room.name));
      }
    }
    
    // Place roads on high-traffic tiles
    let placed = 0;
    for (const pos of highTrafficPositions) {
      if (this.shouldPlaceRoad(pos)) {
        const result = this.room.createConstructionSite(pos, STRUCTURE_ROAD);
        if (result === OK) {
          placed++;
        } else if (result === ERR_FULL) {
          break;
        }
      }
    }
    
    if (placed > 0) {
      console.log(`🛤️ ${this.room.name}: Placed ${placed} traffic-based road sites`);
    }
    
    this.memory.roadPlannedAt = Game.time;
  }
  
  /**
   * Plan core roads (storage -> controller, storage -> sources)
   */
  private planCoreRoads(plan: RoomPlan): void {
    if (!plan.storage) return;
    
    const controller = this.room.controller;
    if (!controller) return;
    
    // Road from storage to controller
    const pathToController = plan.storage.findPathTo(controller, {
      ignoreCreeps: true,
      range: 3
    });
    
    for (const step of pathToController) {
      const pos = new RoomPosition(step.x, step.y, this.room.name);
      if (this.shouldPlaceRoad(pos)) {
        this.room.createConstructionSite(pos, STRUCTURE_ROAD);
      }
    }
    
    // Roads from storage to sources
    const sources = this.room.find(FIND_SOURCES);
    for (const source of sources) {
      const pathToSource = plan.storage.findPathTo(source, {
        ignoreCreeps: true,
        range: 1
      });
      
      for (const step of pathToSource) {
        const pos = new RoomPosition(step.x, step.y, this.room.name);
        if (this.shouldPlaceRoad(pos)) {
          this.room.createConstructionSite(pos, STRUCTURE_ROAD);
        }
      }
    }
    
    console.log(`🛤️ ${this.room.name}: Placed core road network`);
  }

  /**
   * Ensure core roads exist; if too few roads are present, re-run `planCoreRoads`.
   * This helps recover from mass destruction even when RCL hasn't changed.
   */
  private ensureCoreRoads(): void {
    const plan = this.planner.getPlan();
    if (!plan || !plan.storage) return;

    // Count existing roads in room
    const roads = this.room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_ROAD }) as StructureRoad[];

    // Estimate expected core road tiles: path from storage to controller + to each source
    const controller = this.room.controller;
    if (!controller) return;

    const storagePos = plan.storage;
    const pathToController = storagePos.findPathTo(controller, { ignoreCreeps: true, range: 3 });
    let expected = pathToController.length;

    const sources = this.room.find(FIND_SOURCES);
    for (const source of sources) {
      const path = storagePos.findPathTo(source, { ignoreCreeps: true, range: 1 });
      expected += path.length;
    }

    // If there are significantly fewer roads than expected (e.g. <50%), replan core roads
    if (expected > 0 && roads.length < Math.max(5, Math.floor(expected * 0.5))) {
      console.log(`🛤️ ${this.room.name}: Road deficit detected (${roads.length}/${expected}). Replanning core roads.`);
      this.planCoreRoads(plan);
      this.memory.roadPlannedAt = Game.time;
    }
  }
  
  /**
   * Plan defense perimeter with ramparts and walls
   */
  private planDefensePerimeter(): void {
    const plan = this.planner.getPlan();
    if (!plan) return;
    
    // Identify critical structures to protect
    const criticalStructures: Structure[] = [];
    
    // Spawns
    criticalStructures.push(...this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_SPAWN
    }));
    
    // Storage and terminal
    if (this.room.storage) criticalStructures.push(this.room.storage);
    if (this.room.terminal) criticalStructures.push(this.room.terminal);
    
    // Towers
    criticalStructures.push(...this.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_TOWER
    }));
    
    // Place ramparts on critical structures
    for (const structure of criticalStructures) {
      const hasRampart = structure.pos.lookFor(LOOK_STRUCTURES).some(
        s => s.structureType === STRUCTURE_RAMPART
      );
      
      if (!hasRampart) {
        this.room.createConstructionSite(structure.pos, STRUCTURE_RAMPART);
      }
    }
    
    this.memory.defensePlanned = true;
    console.log(`🛡️ ${this.room.name}: Planned defensive ramparts`);
  }
  
  /**
   * Check if construction site can be placed
   */
  private canPlaceConstructionSite(pos: RoomPosition, structureType: BuildableStructureConstant): boolean {
    // Check if structure or site already exists
    const structures = pos.lookFor(LOOK_STRUCTURES);
    if (structures.some(s => s.structureType === structureType)) {
      return false;
    }
    
    const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
    if (sites.some(s => s.structureType === structureType)) {
      return false;
    }
    
    // Check if position is walkable (except for roads)
    if (structureType !== STRUCTURE_ROAD && structureType !== STRUCTURE_RAMPART) {
      const terrain = new Room.Terrain(this.room.name);
      if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) {
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Check if road should be placed at position
   */
  private shouldPlaceRoad(pos: RoomPosition): boolean {
    // Don't place roads on structures (except ramparts)
    const structures = pos.lookFor(LOOK_STRUCTURES);
    if (structures.length > 0) {
      // Allow roads under ramparts
      if (structures.every(s => s.structureType === STRUCTURE_RAMPART)) {
        return this.canPlaceConstructionSite(pos, STRUCTURE_ROAD);
      }
      return false;
    }
    
    return this.canPlaceConstructionSite(pos, STRUCTURE_ROAD);
  }
  
  /**
   * Get construction statistics
   */
  getStatus(): string {
    const sites = this.room.find(FIND_CONSTRUCTION_SITES);
    const trafficPoints = Object.keys(this.memory.trafficMap).length;
    
    return `AutoPlanner ${this.room.name}:\n` +
           `  RCL: ${this.room.controller?.level || 0}\n` +
           `  Construction Sites: ${sites.length}\n` +
           `  Traffic Points: ${trafficPoints}\n` +
           `  Defense Planned: ${this.memory.defensePlanned ? 'Yes' : 'No'}`;
  }
  
  /**
   * Visualize traffic heatmap
   */
  visualizeTraffic(): void {
    const visual = this.room.visual;
    
    for (const key in this.memory.trafficMap) {
      const count = this.memory.trafficMap[key];
      const [x, y] = key.split(',').map(Number);
      
      const intensity = Math.min(count / 100, 1);
      const alpha = Math.max(0.2, intensity);
      
      visual.circle(x, y, {
        fill: `rgba(255, ${255 - Math.floor(intensity * 255)}, 0, ${alpha})`,
        radius: 0.3
      });
    }
  }
}
