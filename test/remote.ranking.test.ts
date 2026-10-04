import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_MY_SPAWNS = 108;
g.FIND_STRUCTURES = 107;
g.OK = 0;

import {
  getActiveRemoteRooms,
  buildRemoteHaulerBody,
  planRemoteSource,
} from "../src/orchestrators/orchestrator.spawning";
import {
  buildRemoteMinerBody,
  reassignStrayHaulers,
  shouldSpawnRemoteHauler,
  spawnRemoteHauler,
} from "../src/orchestrators/orchestrator.spawning.remote";
import {
  ROLE_KNIGHT,
  ROLE_REMOTE_HAULER,
  ROLE_REMOTE_MINER,
  ROLE_SETTLER,
  ROLE_UPGRADER,
} from "../src/config/config.roles";

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
    const busy = Array.from({ length: 16 }, () => creep(ROLE_UPGRADER, 16));
    const room = home({ remotes, creeps: busy });
    expect(sourceIds(getActiveRemoteRooms(room))).toEqual(["W4N5-s0"]);
  });

  it("keeps its remotes while pilgrims and a dragon knight are out", () => {
    const remotes = [remote("W4N5", [30])];
    const busy = Array.from({ length: 16 }, () => creep(ROLE_UPGRADER, 16));
    const passing = [33, 30, 33].map((n) => creep(ROLE_SETTLER, n)).concat(creep(ROLE_KNIGHT, 40));
    const room = home({ remotes, creeps: busy.concat(passing) });
    expect(sourceIds(getActiveRemoteRooms(room))).toEqual(["W4N5-s0"]);
  });

  it("takes on more remotes as the home adds spawns", () => {
    const remotes = [remote("W6N5", [60, 70]), remote("W4N5", [30, 40]), remote("W5N6", [50])];
    const busy = Array.from({ length: 14 }, () => creep(ROLE_UPGRADER, 16));
    const one = sourceIds(getActiveRemoteRooms(home({ remotes, spawns: 1, creeps: busy })));
    clock += 1;
    const three = sourceIds(getActiveRemoteRooms(home({ remotes, spawns: 3, creeps: busy })));
    expect(one.length).toBeGreaterThan(0);
    expect(one.length).toBeLessThan(5);
    expect(three).toHaveLength(5);
    expect(three.slice(0, one.length)).toEqual(one);
  });

  it("takes on no new remote in a dip of one or two home creeps", () => {
    // The source fits the budget by 190 ticks, under two creeps of 33 parts.
    const remotes = [remote("W4N5", [30])];
    const busy = Array.from({ length: 18 }, () => creep(ROLE_UPGRADER, 16));
    expect(getActiveRemoteRooms(home({ remotes, creeps: busy }))).toEqual([]);
  });

  it("keeps a remote it took on while the home fills out and its miner is replaced", () => {
    const remotes = [remote("W4N5", [30])];
    const room = home({ remotes, creeps: Array.from({ length: 14 }, () => creep(ROLE_UPGRADER, 16)) });
    expect(sourceIds(getActiveRemoteRooms(room))).toEqual(["W4N5-s0"]);
    clock += 1;
    const fuller = home({ remotes, creeps: Array.from({ length: 18 }, () => creep(ROLE_UPGRADER, 16)) });
    expect(sourceIds(getActiveRemoteRooms(fuller))).toEqual(["W4N5-s0"]);
  });

  it("does not take back a dropped remote on its peddler's account", () => {
    const remotes = [remote("W4N5", [30])];
    const peddler = creep(ROLE_REMOTE_MINER, 9, { targetRoom: "W4N5", remoteSourceId: "W4N5-s0" as Id<Source> });
    const busy = (n: number) => Array.from({ length: n }, () => creep(ROLE_UPGRADER, 16));
    expect(getActiveRemoteRooms(home({ remotes, creeps: [...busy(22), peddler] }))).toEqual([]);
    // Spare enough for the source, but not with the headroom a new one needs.
    clock += 1;
    expect(getActiveRemoteRooms(home({ remotes, creeps: [...busy(18), peddler] }))).toEqual([]);
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
    expect(buildRemoteHaulerBody(12_900, true, true).length).toBeLessThanOrEqual(50);
  });

  it("takes one MOVE per two CARRY on a paved road, and keeps pace there loaded", () => {
    const body = buildRemoteHaulerBody(2300, true, true);
    expect(count(body, "carry")).toBe(28);
    expect(count(body, "move")).toBe(15);
    // On a road each part but MOVE makes 1 fatigue loaded, and each MOVE clears 2.
    expect(count(body, "move") * 2).toBeGreaterThanOrEqual(body.length - count(body, "move"));
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

describe("merchants on a paved road", () => {
  // 60 steps out is 24 CARRY. A 1300-gold home plans merchants of 1170 gold:
  // with one MOVE per CARRY that holds 10, so the remote needs three; with one
  // MOVE per two it holds 12, and two will do. The road runs over ten tiles
  // and the exit, which takes none.
  function remoteWithRoad(built: number): Room {
    const tiles = Array.from({ length: 10 }, (_, i) => `${10 + i},20`);
    const r = remote("W4N5", [60]);
    r.sources[0].containerId = "box" as Id<StructureContainer>;
    r.sources[0].roadTiles = ["0,20", ...tiles].join(";");
    const merchants = [1, 2].map(() => creep(ROLE_REMOTE_HAULER, 22, { targetRoom: "W4N5" }));
    const room = home({ remotes: [r], storage: true, creeps: merchants });
    const roads = tiles.slice(0, built).map((t) => {
      const [x, y] = t.split(",").map(Number);
      return { structureType: "road", pos: { x, y } };
    });
    (g.Game as { rooms: Record<string, unknown> }).rooms.W4N5 = {
      name: "W4N5",
      find: (type: number) => (type === g.FIND_STRUCTURES ? roads : []),
    };
    return room;
  }

  it("needs fewer merchants once the road is all but built", () => {
    expect(shouldSpawnRemoteHauler(remoteWithRoad(8))).toBe(true);
    clock += 1;
    expect(shouldSpawnRemoteHauler(remoteWithRoad(9))).toBe(false);
  });

  it("raises a merchant with one MOVE per two CARRY there", () => {
    const bodies: string[][] = [];
    const spawn = {
      name: "Spawn1",
      spawning: null,
      spawnCreep(body: string[]) {
        bodies.push(body);
        return g.OK;
      },
    } as unknown as StructureSpawn;

    spawnRemoteHauler(remoteWithRoad(10), spawn);

    expect(bodies).toHaveLength(1);
    expect(bodies[0].filter((p) => p === "carry")).toHaveLength(12);
    expect(bodies[0].filter((p) => p === "move")).toHaveLength(7);
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
    reassignStrayHaulers(room);
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
    reassignStrayHaulers(room);
    const [merchant] = Object.values((g.Game as { creeps: Record<string, Creep> }).creeps);
    expect(merchant.memory.targetRoom).toBe("W5N4");
  });
});

describe("remote miner body", () => {
  it("out-digs its source by enough to mend its container as well", () => {
    const work = buildRemoteMinerBody(2300).filter((p) => p === WORK).length;
    // A container outside a keep loses 5000 hits every 100 ticks, mended at 100
    // hits per WORK a tick. The other ticks have to dig the 1000 gold a
    // reserved source refills in that time.
    const mending = Math.ceil(5000 / (work * 100));
    expect(work * 2 * (100 - mending)).toBeGreaterThanOrEqual(1000);
  });

  it("keeps its CARRY when the gold runs one part short", () => {
    // A young keep at RCL 3 holds 800 and spawns on anything past 720.
    const tally = (body: BodyPartConstant[]) => body.filter((p) => p === WORK).length + "W" + body.filter((p) => p === CARRY).length + "C";
    expect(tally(buildRemoteMinerBody(800))).toBe("6W1C");
    expect(tally(buildRemoteMinerBody(760))).toBe("5W1C");
  });
});
