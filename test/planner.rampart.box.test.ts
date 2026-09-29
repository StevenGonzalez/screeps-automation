import { describe, it, expect, vi, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.RoomPosition = class {
  constructor(public x: number, public y: number, public roomName: string) {}
};

const captured: Array<Array<{ x1: number; y1: number; x2: number; y2: number }>> = [];
vi.mock("../src/services/services.mincut", () => ({
  getCutTiles: (_room: string, rects: Array<{ x1: number; y1: number; x2: number; y2: number }>) => {
    captured.push(rects);
    return [{ x: 1, y: 1 }];
  },
}));

import { planDefensivePerimeter } from "../src/planning/planner.rampart";
import { encodeBlueprint, BlueprintEntry } from "../src/planning/planner.blueprint";

let planTick = 0;
function makeRoom(level: number, entries: BlueprintEntry[]): Room {
  const bp = { anchor: { x: 25, y: 25 }, hub: { x: 25, y: 27 }, entries, exits: {} };
  return {
    name: "W1N1",
    controller: { level, pos: { x: 45, y: 45 } },
    memory: {
      castleAnchor: { x: 25, y: 25 },
      plannedStructures: {},
      plannedStructuresMeta: {},
      // A new plan tick per room, so the decoded-plan cache never hands back a stale one.
      blueprint: encodeBlueprint(bp, ++planTick),
    },
  } as unknown as Room;
}

const castle: BlueprintEntry[] = [
  { type: "spawn", x: 25, y: 25, rcl: 1 },
  { type: "extension", x: 20, y: 22, rcl: 2 },
  { type: "tower", x: 30, y: 31, rcl: 8 },
  { type: "link", x: 26, y: 28, rcl: 5, tag: "storage" },
];

describe("planDefensivePerimeter protected box", () => {
  beforeEach(() => {
    g.Game = { time: 1 };
    captured.length = 0;
  });

  it("covers the whole RCL 8 castle even at RCL 3", () => {
    planDefensivePerimeter(makeRoom(3, castle));
    expect(captured[0][0]).toEqual({ x1: 20, y1: 22, x2: 30, y2: 31 });
  });

  it("does not stretch to the outposts or along the roads", () => {
    planDefensivePerimeter(
      makeRoom(8, [
        ...castle,
        { type: "extractor", x: 5, y: 5, rcl: 6, tag: "mineral:m1" },
        { type: "container", x: 6, y: 5, rcl: 6, tag: "mineral:m1" },
        { type: "link", x: 40, y: 10, rcl: 5, tag: "source:s1" },
        { type: "link", x: 44, y: 44, rcl: 5, tag: "controller" },
        { type: "road", x: 40, y: 11, rcl: 2 },
      ])
    );
    expect(captured[0][0]).toEqual({ x1: 20, y1: 22, x2: 30, y2: 31 });
  });

  it("waits for a blueprint", () => {
    const room = makeRoom(8, castle);
    delete room.memory.blueprint;
    planDefensivePerimeter(room);
    expect(captured).toHaveLength(0);
  });
});
