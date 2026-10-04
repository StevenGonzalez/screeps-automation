import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_HOSTILE_CREEPS = 103;
g.ATTACK_POWER = 30;
g.RANGED_ATTACK_POWER = 10;
g.DISMANTLE_POWER = 50;
g.HEAL_POWER = 12;
g.FIND_SOURCES = 105;
g.EVENT_OBJECT_DESTROYED = 1;
g.FIND_HOSTILE_STRUCTURES = 109;
g.STRUCTURE_INVADER_CORE = "invaderCore";

vi.mock("../src/orchestrators/orchestrator.military", () => ({
  recordRoomIntel: vi.fn(),
}));

import { runScout } from "../src/roles/role.scout";
import {
  pruneRemoteRooms,
  applyRemoteControllerStatus,
  collectRoomMemoryGarbage,
  refreshVisibleRemoteRooms,
  discoverAdjacentRooms,
} from "../src/orchestrators/orchestrator.memory";
import { recordRoomIntel } from "../src/orchestrators/orchestrator.military";

const HOME = "W1N1";
const ME = "Me";
// HOME's neighbours; W3N1 is two rooms away.
const EXITS: Record<string, Record<string, string>> = {
  [HOME]: { "1": "W1N2", "3": "W0N1", "7": "W2N1" },
};

function scoutIn(roomName: string, opts: { controller?: unknown; hostiles?: unknown[] } = {}) {
  const room = {
    name: roomName,
    controller: opts.controller,
    find: (type: number) =>
      type === g.FIND_HOSTILE_CREEPS
        ? opts.hostiles ?? []
        : type === g.FIND_SOURCES
          ? [{ id: `${roomName}-src` }]
          : [],
  };
  return {
    id: "scout1",
    owner: { username: ME },
    room,
    memory: { role: "scout", homeRoom: HOME, targetRoom: roomName },
  } as unknown as Creep;
}

function body(...types: string[]) {
  return types.map((type) => ({ type, hits: 100 }));
}

let homeMem: RoomMemory;

beforeEach(() => {
  homeMem = { remoteRooms: [], pendingScoutRooms: [] } as unknown as RoomMemory;
  g.Game = {
    time: 5000,
    creeps: {},
    rooms: {},
    map: { describeExits: (rn: string) => EXITS[rn] ?? {} },
  };
  g.Memory = { rooms: { [HOME]: homeMem }, allies: ["Pal"] };
  vi.mocked(recordRoomIntel).mockClear();
});

describe("scout survey", () => {
  it("records intel only for a deep (non-adjacent) room", () => {
    homeMem.pendingScoutRooms = ["W3N1"];
    const creep = scoutIn("W3N1");
    runScout(creep);
    expect(recordRoomIntel).toHaveBeenCalled();
    expect(homeMem.remoteRooms).toEqual([]);
    expect(homeMem.pendingScoutRooms).toEqual([]);
    expect(creep.memory.targetRoom).toBeUndefined();
  });

  it("creates a remote for an adjacent room", () => {
    runScout(scoutIn("W1N2"));
    expect(homeMem.remoteRooms).toHaveLength(1);
    expect(homeMem.remoteRooms![0]).toMatchObject({
      roomName: "W1N2",
      hostile: false,
      sources: [{ sourceId: "W1N2-src" }],
    });
  });

  it("does not mark a remote hostile over an unarmed or allied creep", () => {
    const hostiles = [
      { owner: { username: "Stranger" }, body: body("move") },
      { owner: { username: "Pal" }, body: body("attack", "move") },
    ];
    runScout(scoutIn("W1N2", { hostiles }));
    expect(homeMem.remoteRooms![0].hostile).toBe(false);
  });

  it("does not mark a remote hostile over another player's workers", () => {
    const hostiles = [{ owner: { username: "Stranger" }, body: body("work", "carry", "move") }];
    runScout(scoutIn("W1N2", { hostiles }));
    expect(homeMem.remoteRooms![0].hostile).toBe(false);
  });

  it("marks a remote hostile over an armed player creep", () => {
    const hostiles = [{ owner: { username: "Stranger" }, body: body("attack", "move") }];
    runScout(scoutIn("W1N2", { hostiles }));
    expect(homeMem.remoteRooms![0].hostile).toBe(true);
  });

  it("marks a room owned by another player hostile for a long time", () => {
    runScout(scoutIn("W1N2", { controller: { my: false, owner: { username: "Stranger" } } }));
    const entry = homeMem.remoteRooms![0];
    expect(entry.hostile).toBe(true);
    expect(entry.hostileUntil).toBeGreaterThan(5000 + 10_000);
  });

  it("drops the remote entry for a room we now own", () => {
    homeMem.remoteRooms = [{ roomName: "W1N2", sources: [], lastSeen: 0, hostile: false }];
    runScout(scoutIn("W1N2", { controller: { my: true, owner: { username: ME } } }));
    expect(homeMem.remoteRooms).toEqual([]);
  });
});

