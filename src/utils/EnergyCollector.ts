/// <reference types="@types/screeps" />

import type { Warrior } from '../Warriors/Warrior';

export interface CollectOptions {
  useLinks?: boolean;
  useStorage?: boolean;
  useContainers?: boolean;
  useDropped?: boolean;
  harvestIfNeeded?: boolean;
  storageMinEnergy?: number;
}

export class EnergyCollector {
  static collect(Warrior: Warrior, options?: CollectOptions): boolean {
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
    const hasCarry = Warrior.body.some(p => p.type === CARRY);
    if (!hasCarry) return false;

    // Try links first
    if (opts.useLinks) {
      const links = Warrior.room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_LINK &&
                     (s as StructureLink).store.getUsedCapacity(RESOURCE_ENERGY) > 100
      }) as StructureLink[];

      if (links.length > 0) {
        const nearest = Warrior.pos.findClosestByPath(links);
        if (nearest) {
          Warrior.withdrawFrom(nearest);
          return true;
        }
      }
    }

    // Try containers
    if (opts.useContainers) {
      const container = Warrior.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
                       (s as StructureContainer).store.getUsedCapacity(RESOURCE_ENERGY) > 50
      }) as StructureContainer | null;

      if (container) {
        Warrior.withdrawFrom(container);
        return true;
      }
    }

    // Try storage
    if (opts.useStorage && Warrior.room.storage &&
        (Warrior.room.storage as StructureStorage).store.getUsedCapacity(RESOURCE_ENERGY) > (opts.storageMinEnergy || 0)) {
      Warrior.withdrawFrom(Warrior.room.storage);
      return true;
    }

    // Try terminal
    if (opts.useStorage && Warrior.room.terminal &&
        (Warrior.room.terminal as StructureTerminal).store.getUsedCapacity(RESOURCE_ENERGY) > (opts.storageMinEnergy || 0)) {
      Warrior.withdrawFrom(Warrior.room.terminal);
      return true;
    }

    // Try dropped resources
    if (opts.useDropped) {
      const dropped = Warrior.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50
      });

      if (dropped) {
        if (Warrior.pos.isNearTo(dropped)) {
          Warrior.pickup(dropped);
        } else {
          Warrior.goTo(dropped);
        }
        return true;
      }
    }

    // Last resort: harvest directly
    if (opts.harvestIfNeeded) {
      const source = Warrior.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
      if (source) {
        Warrior.harvestSource(source);
        return true;
      }
    }

    return false;
  }
}

export default EnergyCollector;
