import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_STRUCTURES = 107;
g.FIND_MY_STRUCTURES = 108;
g.FIND_CONSTRUCTION_SITES = 111;
g.FIND_MY_CONSTRUCTION_SITES = 114;
g.FIND_SOURCES = 105;
g.FIND_MINERALS = 116;
g.TERRAIN_MASK_WALL = 1;
g.STRUCTURE_WALL = "constructedWall";
g.STRUCTURE_CONTROLLER = "controller";
g.OK = 0;

import { planTown, findCottage, reachable, TownSite } from "../src/planning/planner.town";
import { cottageLayout } from "../src/services/services.town";
import { barrierTargetFn } from "../src/services/services.creep.maintenance";
import { TOWN } from "../src/config/config.town";

const ANCHOR = { x: 25, y: 25 };
const RING_RADIUS = 13;
const cheb = (x: number, y: number) => Math.max(Math.abs(x - ANCHOR.x), Math.abs(y - ANCHOR.y));

type Struct = { structureType: string; pos: { x: number; y: number }; hits?: number };

function ringTiles(): string[] {
  const out: string[] = [];
  for (let y = 0; y < 50; y++) {
    for (let x = 0; x < 50; x++) if (cheb(x, y) === RING_RADIUS) out.push(`${x},${y}`);
  }
  return out;
}

// The rampart doors where the spokes cross the ring.
const DOORS = new Set(["25,12", "25,38"]);

// A plain room with exits on the top and bottom edges, a built ring of walls
// 13 tiles out from the anchor, and road spokes running north and south from
// the spawn through rampart doors in the ring.
function makeRoom(opts: { rcl: number; storage: number; ramparts?: boolean; barrier?: string }) {
  const ring = ringTiles();
  const structures: Struct[] = [
    { structureType: "spawn", pos: { x: 25, y: 25 } },
    { structureType: "storage", pos: { x: 25, y: 27 } },
  ];
  if (opts.ramparts !== false) {
    for (const k of ring) {
      const [x, y] = k.split(",").map(Number);
      const type = opts.barrier ?? (DOORS.has(k) ? "rampart" : "constructedWall");
      structures.push({ structureType: type, pos: { x, y } });
    }
  }
  const roads: string[] = [];
  for (let y = 12; y <= 38; y++) if (y !== 25) roads.push(`25,${y}`);
  const room = {
    name: "W1N1",
    controller: { my: true, level: opts.rcl, pos: { x: 5, y: 25 }, owner: { username: "me" } },
    storage: { pos: { x: 25, y: 27 }, store: { energy: opts.storage } },
    memory: {
      castleAnchor: { ...ANCHOR },
      perimeterTiles: ring,
      plannedStructures: {
        stamp_roads: roads,
        stamp_ramparts: [],
      } as Record<string, string[]>,
      plannedStructuresMeta: { stamp_ramparts: { createdAt: 1 } } as Record<string, { createdAt: number }>,
    } as RoomMemory,
    getTerrain: () => ({
      get: (x: number, y: number) => (x === 0 || x === 49 ? 1 : 0),
    }),
    find: (type: number) => {
      if (type === g.FIND_STRUCTURES) return structures;
      if (type === g.FIND_MY_STRUCTURES) return structures.filter((s) => s.structureType === "rampart");
      if (type === g.FIND_SOURCES) return [{ pos: { x: 5, y: 5 } }, { pos: { x: 44, y: 44 } }];
      return [];
    },
    structures,
  };
  return room;
}

beforeEach(() => {
  g.Game = { time: 5000 };
  g.console = console;
});

const parse = (k: string) => k.split(",").map(Number) as [number, number];

