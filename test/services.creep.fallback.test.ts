import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;

let clock = 500;

beforeEach(() => {
  g.RESOURCE_ENERGY = "energy";
  g.WORK = "work";
  g.CARRY = "carry";
  g.MOVE = "move";
  g.FIND_STRUCTURES = 101;
  g.FIND_MY_CONSTRUCTION_SITES = 102;
  g.FIND_HOSTILE_CREEPS = 103;
  g.FIND_SOURCES = 105;
  g.FIND_MY_CREEPS = 107;
  g.FIND_MY_SPAWNS = 108;
  g.STRUCTURE_SPAWN = "spawn";
  g.STRUCTURE_EXTENSION = "extension";
  g.STRUCTURE_TOWER = "tower";
  g.STRUCTURE_STORAGE = "storage";
  g.STRUCTURE_LINK = "link";
  g.STRUCTURE_TERMINAL = "terminal";
  g.FIND_MINERALS = 106;
  g.STRUCTURE_ROAD = "road";
  g.STRUCTURE_CONTAINER = "container";
  g.STRUCTURE_RAMPART = "rampart";
  g.STRUCTURE_WALL = "wall";
  g.ERR_NOT_IN_RANGE = -1;
  g.OK = 0;
  g.Memory = {};
  clock += 1;
});

import { findSmartEnergyFallbackTarget } from "../src/services/services.creep";

function makeRoomWithWork() {
  const site = {
    id: "site",
    structureType: g.STRUCTURE_ROAD,
    progress: 0,
    progressTotal: 300,
    pos: { x: 25, y: 24, getRangeTo: () => 1, findInRange: () => [] },
  };
  g.Game = { time: clock, getObjectById: (id: string) => (id === "site" ? site : null) };
  return {
    name: `W1N1-${clock}`,
    controller: { my: true, id: "controller", pos: { x: 9, y: 5 } } as unknown as StructureController,
    memory: {} as RoomMemory,
    find: (type: number) => (type === g.FIND_MY_CONSTRUCTION_SITES ? [site] : []),
  } as unknown as Room;
}

function makeCreep(body: string[], room: Room): Creep {
  return {
    room,
    name: "c1",
    pos: { x: 25, y: 25, getRangeTo: () => 5, findInRange: () => [], findClosestByPath: <T>(t: T[]) => t[0] ?? null },
    store: { getFreeCapacity: () => 0, [g.RESOURCE_ENERGY as string]: 50 },
    getActiveBodyparts: (part: string) => body.filter((p) => p === part).length,
  } as unknown as Creep;
}

describe("findSmartEnergyFallbackTarget body-part awareness", () => {
  it("offers build work to a creep that has a WORK part", () => {
    const room = makeRoomWithWork();
    const creep = makeCreep([g.WORK as string, g.CARRY as string, g.MOVE as string], room);
    expect(findSmartEnergyFallbackTarget(creep)?.kind).toBe("build");
  });

  it("offers nothing to a WORK-less hauler, which cannot build, repair or upgrade", () => {
    const room = makeRoomWithWork();
    const creep = makeCreep([g.CARRY as string, g.CARRY as string, g.MOVE as string], room);
    expect(findSmartEnergyFallbackTarget(creep)).toBeNull();
  });
});

import { runHauler } from "../src/roles/role.hauler";

describe("runHauler with nothing to deposit", () => {
  it("parks by the core instead of trying to build a site it has no WORK part for", () => {
    const site = {
      id: "site",
      structureType: g.STRUCTURE_ROAD,
      progress: 0,
      progressTotal: 300,
      pos: { x: 25, y: 24, getRangeTo: () => 1, findInRange: () => [] },
    };
    const spawn = {
      id: "spawn",
      structureType: g.STRUCTURE_SPAWN,
      pos: { x: 24, y: 24 },
      store: { getFreeCapacity: () => 0, getUsedCapacity: () => 300, [g.RESOURCE_ENERGY as string]: 300 },
    };
    g.Game = { time: clock, getObjectById: (id: string) => (id === "site" ? site : null) };

    const room = {
      name: `W1N1-hauler-${clock}`,
      controller: { my: true, id: "controller", pos: { x: 9, y: 5 } } as unknown as StructureController,
      memory: {} as RoomMemory,
      storage: undefined,
      energyAvailable: 300,
      energyCapacityAvailable: 300,
      find: (type: number) => {
        if (type === g.FIND_MY_CONSTRUCTION_SITES) return [site];
        if (type === g.FIND_MY_SPAWNS) return [spawn];
        return [];
      },
    } as unknown as Room;

    const calls: string[] = [];
    const creep = {
      room,
      id: "hauler1",
      name: "dragger1",
      memory: {} as CreepMemory,
      pos: {
        x: 35,
        y: 35,
        getRangeTo: () => 12,
        inRangeTo: () => false,
        findInRange: () => [],
        findClosestByPath: <T>(t: T[]) => t[0] ?? null,
      },
      store: {
        getFreeCapacity: () => 0,
        getUsedCapacity: () => 100,
        [g.RESOURCE_ENERGY as string]: 100,
      },
      getActiveBodyparts: (part: string) => (part === g.CARRY ? 2 : 0),
      moveTo: () => {
        calls.push("moveTo");
        return g.OK as number;
      },
      build: () => {
        calls.push("build");
        return g.OK as number;
      },
      repair: () => {
        calls.push("repair");
        return g.OK as number;
      },
      upgradeController: () => {
        calls.push("upgradeController");
        return g.OK as number;
      },
      transfer: () => g.OK as number,
      say: () => g.OK as number,
    } as unknown as Creep;

    runHauler(creep);

    expect(calls).not.toContain("build");
    expect(calls).not.toContain("repair");
    expect(calls).not.toContain("upgradeController");
    expect(calls).toContain("moveTo");
  });
});
