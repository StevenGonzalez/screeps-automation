import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_MY_SPAWNS = 108;
g.OK = 0;

import {
  getActiveRemoteRooms,
  buildRemoteHaulerBody,
  planRemoteSource,
} from "../src/orchestrators/orchestrator.spawning";
import { shouldSpawnRemoteHauler, spawnRemoteHauler } from "../src/orchestrators/orchestrator.spawning.remote";
import { ROLE_REMOTE_HAULER, ROLE_REMOTE_MINER, ROLE_UPGRADER } from "../src/config/config.roles";

const HOME = "W5N5";
let clock = 50_000;

function remote(roomName: string, pathLengths: number[]): RemoteRoomData {
  return {
    roomName,
    lastSeen: 0,
    hostile: false,
    sources: pathLengths.map(
      (pathLength, i) =>
        // A fresh cached path, so no search is attempted (nothing is visible).
        ({ sourceId: `${roomName}-s${i}`, pathLength, pathKey: "k", pathTick: clock }) as unknown as RemoteSourceData
    ),
  };
}

function creep(role: string, parts: number, memory: Partial<CreepMemory> = {}): Creep {
  return {
    name: `${role}${Math.random()}`,
    room: { name: HOME },
    body: Array(parts).fill({ type: "work", hits: 100 }),
    memory: { role, homeRoom: HOME, ...memory },
  } as unknown as Creep;
}

function home(opts: {
  remotes: RemoteRoomData[];
  spawns?: number;
  creeps?: Creep[];
  bucket?: number;
  rcl?: number;
  storage?: boolean;
}): Room {
  const room = {
    name: HOME,
    controller: { my: true, level: opts.rcl ?? 4, owner: { username: "Me" } },
    energyAvailable: 1300,
    energyCapacityAvailable: 1300,
    storage: opts.storage ? { id: "storage1" } : undefined,
    memory: { remoteRooms: opts.remotes } as unknown as RoomMemory,
    find: (type: number) =>
      type === g.FIND_MY_SPAWNS
        ? Array.from({ length: opts.spawns ?? 1 }, (_, i) => ({ id: `spawn${i}` }))
        : [],
  } as unknown as Room;
  const byName: Record<string, Creep> = {};
  for (const c of opts.creeps ?? []) byName[c.name] = c;
  g.Game = {
    time: clock,
    creeps: byName,
    rooms: { [HOME]: room },
    cpu: { bucket: opts.bucket ?? 10_000 },
    map: { getRoomLinearDistance: () => 1 },
    getObjectById: () => null,
  };
  g.Memory = { creeps: {}, rooms: { [HOME]: room.memory }, intel: {} };
  return room;
}

const sourceIds = (rooms: RemoteRoomData[]) => rooms.flatMap((r) => r.sources.map((s) => s.sourceId));

beforeEach(() => {
  clock += 1000;
});

describe("remote source ranking", () => {
  it("puts the nearer remote first whatever the list order", () => {
    const room = home({ remotes: [remote("W6N5", [120]), remote("W4N5", [30])], spawns: 2 });
    expect(getActiveRemoteRooms(room).map((r) => r.roomName)).toEqual(["W4N5", "W6N5"]);
  });

  it("earns more from a near source than a far one", () => {
    const room = home({ remotes: [] });
    const near = planRemoteSource(room, remote("W4N5", [30]), remote("W4N5", [30]).sources[0]);
    const far = planRemoteSource(room, remote("W6N5", [120]), remote("W6N5", [120]).sources[0]);
    expect(near.profit).toBeGreaterThan(far.profit);
    expect(near.spawnTime).toBeLessThan(far.spawnTime);
  });

  it("leaves out a source that costs more than it brings in", () => {
    const room = home({ remotes: [remote("W6N5", [999])], spawns: 3 });
    expect(getActiveRemoteRooms(room)).toEqual([]);
  });

  it("works only the sources the home's spawn time covers, best first", () => {
    const remotes = [remote("W6N5", [120]), remote("W4N5", [30])];
    // One spawn, already mostly busy keeping the home's own creeps alive.
    const busy = Array.from({ length: 20 }, () => creep(ROLE_UPGRADER, 16));
    const room = home({ remotes, creeps: busy });
    expect(sourceIds(getActiveRemoteRooms(room))).toEqual(["W4N5-s0"]);
  });

  it("takes on more remotes as the home adds spawns", () => {
    const remotes = [remote("W6N5", [60, 70]), remote("W4N5", [30, 40]), remote("W5N6", [50])];
    const busy = Array.from({ length: 18 }, () => creep(ROLE_UPGRADER, 16));
    const one = sourceIds(getActiveRemoteRooms(home({ remotes, spawns: 1, creeps: busy })));
    clock += 1;
    const three = sourceIds(getActiveRemoteRooms(home({ remotes, spawns: 3, creeps: busy })));
    expect(one.length).toBeGreaterThan(0);
    expect(one.length).toBeLessThan(5);
    expect(three).toHaveLength(5);
    expect(three.slice(0, one.length)).toEqual(one);
  });

  it("never works more than six sources, however much spawn time there is", () => {
    const remotes = ["W4N5", "W6N5", "W5N4", "W5N6"].map((rn) => remote(rn, [20, 25]));
    const room = home({ remotes, spawns: 3 });
    expect(sourceIds(getActiveRemoteRooms(room))).toHaveLength(6);
  });

  it("adds no new remote on a low CPU bucket but keeps the ones already mined", () => {
    const remotes = [remote("W6N5", [60]), remote("W4N5", [30])];
    const miner = creep(ROLE_REMOTE_MINER, 9, { targetRoom: "W6N5", remoteSourceId: "W6N5-s0" as Id<Source> });
    const room = home({ remotes, spawns: 3, creeps: [miner], bucket: 1000 });
    expect(sourceIds(getActiveRemoteRooms(room))).toEqual(["W6N5-s0"]);
  });
});

