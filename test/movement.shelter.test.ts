import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_HOSTILE_CREEPS = 103;
g.FIND_STRUCTURES = 101;
g.FIND_CREEPS = 102;
g.FIND_POWER_CREEPS = 119;
g.FIND_MY_CONSTRUCTION_SITES = 114;
g.OBSTACLE_OBJECT_TYPES = [];
g.STRUCTURE_RAMPART = "rampart";
g.LOOK_STRUCTURES = "structure";
g.OK = 0;
g.RoomPosition = class {
  constructor(public x: number, public y: number, public roomName: string) {}
};

class FakeMatrix {
  get() { return 0; }
  set() {}
  clone() { return new FakeMatrix(); }
}
class FakeCreep {}
(FakeCreep.prototype as unknown as { moveTo: unknown }).moveTo = vi.fn(() => 0);
g.Creep = FakeCreep;
const search = vi.fn();
g.PathFinder = { CostMatrix: FakeMatrix, search };

import { ROLE_BUILDER, ROLE_KNIGHT, ROLE_REPAIRER } from "../src/config/config.roles";

let shelterFromHostiles: (c: Creep) => boolean;
let walkHome: (c: Creep) => boolean;
beforeAll(async () => {
  ({ shelterFromHostiles, walkHome } = await import("../src/services/services.movement"));
});

function pos(x: number, under: unknown[] = []) {
  return {
    x,
    y: 10,
    roomName: "W1N1",
    inRangeTo: (p: { x: number }, r: number) => Math.abs(p.x - x) <= r,
    getDirectionTo: () => 7,
    lookFor: () => under,
  };
}

let hostiles: unknown[] = [];
let safeMode: number | undefined;
let clock = 100;

function hostile(x: number, parts: { ranged?: number; attack?: number }) {
  return {
    owner: { username: "enemy" },
    pos: pos(x),
    body: [],
    getActiveBodyparts: (t: string) =>
      t === "ranged_attack" ? parts.ranged ?? 0 : t === "attack" ? parts.attack ?? 0 : 0,
  };
}

let town: TownMemory | undefined;

function civilian(role: string, x: number, under: unknown[] = []) {
  const room = {
    name: "W1N1",
    controller: { my: true, safeMode },
    memory: { town },
    find: (type: number) => (type === g.FIND_HOSTILE_CREEPS ? hostiles : []),
  };
  return {
    name: "c",
    memory: { role },
    room,
    pos: pos(x, under),
    move: vi.fn(() => 0),
    moveTo: vi.fn(() => 0),
  } as unknown as Creep;
}

beforeEach(() => {
  clock += 1;
  g.Game = { time: clock, rooms: {}, creeps: {} };
  g.Memory = {};
  hostiles = [];
  safeMode = undefined;
  town = undefined;
  search.mockReset();
  search.mockReturnValue({ path: [{ x: 9, y: 10, roomName: "W1N1" }] });
});

describe("shelterFromHostiles", () => {
  it("steps a builder away from a ranged hostile that can reach it", () => {
    hostiles = [hostile(14, { ranged: 1 })];
    const c = civilian(ROLE_BUILDER, 10);
    expect(shelterFromHostiles(c)).toBe(true);
    expect(search.mock.calls[0][2].flee).toBe(true);
    expect(c.move).toHaveBeenCalledWith(7);
  });

  it("ignores a melee hostile more than two tiles off", () => {
    hostiles = [hostile(13, { attack: 1 })];
    expect(shelterFromHostiles(civilian(ROLE_BUILDER, 10))).toBe(false);
  });

  it("ignores an unarmed hostile", () => {
    hostiles = [hostile(11, {})];
    expect(shelterFromHostiles(civilian(ROLE_BUILDER, 10))).toBe(false);
  });

  it("leaves military roles to their own logic", () => {
    hostiles = [hostile(11, { attack: 1 })];
    expect(shelterFromHostiles(civilian(ROLE_KNIGHT, 10))).toBe(false);
  });

  it("stays put on one of our ramparts", () => {
    hostiles = [hostile(11, { attack: 1 })];
    const c = civilian(ROLE_BUILDER, 10, [{ structureType: "rampart", my: true }]);
    expect(shelterFromHostiles(c)).toBe(false);
  });

  it("carries on working under safe mode", () => {
    safeMode = 500;
    hostiles = [hostile(11, { attack: 1 })];
    expect(shelterFromHostiles(civilian(ROLE_BUILDER, 10))).toBe(false);
  });

  it("carries on when there is nowhere to flee", () => {
    search.mockReturnValue({ path: [] });
    hostiles = [hostile(11, { attack: 1 })];
    expect(shelterFromHostiles(civilian(ROLE_BUILDER, 10))).toBe(false);
  });

  // A cottage west of the creep: beds at x 5-7, y 10-12.
  const COTTAGE: TownMemory = {
    posts: [],
    square: [],
    cottages: [{ x: 4, y: 9, door: "8,11", name: "Pasi" }],
  };

  it("runs for a free cottage bed away from the danger instead of open ground", () => {
    town = COTTAGE;
    hostiles = [hostile(14, { ranged: 1 })];
    const c = civilian(ROLE_BUILDER, 10);
    expect(shelterFromHostiles(c)).toBe(true);
    expect(search).not.toHaveBeenCalled();
    const target = (c.moveTo as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(target.x).toBe(7);
    expect(c.memory.townSpot).toBe("7,10");
  });

  it("will not run toward the danger for a bed", () => {
    town = COTTAGE;
    hostiles = [hostile(6, { ranged: 1 })];
    const c = civilian(ROLE_BUILDER, 10);
    expect(shelterFromHostiles(c)).toBe(true);
    expect(search).toHaveBeenCalled();
  });
});

describe("walkHome", () => {
  it("walks a home worker that strayed into another room back to its castle", () => {
    const c = civilian(ROLE_REPAIRER, 10);
    c.memory.homeRoom = "W1N2";
    expect(walkHome(c)).toBe(true);
    expect((c.moveTo as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ roomName: "W1N2" });
  });

  it("leaves a worker at home, one with no home on record, and military roles alone", () => {
    const home = civilian(ROLE_REPAIRER, 10);
    home.memory.homeRoom = "W1N1";
    expect(walkHome(home)).toBe(false);
    expect(walkHome(civilian(ROLE_REPAIRER, 10))).toBe(false);
    const knight = civilian(ROLE_KNIGHT, 10);
    knight.memory.homeRoom = "W1N2";
    expect(walkHome(knight)).toBe(false);
  });
});
