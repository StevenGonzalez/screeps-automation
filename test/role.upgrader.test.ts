import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;

// Module-level caches in services.creep are keyed on Game.time, so each case
// advances the clock to avoid inheriting the previous case's cached lookups.
let clock = 100;

beforeEach(() => {
  g.RESOURCE_ENERGY = "energy";
  g.FIND_STRUCTURES = 101;
  g.FIND_MY_CONSTRUCTION_SITES = 102;
  g.FIND_HOSTILE_CREEPS = 103;
  g.FIND_MY_STRUCTURES = 104;
  g.FIND_SOURCES = 105;
  g.FIND_MINERALS = 106;
  g.STRUCTURE_ROAD = "road";
  g.STRUCTURE_LINK = "link";
  g.STRUCTURE_CONTAINER = "container";
  g.STRUCTURE_RAMPART = "rampart";
  g.STRUCTURE_WALL = "wall";
  g.ERR_NOT_IN_RANGE = -1;
  g.OK = 0;
  g.Memory = {};
  clock += 1;
});

import { runUpgrader } from "../src/roles/role.upgrader";

const controller = {
  my: true,
  id: "controller",
  ticksToDowngrade: 5171,
  pos: { x: 9, y: 5 },
} as unknown as StructureController;

function runFullUpgraderIn(room: Room): string[] {
  const calls: string[] = [];
  const creep = {
    room,
    name: "poker1",
    memory: {} as CreepMemory,
    pos: {
      x: 25,
      y: 25,
      getRangeTo: () => 5,
      findInRange: () => [],
      // Stand-in for pathfinding: the nearest target is simply the first one.
      findClosestByPath: <T>(targets: T[]) => targets[0] ?? null,
    },
    store: {
      getFreeCapacity: () => 0,
      [g.RESOURCE_ENERGY as string]: 50,
    },
    moveTo: () => g.OK as number,
    upgradeController: () => {
      calls.push("upgradeController");
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
    signController: () => g.OK as number,
  } as unknown as Creep;

  runUpgrader(creep);
  return calls;
}

describe("runUpgrader", () => {
  it("upgrades the controller even while the room has construction sites", () => {
    const site = {
      id: "site",
      structureType: g.STRUCTURE_ROAD,
      progress: 0,
      progressTotal: 300,
      pos: { x: 25, y: 24, getRangeTo: () => 1, findInRange: () => [] },
    };
    g.Game = { time: clock, getObjectById: (id: string) => (id === "site" ? site : null) };

    const room = {
      name: `W48S8-${clock}`,
      controller,
      memory: {} as RoomMemory,
      find: (type: number) => (type === g.FIND_MY_CONSTRUCTION_SITES ? [site] : []),
    } as unknown as Room;

    const calls = runFullUpgraderIn(room);

    expect(calls).toContain("upgradeController");
    expect(calls).not.toContain("build");
  });

  it("upgrades the controller even while a road in the room is damaged", () => {
    const road = {
      id: "road",
      structureType: g.STRUCTURE_ROAD,
      hits: 4900,
      hitsMax: 5000,
      pos: { x: 25, y: 24, getRangeTo: () => 1, findInRange: () => [] },
    };
    g.Game = { time: clock, getObjectById: (id: string) => (id === "road" ? road : null) };

    const room = {
      name: `W48S8-${clock}`,
      controller,
      memory: {} as RoomMemory,
      find: (type: number) => (type === g.FIND_STRUCTURES ? [road] : []),
    } as unknown as Room;

    const calls = runFullUpgraderIn(room);

    expect(calls).toContain("upgradeController");
    expect(calls).not.toContain("repair");
  });
});
