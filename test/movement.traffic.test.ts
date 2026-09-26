import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_STRUCTURES = 101;
g.FIND_CREEPS = 102;
g.FIND_POWER_CREEPS = 119;
g.FIND_MY_CONSTRUCTION_SITES = 114;
g.FIND_SOURCES = 105;
g.LOOK_CREEPS = "creep";
g.LOOK_STRUCTURES = "structure";
g.OBSTACLE_OBJECT_TYPES = [];

class FakeMatrix {
  get() { return 0; }
  set() {}
  clone() { return new FakeMatrix(); }
}

class FakePos {
  constructor(public x: number, public y: number, public roomName: string) {}
  getRangeTo(p: FakePos) { return Math.max(Math.abs(p.x - this.x), Math.abs(p.y - this.y)); }
  getDirectionTo(p: FakePos) { return p.x > this.x ? 3 : 7; }
  lookFor(): unknown[] { return lookup(this); }
  findInRange() { return []; }
}
g.RoomPosition = FakePos;

// Creep.prototype.moveTo is what the traffic module wraps; spy on the original.
const originalMoveTo = vi.fn(() => 0);
class FakeCreep {}
(FakeCreep.prototype as unknown as { moveTo: unknown }).moveTo = originalMoveTo;
g.Creep = FakeCreep;

let lookup: (p: FakePos) => unknown[] = () => [];
const search = vi.fn();
g.PathFinder = { CostMatrix: FakeMatrix, search };

let resolveTraffic: () => void;
beforeAll(async () => {
  ({ resolveTraffic } = await import("../src/services/services.movement"));
});

const room = { name: "W1N1", find: () => [] };

function creep(name: string, x: number): Creep {
  const c = Object.create(FakeCreep.prototype);
  Object.assign(c, {
    name,
    my: true,
    fatigue: 0,
    pos: new FakePos(x, 10, "W1N1"),
    room,
    memory: { role: "x" },
    move: vi.fn(() => 0),
  });
  return c as Creep;
}

let tick = 100;
beforeEach(() => {
  tick += 100;
  g.Memory = {};
  originalMoveTo.mockClear();
  search.mockReset();
  lookup = () => [];
});

function setTick(t: number) {
  const creeps = (g.Game as { creeps?: Record<string, Creep> } | undefined)?.creeps ?? {};
  g.Game = { time: t, rooms: { W1N1: room }, creeps };
}

describe("stuck detection", () => {
  it("counts ticks, not repeated calls in one tick", () => {
    const a = creep("a", 10);
    setTick(tick);
    (Game.creeps as Record<string, Creep>).a = a;
    const target = new FakePos(20, 10, "W1N1");
    for (let i = 0; i < 6; i++) a.moveTo(target as unknown as RoomPosition);
    expect(search).not.toHaveBeenCalled();
  });

  it("restarts the count after a skipped tick", () => {
    const a = creep("a", 10);
    const target = new FakePos(20, 10, "W1N1");
    for (const t of [1, 2, 4, 5, 7, 8]) {
      setTick(tick + t);
      (Game.creeps as Record<string, Creep>).a = a;
      a.moveTo(target as unknown as RoomPosition);
    }
    expect(search).not.toHaveBeenCalled();
  });
});

describe("traffic shove", () => {
  it("steps the stuck creep into its blocker's tile so the two swap", () => {
    const a = creep("a", 10);
    const b = creep("b", 11);
    const target = new FakePos(20, 10, "W1N1");
    lookup = (p) => (p.x === 11 ? [b] : []);
    search.mockReturnValue({ path: [new FakePos(11, 10, "W1N1")] });

    for (let t = 1; t <= 4; t++) {
      setTick(tick + t);
      (Game.creeps as Record<string, Creep>).a = a;
      (Game.creeps as Record<string, Creep>).b = b;
      originalMoveTo.mockClear();
      a.moveTo(target as unknown as RoomPosition);
    }

    // Fourth consecutive stuck tick: direct move toward b, no re-path around it.
    expect(a.move).toHaveBeenCalledWith(3);
    expect(originalMoveTo).not.toHaveBeenCalled();

    resolveTraffic();
    expect(b.move).toHaveBeenCalledWith(7);
  });
});