describe("applyRemoteControllerStatus", () => {
  const entry = () => ({ roomName: "W1N2", sources: [], lastSeen: 0, hostile: false }) as RemoteRoomData;

  it("flags a player reservation", () => {
    const e = entry();
    expect(applyRemoteControllerStatus(e, { reservation: { username: "Stranger" } } as any, ME)).toBe(true);
    expect(e.hostile).toBe(true);
  });

  it("leaves our own and Invader reservations alone", () => {
    const e = entry();
    expect(applyRemoteControllerStatus(e, { reservation: { username: ME } } as any, ME)).toBe(false);
    expect(applyRemoteControllerStatus(e, { reservation: { username: "Invader" } } as any, ME)).toBe(false);
    expect(e.hostile).toBe(false);
  });
});

describe("refreshVisibleRemoteRooms", () => {
  it("flags a remote holding an Invader core so a knight gets sent", () => {
    const entry = { roomName: "W1N2", sources: [], lastSeen: 0, hostile: false } as RemoteRoomData;
    const core = { structureType: "invaderCore" };
    (g.Game as any).time = 5000;
    (g.Game as any).rooms = {
      W1N2: {
        controller: { reservation: { username: "Invader" } },
        find: (type: number, opts?: { filter: (s: unknown) => boolean }) =>
          type === g.FIND_HOSTILE_STRUCTURES ? [core].filter(opts?.filter ?? (() => true)) : [],
      },
    };
    const room = { name: HOME, controller: { owner: { username: ME } }, memory: { remoteRooms: [entry] } };
    refreshVisibleRemoteRooms(room as unknown as Room);
    expect(entry.invaderUntil).toBeGreaterThan(5000);
    expect(entry.hostile).toBe(false);
  });

  // A hostile remote drops out of the ones this home works, and knights only
  // go to those, so an Invader creep must not make the room hostile.
  it("calls a knight for Invader creeps without marking the remote hostile", () => {
    const entry = {
      roomName: "W1N2",
      sources: [],
      lastSeen: 0,
      hostile: true,
      hostileUntil: 6000,
      hostileStrikes: 1,
    } as RemoteRoomData;
    const invader = { owner: { username: "Invader" }, body: body("work", "move") };
    // A tick apart from the test above, so its cached threat is not read back.
    (g.Game as any).time = 5001;
    (g.Game as any).rooms = {
      W1N2: {
        name: "W1N2",
        controller: { reservation: { username: ME } },
        find: (type: number) => (type === g.FIND_HOSTILE_CREEPS ? [invader] : []),
      },
    };
    const room = { name: HOME, controller: { owner: { username: ME } }, memory: { remoteRooms: [entry] } };
    refreshVisibleRemoteRooms(room as unknown as Room);
    expect(entry.invaderUntil).toBeGreaterThan(5000);
    expect(entry.hostile).toBe(false);
  });

  describe("with another player's creeps in the remote", () => {
    let tick = 6000;

    function refreshAmong(...parts: string[]) {
      // A fresh tick, so no threat cached by another test is read back.
      (g.Game as any).time = ++tick;
      const entry = { roomName: "W1N2", sources: [], lastSeen: 0, hostile: false } as RemoteRoomData;
      const stranger = { owner: { username: "Stranger" }, body: body(...parts) };
      (g.Game as any).rooms = {
        W1N2: {
          name: "W1N2",
          controller: { reservation: { username: ME } },
          find: (type: number) => (type === g.FIND_HOSTILE_CREEPS ? [stranger] : []),
        },
      };
      const room = { name: HOME, controller: { owner: { username: ME } }, memory: { remoteRooms: [entry] } };
      refreshVisibleRemoteRooms(room as unknown as Room);
      return entry;
    }

    it("does not mark it hostile over workers passing through", () => {
      expect(refreshAmong("work", "work", "carry", "move").hostile).toBe(false);
    });

    it("marks it hostile over an armed creep", () => {
      const entry = refreshAmong("attack", "move");
      expect(entry.hostile).toBe(true);
      expect(entry.rival).toBe("Stranger");
    });

    it("tells the chronicle once the rival's men have left", () => {
      const entry = refreshAmong("attack", "move");
      (g.Game as any).rooms.W1N2.find = () => [];
      (g.Game as any).time = tick += 5000;
      const room = { name: HOME, controller: { owner: { username: ME } }, memory: { remoteRooms: [entry] } };
      refreshVisibleRemoteRooms(room as unknown as Room);
      refreshVisibleRemoteRooms(room as unknown as Room);
      const lines = ((g.Memory as any).chronicle as { text: string }[]).map((e) => e.text);
      expect(entry.hostile).toBe(false);
      expect(lines.filter((t) => / have left the /.test(t))).toHaveLength(1);
      expect(lines[lines.length - 1]).toMatch(/The vendors take to the road again\.$/);
    });
  });
});

