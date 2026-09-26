import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;

import {
  applyPlannedConstruction,
  planMineralStructures,
} from "../src/orchestrators/orchestrator.structures";

g.FIND_STRUCTURES = 107;
g.FIND_CONSTRUCTION_SITES = 111;
g.FIND_MY_CONSTRUCTION_SITES = 114;
g.FIND_MINERALS = 116;
g.RoomPosition = class {
  constructor(public x: number, public y: number, public roomName: string) {}
};
g.TERRAIN_MASK_WALL = 1;
g.MAX_CONSTRUCTION_SITES = 100;
g.OK = 0;
g.CONTROLLER_STRUCTURES = {
  extractor: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 1, 7: 1, 8: 1 },
  road: { 0: 2500, 6: 2500 },
  rampart: { 0: 0, 6: 2500 },
  container: { 0: 5, 6: 5 },
  tower: { 0: 0, 6: 2 },
};

// Minerals commonly sit on wall terrain. The engine accepts an extractor there,
// so the planner must not throw the plan away as an invalid wall tile.
describe("applyPlannedConstruction on wall terrain", () => {
  beforeEach(() => {
    g.Game = { time: 1, constructionSites: {} };
  });

  function wallRoom(planned: Record<string, string[]>, created: string[]) {
    return {
      name: "W1N1",
      controller: { level: 6 },
      memory: { plannedStructures: planned },
      getTerrain: () => ({ get: () => 1 }),
      find: () => [],
      createConstructionSite(x: number, y: number, type: string) {
        created.push(`${x},${y}:${type}`);
        return 0;
      },
    } as unknown as Room;
  }

  it("places an extractor on a mineral that sits on a wall", () => {
    const created: string[] = [];
    const room = wallRoom({ extractor_m1: ["10,10"] }, created);

    applyPlannedConstruction(room);

    expect(created).toEqual(["10,10:extractor"]);
    expect(room.memory.plannedStructures!.extractor_m1).toEqual(["10,10"]);
  });

  it("still rejects other structures on a wall", () => {
    const created: string[] = [];
    const room = wallRoom({ container_mineral_m1: ["10,10"] }, created);

    applyPlannedConstruction(room);

    expect(created).toEqual([]);
    expect(room.memory.plannedStructures!.container_mineral_m1).toEqual([]);
  });
});

// Roads share the fallback priority, so without its own entry an extractor
// could never bump a pending road and sat behind every one of them.
describe("applyPlannedConstruction at the site cap", () => {
  beforeEach(() => {
    g.Game = { time: 1, constructionSites: {} };
  });

  it("evicts an unstarted road site to make room for the extractor", () => {
    const created: string[] = [];
    const roads = Array.from({ length: 8 }, (_, i) => ({
      structureType: "road",
      progress: 0,
      pos: { x: 20 + i, y: 20 },
      removed: false,
      remove() {
        this.removed = true;
      },
    }));
    const room = {
      name: "W1N1",
      controller: { level: 6 },
      memory: { plannedStructures: { extractor_m1: ["10,10"] } },
      getTerrain: () => ({ get: () => 1 }),
      find: (type: number) =>
        type === g.FIND_CONSTRUCTION_SITES || type === g.FIND_MY_CONSTRUCTION_SITES
          ? roads
          : [],
      createConstructionSite(x: number, y: number, type: string) {
        created.push(`${x},${y}:${type}`);
        return 0;
      },
    } as unknown as Room;

    applyPlannedConstruction(room);

    expect(created).toEqual(["10,10:extractor"]);
    expect(roads.filter((r) => r.removed)).toHaveLength(1);
  });
});

describe("planMineralStructures", () => {
  beforeEach(() => {
    g.Game = { time: 1 };
  });

  function mineralRoom(level: number, planned: Record<string, string[]>) {
    const mineral = {
      id: "m1",
      // A container already stands beside the mineral, so no new one is planned.
      pos: { x: 10, y: 10, findInRange: () => [{}] },
    };
    return {
      name: "W1N1",
      controller: { level },
      memory: { plannedStructures: planned, plannedStructuresMeta: {} },
      find: (type: number) => (type === g.FIND_MINERALS ? [mineral] : []),
    } as unknown as Room;
  }

  it("drops a mineral container plan before the extractor unlocks", () => {
    const room = mineralRoom(5, { container_mineral_m1: ["11,10"] });

    planMineralStructures(room);

    expect(room.memory.plannedStructures).toEqual({});
  });

  it("plans the extractor once the room reaches RCL 6", () => {
    const room = mineralRoom(6, {});

    planMineralStructures(room);

    expect(room.memory.plannedStructures).toEqual({ extractor_m1: ["10,10"] });
  });
});
