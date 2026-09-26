import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.OK = 0;
g.FIND_MY_SPAWNS = 108;
g.FIND_HOSTILE_CREEPS = 103;

import { loop as strategyLoop } from "../src/orchestrators/orchestrator.strategy";
import { loop as pixelsLoop, inPixelRefill } from "../src/orchestrators/orchestrator.pixels";

let clock = 1000;

function room(name: string, spawns: number, level: number, memory: Record<string, unknown> = {}) {
  return {
    name,
    controller: { my: true, level },
    memory,
    find: (type: number) => (type === g.FIND_MY_SPAWNS ? Array(spawns).fill({}) : []),
  };
}

function setGame(rooms: ReturnType<typeof room>[], bucket: number) {
  clock += 5;
  const generated: number[] = [];
  g.Game = {
    time: clock,
    rooms: Object.fromEntries(rooms.map((r) => [r.name, r])),
    cpu: {
      bucket,
      limit: 20,
      generatePixel: () => {
        generated.push(clock);
        return 0;
      },
    },
  };
  return generated;
}

beforeEach(() => {
  g.Memory = {};
});

describe("strategy RECOVER triggers", () => {
  it("does not treat a colony bootstrapping its first spawn as crippled", () => {
    setGame([room("W1N1", 1, 8), room("W2N1", 0, 3)], 10_000);
    strategyLoop();
    expect((g.Memory as Memory).empire?.posture).toBe("EXPAND");
  });

  it("does treat a room that lost its spawn as crippled", () => {
    setGame([room("W1N1", 1, 8), room("W2N1", 0, 3, { hadSpawn: true })], 10_000);
    strategyLoop();
    expect((g.Memory as Memory).empire?.posture).toBe("RECOVER");
  });

  it("ignores the active expansion target even if it once had a spawn", () => {
    setGame([room("W1N1", 1, 8), room("W2N1", 0, 3, { hadSpawn: true })], 10_000);
    (g.Memory as Memory).expansion = { roomName: "W2N1" } as ExpansionData;
    strategyLoop();
    expect((g.Memory as Memory).empire?.posture).toBe("EXPAND");
  });

  it("does not enter RECOVER on a bucket our own pixel drained while it refills", () => {
    setGame([room("W1N1", 1, 8)], 10_000);
    (g.Memory as Memory).lastPixelTick = clock + 5 - 500;
    setGame([room("W1N1", 1, 8)], 2_500);
    expect(inPixelRefill()).toBe(true);
    strategyLoop();
    expect((g.Memory as Memory).empire?.posture).toBe("EXPAND");
  });

  it("still enters RECOVER on a low bucket with no recent pixel, naming the live threshold", () => {
    setGame([room("W1N1", 1, 8)], 2_500);
    strategyLoop();
    expect((g.Memory as Memory).empire?.posture).toBe("RECOVER");
    expect((g.Memory as Memory).empire?.reason).toContain("below 3000");
    setGame([room("W1N1", 1, 8)], 4_000);
    strategyLoop();
    expect((g.Memory as Memory).empire?.reason).toContain("below 6000");
  });

  it("ends the refill for good once the bucket falls back from its peak", () => {
    setGame([room("W1N1", 1, 8)], 2_000);
    (g.Memory as Memory).lastPixelTick = clock - 1000;
    expect(inPixelRefill()).toBe(true);
    setGame([room("W1N1", 1, 8)], 1_700);
    expect(inPixelRefill()).toBe(false);
    setGame([room("W1N1", 1, 8)], 2_500);
    expect(inPixelRefill()).toBe(false);
  });
});

describe("pixel generation", () => {
  it("records the tick it generates a pixel", () => {
    setGame([room("W1N1", 1, 8)], 10_000);
    pixelsLoop();
    expect((g.Memory as Memory).lastPixelTick).toBe(clock);
  });

  it("holds off at war or while turtling", () => {
    const generated = setGame([room("W1N1", 1, 8)], 10_000);
    (g.Memory as Memory).empire = { posture: "WAR", updatedAt: 0, reason: "" };
    pixelsLoop();
    (g.Memory as Memory).empire = { posture: "TURTLE", updatedAt: 0, reason: "" };
    pixelsLoop();
    expect(generated).toEqual([]);
  });
});
