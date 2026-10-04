import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;

import { applyPlannedConstruction } from "../src/orchestrators/orchestrator.structures";

g.FIND_STRUCTURES = 107;
g.FIND_CONSTRUCTION_SITES = 111;
g.FIND_MY_CONSTRUCTION_SITES = 114;
g.RoomPosition = class {
  constructor(public x: number, public y: number, public roomName: string) {}
};
g.TERRAIN_MASK_WALL = 1;
g.MAX_CONSTRUCTION_SITES = 100;
g.OK = 0;
g.CONTROLLER_STRUCTURES = {
  tower: { 5: 2 },
  road: { 5: 2500 },
  rampart: { 5: 2500 },
  extension: { 5: 30 },
};

interface FakeSite {
  structureType: string;
  progress: number;
  pos: { x: number; y: number };
  removed: boolean;
  remove(): void;
}

function roadSites(n: number): FakeSite[] {
  return Array.from({ length: n }, (_, i) => ({
    structureType: "road",
    progress: 0,
    pos: { x: 20 + i, y: 20 },
    removed: false,
    remove() {
      this.removed = true;
    },
  }));
}

function makeRoom(opts: {
  planned: Record<string, string[]>;
  structures?: Array<{ structureType: string; pos: { x: number; y: number }; my?: boolean }>;
  sites?: FakeSite[];
  created: string[];
}): Room {
  return {
    name: "W1N1",
    controller: { level: 5 },
    memory: { plannedStructures: opts.planned },
    getTerrain: () => ({ get: () => 0 }),
    find: (type: number) => {
      if (type === g.FIND_STRUCTURES) return opts.structures ?? [];
      if (type === g.FIND_CONSTRUCTION_SITES || type === g.FIND_MY_CONSTRUCTION_SITES) {
        return opts.sites ?? [];
      }
      return [];
    },
    createConstructionSite(x: number, y: number, type: string) {
      opts.created.push(`${x},${y}:${type}`);
      return 0;
    },
  } as unknown as Room;
}

describe("applyPlannedConstruction structure limits", () => {
  beforeEach(() => {
    g.Game = { time: 1, constructionSites: {} };
  });

  it("does not evict a road for a tower the RCL no longer allows", () => {
    const created: string[] = [];
    const sites = roadSites(8);
    const room = makeRoom({
      planned: { stamp_tower_a: ["10,10"] },
      structures: [
        { structureType: "tower", pos: { x: 5, y: 5 } },
        { structureType: "tower", pos: { x: 6, y: 5 } },
      ],
      sites,
      created,
    });

    applyPlannedConstruction(room);

    expect(created).toEqual([]);
    expect(sites.filter((s) => s.removed)).toHaveLength(0);
  });

  it("does not count a previous owner's towers against our limit", () => {
    const created: string[] = [];
    const room = makeRoom({
      planned: { stamp_tower_a: ["10,10"] },
      structures: [
        { structureType: "tower", pos: { x: 5, y: 5 }, my: false },
        { structureType: "tower", pos: { x: 6, y: 5 }, my: false },
      ],
      created,
    });

    applyPlannedConstruction(room);

    expect(created).toEqual(["10,10:tower"]);
  });
});

describe("applyPlannedConstruction ramparts over built structures", () => {
  beforeEach(() => {
    g.Game = { time: 1, constructionSites: {} };
  });

  it("skips a structure already under a rampart", () => {
    const created: string[] = [];
    const room = makeRoom({
      planned: { stamp_extensions: ["10,10"] },
      structures: [
        { structureType: "extension", pos: { x: 10, y: 10 } },
        { structureType: "rampart", pos: { x: 10, y: 10 } },
      ],
      created,
    });

    applyPlannedConstruction(room);

    expect(created.filter((c) => c === "10,10:rampart")).toEqual([]);
  });

  it("charges on-top ramparts to the site budget", () => {
    const created: string[] = [];
    const positions = Array.from({ length: 12 }, (_, i) => `${10 + i},10`);
    const room = makeRoom({
      planned: { stamp_extensions: positions },
      structures: [
        { structureType: "tower", pos: { x: 5, y: 5 } },
        ...positions.map((p) => {
          const [x, y] = p.split(",").map(Number);
          return { structureType: "extension", pos: { x, y } };
        }),
      ],
      created,
    });

    applyPlannedConstruction(room);

    // maxActiveConstructionSites is 8 per room.
    expect(created.length).toBe(8);
  });

  it("raises no ramparts until a tower can keep them up", () => {
    const created: string[] = [];
    const room = makeRoom({
      planned: { stamp_extensions: ["10,10"], ramparts: ["10,10", "12,12"] },
      structures: [{ structureType: "extension", pos: { x: 10, y: 10 } }],
      created,
    });

    applyPlannedConstruction(room);

    expect(created).toEqual([]);
    expect(room.memory.plannedStructures!.ramparts).toEqual(["10,10", "12,12"]);
  });
});
