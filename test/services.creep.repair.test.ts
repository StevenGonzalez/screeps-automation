import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_STRUCTURES = 107;
g.FIND_HOSTILE_CREEPS = 103;
g.STRUCTURE_WALL = "constructedWall";

import {
  findMostCriticalRepairTarget,
  findTowerDefenseRepairTarget,
  findTowerRepairTarget,
  clearRemotePlayerHostile,
  markRemotePlayerHostile,
} from "../src/services/services.creep";

let tick = 1000;

function rampart(id: string, x: number, y: number, hits: number) {
  return {
    id,
    structureType: "rampart",
    pos: {
      x,
      y,
      getRangeTo: (p: { x: number; y: number }) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)),
    },
    hits,
    hitsMax: 300_000_000,
  } as unknown as AnyStructure;
}

function makeRoom(opts: {
  level: number;
  structures: AnyStructure[];
  planned?: Record<string, string[]>;
  perimeter?: string[];
  storageEnergy?: number;
  hostiles?: unknown[];
}): Room {
  return {
    name: "W1N1",
    controller: { level: opts.level },
    storage: opts.storageEnergy === undefined ? undefined : { store: { energy: opts.storageEnergy } },
    memory: { plannedStructures: opts.planned ?? {}, perimeterTiles: opts.perimeter },
    find: (type: number) => {
      if (type === g.FIND_STRUCTURES) return opts.structures;
      if (type === g.FIND_HOSTILE_CREEPS) return opts.hostiles ?? [];
      return [];
    },
    lookForAt: () => [],
  } as unknown as Room;
}

function repairFor(room: Room): AnyStructure | null {
  return findMostCriticalRepairTarget({ room } as unknown as Creep);
}

describe("findMostCriticalRepairTarget ramparts", () => {
  beforeEach(() => {
    tick++;
    g.Game = { time: tick };
  });

  it("leaves a bare rampart off the stored ring alone, even when decaying", () => {
    const stale = rampart("stale", 5, 5, 500);
    const room = makeRoom({ level: 8, structures: [stale], perimeter: ["20,20"] });
    expect(repairFor(room)).toBeNull();
  });

  it("repairs every bare rampart as perimeter until a ring is stored", () => {
    const bare = rampart("bare", 5, 5, 500);
    const room = makeRoom({ level: 8, structures: [bare] });
    expect(repairFor(room)?.id).toBe("bare");
  });

  it("keeps repairing built perimeter ramparts after the plan drops their tiles", () => {
    // The planner prunes built tiles from stamp_ramparts; the stored ring is what counts.
    const built = rampart("built", 20, 20, 500);
    const room = makeRoom({
      level: 8,
      structures: [built],
      planned: { stamp_ramparts: [] },
      perimeter: ["20,20"],
    });
    expect(repairFor(room)?.id).toBe("built");
  });

  it("stops on-top ramparts at their lower target", () => {
    const onTop = rampart("onTop", 10, 10, 400_000);
    const spawn = { id: "spawn", structureType: "spawn", pos: { x: 10, y: 10 }, hits: 5000, hitsMax: 5000 };
    const room = makeRoom({
      level: 8,
      structures: [onTop, spawn as unknown as AnyStructure],
      perimeter: ["20,20"],
      storageEnergy: 500_000,
    });
    expect(repairFor(room)).toBeNull();
  });

  it("holds the perimeter at 1M until storage has energy to spare", () => {
    const wall = rampart("perim", 20, 20, 1_500_000);
    const poor = makeRoom({
      level: 8,
      structures: [wall],
      perimeter: ["20,20"],
      storageEnergy: 50_000,
    });
    expect(repairFor(poor)).toBeNull();

    tick++;
    g.Game = { time: tick };
    const rich = makeRoom({
      level: 8,
      structures: [wall],
      perimeter: ["20,20"],
      storageEnergy: 500_000,
    });
    expect(repairFor(rich)?.id).toBe("perim");
  });
});

