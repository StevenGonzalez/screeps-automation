import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_MY_SPAWNS = 112;
g.FIND_SOURCES = 105;
g.FIND_MINERALS = 116;
g.FIND_STRUCTURES = 107;
g.EVENT_OBJECT_DESTROYED = 2;

import { processRoomMemory } from "../src/orchestrators/orchestrator.memory";

const at = (x: number, y: number) => ({
  x,
  y,
  getRangeTo: (o: { x: number; y: number }) => Math.max(Math.abs(o.x - x), Math.abs(o.y - y)),
});

describe("throne container scan", () => {
  beforeEach(() => {
    g.Game = { time: 5000 };
  });

  it("finds the throne's container while a creep stands on the only tile between them", () => {
    // Thornbarrow: the throne at 33,22 with one open tile beside it, 34,21,
    // and its container beyond at 35,20. An enchanter stood on that tile.
    const container = { id: "throne", structureType: "container", pos: at(35, 20) };
    const room = {
      name: "W47S7",
      memory: {} as RoomMemory,
      controller: {
        my: true,
        level: 4,
        pos: {
          ...at(33, 22),
          findClosestByPath: (objs: unknown[], opts?: FindPathOpts) => (opts?.ignoreCreeps ? objs[0] : null),
        },
      },
      getEventLog: () => "[]",
      find: (type: number) => (type === g.FIND_STRUCTURES ? [container] : []),
    };
    processRoomMemory(room as unknown as Room);
    expect(room.memory.upgradeContainerId).toBe("throne");
  });
});
