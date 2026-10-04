import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.ERR_NO_PATH = -2;
g.FIND_MINERALS = 116;
g.FIND_HOSTILE_CREEPS = 103;
g.TERRAIN_MASK_SWAMP = 2;
g.RESOURCE_CATALYST = "X";
g.FIND_MY_SPAWNS = 112;

import { rankExpansionCandidates, loop } from "../src/orchestrators/orchestrator.expansion";
import { recordCpu } from "../src/services/services.profiler";

const HOME = "W1N1";
const ME = "Me";

let routes: Record<string, unknown>;

function remote(roomName: string): RemoteRoomData {
  return { roomName, sources: [{ sourceId: "a" as Id<Source> }, { sourceId: "b" as Id<Source> }], lastSeen: 0, hostile: false };
}

beforeEach(() => {
  routes = {};
  const home = {
    name: HOME,
    controller: { my: true, level: 6, owner: { username: ME } },
    storage: { store: { energy: 100_000 } },
    memory: { remoteRooms: [remote("W1N2"), remote("W2N1")] },
    find: () => [],
  };
  g.Game = {
    time: 50_000,
    creeps: {},
    rooms: { [HOME]: home },
    gcl: { level: 3 },
    cpu: { bucket: 10_000 },
    map: {
      describeExits: () => ({}),
      getRoomLinearDistance: () => 1,
      getRoomTerrain: () => undefined,
      findRoute: (_from: string, to: string) => routes[to] ?? [{ room: to }],
    },
  };
  g.Memory = { rooms: { [HOME]: home.memory }, allies: [] };
});

const ranked = () => rankExpansionCandidates().map((c) => c.room).sort();

describe("rankExpansionCandidates", () => {
  it("offers reachable remotes", () => {
    expect(ranked()).toEqual(["W1N2", "W2N1"]);
  });

  it("skips rooms with no route or too long a route", () => {
    routes.W1N2 = -2;
    routes.W2N1 = new Array(11).fill({ room: "x" });
    expect(ranked()).toEqual([]);
  });

  it("skips a remote whose intel shows another player's reservation", () => {
    (g.Memory as any).intel = { W1N2: { reservedBy: "Stranger", threatLevel: 0 } };
    expect(ranked()).toEqual(["W2N1"]);
  });

  it("skips rooms whose claim recently failed, then retries after the cooldown", () => {
    (g.Memory as any).claimFailures = { W1N2: 60_000, W2N1: 40_000 };
    expect(ranked()).toEqual(["W2N1"]);
    // The expired entry is dropped.
    expect((g.Memory as any).claimFailures).toEqual({ W1N2: 60_000 });
  });
});

describe("claim timeout", () => {
  it("records a claim failure instead of disabling the remote", () => {
    (g.Memory as any).expansion = {
      roomName: "W1N2",
      homeRoom: HOME,
      phase: "claiming",
      startedAt: 0,
    };
    loop();
    expect((g.Memory as any).expansion?.roomName).not.toBe("W1N2");
    expect((g.Memory as any).claimFailures.W1N2).toBeGreaterThan(50_000);
    const rec = (g.Memory as any).rooms[HOME].remoteRooms.find((r: RemoteRoomData) => r.roomName === "W1N2");
    expect(rec.hostile).toBe(false);
  });
});

describe("bootstrap timeout", () => {
  function keep(spawns: unknown[]) {
    const unclaim = vi.fn();
    (g.Game as any).time = 50_001;
    (g.Game as any).rooms.W1N2 = {
      name: "W1N2",
      controller: { my: true, level: 2, unclaim },
      memory: {},
      find: (type: number) => (type === 112 ? spawns : []),
    };
    (g.Memory as any).expansion = {
      roomName: "W1N2",
      homeRoom: HOME,
      phase: "bootstrapping",
      startedAt: 0,
      bootstrapStartedAt: 40_000,
    };
    return unclaim;
  }
  const lastLine = () => ((g.Memory as any).chronicle ?? []).at(-1)?.text as string;

  it("gives up a keep that never raised its spawn", () => {
    const unclaim = keep([]);
    loop();
    expect(unclaim).toHaveBeenCalled();
    expect((g.Memory as any).expansion).toBeUndefined();
    expect(lastLine()).toMatch(/The keep is abandoned\.$/);
  });

  it("leaves a keep with a spawn of its own to grow by itself, and does not call it abandoned", () => {
    const unclaim = keep([{ id: "s1" }]);
    loop();
    expect(unclaim).not.toHaveBeenCalled();
    expect((g.Memory as any).expansion).toBeUndefined();
    expect(lastLine()).not.toMatch(/abandoned/);
    expect(lastLine()).toMatch(/must stand on its own now\.$/);
  });
});

describe("saving for a keep", () => {
  const home = () => (g.Game as any).rooms[HOME];
  const lines = () => (((g.Memory as any).chronicle ?? []) as Array<{ text: string }>).map((l) => l.text).join("\n");

  it("queues the best keep while the castle is short of gold, and saves for it", () => {
    home().storage.store.energy = 20_000;
    loop();
    const queue = (g.Memory as any).expansionQueue as QueuedExpansion[];
    expect(queue.map((q) => q.roomName).sort()).toEqual(["W1N2", "W2N1"]);
    expect((g.Memory as any).expansion).toBeUndefined();
    expect((g.Memory as any).expansionSavings).toEqual({ room: HOME, target: queue[0].roomName });
    expect(lines()).toMatch(/fills its coffers to found a keep in the /);

    // Waiting on the gold does not shuffle the queue the castle is saving toward.
    const head = queue[0].roomName;
    (g.Game as any).time = 50_001;
    loop();
    expect((g.Memory as any).expansionQueue[0].roomName).toBe(head);
  });

  it("starts the claim once the treasury reaches the gate", () => {
    home().storage.store.energy = 40_000;
    loop();
    expect((g.Memory as any).expansion).toMatchObject({ homeRoom: HOME, phase: "claiming" });
    // The castle now saves toward the keep after this one.
    const next = (g.Memory as any).expansionQueue[0].roomName;
    expect((g.Memory as any).expansionSavings).toEqual({ room: HOME, target: next });
    expect(lines()).toMatch(/fills its coffers to found the next keep, in the /);
  });

  it("neither queues nor saves when auto-expansion is switched off", () => {
    (g.Memory as any).autoExpand = false;
    home().storage.store.energy = 20_000;
    loop();
    expect((g.Memory as any).expansionQueue).toBeUndefined();
    expect((g.Memory as any).expansionSavings).toBeUndefined();
  });
});

// Last in the file: the profiler's averages live on the module and persist.
describe("CPU headroom", () => {
  it("queues no keep while the empire already uses most of its CPU", () => {
    recordCpu("creeps", 15);
    (g.Game as any).cpu.limit = 20;
    loop();
    expect((g.Memory as any).expansionQueue).toBeUndefined();
  });
});