describe("findTowerDefenseRepairTarget", () => {
  beforeEach(() => {
    tick++;
    g.Game = { time: tick };
  });

  it("prefers the barrier a breaker is standing at over the weakest one", () => {
    const far = rampart("far", 5, 5, 1_000);
    const near = rampart("near", 30, 30, 50_000);
    const breaker = {
      pos: {
        getRangeTo: (p: { x: number; y: number }) => Math.max(Math.abs(p.x - 31), Math.abs(p.y - 30)),
      },
      body: [{ type: "work", hits: 100 }],
    };
    const room = makeRoom({ level: 8, structures: [far, near], hostiles: [breaker] });
    expect(findTowerDefenseRepairTarget(room)?.id).toBe("near");
  });

  it("falls back to the weakest barrier when nothing is threatening one", () => {
    const far = rampart("far", 5, 5, 1_000);
    const near = rampart("near", 30, 30, 50_000);
    const room = makeRoom({ level: 8, structures: [far, near] });
    expect(findTowerDefenseRepairTarget(room)?.id).toBe("far");
  });
});

describe("remote player strikes", () => {
  function entry(): RemoteRoomData {
    return { roomName: "W2N1", sources: [], lastSeen: 0, hostile: false };
  }

  it("escalates across visits instead of resetting on the first clean look", () => {
    const e = entry();
    g.Game = { time: 10_000 };
    markRemotePlayerHostile(e);
    expect(e.hostileStrikes).toBe(1);

    g.Game = { time: 10_100 };
    clearRemotePlayerHostile(e);
    expect(e.hostile).toBe(false);
    expect(e.hostileStrikes).toBe(1);

    g.Game = { time: 10_500 };
    markRemotePlayerHostile(e);
    expect(e.hostileStrikes).toBe(2);
    expect(e.hostileUntil).toBe(10_500 + 4000);
  });

  it("forgives one strike per clean window", () => {
    // Three strikes, the last window having ended at tick 1000.
    const e = { ...entry(), hostile: true, hostileStrikes: 3, hostileUntil: 1000 };

    g.Game = { time: 1000 };
    clearRemotePlayerHostile(e);
    expect(e.hostileStrikes).toBe(3);

    g.Game = { time: 5100 };
    clearRemotePlayerHostile(e);
    expect(e.hostileStrikes).toBe(1);
    expect(e.hostileUntil).toBeLessThanOrEqual(5100);

    g.Game = { time: 7100 };
    clearRemotePlayerHostile(e);
    expect(e.hostileStrikes).toBe(0);
    expect(e.hostileUntil).toBeUndefined();
  });
});

describe("road upkeep under a blueprint", () => {
  function road(id: string, x: number, y: number, hits: number) {
    return { id, structureType: "road", pos: { x, y }, hits, hitsMax: 5000 } as unknown as AnyStructure;
  }

  function plannedRoom(structures: AnyStructure[], lanes: Array<"top" | "left"> = []): Room {
    const room = makeRoom({ level: 6, structures });
    // Blueprint roads at 10,10; the top exit road runs through 10,2.
    room.memory.blueprint = { v: 1, at: tick, anchor: { x: 10, y: 12 }, hub: { x: 10, y: 11 }, s: "R10,10,2", exits: { top: "10,2" }, lanes };
    return room;
  }

  beforeEach(() => {
    tick++;
    g.Game = { time: tick };
  });

  it("lets a road off the plan decay", () => {
    const room = plannedRoom([road("stray", 30, 30, 100)]);
    expect(repairFor(room)).toBeNull();
    expect(findTowerRepairTarget(room)).toBeNull();
  });

  it("keeps up the plan's roads and the exit roads in use", () => {
    // Repair targets are cached for the tick, so each room gets a tick of its own.
    const next = () => (g.Game = { time: ++tick });
    expect(repairFor(plannedRoom([road("kept", 10, 10, 100)]))?.id).toBe("kept");
    next();
    expect(repairFor(plannedRoom([road("lane", 10, 2, 100)], ["top"]))?.id).toBe("lane");
    next();
    expect(repairFor(plannedRoom([road("idle", 10, 2, 100)]))).toBeNull();
  });
});
