import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_MY_SPAWNS = 112;
g.FIND_SOURCES = 105;
g.FIND_MINERALS = 116;
g.FIND_STRUCTURES = 107;
g.FIND_MY_STRUCTURES = 108;
g.TERRAIN_MASK_WALL = 1;
g.STRUCTURE_CONTROLLER = "controller";
g.CONTROLLER_STRUCTURES = {
  tower: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 1, 5: 2, 6: 2, 7: 3, 8: 6 },
  extension: { 0: 0, 1: 0, 2: 5, 3: 10, 4: 20, 5: 30, 6: 40, 7: 50, 8: 60 },
};
g.RoomPosition = class {
  constructor(public x: number, public y: number, public roomName: string) {}
};

import { applyCastleStamp } from "../src/planning/planner.room";
import { MERCHANT_RING_EXTENSION_OFFSETS } from "../src/planning/planner.stamp";

const ANCHOR = { x: 25, y: 25 };

function makeRoom(opts: {
  level: number;
  planned?: Record<string, string[]>;
  wall?: (x: number, y: number) => boolean;
  sources?: Array<{ x: number; y: number }>;
  structures?: Array<{ structureType: string; pos: { x: number; y: number } }>;
}): Room {
  const spawn = { pos: { x: ANCHOR.x, y: ANCHOR.y } };
  return {
    name: "W1N1",
    controller: { level: opts.level, pos: { x: 5, y: 45 } },
    memory: { castleAnchor: { ...ANCHOR }, plannedStructures: opts.planned ?? {} },
    getTerrain: () => ({ get: (x: number, y: number) => (opts.wall?.(x, y) ? 1 : 0) }),
    find: (type: number) => {
      if (type === g.FIND_MY_SPAWNS) return [spawn];
      if (type === g.FIND_SOURCES) return (opts.sources ?? []).map((p) => ({ pos: p }));
      if (type === g.FIND_STRUCTURES) return opts.structures ?? [];
      return [];
    },
  } as unknown as Room;
}

function planned(room: Room): Record<string, string[]> {
  return room.memory.plannedStructures as Record<string, string[]>;
}

describe("applyCastleStamp", () => {
  beforeEach(() => {
    g.Game = { time: 1 };
  });

  it("counts towers planned on earlier runs toward the RCL cap", () => {
    const room = makeRoom({
      level: 5,
      planned: { "stamp_tower_-4_-4": [`${ANCHOR.x - 4},${ANCHOR.y - 4}`] },
    });

    applyCastleStamp(room);

    const towers = Object.keys(planned(room))
      .filter((k) => k.startsWith("stamp_tower_"))
      .reduce((n, k) => n + planned(room)[k].length, 0);
    expect(towers).toBe(2);
  });

  it("does not plan a critical structure on top of a source", () => {
    const storageTile = { x: ANCHOR.x, y: ANCHOR.y + 2 };
    const room = makeRoom({ level: 4, sources: [storageTile] });

    applyCastleStamp(room);

    const storage = planned(room).stamp_storage;
    expect(storage).toHaveLength(1);
    expect(storage[0]).not.toBe(`${storageTile.x},${storageTile.y}`);
  });

  it("makes up extensions lost to walls from outside the stamp", () => {
    expect(MERCHANT_RING_EXTENSION_OFFSETS.length).toBe(60);
    // Wall off the east half of the ring at radius 2 and 4.
    const wall = (x: number, y: number) => {
      const dx = x - ANCHOR.x;
      const dy = y - ANCHOR.y;
      const r = Math.max(Math.abs(dx), Math.abs(dy));
      return dx > 0 && (r === 2 || r === 4);
    };
    const room = makeRoom({ level: 8, wall });

    applyCastleStamp(room);

    const ext = planned(room).stamp_extensions;
    expect(ext).toHaveLength(60);
    expect(new Set(ext).size).toBe(60);
    for (const p of ext) {
      const [x, y] = p.split(",").map(Number);
      expect(wall(x, y)).toBe(false);
    }
  });

  it("keeps fill extensions off existing roads and away from walls", () => {
    const wall = (x: number, y: number) => {
      const dx = x - ANCHOR.x;
      const dy = y - ANCHOR.y;
      const r = Math.max(Math.abs(dx), Math.abs(dy));
      return dx > 0 && (r === 2 || r === 4);
    };
    const road = { structureType: "road", pos: { x: ANCHOR.x - 7, y: ANCHOR.y - 1 } };
    const room = makeRoom({ level: 8, wall, structures: [road] });

    applyCastleStamp(room);

    const ext = planned(room).stamp_extensions;
    expect(ext).not.toContain(`${road.pos.x},${road.pos.y}`);
    for (const p of ext) {
      const [x, y] = p.split(",").map(Number);
      if (Math.max(Math.abs(x - ANCHOR.x), Math.abs(y - ANCHOR.y)) <= 6) continue;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) expect(wall(x + dx, y + dy)).toBe(false);
      }
    }
  });
});
