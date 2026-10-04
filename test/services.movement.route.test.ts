import { describe, it, expect, beforeEach, vi } from "vitest";

// services.movement patches Creep.prototype.moveTo at import time, so the
// globals it touches must exist before the module loads.
const { originalMoveTo } = vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  const originalMoveTo = vi.fn(() => 0);
  class FakeCreep {}
  (FakeCreep.prototype as unknown as { moveTo: unknown }).moveTo = originalMoveTo;
  g.Creep = FakeCreep;
  g.RoomPosition = class {
    constructor(public x: number, public y: number, public roomName: string) {}
    getRangeTo(): number {
      return 50;
    }
  };
  g.PathFinder = {
    CostMatrix: class {
      bits = new Uint8Array(2500);
      set(x: number, y: number, v: number) {
        this.bits[x * 50 + y] = v;
      }
      get(x: number, y: number) {
        return this.bits[x * 50 + y];
      }
      clone() {
        return this;
      }
    },
  };
  g.ERR_NO_PATH = -2;
  return { originalMoveTo };
});

import { routeRoomCost, getRouteRooms } from "../src/services/services.movement";

const g = globalThis as Record<string, unknown>;

let findRoute: ReturnType<typeof vi.fn>;
let intel: Record<string, Partial<RoomIntelData>>;
let tick = 1000;

beforeEach(() => {
  // A fresh tick per test keeps the per-tick danger context and route cache apart.
  tick += 10000;
  intel = {};
  findRoute = vi.fn(() => [{ exit: 3, room: "W2N1" }, { exit: 3, room: "W3N1" }]);
  originalMoveTo.mockClear();
  g.Game = {
    time: tick,
    rooms: { W1N1: { name: "W1N1", controller: { my: true, owner: { username: "Me" } } } },
    creeps: {},
    map: { findRoute },
  };
  g.Memory = {
    intel,
    allies: ["Friend"],
    rooms: { W1N1: { remoteRooms: [] } },
  };
});

describe("routeRoomCost", () => {
  it("refuses enemy rooms with towers, or with no tower count recorded", () => {
    intel.W3N3 = { owner: "Enemy", towers: 2 };
    intel.W4N3 = { owner: "Enemy" };
    expect(routeRoomCost("W3N3", "W9N9")).toBe(Infinity);
    expect(routeRoomCost("W4N3", "W9N9")).toBe(Infinity);
  });

  it("makes towerless enemy rooms expensive but passable", () => {
    intel.W3N3 = { owner: "Enemy", towers: 0 };
    expect(routeRoomCost("W3N3", "W9N9")).toBe(10);
  });

  it("treats ally-owned rooms as ordinary rooms", () => {
    intel.W3N3 = { owner: "Friend", towers: 6 };
    expect(routeRoomCost("W3N3", "W9N9")).toBe(2);
  });

  it("penalises Source Keeper rooms unless they are the destination", () => {
    expect(routeRoomCost("W4N4", "W9N9")).toBe(10);
    expect(routeRoomCost("W4N4", "W4N4")).toBe(1);
  });

  it("always allows the destination, even a towered enemy room", () => {
    intel.W3N3 = { owner: "Enemy", towers: 2 };
    expect(routeRoomCost("W3N3", "W3N3")).toBe(1);
  });

  it("penalises rooms someone else reserves, but not ours or an ally's", () => {
    intel.W3N3 = { reservedBy: "Enemy" };
    intel.W4N3 = { reservedBy: "Invader" };
    intel.W5N3 = { reservedBy: "Me" };
    intel.W6N3 = { reservedBy: "Friend" };
    expect(routeRoomCost("W3N3", "W9N9")).toBe(10);
    expect(routeRoomCost("W4N3", "W9N9")).toBe(10);
    expect(routeRoomCost("W5N3", "W9N9")).toBe(2);
    expect(routeRoomCost("W6N3", "W9N9")).toBe(2);
  });

  it("penalises remotes flagged hostile until the flag expires", () => {
    (Memory.rooms.W1N1 as RoomMemory).remoteRooms = [
      { roomName: "W2N2", sources: [], lastSeen: 0, hostile: true, hostileUntil: tick + 100 },
      { roomName: "W3N2", sources: [], lastSeen: 0, hostile: true, hostileUntil: tick - 1 },
    ];
    expect(routeRoomCost("W2N2", "W9N9")).toBe(10);
    expect(routeRoomCost("W3N2", "W9N9")).toBe(2);
  });

  it("prefers highways and our own rooms", () => {
    expect(routeRoomCost("W10N3", "W9N9")).toBe(1);
    expect(routeRoomCost("W1N1", "W9N9")).toBe(1);
    expect(routeRoomCost("W2N2", "W9N9")).toBe(2);
  });
});

