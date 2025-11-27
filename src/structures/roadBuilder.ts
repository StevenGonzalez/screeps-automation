// src/structures/roadBuilder.ts
import { MemoryManager } from '../memory/memoryManager';
import { roadPlanner } from './roadPlanner';

interface RoadBuildState {
  lastBuildCheck: number;
  lastCleanupCheck: number;
}

export class RoadBuilder {
  private readonly BUILD_CHECK_INTERVAL = 10;
  private readonly CLEANUP_CHECK_INTERVAL = 50;
  private readonly MAX_SITES_PER_TICK = 20;

  buildRoadsForRoom(room: Room) {
    const statePath = `rooms.${room.name}.roadBuildState`;
    const state = MemoryManager.get<RoadBuildState>(statePath, {
      lastBuildCheck: 0,
      lastCleanupCheck: 0,
    }) || { lastBuildCheck: 0, lastCleanupCheck: 0 };

    const now = Game.time;

    if (now - state.lastBuildCheck >= this.BUILD_CHECK_INTERVAL) {
      this.createRoadConstructionSites(room);
      state.lastBuildCheck = now;
      MemoryManager.set(statePath, state);
    }

    if (now - state.lastCleanupCheck >= this.CLEANUP_CHECK_INTERVAL) {
      this.cleanupObsoleteRoads(room);
      state.lastCleanupCheck = now;
      MemoryManager.set(statePath, state);
    }
  }

  private createRoadConstructionSites(room: Room) {
    const plan = roadPlanner.getRoadPlan(room);
    if (!plan || plan.positions.length === 0) return;

    const existingSites = room.find(FIND_MY_CONSTRUCTION_SITES, {
      filter: (s) => s.structureType === STRUCTURE_ROAD,
    });

    if (existingSites.length >= this.MAX_SITES_PER_TICK) return;

    let sitesCreated = 0;
    const maxToCreate = this.MAX_SITES_PER_TICK - existingSites.length;

    for (const posStr of plan.positions) {
      if (sitesCreated >= maxToCreate) break;

      const [x, y] = posStr.split(',').map(Number);
      const pos = new RoomPosition(x, y, room.name);

      const hasRoad = pos.lookFor(LOOK_STRUCTURES).some(s => s.structureType === STRUCTURE_ROAD);
      if (hasRoad) continue;

      const hasSite = pos.lookFor(LOOK_CONSTRUCTION_SITES).some(s => s.structureType === STRUCTURE_ROAD);
      if (hasSite) continue;

      const blockingStructure = this.hasBlockingStructure(pos);
      if (blockingStructure) continue;

      const result = room.createConstructionSite(pos.x, pos.y, STRUCTURE_ROAD);
      if (result === OK) {
        sitesCreated++;
      }
    }
  }

  private cleanupObsoleteRoads(room: Room) {
    const plan = roadPlanner.getRoadPlan(room);
    if (!plan) return;

    const plannedSet = new Set(plan.positions);

    const roads = room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_ROAD,
    }) as StructureRoad[];

    for (const road of roads) {
      const posKey = `${road.pos.x},${road.pos.y}`;
      
      const hasBlockingStructure = this.hasBlockingStructure(road.pos);
      if (hasBlockingStructure) {
        road.destroy();
        continue;
      }

      if (!plannedSet.has(posKey)) {
        const distanceToKey = this.distanceToNearestKeyLocation(room, road.pos);
        if (distanceToKey > 3) {
          road.destroy();
        }
      }
    }

    const roadSites = room.find(FIND_MY_CONSTRUCTION_SITES, {
      filter: (s) => s.structureType === STRUCTURE_ROAD,
    });

    for (const site of roadSites) {
      const hasBlockingStructure = this.hasBlockingStructure(site.pos);
      if (hasBlockingStructure) {
        site.remove();
      }
    }
  }

  private hasBlockingStructure(pos: RoomPosition): boolean {
    const structures = pos.lookFor(LOOK_STRUCTURES);
    for (const struct of structures) {
      if (struct.structureType !== STRUCTURE_ROAD && 
          struct.structureType !== STRUCTURE_CONTAINER &&
          struct.structureType !== STRUCTURE_RAMPART) {
        return true;
      }
    }

    const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
    for (const site of sites) {
      if (site.structureType !== STRUCTURE_ROAD && 
          site.structureType !== STRUCTURE_CONTAINER &&
          site.structureType !== STRUCTURE_RAMPART) {
        return true;
      }
    }

    return false;
  }

  private distanceToNearestKeyLocation(room: Room, pos: RoomPosition): number {
    let minDist = Number.POSITIVE_INFINITY;

    const spawns = room.find(FIND_MY_SPAWNS);
    for (const spawn of spawns) {
      const dist = pos.getRangeTo(spawn.pos);
      if (dist < minDist) minDist = dist;
    }

    const sources = room.find(FIND_SOURCES);
    for (const source of sources) {
      const dist = pos.getRangeTo(source.pos);
      if (dist < minDist) minDist = dist;
    }

    if (room.controller && room.controller.my) {
      const dist = pos.getRangeTo(room.controller.pos);
      if (dist < minDist) minDist = dist;
    }

    return minDist;
  }
}

export const roadBuilder = new RoadBuilder();