describe("discoverAdjacentRooms", () => {
  it("scouts every adjacent room, not just the first three", () => {
    // Profit ranking and the spawn budget decide how many are worked, so a
    // fourth neighbour is still worth knowing about.
    const home = "W2N2";
    (g.Game as any).map.describeExits = () => ({ "1": "W2N3", "3": "W3N2", "5": "W2N1", "7": "W1N2" });
    const remotes = ["W2N3", "W3N2", "W2N1"].map(
      (roomName) =>
        ({ roomName, sources: [{ sourceId: `${roomName}-src` }], lastSeen: 5000, hostile: false }) as RemoteRoomData
    );
    const room = { name: home, memory: { remoteRooms: remotes, pendingScoutRooms: [] } } as unknown as Room;
    discoverAdjacentRooms(room);
    expect(room.memory.pendingScoutRooms).toEqual(["W1N2"]);
  });
});

describe("pruneRemoteRooms", () => {
  it("removes non-adjacent and owned remotes", () => {
    const remotes = ["W1N2", "W0N1", "W3N1"].map(
      (roomName) => ({ roomName, sources: [], lastSeen: 0, hostile: false }) as RemoteRoomData
    );
    (g.Game as any).rooms = { W0N1: { controller: { my: true } } };
    const room = { name: HOME, memory: { remoteRooms: remotes } } as unknown as Room;
    pruneRemoteRooms(room);
    expect(room.memory.remoteRooms!.map((r) => r.roomName)).toEqual(["W1N2"]);
  });
});

describe("collectRoomMemoryGarbage", () => {
  it("keeps referenced rooms and drops strays", () => {
    homeMem.remoteRooms = [{ roomName: "W1N2", sources: [], lastSeen: 0, hostile: false }];
    (g.Game as any).rooms = { [HOME]: { controller: { my: true } } };
    const mem = g.Memory as any;
    mem.rooms.W1N2 = {};
    mem.rooms.W5N5 = {};
    mem.rooms.W6N6 = {};
    mem.rooms.W7N7 = { plannedStructures: {} };
    mem.skOps = [{ roomName: "W5N5" }];
    mem.rooms.W9N9 = {};
    collectRoomMemoryGarbage();
    expect(Object.keys(mem.rooms).sort()).toEqual([HOME, "W1N2", "W5N5", "W7N7"].sort());
  });
});
