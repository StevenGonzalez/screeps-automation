import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;

// The second source is unsafe (a keeper, an invader core).
vi.mock("../src/services/services.creep", async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  isSourceSafe: (s: { id: string }) => s.id !== "s2",
}));

import {
  materializeBlueprint,
  clearWayForBlueprint,
  clearWayForRing,
} from "../src/orchestrators/orchestrator.structures";
import { encodeBlueprint, type Blueprint } from "../src/planning/planner.blueprint";

g.FIND_STRUCTURES = 107;
g.FIND_MY_CONSTRUCTION_SITES = 114;
g.FIND_SOURCES = 105;
g.FIND_HOSTILE_CREEPS = 103;
g.OK = 0;
g.STRUCTURE_CONTROLLER = "controller";
g.CONTROLLER_STRUCTURES = {
  extension: { 2: 5, 3: 10 },
  lab: { 3: 0 },
  container: { 2: 5, 3: 5 },
};

const bp: Blueprint = {
  anchor: { x: 25, y: 25 },
  hub: { x: 25, y: 27 },
  entries: [
    { type: "spawn", x: 25, y: 25, rcl: 1 },
    { type: "extension", x: 24, y: 24, rcl: 2 },
    { type: "extension", x: 26, y: 24, rcl: 3 },
    { type: "tower", x: 23, y: 23, rcl: 3 },
    { type: "container", x: 10, y: 11, rcl: 2, tag: "source:s1" },
    { type: "container", x: 40, y: 41, rcl: 2, tag: "source:s2" },
    { type: "container", x: 30, y: 12, rcl: 2, tag: "controller" },
    { type: "link", x: 11, y: 11, rcl: 5, tag: "source:s1" },
    { type: "road", x: 25, y: 26, rcl: 2 },
    { type: "road", x: 25, y: 27, rcl: 2 },
  ],
  exits: { top: [{ x: 25, y: 2 }, { x: 25, y: 1 }], left: [{ x: 2, y: 25 }] },
};

const safe = { id: "s1", room: {}, pos: {} };
const unsafe = { id: "s2", room: {}, pos: {} };

function room(level: number, extra: Partial<Record<string, unknown>> = {}): Room {
  return {
    name: "W1N1",
    controller: { level },
    memory: {
      plannedStructures: { stamp_ramparts: ["1,1"], town_walls: ["5,5"], stamp_extensions: ["9,9"] },
      plannedStructuresMeta: { stamp_extensions: { createdAt: 0 }, cardinal_road_west: { createdAt: 0 } },
      blueprint: { lanes: ["top"] },
    },
    find: (type: number) => (type === g.FIND_SOURCES ? [safe, unsafe] : []),
    ...extra,
  } as unknown as Room;
}

describe("materializeBlueprint", () => {
  beforeEach(() => {
    g.Game = { time: 7 };
  });

  it("plans what the room's age has unlocked, under the usual keys", () => {
    const r = room(3);
    materializeBlueprint(r, bp);
    const mem = r.memory.plannedStructures!;
    expect(mem.stamp_spawn_1).toEqual(["25,25"]);
    expect(mem.stamp_tower_1).toEqual(["23,23"]);
    expect(mem.stamp_extensions).toEqual(["24,24", "26,24"]);
    expect(mem.container_controller).toEqual(["30,12"]);
    expect(mem.road_blueprint).toEqual(["25,26", "25,27"]);
    expect(mem.container_source_s1).toEqual(["10,11"]);
    expect(mem.container_source_s2).toBeUndefined();
    expect(mem.link_source_s1).toBeUndefined();
  });

  it("keeps the ring and the town, and replaces everything else", () => {
    const r = room(1);
    materializeBlueprint(r, bp);
    const mem = r.memory.plannedStructures!;
    expect(mem.stamp_ramparts).toEqual(["1,1"]);
    expect(mem.town_walls).toEqual(["5,5"]);
    expect(mem.stamp_extensions).toBeUndefined();
    expect(r.memory.plannedStructuresMeta!.stamp_extensions).toBeUndefined();
    expect(r.memory.plannedStructuresMeta!.stamp_spawn_1).toEqual({ createdAt: 7 });
  });

  it("lays exit roads only on sides with worked remotes", () => {
    const r = room(2);
    materializeBlueprint(r, bp);
    const mem = r.memory.plannedStructures!;
    expect(mem.cardinal_road_north).toEqual(["25,2", "25,1"]);
    expect(mem.cardinal_road_west).toBeUndefined();
    expect(r.memory.plannedStructuresMeta!.cardinal_road_west).toBeUndefined();
  });
});

interface FakeStructure {
  structureType: string;
  pos: { x: number; y: number };
  my?: boolean;
  destroyed: boolean;
  destroy(): number;
}

function built(structureType: string, x: number, y: number, my?: boolean, hits = 1000): FakeStructure {
  return {
    structureType,
    pos: { x, y },
    my,
    hits,
    destroyed: false,
    destroy() {
      this.destroyed = true;
      return 0;
    },
  };
}

function builtRoom(level: number, structures: FakeStructure[], hostiles: unknown[] = []): Room {
  return {
    name: "W1N1",
    controller: { level },
    memory: {},
    find: (type: number) =>
      type === g.FIND_STRUCTURES ? structures : type === g.FIND_HOSTILE_CREEPS ? hostiles : [],
  } as unknown as Room;
}

