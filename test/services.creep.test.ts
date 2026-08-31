import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;

beforeEach(() => {
  g.RESOURCE_ENERGY = "energy";
  g.FIND_STRUCTURES = 101;
  g.FIND_MY_CONSTRUCTION_SITES = 102;
  g.FIND_HOSTILE_CREEPS = 103;
  g.STRUCTURE_SPAWN = "spawn";
  g.STRUCTURE_EXTENSION = "extension";
  g.STRUCTURE_CONTAINER = "container";
  g.STRUCTURE_STORAGE = "storage";
  g.STRUCTURE_LINK = "link";
  g.STRUCTURE_TOWER = "tower";
  g.STRUCTURE_LAB = "lab";
  g.STRUCTURE_FACTORY = "factory";
  g.STRUCTURE_NUKER = "nuker";
  g.STRUCTURE_POWER_SPAWN = "powerSpawn";
  g.STRUCTURE_OBSERVER = "observer";
  g.STRUCTURE_RAMPART = "rampart";
  g.STRUCTURE_WALL = "wall";
  g.STRUCTURE_ROAD = "road";
  g.STRUCTURE_CONTROLLER = "controller";
  g.ERR_NOT_IN_RANGE = -1;
  g.ERR_INVALID_TARGET = -7;
  g.ERR_NO_PATH = -2000;
  g.OK = 0;
  g.Game = { time: 1 };
  g.Memory = {};
});

import { findSmartEnergyFallbackTarget } from "../src/services/services.creep";

describe("findSmartEnergyFallbackTarget", () => {
  it("falls back to upgrading the controller when there is no build or repair work", () => {
    const controller = { my: true, pos: { x: 20, y: 20 }, id: "controller" } as unknown as StructureController;
    const room = {
      name: "W1N1",
      controller,
      find: (type: number) => {
        if (type === g.FIND_MY_CONSTRUCTION_SITES) return [];
        if (type === g.FIND_STRUCTURES) return [];
        return [];
      },
      energyAvailable: 300,
      energyCapacityAvailable: 300,
    } as unknown as Room;

    const creep = {
      room,
      pos: { x: 10, y: 10 },
      name: "worker",
      store: {
        getFreeCapacity: () => 0,
        [g.RESOURCE_ENERGY as string]: 50,
      },
      moveTo: () => g.OK,
      upgradeController: () => g.OK,
    } as unknown as Creep;

    const target = findSmartEnergyFallbackTarget(creep);
    expect(target?.kind).toBe("upgrade");
    expect(target?.target).toBe(controller);
  });
});
