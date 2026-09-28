import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_MY_CREEPS = 102;
g.FIND_MY_STRUCTURES = 108;
g.FIND_HOSTILE_CREEPS = 103;
g.STRUCTURE_RAMPART = "rampart";
g.OK = 0;
g.TOP = 1;
g.RIGHT = 3;
g.BOTTOM = 5;
g.LEFT = 7;
g.TERRAIN_MASK_WALL = 1;

class FakePos {
  constructor(public x: number, public y: number, public roomName: string) {}
}
g.RoomPosition = FakePos;

let hostiles: unknown[] = [];
vi.mock("../src/services/services.combat", () => ({
  getThreatInfo: () => ({ hostiles, score: hostiles.length }),
  isSourceKeeperRoom: (name: string) => name === "W5N5",
}));

import { runTownsfolk, lookoutTargets } from "../src/roles/role.townsfolk";
import { claimSpot, townClock } from "../src/services/services.town";
import { nextTownJob } from "../src/orchestrators/orchestrator.spawning.town";
import { ROLE_TOWNSFOLK } from "../src/config/config.roles";
import { TOWN, TOWN_DAY_LENGTH } from "../src/config/config.town";

// Night falls 700 ticks into each 1000-tick day.
const DAY = 3 * TOWN_DAY_LENGTH + 200;
const NIGHT = 3 * TOWN_DAY_LENGTH + 800;

function pos(x: number, y: number) {
  return {
    x,
    y,
    roomName: "W1N1",
    inRangeTo: (p: { x: number; y: number } | { pos: { x: number; y: number } }, r: number) => {
      const q = "pos" in p ? p.pos : p;
      return Math.max(Math.abs(q.x - x), Math.abs(q.y - y)) <= r;
    },
    isEqualTo: (p: { x: number; y: number }) => p.x === x && p.y === y,
    findClosestByRange: (list: Array<{ pos: { x: number; y: number } }>) => list[0] ?? null,
  };
}

// One cottage at 30,30 (beds 31-33 x 31-33), two watch posts and a square.
const TOWN_MEM: TownMemory = {
  posts: ["20,12", "21,12"],
  square: ["24,34", "25,34"],
  fountain: "25,35",
  cottages: [{ x: 30, y: 30, door: "30,32", name: "Hanzo" }],
};

let ramparts: Array<{ structureType: string; pos: { x: number; y: number } }> = [];
let room: Record<string, unknown>;

function makeRoom() {
  room = {
    name: "W1N1",
    controller: { my: true, level: 7, owner: { username: "me" } },
    storage: { store: { energy: 200_000 } },
    memory: { town: JSON.parse(JSON.stringify(TOWN_MEM)), perimeterTiles: ["20,11", "21,11", "22,11"] },
    find: (type: number) => {
      if (type === g.FIND_MY_STRUCTURES) return ramparts;
      if (type === g.FIND_MY_CREEPS) return Object.values((g.Game as { creeps: object }).creeps);
      return [];
    },
  };
  return room;
}

function folk(name: string, x: number, y: number, memory: Partial<CreepMemory> = {}) {
  const c = {
    name,
    room,
    pos: pos(x, y),
    memory: { role: ROLE_TOWNSFOLK, job: "militia", homeRoom: "W1N1", ...memory },
    body: [],
    moveTo: vi.fn(),
    rangedAttack: vi.fn(),
    say: vi.fn(),
  };
  (g.Game as { creeps: Record<string, unknown> }).creeps[name] = c;
  return c;
}

function movedTo(c: { moveTo: ReturnType<typeof vi.fn> }): string | null {
  const call = c.moveTo.mock.calls[0];
  if (!call) return null;
  const p = call[0] as { x: number; y: number };
  return `${p.x},${p.y}`;
}

beforeEach(() => {
  hostiles = [];
  ramparts = [];
  g.Game = { time: DAY, creeps: {}, rooms: {} };
  g.Memory = { creeps: {} };
  makeRoom();
});

describe("townClock", () => {
  it("runs dawn, day, dusk and night through each thousand-tick day", () => {
    expect(townClock(0)).toEqual({ phase: "dawn", hour: 0 });
    expect(townClock(1250).phase).toBe("day");
    expect(townClock(2650).phase).toBe("dusk");
    expect(townClock(3999)).toEqual({ phase: "night", hour: 23 });
  });
});

describe("claimSpot", () => {
  it("gives each tile to one creep and frees a tile its holder stopped using", () => {
    const a = folk("a", 10, 10);
    const b = folk("b", 10, 10);
    expect(claimSpot(a as unknown as Creep, ["5,5"])).toBe("5,5");
    expect(claimSpot(b as unknown as Creep, ["5,5"])).toBeNull();

    // Two ticks on without a's claim being used, it has lapsed.
    (g.Game as { time: number }).time += 2;
    expect(claimSpot(b as unknown as Creep, ["5,5"])).toBe("5,5");
  });
});

