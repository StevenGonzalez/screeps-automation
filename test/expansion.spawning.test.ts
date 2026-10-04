import { describe, it, expect } from "vitest";

const g = globalThis as Record<string, unknown>;
g.OK = 0;
g.CLAIM = "claim";
g.MOVE = "move";
g.BODYPART_COST = { claim: 600, move: 50 };
g.RoomPosition = class {
  constructor(public x: number, public y: number, public roomName: string) {}
};

const { shouldSpawnSettler, spawnConqueror } = await import("../src/orchestrators/orchestrator.spawning.military");

describe("settler spawning", () => {
  it("waits for a full settler while the extensions still fill, rather than sending a runt", () => {
    const room = { name: "W1N1", energyAvailable: 600, energyCapacityAvailable: 2300, memory: {} } as unknown as Room;
    g.Memory = {
      creeps: {},
      rooms: { W1N1: room.memory },
      expansion: { roomName: "W2N1", homeRoom: "W1N1", phase: "bootstrapping", startedAt: 0 },
    };
    g.Game = { time: 100, creeps: {}, rooms: { W1N1: room } };
    expect(shouldSpawnSettler(room)).toBe(false);

    (room as { energyAvailable: number }).energyAvailable = 2300;
    g.Game = { time: 110, creeps: {}, rooms: { W1N1: room } };
    expect(shouldSpawnSettler(room)).toBe(true);
  });
});

describe("conqueror spawning", () => {
  it("writes the conqueror's departure into the chronicle", () => {
    const room = { name: "W1N1", energyAvailable: 800, energyCapacityAvailable: 2300, memory: {} } as unknown as Room;
    g.Memory = {
      creeps: {},
      rooms: { W1N1: room.memory },
      expansion: { roomName: "W2N1", homeRoom: "W1N1", phase: "claiming", startedAt: 0 },
    };
    g.Game = { time: 200, creeps: {}, rooms: { W1N1: room } };
    const spawn = { spawnCreep: () => 0 } as unknown as StructureSpawn;
    expect(spawnConqueror(room, spawn)).toBe(true);
    const chronicle = (g.Memory as { chronicle?: Array<{ text: string }> }).chronicle ?? [];
    expect(chronicle.at(-1)?.text).toMatch(/^A conqueror rides out from .+ for the .+\.$/);
  });
});