describe("planTown", () => {
  it("waits for the perimeter to stand before planning anything", () => {
    const room = makeRoom({ rcl: 7, storage: 500_000, ramparts: false });
    planTown(room as unknown as Room);
    expect(room.memory.town).toBeUndefined();
  });

  it("counts a ring of walls as standing", () => {
    const room = makeRoom({ rcl: 6, storage: 500_000, barrier: "constructedWall" });
    planTown(room as unknown as Room);
    expect(room.memory.town).toBeDefined();
  });

  it("keeps the watch and the square off the tiles beside a door", () => {
    const room = makeRoom({ rcl: 6, storage: 0 });
    planTown(room as unknown as Room);
    const town = room.memory.town!;
    const besideDoor = (k: string) => {
      const [x, y] = parse(k);
      return [...DOORS].some((d) => {
        const [dx, dy] = parse(d);
        return Math.max(Math.abs(x - dx), Math.abs(y - dy)) <= 1;
      });
    };
    expect(town.posts).toHaveLength(2 * TOWN.postsPerSide);
    expect(town.posts.filter(besideDoor)).toEqual([]);
    expect(town.square.filter(besideDoor)).toEqual([]);
  });

  it("moves a watch post planned beside a door before doors were kept clear", () => {
    const room = makeRoom({ rcl: 6, storage: 0 });
    planTown(room as unknown as Room);
    room.memory.town!.posts[0] = "24,13";
    planTown(room as unknown as Room);
    expect(room.memory.town!.posts).not.toContain("24,13");
    expect(room.memory.town!.posts).toHaveLength(2 * TOWN.postsPerSide);
  });

  it("raises watch posts and a square at RCL 4, but no cottage", () => {
    const room = makeRoom({ rcl: 4, storage: 500_000 });
    planTown(room as unknown as Room);
    const town = room.memory.town!;
    const ring = new Set(room.memory.perimeterTiles);
    const roads = new Set(room.memory.plannedStructures!.stamp_roads);

    // Exits on two sides, three posts behind the ring for each.
    expect(town.posts).toHaveLength(2 * TOWN.postsPerSide);
    for (const p of town.posts) {
      const [x, y] = parse(p);
      expect(cheb(x, y)).toBeLessThan(RING_RADIUS);
      expect(roads.has(p)).toBe(false);
      const behindRing = [-1, 0, 1].some((dx) => [-1, 0, 1].some((dy) => ring.has(`${x + dx},${y + dy}`)));
      expect(behindRing).toBe(true);
    }

    expect(town.fountain).toBeDefined();
    expect(town.square).toHaveLength(8);
    const [fx, fy] = parse(town.fountain!);
    // Clear of the stamp's full footprint, a short walk from storage.
    expect(cheb(fx, fy)).toBeGreaterThan(7);
    expect(Math.max(Math.abs(fx - 25), Math.abs(fy - 27))).toBeLessThanOrEqual(TOWN.squareMaxRange);
    for (const k of town.square) expect(roads.has(k)).toBe(false);

    expect(town.cottages).toHaveLength(0);
    expect(room.memory.plannedStructures!.town_walls).toEqual([town.fountain]);
    expect(room.memory.plannedStructures!.town_ramparts!.sort()).toEqual([...town.posts].sort());
  });

  it("builds a cottage inside the ring at RCL 7, door toward the castle", () => {
    const room = makeRoom({ rcl: 7, storage: 200_000 });
    planTown(room as unknown as Room);
    const town = room.memory.town!;
    expect(town.cottages).toHaveLength(1);
    const c = town.cottages[0];
    expect(c.outside).toBeUndefined();

    const roads = new Set(room.memory.plannedStructures!.stamp_roads);
    const square = new Set([...town.square, town.fountain]);
    for (let dy = 0; dy < 5; dy++) {
      for (let dx = 0; dx < 5; dx++) {
        const k = `${c.x + dx},${c.y + dy}`;
        expect(cheb(c.x + dx, c.y + dy)).toBeLessThan(RING_RADIUS);
        expect(cheb(c.x + dx, c.y + dy)).toBeGreaterThan(6);
        expect(roads.has(k)).toBe(false);
        expect(square.has(k)).toBe(false);
        expect(town.posts.includes(k)).toBe(false);
      }
    }

    // The door is on the side that faces the anchor.
    const [doorX, doorY] = parse(c.door);
    const dist = (x: number, y: number) => Math.hypot(x - ANCHOR.x, y - ANCHOR.y);
    const sides = [[c.x + 2, c.y], [c.x + 4, c.y + 2], [c.x + 2, c.y + 4], [c.x, c.y + 2]];
    const closest = Math.min(...sides.map(([x, y]) => dist(x, y)));
    expect(dist(doorX, doorY)).toBe(closest);

    const layout = cottageLayout(c);
    expect(layout.walls).toHaveLength(15);
    expect(layout.beds).toHaveLength(9);
    const walls = room.memory.plannedStructures!.town_walls!;
    const ramparts = room.memory.plannedStructures!.town_ramparts!;
    expect(walls).toHaveLength(16);
    expect(ramparts).toEqual(expect.arrayContaining([c.door, ...layout.beds, ...town.posts]));
  });

  it("holds off the cottage while storage is short of the gate", () => {
    const room = makeRoom({ rcl: 7, storage: TOWN.storageGate - 1 });
    planTown(room as unknown as Room);
    expect(room.memory.town!.cottages).toHaveLength(0);
  });

  it("keeps its layout on later passes and drops what is built from the plan", () => {
    // RCL 6 wants one cottage, so the second pass has nothing more to add.
    const room = makeRoom({ rcl: 6, storage: 200_000 });
    planTown(room as unknown as Room);
    const first = JSON.parse(JSON.stringify(room.memory.town));
    const fountain = first.fountain as string;
    const [fx, fy] = parse(fountain);
    room.structures.push({ structureType: "constructedWall", pos: { x: fx, y: fy } });

    (g.Game as { time: number }).time += 50;
    planTown(room as unknown as Room);

    expect(room.memory.town).toEqual(first);
    expect(room.memory.plannedStructures!.town_walls).not.toContain(fountain);
    expect(room.memory.plannedStructures!.town_walls).toHaveLength(15);
  });

  it("moves the posts when the perimeter is re-planned", () => {
    const room = makeRoom({ rcl: 6, storage: 0 });
    planTown(room as unknown as Room);
    expect(room.memory.town!.perimeterAt).toBe(1);
    room.memory.plannedStructuresMeta!.stamp_ramparts = { createdAt: 4000 };
    planTown(room as unknown as Room);
    expect(room.memory.town!.perimeterAt).toBe(4000);
  });
});