describe("clearWayForBlueprint", () => {
  beforeEach(() => {
    g.Game = { time: 7 };
  });

  it("removes a building that sits where an unlocked one is planned", () => {
    const blocker = built("container", 24, 24);
    const road = built("road", 26, 24);
    clearWayForBlueprint(builtRoom(2, [blocker, road]), bp);
    expect(blocker.destroyed).toBe(true);
    expect(road.destroyed).toBe(false);
  });

  it("leaves a tile alone until its age comes", () => {
    const blocker = built("container", 26, 24);
    clearWayForBlueprint(builtRoom(2, [blocker]), bp);
    expect(blocker.destroyed).toBe(false);
  });

  it("removes the farthest stray once the type is at its cap", () => {
    const strays = [
      built("extension", 30, 30, true),
      built("extension", 31, 31, true),
      built("extension", 40, 40, true),
      built("extension", 32, 32, true),
      built("extension", 33, 33, true),
    ];
    clearWayForBlueprint(builtRoom(2, strays), bp);
    expect(strays.filter((s) => s.destroyed).map((s) => s.pos)).toEqual([{ x: 40, y: 40 }]);
  });

  it("keeps strays while the type has slots left", () => {
    const stray = built("extension", 40, 40, true);
    clearWayForBlueprint(builtRoom(2, [stray]), bp);
    expect(stray.destroyed).toBe(false);
  });

  it("tears nothing down with enemies in the room", () => {
    const blocker = built("container", 24, 24);
    clearWayForBlueprint(builtRoom(2, [blocker], [{}]), bp);
    expect(blocker.destroyed).toBe(false);
  });
});

describe("clearWayForRing", () => {
  let planTick = 100;
  beforeEach(() => {
    g.Game = { time: 7 };
  });

  // The ring crosses the blueprint road at 25,26 and the top exit road at
  // 25,2; 20,20 and 21,20 are wall tiles.
  function ringRoom(structures: FakeStructure[], hostiles: unknown[] = []): Room {
    const r = builtRoom(6, structures, hostiles);
    r.memory.perimeterTiles = ["25,26", "25,2", "20,20", "21,20"];
    // A plan tick per room, so the decoded-plan cache never hands back a stale one.
    r.memory.blueprint = encodeBlueprint(bp, ++planTick);
    return r;
  }

  it("takes down a weak rampart where the ring wants a wall", () => {
    const rampart = built("rampart", 20, 20, true, 3000);
    expect(clearWayForRing(ringRoom([rampart]))).toBe(true);
    expect(rampart.destroyed).toBe(true);
  });

  it("keeps a rampart that is too strong to throw away", () => {
    const rampart = built("rampart", 20, 20, true, 5_000_000);
    expect(clearWayForRing(ringRoom([rampart]))).toBe(false);
    expect(rampart.destroyed).toBe(false);
  });

  it("keeps a rampart over a container where the ring wants a wall", () => {
    // No wall can stand on the container, so the rampart is raised again
    // over it and torn down again, every pass.
    const container = built("container", 20, 20);
    const rampart = built("rampart", 20, 20, true, 3000);
    expect(clearWayForRing(ringRoom([container, rampart]))).toBe(false);
    expect(rampart.destroyed).toBe(false);
  });

  it("keeps the rampart doors where roads cross", () => {
    const doors = [built("rampart", 25, 26, true, 3000), built("rampart", 25, 2, true, 3000)];
    clearWayForRing(ringRoom(doors));
    expect(doors.some((d) => d.destroyed)).toBe(false);
  });

  it("opens a wall that stands where a door is needed", () => {
    const wall = built("constructedWall", 25, 26);
    clearWayForRing(ringRoom([wall]));
    expect(wall.destroyed).toBe(true);
  });

  it("takes down a wall left from an older ring once the ring is closed, but not the town's", () => {
    const ringWalls = [built("constructedWall", 20, 20), built("constructedWall", 21, 20)];
    const doors = [built("rampart", 25, 26, true, 3000), built("rampart", 25, 2, true, 3000)];
    const old = built("constructedWall", 30, 30, undefined, 130_000);
    const fountain = built("constructedWall", 31, 31);
    const server = { ...built("constructedWall", 0, 30), hits: undefined as unknown as number };
    const open = ringRoom([ringWalls[0], ...doors, old, fountain, server]);
    open.memory.town = { posts: [], square: [], cottages: [], fountain: "31,31" } as unknown as RoomMemory["town"];
    expect(clearWayForRing(open)).toBe(false);
    expect(old.destroyed).toBe(false);

    const closed = ringRoom([...ringWalls, ...doors, old, fountain, server]);
    closed.memory.town = open.memory.town;
    expect(clearWayForRing(closed)).toBe(true);
    expect(old.destroyed).toBe(true);
    const tidy = ringRoom([...ringWalls, ...doors, fountain, server]);
    tidy.memory.town = open.memory.town;
    expect(clearWayForRing(tidy)).toBe(false);
    expect([...ringWalls, ...doors, fountain, server].some((s) => s.destroyed)).toBe(false);
  });

  it("takes down one at a time, and nothing with enemies in the room", () => {
    const ramparts = [built("rampart", 20, 20, true, 3000), built("rampart", 21, 20, true, 3000)];
    clearWayForRing(ringRoom(ramparts, [{}]));
    expect(ramparts.filter((r) => r.destroyed)).toHaveLength(0);
    clearWayForRing(ringRoom(ramparts));
    expect(ramparts.filter((r) => r.destroyed)).toHaveLength(1);
  });
});
