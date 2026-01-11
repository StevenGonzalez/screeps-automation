/// <reference types="@types/screeps" />

import type { Elite } from '../elites/Elite';

export interface CollectOptions {
  useLinks?: boolean;
  useStorage?: boolean;
  useContainers?: boolean;
  useDropped?: boolean;
  harvestIfNeeded?: boolean;
  storageMinEnergy?: number;
}

export class EnergyCollector {
  static collect(elite: Elite, options?: CollectOptions): boolean {
    const opts: CollectOptions = {
      useLinks: true,
      useStorage: true,
      useContainers: true,
      useDropped: true,
      harvestIfNeeded: true,
      storageMinEnergy: 1000,
      ...options
    };

    // Only creeps with CARRY should attempt collection
    const hasCarry = elite.body.some(p => p.type === CARRY);
    if (!hasCarry) return false;

    // Try links first
    if (opts.useLinks) {
      const links = elite.room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_LINK &&
                     (s as StructureLink).store.getUsedCapacity(RESOURCE_ENERGY) > 100
      }) as StructureLink[];

      if (links.length > 0) {
        const nearest = elite.pos.findClosestByPath(links);
        if (nearest) {
          elite.withdrawFrom(nearest);
          return true;
        }
      }
    }

    // Try containers
    if (opts.useContainers) {
      const container = elite.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
                       (s as StructureContainer).store.getUsedCapacity(RESOURCE_ENERGY) > 50
      }) as StructureContainer | null;

      if (container) {
        elite.withdrawFrom(container);
        return true;
      }
    }

    // Try storage
    if (opts.useStorage && elite.room.storage &&
        (elite.room.storage as StructureStorage).store.getUsedCapacity(RESOURCE_ENERGY) > (opts.storageMinEnergy || 0)) {
      elite.withdrawFrom(elite.room.storage);
      return true;
    }

    // Try terminal
    if (opts.useStorage && elite.room.terminal &&
        (elite.room.terminal as StructureTerminal).store.getUsedCapacity(RESOURCE_ENERGY) > (opts.storageMinEnergy || 0)) {
      elite.withdrawFrom(elite.room.terminal);
      return true;
    }

    // Try dropped resources
    if (opts.useDropped) {
      const dropped = elite.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50
      });

      if (dropped) {
        if (elite.pos.isNearTo(dropped)) {
          elite.pickup(dropped);
        } else {
          elite.goTo(dropped);
        }
        return true;
      }
    }

    // Last resort: harvest directly
    if (opts.harvestIfNeeded) {
      const source = elite.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
      if (source) {
        elite.harvestSource(source);
        return true;
      }
    }

    return false;
  }
}

export default EnergyCollector;
