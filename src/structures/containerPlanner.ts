// src/structures/containerPlanner.ts
import { MemoryManager } from '../memory/memoryManager';

interface ContainerPlan {
  positions: string[];
  generatedAt: number;
  rcl: number;
}

interface ContainerLocation {
  pos: RoomPosition;
  type: 'source' | 'controller';
  targetId: string;
}

export class ContainerPlanner {
  planContainersForRoom(room: Room): ContainerPlan | null {
    if (!room.controller || !room.controller.my) return null;

    const planPath = `rooms.${room.name}.containerPlan`;
    const existingPlan = MemoryManager.get<ContainerPlan>(planPath);

    if (existingPlan && existingPlan.rcl === room.controller.level) {
      return existingPlan;
    }

    const containerLocations = this.computeContainerLocations(room);
    
    const plan: ContainerPlan = {
      positions: containerLocations.map(loc => `${loc.pos.x},${loc.pos.y},${loc.type},${loc.targetId}`),
      generatedAt: Game.time,
      rcl: room.controller.level,
    };

    MemoryManager.set(planPath, plan);
    return plan;
  }

  private computeContainerLocations(room: Room): ContainerLocation[] {
    const locations: ContainerLocation[] = [];
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return locations;

    // Container for each safe source
    const sources = room.find(FIND_SOURCES);
    for (const source of sources) {
      if (!this.isSafeSource(source)) continue;

      const pos = this.findBestContainerPosition(room, source.pos, spawn.pos);
      if (pos) {
        locations.push({ pos, type: 'source', targetId: source.id });
      }
    }

    // Container at controller
    if (room.controller && room.controller.my) {
      const pos = this.findBestContainerPosition(room, room.controller.pos, spawn.pos);
      if (pos) {
        locations.push({ pos, type: 'controller', targetId: room.controller.id });
      }
    }

    return locations;
  }

  private isSafeSource(source: Source): boolean {
    const room = Game.rooms[source.pos.roomName];
    if (!room) return false;
    
    if (room.controller && room.controller.owner && !room.controller.my) {
      return false;
    }
    
    const hostiles = source.pos.findInRange(FIND_HOSTILE_CREEPS, 5);
    if (hostiles.length > 0) return false;
    
    return true;
  }

  private findBestContainerPosition(room: Room, target: RoomPosition, spawn: RoomPosition): RoomPosition | null {
    const candidates: Array<{ pos: RoomPosition; score: number }> = [];

    // Check positions adjacent to target
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;

        const x = target.x + dx;
        const y = target.y + dy;
        
        if (x < 1 || x > 48 || y < 1 || y > 48) continue;

        const pos = new RoomPosition(x, y, room.name);
        
        if (!this.isValidContainerPosition(pos)) continue;

        const distToSpawn = pos.getRangeTo(spawn);
        const terrain = room.getTerrain().get(x, y);
        const terrainCost = terrain === TERRAIN_MASK_SWAMP ? 5 : (terrain === TERRAIN_MASK_WALL ? 255 : 1);
        
        if (terrainCost === 255) continue;

        // Score: prefer closer to spawn and non-swamp terrain
        const score = distToSpawn + terrainCost;
        candidates.push({ pos, score });
      }
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => a.score - b.score);
    return candidates[0].pos;
  }

  private isValidContainerPosition(pos: RoomPosition): boolean {
    const terrain = Game.rooms[pos.roomName]?.getTerrain();
    if (!terrain) return false;
    if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) return false;

    const structures = pos.lookFor(LOOK_STRUCTURES);
    for (const struct of structures) {
      // Allow building on roads
      if (struct.structureType !== STRUCTURE_ROAD && struct.structureType !== STRUCTURE_CONTAINER) {
        return false;
      }
    }

    const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
    for (const site of sites) {
      if (site.structureType !== STRUCTURE_CONTAINER && site.structureType !== STRUCTURE_ROAD) {
        return false;
      }
    }

    return true;
  }

  getContainerPlan(room: Room): ContainerPlan | null {
    const planPath = `rooms.${room.name}.containerPlan`;
    return MemoryManager.get<ContainerPlan>(planPath) || null;
  }

  invalidatePlan(roomName: string) {
    const planPath = `rooms.${roomName}.containerPlan`;
    MemoryManager.remove(planPath);
  }
}

export const containerPlanner = new ContainerPlanner();
