import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.ERR_NO_PATH = -2;
g.FIND_MINERALS = 116;
g.FIND_HOSTILE_CREEPS = 103;
g.TERRAIN_MASK_SWAMP = 2;
g.RESOURCE_CATALYST = "X";

import { rankExpansionCandidates, loop } from "../src/orchestrators/orchestrator.expansion";

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