describe("remote hauler body", () => {
  const count = (body: BodyPartConstant[], type: string) => body.filter((p) => p === type).length;

  it("adds one WORK for road upkeep only when asked", () => {
    expect(count(buildRemoteHaulerBody(1300), "work")).toBe(0);
    const withWork = buildRemoteHaulerBody(1300, true);
    expect(count(withWork, "work")).toBe(1);
    // Still one MOVE per other part, so it keeps full speed off-road.
    expect(count(withWork, "move")).toBe(withWork.length / 2);
  });

  it("stays within 50 parts at any energy", () => {
    expect(buildRemoteHaulerBody(12_900, true).length).toBeLessThanOrEqual(50);
  });
});

describe("remote hauler sizing", () => {
  it("splits a remote's carry evenly instead of sending full-size haulers", () => {
    // 40 steps out at 10 gold a tick is 16 CARRY. A 1300-gold hauler holds
    // 13, so the remote gets two, each with half the 16 and a fifth on top.
    const room = home({ remotes: [remote("W4N5", [40])], spawns: 2 });
    const bodies: string[][] = [];
    const spawn = {
      name: "Spawn1",
      spawning: null,
      spawnCreep(body: string[]) {
        bodies.push(body);
        return g.OK;
      },
    } as unknown as StructureSpawn;

    spawnRemoteHauler(room, spawn);

    expect(bodies).toHaveLength(1);
    expect(bodies[0].filter((p) => p === "carry")).toHaveLength(10);
  });
});

describe("stray merchants", () => {
  it("sends a merchant whose remote has become a keep to a remote still worked", () => {
    const keep = remote("W5N4", [30]);
    const room = home({
      remotes: [remote("W4N5", [40]), keep],
      creeps: [creep(ROLE_REMOTE_HAULER, 20, { targetRoom: "W5N4" }), creep(ROLE_REMOTE_HAULER, 20, { targetRoom: "W5N4" })],
    });
    (g.Game as { rooms: Record<string, unknown> }).rooms.W5N4 = { name: "W5N4", controller: { my: true } };

    // W4N5 plans two merchants; the two strays now fill them, so none is spawned.
    expect(shouldSpawnRemoteHauler(room)).toBe(false);
    const targets = Object.values((g.Game as { creeps: Record<string, Creep> }).creeps).map((c) => c.memory.targetRoom);
    expect(targets).toEqual(["W4N5", "W4N5"]);
  });

  it("leaves a merchant at its post while its remote is only invaded", () => {
    const invaded = { ...remote("W5N4", [30]), invaderUntil: clock + 500 };
    const room = home({
      remotes: [remote("W4N5", [40]), invaded],
      creeps: [creep(ROLE_REMOTE_HAULER, 20, { targetRoom: "W5N4" })],
    });
    shouldSpawnRemoteHauler(room);
    const [merchant] = Object.values((g.Game as { creeps: Record<string, Creep> }).creeps);
    expect(merchant.memory.targetRoom).toBe("W5N4");
  });
});
