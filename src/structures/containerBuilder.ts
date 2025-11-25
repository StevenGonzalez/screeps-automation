// src/structures/containerBuilder.ts
import { MemoryManager } from '../memory/memoryManager';
import { containerPlanner } from './containerPlanner';

interface ContainerBuildState {
  lastBuildCheck: number;
  lastCleanupCheck: number;
}

export class ContainerBuilder {
  private readonly BUILD_CHECK_INTERVAL = 20;
  private readonly CLEANUP_CHECK_INTERVAL = 100;

  buildContainersForRoom(room: Room) {
    const statePath = `rooms.${room.name}.containerBuildState`;
    const state = MemoryManager.get<ContainerBuildState>(statePath, {
      lastBuildCheck: 0,
      lastCleanupCheck: 0,
    }) || { lastBuildCheck: 0, lastCleanupCheck: 0 };

    const now = Game.time;

    if (now - state.lastBuildCheck >= this.BUILD_CHECK_INTERVAL) {
      this.createContainerConstructionSites(room);
      state.lastBuildCheck = now;
      MemoryManager.set(statePath, state);
    }

    if (now - state.lastCleanupCheck >= this.CLEANUP_CHECK_INTERVAL) {
      this.cleanupObsoleteContainers(room);
      state.lastCleanupCheck = now;
      MemoryManager.set(statePath, state);
    }
  }

  private createContainerConstructionSites(room: Room) {
    const plan = containerPlanner.getContainerPlan(room);
    if (!plan || plan.positions.length === 0) return;

    for (const posStr of plan.positions) {
      const parts = posStr.split(',');
      const x = parseInt(parts[0]);
      const y = parseInt(parts[1]);
      const pos = new RoomPosition(x, y, room.name);

      const hasContainer = pos.lookFor(LOOK_STRUCTURES).some(s => s.structureType === STRUCTURE_CONTAINER);
      if (hasContainer) continue;

      const hasSite = pos.lookFor(LOOK_CONSTRUCTION_SITES).some(s => s.structureType === STRUCTURE_CONTAINER);
      if (hasSite) continue;

      const blockingStructure = this.hasBlockingStructure(pos);
      if (blockingStructure) continue;

      room.createConstructionSite(pos.x, pos.y, STRUCTURE_CONTAINER);
    }
  }

  private cleanupObsoleteContainers(room: Room) {
    const plan = containerPlanner.getContainerPlan(room);
    if (!plan) return;

    const plannedPositions = new Set<string>();
    for (const posStr of plan.positions) {
      const parts = posStr.split(',');
      const key = `${parts[0]},${parts[1]}`;
      plannedPositions.add(key);
    }

    const containers = room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    }) as StructureContainer[];

    for (const container of containers) {
      const posKey = `${container.pos.x},${container.pos.y}`;
      
      const hasBlockingStructure = this.hasBlockingStructure(container.pos);
      if (hasBlockingStructure) {
        container.destroy();
        continue;
      }

      if (!plannedPositions.has(posKey)) {
        const distanceToKey = this.distanceToNearestKeyLocation(room, container.pos);
        if (distanceToKey > 2) {
          container.destroy();
        }
      }
    }

    const containerSites = room.find(FIND_MY_CONSTRUCTION_SITES, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    });

    for (const site of containerSites) {
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

export const containerBuilder = new ContainerBuilder();
