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

import { ROLE_BUILDER, ROLE_KNIGHT } from "../src/config/config.roles";

let shelterFromHostiles: (c: Creep) => boolean;
beforeAll(async () => {
  ({ shelterFromHostiles } = await import("../src/services/services.movement"));
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

function civilian(role: string, x: number, under: unknown[] = []) {
  const room = {
    name: "W1N1",
    controller: { my: true, safeMode },
    find: (type: number) => (type === g.FIND_HOSTILE_CREEPS ? hostiles : []),
  };
  return { name: "c", memory: { role }, room, pos: pos(x, under), move: vi.fn(() => 0) } as unknown as Creep;
}

beforeEach(() => {
  clock += 1;
  g.Game = { time: clock, rooms: {}, creeps: {} };
  g.Memory = {};
  hostiles = [];
  safeMode = undefined;
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
});