describe("militia", () => {
  it("stands the watch by day and goes to bed at night", () => {
    const m = folk("m", 25, 25);
    runTownsfolk(m as unknown as Creep);
    expect(TOWN_MEM.posts).toContain(movedTo(m));

    (g.Game as { time: number }).time = NIGHT;
    m.moveTo.mockClear();
    runTownsfolk(m as unknown as Creep);
    const bed = movedTo(m)!;
    const [x, y] = bed.split(",").map(Number);
    expect(x).toBeGreaterThanOrEqual(31);
    expect(x).toBeLessThanOrEqual(33);
    expect(y).toBeGreaterThanOrEqual(31);
    expect(y).toBeLessThanOrEqual(33);
  });

  it("runs to the rampart nearest the raiders and shoots anything in reach", () => {
    ramparts = ["20,11", "21,11", "22,11", "20,12"].map((k) => {
      const [x, y] = k.split(",").map(Number);
      return { structureType: "rampart", pos: { x, y } };
    });
    const raider = { pos: { x: 24, y: 10 }, hits: 500 };
    hostiles = [raider];
    const m = folk("m", 22, 13);
    runTownsfolk(m as unknown as Creep);

    expect(m.rangedAttack).toHaveBeenCalledWith(raider);
    expect(movedTo(m)).toBe("22,11");
    expect(m.say).toHaveBeenCalledWith("To arms!", true);
  });

  it("bars itself in a bed when every rampart is taken", () => {
    hostiles = [{ pos: { x: 22, y: 5 }, hits: 500 }];
    const m = folk("m", 30, 25);
    runTownsfolk(m as unknown as Creep);
    const [x, y] = movedTo(m)!.split(",").map(Number);
    expect(x).toBeGreaterThanOrEqual(31);
    expect(y).toBeGreaterThanOrEqual(31);
  });
});

describe("nextTownJob", () => {
  function buildBeds(n: number) {
    const beds = ["31,31", "32,31", "33,31", "31,32", "32,32", "33,32", "31,33", "32,33", "33,33"];
    ramparts = beds.slice(0, n).map((k) => {
      const [x, y] = k.split(",").map(Number);
      return { structureType: "rampart", pos: { x, y } };
    });
  }

  it("raises one militiaman per built bed, up to the RCL cap", () => {
    buildBeds(2);
    expect(nextTownJob(room as unknown as Room)).toEqual({ job: "militia" });
    folk("a", 31, 31);
    folk("b", 32, 31);
    expect(nextTownJob(room as unknown as Room)).toBeNull();

    buildBeds(9);
    for (const n of ["c", "d"]) folk(n, 31, 32);
    expect(TOWN.militiaByRcl[7]).toBe(4);
    expect(nextTownJob(room as unknown as Room)).toBeNull();
  });

  it("raises nobody while storage is under the gate or the empire is recovering", () => {
    buildBeds(9);
    (room.storage as { store: { energy: number } }).store.energy = TOWN.storageGateByRcl[7] - 1;
    expect(nextTownJob(room as unknown as Room)).toBeNull();

    (room.storage as { store: { energy: number } }).store.energy = 500_000;
    g.Memory = { creeps: {}, empire: { posture: "RECOVER", updatedAt: 0 } };
    expect(nextTownJob(room as unknown as Room)).toBeNull();
  });
});

describe("lookoutTargets", () => {
  it("skips our own rooms, other players' rooms, keeper rooms and worked remotes", () => {
    g.Game = {
      time: DAY,
      creeps: {},
      rooms: { W2N1: { controller: { my: true } } },
      map: {
        describeExits: () => ({ 1: "W1N2", 3: "W2N1", 5: "W5N5", 7: "W0N1" }),
      },
    };
    g.Memory = { creeps: {}, intel: { W0N1: { owner: "rival" } } };
    expect(lookoutTargets(room as unknown as Room, new Set())).toEqual(["W1N2"]);
    expect(lookoutTargets(room as unknown as Room, new Set(["W1N2"]))).toEqual([]);
  });
});

describe("lookout", () => {
  function lookoutIn(controller: object | undefined) {
    const target = { name: "W1N2", controller, find: () => [] };
    const c = folk("l", 25, 45, { job: "lookout", targetRoom: "W1N2", lookoutPos: "25,46" });
    (c as { room: unknown }).room = target;
    return c;
  }

  it("keeps its post in an empty neighbour", () => {
    const l = lookoutIn(undefined);
    runTownsfolk(l as unknown as Creep);
    expect(l.memory.retreatUntil).toBeUndefined();
    expect(movedTo(l)).toBe("25,46");
  });

  it("runs home from a room another player has claimed", () => {
    const l = lookoutIn({ my: false, owner: { username: "rival" } });
    runTownsfolk(l as unknown as Creep);
    expect(l.memory.retreatUntil).toBe(DAY + 300);
    expect(l.say).toHaveBeenCalledWith("Raiders!", true);
    const home = l.moveTo.mock.calls[0][0] as { roomName: string };
    expect(home.roomName).toBe("W1N1");
  });
});
