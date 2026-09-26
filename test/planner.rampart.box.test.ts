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

function makeRoom(level: number, planned: Record<string, string[]>): Room {
  return {
    name: "W1N1",
    controller: { level, pos: { x: 45, y: 45 } },
    memory: { castleAnchor: { x: 25, y: 25 }, plannedStructures: planned, plannedStructuresMeta: {} },
  } as unknown as Room;
}

describe("planDefensivePerimeter protected box", () => {
  beforeEach(() => {
    g.Game = { time: 1 };
    captured.length = 0;
  });

  it("covers the full RCL 8 stamp even at RCL 3", () => {
    planDefensivePerimeter(makeRoom(3, { stamp_spawn_1: ["25,25"] }));
    expect(captured[0][0]).toEqual({ x1: 19, y1: 19, x2: 31, y2: 31 });
  });

  it("does not stretch to the extractor or outlying links", () => {
    planDefensivePerimeter(
      makeRoom(8, {
        stamp_spawn_1: ["25,25"],
        extractor_m1: ["5,5"],
        link_source_s1: ["40,10"],
        link_controller: ["44,44"],
      })
    );
    expect(captured[0][0]).toEqual({ x1: 19, y1: 19, x2: 31, y2: 31 });
  });

  it("leaves make-up extensions outside the stamp out of the box", () => {
    planDefensivePerimeter(
      makeRoom(8, { stamp_spawn_1: ["25,25"], stamp_extensions: ["26,27", "36,25"] })
    );
    expect(captured[0][0]).toEqual({ x1: 19, y1: 19, x2: 31, y2: 31 });
  });
});
