import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_STRUCTURES = 107;
g.FIND_HOSTILE_CREEPS = 103;
g.STRUCTURE_WALL = "constructedWall";
g.RESOURCE_ENERGY = "energy";
g.FIND_CONSTRUCTION_SITES = 111;
g.STRUCTURE_STORAGE = "storage";
g.OK = 0;

import { getRepairerPopulationTarget, spawnRepairer } from "../src/orchestrators/orchestrator.spawning.economy";

let tick = 5000;

function road(x: number, y: number, hits: number) {
  return { id: `road${x},${y}`, structureType: "road", pos: { x, y }, hits, hitsMax: 5000 };
}

// An RCL 6 room with little in storage and one planned road, at 10,10.
function plannedRoom(structures: unknown[], stored = 5_000): Room {
  return {
    name: `W1N1-${tick}`,
    controller: { level: 6 },
    energyCapacityAvailable: 0,
    storage: { store: { energy: stored } },
    memory: {
      blueprint: { v: 1, at: tick, anchor: { x: 10, y: 12 }, hub: { x: 10, y: 11 }, s: "R10,10,2", exits: {} },
    },
    find: (type: number, opts?: { filter?: (s: unknown) => boolean }) =>
      type === g.FIND_STRUCTURES ? structures.filter(opts?.filter ?? (() => true)) : [],
  } as unknown as Room;
}

describe("repairer population", () => {
  beforeEach(() => {
    tick += 100;
    g.Game = { time: tick };
  });

  it("sends no repairers for roads left off the plan to decay", () => {
    const strays = Array.from({ length: 10 }, (_, i) => road(30 + i, 30, 1000));
    expect(getRepairerPopulationTarget(plannedRoom(strays))).toBe(0);
  });

  it("still sends one for a worn road on the plan", () => {
    expect(getRepairerPopulationTarget(plannedRoom([road(10, 10, 1000)]))).toBe(1);
  });

  it("sends none to raise the walls while the castle saves for a keep", () => {
    const rampart = { id: "r", structureType: "rampart", pos: { x: 20, y: 20 }, hits: 15_000, hitsMax: 10_000_000 };
    g.Memory = {};
    expect(getRepairerPopulationTarget(plannedRoom([rampart], 30_000))).toBe(1);

    tick += 100;
    g.Game = { time: tick };
    g.Memory = { expansionSavings: { room: `W1N1-${tick}`, target: "W1N2" } };
    expect(getRepairerPopulationTarget(plannedRoom([rampart], 30_000))).toBe(0);
  });

  it("sends none to raise the walls on a few hundred gold above the floor", () => {
    // Storage sat on the 45K savings floor. One look above it sent a blacksmith
    // that took the few hundred and stood on the square for the rest of its life.
    const rampart = { id: "r", structureType: "rampart", pos: { x: 20, y: 20 }, hits: 15_000, hitsMax: 10_000_000 };
    g.Memory = { expansionSavings: { room: `W1N1-${tick}`, target: "W1N2" } };
    expect(getRepairerPopulationTarget(plannedRoom([rampart], 45_500))).toBe(0);

    tick += 100;
    g.Game = { time: tick };
    g.Memory = { expansionSavings: { room: `W1N1-${tick}`, target: "W1N2" } };
    expect(getRepairerPopulationTarget(plannedRoom([rampart], 60_000))).toBe(1);
  });
});

describe("repairer population while the storage is built", () => {
  beforeEach(() => {
    tick += 100;
    g.Game = { time: tick };
    g.Memory = {};
  });

  // Thornbarrow at RCL 4: no storage yet, so nothing held the walls back.
  function storagelessRoom(sites: unknown[]): Room {
    const rampart = { id: "r", structureType: "rampart", pos: { x: 20, y: 20 }, hits: 15_000, hitsMax: 10_000_000 };
    const room = plannedRoom([rampart]) as unknown as Record<string, unknown>;
    room.controller = { level: 4 };
    room.storage = undefined;
    const find = room.find as (type: number, opts?: unknown) => unknown[];
    room.find = (type: number, opts?: unknown) => (type === g.FIND_CONSTRUCTION_SITES ? sites : find(type, opts));
    return room as unknown as Room;
  }

  it("sends one to raise the walls of a castle with no storage to build", () => {
    expect(getRepairerPopulationTarget(storagelessRoom([]))).toBe(1);
  });

  it("sends none to raise them while its storage is a construction site", () => {
    expect(getRepairerPopulationTarget(storagelessRoom([{ structureType: "storage" }]))).toBe(0);
  });
});

describe("blacksmith body", () => {
  beforeEach(() => {
    tick += 100;
  });

  function spawnedBody(stored: number): string[] {
    const room = plannedRoom([], stored) as unknown as Record<string, unknown>;
    room.energyAvailable = 2300;
    room.energyCapacityAvailable = 2300;
    g.Game = { time: tick, creeps: {}, rooms: { [room.name as string]: room } };
    g.Memory = { creeps: {}, expansionSavings: { room: room.name, target: "W1N2" } };
    let body: string[] = [];
    const spawn = { spawnCreep: (b: string[]) => ((body = b), 0) };
    spawnRepairer(room as unknown as Room, spawn as unknown as StructureSpawn);
    return body;
  }

  it("raises a small one for upkeep while the walls wait on the treasury", () => {
    // Embercrag's roads and containers wore about 60 hits a tick between them,
    // and the towers hold the ramparts. A full 33-part blacksmith repairs 1,100.
    const upkeep = spawnedBody(45_500);
    expect(upkeep.filter((p) => p === WORK).length).toBeLessThanOrEqual(4);
    expect(upkeep.length).toBeGreaterThan(0);
  });

  it("raises a full one when there is gold for the walls", () => {
    expect(spawnedBody(60_000)).toHaveLength(33);
  });
});