// A hand-built site: a corridor five tiles high running east from the anchor
// to a dead end at x = 40.
function corridorSite(): TownSite {
  const walkable = new Uint8Array(2500);
  const interior = new Uint8Array(2500);
  for (let y = 10; y <= 14; y++) {
    for (let x = 10; x <= 40; x++) {
      walkable[y * 50 + x] = 1;
      interior[y * 50 + x] = 1;
    }
  }
  return {
    anchor: { x: 12, y: 12 },
    occupied: new Set(),
    structures: new Set(),
    walkable,
    interior,
    reserved: new Set(),
    clearOf: [],
    ring: new Set(),
    storage: { x: 12, y: 14 },
  };
}

describe("findCottage", () => {
  it("never walls off ground the castle could reach", () => {
    const site = corridorSite();
    const cottage = findCottage(site, new Set(), "Hanzo");
    // Anywhere else the cottage would fill the corridor and cut off its far
    // end, so only the dead end itself will do.
    expect(cottage).not.toBeNull();
    expect(cottage!.x + 4).toBe(40);
    expect(cottage!.door).toBe(`${cottage!.x},12`);

    const walls = new Set(cottageLayout(cottage!).walls.map((k) => {
      const [x, y] = parse(k);
      return y * 50 + x;
    }));
    const after = reachable(site, walls);
    for (const b of cottageLayout(cottage!).beds) {
      const [x, y] = parse(b);
      expect(after[y * 50 + x]).toBe(1);
    }
  });
});

describe("barrierTargetFn", () => {
  it("keeps town walls and ramparts at the town goal, other walls at the perimeter goal", () => {
    const room = makeRoom({ rcl: 7, storage: 500_000 });
    planTown(room as unknown as Room);
    const town = room.memory.town!;
    const c = town.cottages[0];
    const wall = cottageLayout(c).walls[0];
    const target = barrierTargetFn(room as unknown as Room);
    const at = (type: string, k: string) =>
      target({ structureType: type, pos: { x: parse(k)[0], y: parse(k)[1] } } as unknown as AnyStructure);

    expect(at("constructedWall", wall)).toBe(TOWN.barrierHits);
    expect(at("rampart", c.door)).toBe(TOWN.barrierHits);
    expect(at("rampart", town.posts[0])).toBe(TOWN.barrierHits);
    expect(at("constructedWall", "3,3")).toBeGreaterThan(TOWN.barrierHits);
    expect(at("rampart", room.memory.perimeterTiles![0])).toBeGreaterThan(TOWN.barrierHits);
  });
});

describe("town growth by RCL", () => {
  it("adds a cottage a level at a time as the castle rises", () => {
    const room = makeRoom({ rcl: 4, storage: 200_000 });
    planTown(room as unknown as Room);
    expect(room.memory.town!.cottages).toHaveLength(0);

    room.controller.level = 5;
    planTown(room as unknown as Room);
    expect(room.memory.town!.cottages).toHaveLength(1);

    room.controller.level = 7;
    planTown(room as unknown as Room);
    expect(room.memory.town!.cottages).toHaveLength(2);
  });
});
