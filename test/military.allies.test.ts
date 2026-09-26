import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;

import { requestHelp, runAllies } from "../src/services/services.allies";

let segments: Record<number, string>;
beforeEach(() => {
  segments = {};
  g.Memory = { allies: ["Friend"] };
  g.RawMemory = {
    segments,
    setActiveSegments: () => {},
    setPublicSegments: () => {},
    setActiveForeignSegment: () => {},
    foreignSegment: undefined,
  };
});

function published(): unknown[] {
  return (JSON.parse(segments[90]) as { requests: unknown[] }).requests;
}

describe("ally request flush", () => {
  it("publishes a request made after runAllies on the next tick", () => {
    g.Game = { time: 10 };
    runAllies();
    requestHelp({ type: "defense", roomName: "W1N1", priority: 0.5 });

    g.Game = { time: 11 };
    runAllies();
    expect(published()).toEqual([{ type: "defense", roomName: "W1N1", priority: 0.5 }]);
  });

  it("drops requests older than one tick", () => {
    g.Game = { time: 20 };
    requestHelp({ type: "defense", roomName: "W1N1" });
    g.Game = { time: 22 };
    runAllies();
    expect(published()).toEqual([]);
  });
});