describe("getRouteRooms", () => {
  it("returns the start, route and destination rooms, using the route cost", () => {
    intel.W3N3 = { owner: "Enemy", towers: 2 };
    const rooms = getRouteRooms("W1N1", "W3N1");
    expect([...rooms!].sort()).toEqual(["W1N1", "W2N1", "W3N1"]);
    const cb = findRoute.mock.calls[0][2].routeCallback as (rn: string) => number;
    expect(cb("W3N3")).toBe(Infinity);
  });

  it("caches routes for a while, then recomputes", () => {
    getRouteRooms("W1N1", "W3N1");
    (Game as { time: number }).time = tick + 100;
    getRouteRooms("W1N1", "W3N1");
    expect(findRoute).toHaveBeenCalledTimes(1);
    (Game as { time: number }).time = tick + 500;
    getRouteRooms("W1N1", "W3N1");
    expect(findRoute).toHaveBeenCalledTimes(2);
  });

  it("returns null when no route exists", () => {
    findRoute.mockReturnValue(-2);
    expect(getRouteRooms("W1N1", "W5N1")).toBeNull();
  });
});

describe("cross-room moveTo", () => {
  function creepIn(roomName: string): Creep {
    const c = Object.create((g.Creep as { prototype: object }).prototype);
    Object.assign(c, {
      name: "c1",
      fatigue: 0,
      pos: new RoomPosition(10, 10, roomName),
      room: { name: roomName },
    });
    return c as Creep;
  }

  it("blocks rooms off the route and passes route rooms through", () => {
    creepIn("W1N1").moveTo(new RoomPosition(25, 25, "W3N1"), { range: 20 });
    const opts = originalMoveTo.mock.calls[0][1] as MoveToOpts;
    const off = opts.costCallback!("W2N2", new PathFinder.CostMatrix()) as CostMatrix;
    expect(off.get(0, 0)).toBe(0xff);
    expect(off.get(25, 25)).toBe(0xff);
    const on = opts.costCallback!("W2N1", new PathFinder.CostMatrix()) as CostMatrix;
    expect(on.get(25, 25)).toBe(0);
  });

  it("leaves pathing unrestricted when no safe route exists", () => {
    findRoute.mockReturnValue(-2);
    creepIn("W1N1").moveTo(new RoomPosition(25, 25, "W5N1"), { range: 20 });
    const opts = originalMoveTo.mock.calls[0][1] as MoveToOpts;
    const cm = opts.costCallback!("W2N2", new PathFinder.CostMatrix()) as CostMatrix;
    expect(cm.get(25, 25)).toBe(0);
  });

  it("still keeps to the route with traffic handling switched off", () => {
    (Memory as { trafficDisabled?: boolean }).trafficDisabled = true;
    creepIn("W1N1").moveTo(new RoomPosition(25, 25, "W3N1"), { range: 20 });
    const opts = originalMoveTo.mock.calls[0][1] as MoveToOpts;
    const off = opts.costCallback!("W2N2", new PathFinder.CostMatrix()) as CostMatrix;
    expect(off.get(25, 25)).toBe(0xff);
    expect(opts.plainCost).toBeUndefined();
  });

  it("counts creeps as obstacles only in the mover's own room", () => {
    g.FIND_CREEPS = 101;
    g.FIND_STRUCTURES = 107;
    g.FIND_MY_CONSTRUCTION_SITES = 114;
    g.FIND_POWER_CREEPS = 119;
    const creepsAt = (x: number, y: number) => (type: number) =>
      type === g.FIND_CREEPS ? [{ pos: { x, y } }] : [];
    const rooms = (Game as { rooms: Record<string, unknown> }).rooms;
    rooms.W1N1 = { ...(rooms.W1N1 as object), find: creepsAt(12, 12) };
    rooms.W2N1 = { name: "W2N1", find: creepsAt(30, 30) };

    creepIn("W1N1").moveTo(new RoomPosition(25, 25, "W3N1"), { range: 20 });
    const opts = originalMoveTo.mock.calls[0][1] as MoveToOpts;
    const here = opts.costCallback!("W1N1", new PathFinder.CostMatrix()) as CostMatrix;
    expect(here.get(12, 12)).toBe(0xff);
    const ahead = opts.costCallback!("W2N1", new PathFinder.CostMatrix()) as CostMatrix;
    expect(ahead.get(30, 30)).toBe(0);
  });

  it("does not route same-room moves", () => {
    creepIn("W1N1").moveTo(new RoomPosition(40, 40, "W1N1"));
    expect(findRoute).not.toHaveBeenCalled();
  });
});
