// src/structures/roadPlanner.ts
import { MemoryManager } from '../memory/memoryManager';

interface RoadPlan {
  positions: string[];
  generatedAt: number;
  rcl: number;
}

interface KeyLocation {
  pos: RoomPosition;
  type: 'spawn' | 'source' | 'controller' | 'container' | 'mineral';
  id?: string;
}

export class RoadPlanner {
  planRoadsForRoom(room: Room): RoadPlan | null {
    if (!room.controller || !room.controller.my) return null;

    const planPath = `rooms.${room.name}.roadPlan`;
    const existingPlan = MemoryManager.get<RoadPlan>(planPath);

    if (existingPlan && existingPlan.rcl === room.controller.level) {
      return existingPlan;
    }

    const keyLocations = this.getKeyLocations(room);
    if (keyLocations.length === 0) return null;

    const roadPositions = this.computeOptimalRoads(room, keyLocations);
    
    const plan: RoadPlan = {
      positions: roadPositions.map(pos => `${pos.x},${pos.y}`),
      generatedAt: Game.time,
      rcl: room.controller.level,
    };

    MemoryManager.set(planPath, plan);
    return plan;
  }

  private getKeyLocations(room: Room): KeyLocation[] {
    const locations: KeyLocation[] = [];

    const spawns = room.find(FIND_MY_SPAWNS);
    for (const spawn of spawns) {
      locations.push({ pos: spawn.pos, type: 'spawn', id: spawn.id });
    }

    const sources = room.find(FIND_SOURCES);
    for (const source of sources) {
      locations.push({ pos: source.pos, type: 'source', id: source.id });
    }

    if (room.controller && room.controller.my) {
      locations.push({ pos: room.controller.pos, type: 'controller', id: room.controller.id });
    }

    // Include containers from planned or built positions
    const containers = room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER
    });
    for (const container of containers) {
      locations.push({ pos: container.pos, type: 'container', id: container.id });
    }

    const containerSites = room.find(FIND_CONSTRUCTION_SITES, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER
    });
    for (const site of containerSites) {
      locations.push({ pos: site.pos, type: 'container', id: site.id });
    }

    // Include mineral if extractor exists or RCL >= 6
    if (room.controller && room.controller.level >= 6) {
      const minerals = room.find(FIND_MINERALS);
      for (const mineral of minerals) {
        locations.push({ pos: mineral.pos, type: 'mineral', id: mineral.id });
      }
    }

    return locations;
  }

  private computeOptimalRoads(room: Room, keyLocations: KeyLocation[]): RoomPosition[] {
    const roadSet = new Set<string>();
    const spawn = keyLocations.find(loc => loc.type === 'spawn');
    
    if (!spawn) return [];

    const targets = keyLocations.filter(loc => loc.type !== 'spawn');

    for (const target of targets) {
      const path = this.findOptimalPath(room, spawn.pos, target.pos);
      for (const pos of path) {
        const key = `${pos.x},${pos.y}`;
        if (!this.isStructureLocation(room, pos)) {
          roadSet.add(key);
        }
      }
    }

    for (let i = 0; i < targets.length; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        const path = this.findOptimalPath(room, targets[i].pos, targets[j].pos);
        for (const pos of path) {
          const key = `${pos.x},${pos.y}`;
          if (!this.isStructureLocation(room, pos)) {
            roadSet.add(key);
          }
        }
      }
    }

    const positions: RoomPosition[] = [];
    for (const key of roadSet) {
      const [x, y] = key.split(',').map(Number);
      positions.push(new RoomPosition(x, y, room.name));
    }

    return positions;
  }

  private findOptimalPath(room: Room, start: RoomPosition, end: RoomPosition): RoomPosition[] {
    const result = PathFinder.search(start, { pos: end, range: 1 }, {
      roomCallback: (roomName: string) => {
        if (roomName !== room.name) return false;
        
        const costs = new PathFinder.CostMatrix();
        
        // Mark existing structures
        const structures = room.find(FIND_STRUCTURES);
        for (const struct of structures) {
          if (struct.structureType === STRUCTURE_ROAD) {
            costs.set(struct.pos.x, struct.pos.y, 1);
          } else if (struct.structureType !== STRUCTURE_CONTAINER && 
                     (struct.structureType !== STRUCTURE_RAMPART || !(struct as StructureRampart).my)) {
            costs.set(struct.pos.x, struct.pos.y, 255);
          }
        }

        // Mark construction sites
        const constructionSites = room.find(FIND_CONSTRUCTION_SITES);
        for (const site of constructionSites) {
          if (site.structureType === STRUCTURE_ROAD) {
            costs.set(site.pos.x, site.pos.y, 1);
          } else if (site.structureType !== STRUCTURE_CONTAINER) {
            costs.set(site.pos.x, site.pos.y, 255);
          }
        }

        return costs;
      },
      plainCost: 2,
      swampCost: 10,
      maxRooms: 1,
    });

    if (result.incomplete) {
      return [];
    }

    return result.path;
  }

  private isStructureLocation(room: Room, pos: RoomPosition): boolean {
    const structures = pos.lookFor(LOOK_STRUCTURES);
    for (const struct of structures) {
      if (struct.structureType !== STRUCTURE_ROAD && struct.structureType !== STRUCTURE_CONTAINER) {
        return true;
      }
    }

    const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
    for (const site of sites) {
      if (site.structureType !== STRUCTURE_ROAD && site.structureType !== STRUCTURE_CONTAINER) {
        return true;
      }
    }

    return false;
  }

  getRoadPlan(room: Room): RoadPlan | null {
    const planPath = `rooms.${room.name}.roadPlan`;
    return MemoryManager.get<RoadPlan>(planPath) || null;
  }

  invalidatePlan(roomName: string) {
    const planPath = `rooms.${roomName}.roadPlan`;
    MemoryManager.remove(planPath);
  }
}

export const roadPlanner = new RoadPlanner();
