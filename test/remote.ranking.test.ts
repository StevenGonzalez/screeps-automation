import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_MY_SPAWNS = 108;
g.FIND_STRUCTURES = 107;
g.FIND_MY_CONSTRUCTION_SITES = 114;
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
  shouldSpawnRemoteMiner,
  shouldSpawnReserver,
  spawnRemoteHauler,
} from "../src/orchestrators/orchestrator.spawning.remote";
import {
  sendIdleRemoteKnights,
  shouldSpawnRemoteDefender,
  spawnRemoteDefender,
} from "../src/orchestrators/orchestrator.spawning.military";
import {
  ROLE_KNIGHT,
  ROLE_REMOTE_HAULER,
  ROLE_REMOTE_MINER,
  ROLE_RESERVER,
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

  it("costs a three-CLAIM envoy by the reservation it banks", () => {
    const room = home({ remotes: [] });
    (room as { energyCapacityAvailable: number }).energyCapacityAvailable = 2300;
    const r = remote("W4N5", [40]);
    // 10 gold a tick, less the 800-gold miner and 19.2 CARRY of merchants at
    // 100 gold each a lifetime, 0.5 a tick of container upkeep, and the
    // 1,950-gold envoy once every 3 x 560 ticks: three CLAIM bank two ticks of
    // reservation for each of the 560 it works after its walk out. Bought every
    // 600 ticks, it cost 3.25 a tick.
    const upkeep = 800 / 1500 + (19.2 * 100) / 1500 + 0.5 + 1950 / (3 * 560);
    expect(planRemoteSource(room, r, r.sources[0]).profit).toBeCloseTo(10 - upkeep, 3);
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
    // The source fits the budget by 204 ticks, short of the headroom a new one needs.
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

  it("takes back a remote it dropped in a short dip", () => {
    const remotes = [remote("W4N5", [30])];
    const busy = (n: number) => Array.from({ length: n }, () => creep(ROLE_UPGRADER, 16));
    expect(sourceIds(getActiveRemoteRooms(home({ remotes, creeps: busy(14) })))).toEqual(["W4N5-s0"]);
    clock += 1;
    expect(getActiveRemoteRooms(home({ remotes, creeps: busy(23) }))).toEqual([]);
    // Fifty ticks on there is spare for the source, though not with the
    // headroom a new one needs.
    clock += 50;
    expect(sourceIds(getActiveRemoteRooms(home({ remotes, creeps: busy(18) })))).toEqual(["W4N5-s0"]);
  });

  it("does not take back a dropped remote on its peddler's account", () => {
    const remotes = [remote("W4N5", [30])];
    const peddler = creep(ROLE_REMOTE_MINER, 9, { targetRoom: "W4N5", remoteSourceId: "W4N5-s0" as Id<Source> });
    const busy = (n: number) => Array.from({ length: n }, () => creep(ROLE_UPGRADER, 16));
    expect(getActiveRemoteRooms(home({ remotes, creeps: [...busy(23), peddler] }))).toEqual([]);
    // Spare enough for the source, but not with the headroom a new one needs.
    clock += 1;
    expect(getActiveRemoteRooms(home({ remotes, creeps: [...busy(18), peddler] }))).toEqual([]);
  });

  it("leaves a source to the castle whose peddler already works it", () => {
    const remotes = [remote("W4N5", [30, 40])];
    const theirs = creep(ROLE_REMOTE_MINER, 9, {
      homeRoom: "W3N5",
      targetRoom: "W4N5",
      remoteSourceId: "W4N5-s0" as Id<Source>,
    });
    expect(sourceIds(getActiveRemoteRooms(home({ remotes, creeps: [theirs] })))).toEqual(["W4N5-s1"]);
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

  it("keeps a source on a low CPU bucket while its slain peddler is replaced", () => {
    const remotes = [remote("W4N5", [30])];
    const miner = creep(ROLE_REMOTE_MINER, 9, { targetRoom: "W4N5", remoteSourceId: "W4N5-s0" as Id<Source> });
    expect(sourceIds(getActiveRemoteRooms(home({ remotes, creeps: [miner] })))).toEqual(["W4N5-s0"]);
    clock += 1;
    expect(sourceIds(getActiveRemoteRooms(home({ remotes, bucket: 1000 })))).toEqual(["W4N5-s0"]);
  });

  it("keeps a source it works through a global reset, though its peddler is gone", async () => {
    const remotes = [remote("W4N5", [30])];
    const busy = (n: number) => Array.from({ length: n }, () => creep(ROLE_UPGRADER, 16));
    expect(sourceIds(getActiveRemoteRooms(home({ remotes, creeps: busy(14) })))).toEqual(["W4N5-s0"]);
    clock += 1;
    vi.resetModules();
    const reset = await import("../src/orchestrators/orchestrator.spawning.remote");
    // Spare enough for the source, but not with the headroom a new one needs.
    expect(sourceIds(reset.getActiveRemoteRooms(home({ remotes, creeps: busy(18) })))).toEqual(["W4N5-s0"]);
  });
});

describe("CPU governor", () => {
  const peddler = (roomName: string) =>
    creep(ROLE_REMOTE_MINER, 9, { targetRoom: roomName, remoteSourceId: `${roomName}-s0` as Id<Source> });
  // A near remote and a far one, both mined. The far one's merchants walk three
  // times as far, so it earns less gold for each creep it keeps busy.
  const realm = (bucket: number) =>
    home({
      remotes: [remote("W4N5", [30]), remote("W6N5", [95])],
      spawns: 3,
      creeps: [peddler("W4N5"), peddler("W6N5")],
      bucket,
    });
  const later = (ticks: number, bucket: number) => {
    const game = g.Game as { time: number; cpu: { bucket: number } };
    game.time += ticks;
    game.cpu.bucket = bucket;
  };
  const lastLine = () => (g.Memory as Memory).chronicle?.at(-1)?.text;
  const talk = () => (g.Memory as Memory).gossip?.line;

  it("sets aside the source earning least per creep while the bucket keeps falling", () => {
    const room = realm(4500);
    expect(sourceIds(getActiveRemoteRooms(room))).toHaveLength(2);
    later(500, 4000);
    expect(sourceIds(getActiveRemoteRooms(room))).toEqual(["W4N5-s0"]);
    expect(lastLine()).toContain("give up a digging");
    expect(talk()).toBe("road shut");
    later(500, 3800);
    expect(sourceIds(getActiveRemoteRooms(room))).toEqual([]);
  });

  it("sets nothing aside while the bucket climbs", () => {
    const room = realm(3000);
    getActiveRemoteRooms(room);
    later(500, 3500);
    expect(sourceIds(getActiveRemoteRooms(room))).toHaveLength(2);
  });

  it("checks no sooner than the interval", () => {
    const room = realm(4500);
    getActiveRemoteRooms(room);
    later(400, 4000);
    expect(sourceIds(getActiveRemoteRooms(room))).toHaveLength(2);
  });

  it("takes the source back once the bucket climbs fast", () => {
    const room = realm(4500);
    getActiveRemoteRooms(room);
    later(500, 4000);
    expect(sourceIds(getActiveRemoteRooms(room))).toEqual(["W4N5-s0"]);
    later(500, 6000);
    expect(sourceIds(getActiveRemoteRooms(room))).toHaveLength(2);
    expect(lastLine()).toContain("return to a digging");
    expect(talk()).toBe("road open");
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
  // 50 steps out is 20 CARRY, 24 with a fifth on top. A 1300-gold home plans
  // merchants of 1170 gold: with one MOVE per CARRY that holds 10, so the
  // remote needs three; with one MOVE per two it holds 12, and two will do.
  // The road runs over ten tiles and the exit, which takes none.
  function remoteWithRoad(built: number): Room {
    const tiles = Array.from({ length: 10 }, (_, i) => `${10 + i},20`);
    const r = remote("W4N5", [50]);
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

describe("relieving a merchant", () => {
  it("sends the relief to the remote of the merchant it relieves", () => {
    // Each remote plans two merchants and has one, but one of those is about
    // to die of age.
    const old = creep(ROLE_REMOTE_HAULER, 20, { targetRoom: "W5N4" });
    Object.assign(old, { ticksToLive: 10 });
    const room = home({
      remotes: [remote("W4N5", [40]), remote("W5N4", [40])],
      spawns: 2,
      creeps: [creep(ROLE_REMOTE_HAULER, 20, { targetRoom: "W4N5" }), old],
    });
    const targets: (string | undefined)[] = [];
    const spawn = {
      name: "Spawn1",
      spawning: null,
      spawnCreep(_body: string[], _name: string, opts: { memory: CreepMemory }) {
        targets.push(opts.memory.targetRoom);
        return g.OK;
      },
    } as unknown as StructureSpawn;

    spawnRemoteHauler(room, spawn);

    expect(targets).toEqual(["W5N4"]);
  });

  it("does not take the relief for a spare while the old merchant lives", () => {
    const old = creep(ROLE_REMOTE_HAULER, 20, { targetRoom: "W5N4" });
    Object.assign(old, { ticksToLive: 10 });
    const posted = [old, ...[1, 2].map(() => creep(ROLE_REMOTE_HAULER, 20, { targetRoom: "W5N4" }))];
    const room = home({
      remotes: [remote("W4N5", [40]), remote("W5N4", [40])],
      spawns: 2,
      creeps: [creep(ROLE_REMOTE_HAULER, 20, { targetRoom: "W4N5" }), ...posted],
    });

    reassignStrayHaulers(room);

    expect(posted.map((c) => c.memory.targetRoom)).toEqual(["W5N4", "W5N4", "W5N4"]);
  });
});

describe("merchants for a young keep", () => {
  // Two sources 92 and 97 steps out need 76 CARRY, 91 with a fifth on top. An
  // 800-gold home plans merchants of 720 gold, 7 CARRY each, so the remote
  // takes thirteen of them. Eleven, without the fifth, let the containers
  // overflow.
  function youngKeep(merchants: number): Room {
    const posted = Array.from({ length: merchants }, () => creep(ROLE_REMOTE_HAULER, 16, { targetRoom: "W4N5" }));
    const room = home({ remotes: [remote("W4N5", [92, 97])], rcl: 3, creeps: posted });
    Object.assign(room, { energyAvailable: 800, energyCapacityAvailable: 800 });
    return room;
  }

  it("raises as many small merchants as a far remote needs", () => {
    expect(shouldSpawnRemoteHauler(youngKeep(6))).toBe(true);
    clock += 1;
    expect(shouldSpawnRemoteHauler(youngKeep(12))).toBe(true);
    clock += 1;
    expect(shouldSpawnRemoteHauler(youngKeep(13))).toBe(false);
  });

  it("raises only one while its peddlers raise the sources' containers", () => {
    const room = youngKeep(1);
    const site = { structureType: STRUCTURE_CONTAINER };
    const sources = room.memory.remoteRooms![0].sources;
    // In sight, each source's cached path is still fresh.
    for (const s of sources) s.pathKey = `spawn0:${s.sourceId}`;
    (g.Game as Record<string, unknown>).getObjectById = (id: string) =>
      id.startsWith("W4N5-s")
        ? { id, pos: { findInRange: (_t: number, _r: number, o: { filter: (s: object) => boolean }) => [site].filter(o.filter) } }
        : null;
    expect(shouldSpawnRemoteHauler(room)).toBe(false);
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

  it("sends the merchants a remote can spare to one that has none", () => {
    const room = home({
      remotes: [remote("W4N5", [40]), remote("W5N4", [40])],
      spawns: 2,
      creeps: Array.from({ length: 4 }, () => creep(ROLE_REMOTE_HAULER, 20, { targetRoom: "W4N5" })),
    });

    // Each remote plans two merchants.
    reassignStrayHaulers(room);
    const targets = Object.values((g.Game as { creeps: Record<string, Creep> }).creeps).map((c) => c.memory.targetRoom);
    expect(targets.sort()).toEqual(["W4N5", "W4N5", "W5N4", "W5N4"]);
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

  it("buys a fifth WORK with gold short of a third pair", () => {
    const count = (body: BodyPartConstant[], part: BodyPartConstant) => body.filter((p) => p === part).length;
    for (const [gold, work, move] of [[650, 5, 2], [720, 5, 3]]) {
      const body = buildRemoteMinerBody(gold);
      expect([count(body, WORK), count(body, MOVE), count(body, CARRY)]).toEqual([work, move, 1]);
    }
  });

  it("never costs more than the gold it is built from", () => {
    const cost = { work: 100, move: 50, carry: 50 } as Record<string, number>;
    for (let gold = 300; gold <= 2300; gold += 10) {
      const body = buildRemoteMinerBody(gold);
      expect(body.reduce((n, p) => n + cost[p], 0)).toBeLessThanOrEqual(gold);
    }
  });
});

describe("relieving a peddler", () => {
  // A ten-part peddler on a 96-tile path: 30 ticks to raise its relief, 96 to
  // walk it out by the path alone, and 78 to wait behind the castle's longest
  // body, 26 parts at 1300 capacity.
  const peddler = (ticksToLive: number, walk?: number) =>
    Object.assign(creep(ROLE_REMOTE_MINER, 10, { targetRoom: "W4N5", remoteSourceId: "W4N5-s0" as Id<Source>, walk }), {
      ticksToLive,
    });

  it("orders the relief by the path while the peddler has yet to reach its post", () => {
    expect(shouldSpawnRemoteMiner(home({ remotes: [remote("W4N5", [96])], creeps: [peddler(205)] }))).toBe(false);
  });

  it("orders it as far ahead as the peddler's own walk out took", () => {
    // 30 + 170 + 78 = 278.
    expect(shouldSpawnRemoteMiner(home({ remotes: [remote("W4N5", [96])], creeps: [peddler(250, 170)] }))).toBe(true);
  });

  it("orders it by the path, a body's spawning early, when the walk out went unmeasured", () => {
    expect(shouldSpawnRemoteMiner(home({ remotes: [remote("W4N5", [96])], creeps: [peddler(204, 0)] }))).toBe(true);
  });
});

describe("relieving an envoy", () => {
  // A one-CLAIM envoy on a 40-tile path: 6 ticks to raise its relief and 40 to
  // walk it out. The castle's longest body, 26 parts at 1300 capacity, takes 78
  // ticks to spawn.
  const envoy = (ticksToLive: number) =>
    Object.assign(creep(ROLE_RESERVER, 2, { targetRoom: "W4N5" }), { ticksToLive });
  const reserved = (room: Room, ticksToEnd: number) => {
    (g.Game as { rooms: Record<string, unknown> }).rooms.W4N5 = {
      controller: { reservation: { username: "Me", ticksToEnd } },
    };
    return room;
  };

  it("orders the relief a body's spawning early while the reservation has nothing banked", () => {
    const room = home({ remotes: [remote("W4N5", [40])], creeps: [envoy(120)] });
    expect(shouldSpawnReserver(reserved(room, 1))).toBe(true);
  });

  it("orders it by the walk alone while the reservation can outlast the wait", () => {
    const room = home({ remotes: [remote("W4N5", [40])], creeps: [envoy(120)] });
    expect(shouldSpawnReserver(reserved(room, 1000))).toBe(false);
  });

  it("orders it by the envoy's own walk to the controller, even one shorter than the path", () => {
    // 6 + 20 + 78 = 104.
    const walked = envoy(110);
    walked.memory.walk = 20;
    const room = home({ remotes: [remote("W4N5", [40])], creeps: [walked] });
    expect(shouldSpawnReserver(reserved(room, 1))).toBe(false);
  });

  it("counts what the reservation has banked against the wait", () => {
    // 78 ticks of wait, 40 of them banked: 6 + 40 + 38 = 84.
    const room = home({ remotes: [remote("W4N5", [40])], creeps: [envoy(90)] });
    expect(shouldSpawnReserver(reserved(room, 40))).toBe(false);
  });
});

// Each castle works a source of its own in W4N5: the castle in W3N5 has its
// peddler on the first, the home its own on the second.
function shared(otherCapacity: number, invaderUntil?: number): Room {
  const ours = creep(ROLE_REMOTE_MINER, 9, { targetRoom: "W4N5", remoteSourceId: "W4N5-s1" as Id<Source> });
  const theirs = creep(ROLE_REMOTE_MINER, 9, {
    homeRoom: "W3N5",
    targetRoom: "W4N5",
    remoteSourceId: "W4N5-s0" as Id<Source>,
  });
  const room = home({ remotes: [{ ...remote("W4N5", [30, 40]), invaderUntil }], creeps: [ours, theirs] });
  const other = {
    name: "W3N5",
    controller: { my: true, level: 4, owner: { username: "Me" } },
    energyAvailable: otherCapacity,
    energyCapacityAvailable: otherCapacity,
    memory: { remoteRooms: [{ ...remote("W4N5", [30, 40]), invaderUntil }] },
    find: (type: number) => (type === g.FIND_MY_SPAWNS ? [{ id: "spawnB" }] : []),
  };
  (g.Game as { rooms: Record<string, unknown> }).rooms.W3N5 = other;
  return room;
}

describe("a remote two castles share", () => {
  it("leaves the envoy to the castle that raises the bigger one", () => {
    expect(shouldSpawnReserver(shared(2300))).toBe(false);
  });

  it("sends the envoy itself when its own is the bigger", () => {
    expect(shouldSpawnReserver(shared(800))).toBe(true);
  });

  it("sends none while the other castle's envoy holds the room", () => {
    const room = shared(800);
    const envoy = Object.assign(creep(ROLE_RESERVER, 2, { homeRoom: "W3N5", targetRoom: "W4N5" }), {
      ticksToLive: 500,
    });
    (g.Game as { creeps: Record<string, Creep> }).creeps[envoy.name] = envoy;
    clock += 1;
    (g.Game as { time: number }).time = clock;
    expect(shouldSpawnReserver(room)).toBe(false);
  });
});

describe("a source two castles contend for", () => {
  // The castle in W3N5 lists the home's remote too, and its peddler works the
  // remote's one source. The home last picked the source `pickedAgo` ticks ago.
  function contested(pickedAgo: number | undefined, otherCapacity: number, theirPeddler = true): Room {
    const r = remote("W4N5", [30]);
    if (pickedAgo !== undefined) r.sources[0].pickedAt = clock - pickedAgo;
    const theirs = creep(ROLE_REMOTE_MINER, 9, {
      homeRoom: "W3N5",
      targetRoom: "W4N5",
      remoteSourceId: "W4N5-s0" as Id<Source>,
    });
    const room = home({ remotes: [r], creeps: theirPeddler ? [theirs] : [] });
    (g.Game as { rooms: Record<string, unknown> }).rooms.W3N5 = {
      name: "W3N5",
      controller: { my: true, level: 4, owner: { username: "Me" } },
      energyAvailable: otherCapacity,
      energyCapacityAvailable: otherCapacity,
      memory: { remoteRooms: [remote("W4N5", [30])] },
      find: (type: number) => (type === g.FIND_MY_SPAWNS ? [{ id: "spawnB" }] : []),
    };
    return room;
  }

  it("takes back a source a smaller castle's peddler took up while its own was gone", () => {
    expect(sourceIds(getActiveRemoteRooms(contested(300, 800)))).toEqual(["W4N5-s0"]);
  });

  it("leaves a smaller castle a source it has long worked", () => {
    expect(sourceIds(getActiveRemoteRooms(contested(2000, 800)))).toEqual([]);
    clock += 1;
    expect(sourceIds(getActiveRemoteRooms(contested(undefined, 800)))).toEqual([]);
  });

  it("does not take a source back from a bigger castle", () => {
    expect(sourceIds(getActiveRemoteRooms(contested(300, 2300)))).toEqual([]);
  });

  it("leaves a source a bigger castle works to it before either has a peddler there", () => {
    expect(sourceIds(getActiveRemoteRooms(contested(undefined, 2300, false)))).toEqual([]);
    clock += 1;
    expect(sourceIds(getActiveRemoteRooms(contested(undefined, 800, false)))).toEqual(["W4N5-s0"]);
  });
});

describe("remote knights", () => {
  const raided = () => ({ ...remote("W4N5", [30]), invaderUntil: clock + 500 });

  it("rides out for a raided remote the castle works", () => {
    expect(shouldSpawnRemoteDefender(home({ remotes: [raided()] }))).toBe(true);
  });

  it("raises a second knight when one cannot out-hit the raiders' healers, but none for a host two could not beat", () => {
    g.ATTACK_POWER = 30;
    const healed = { ...raided(), invaderStrength: { heal: 180, damage: 80, hits: 2000 } };
    const first = knight("W4N5", 1000);
    expect(shouldSpawnRemoteDefender(home({ remotes: [healed], creeps: [first] }))).toBe(true);
    clock += 1;
    const host = { ...raided(), invaderStrength: { heal: 1000, damage: 80, hits: 2000 } };
    expect(shouldSpawnRemoteDefender(home({ remotes: [host] }))).toBe(false);
  });

  it("raises a second knight when the first is too small to beat alone raiders a full knight would", () => {
    g.ATTACK_POWER = 30;
    const raid = { ...raided(), invaderStrength: { heal: 30, damage: 60, hits: 1000 } };
    const runt = knight("W4N5", 1000, 2);
    expect(shouldSpawnRemoteDefender(home({ remotes: [raid], creeps: [runt] }))).toBe(true);
    clock += 1;
    const full = knight("W4N5", 1000);
    expect(shouldSpawnRemoteDefender(home({ remotes: [{ ...raid }], creeps: [full] }))).toBe(false);
  });

  it("raises no third knight when the two it has could not win side by side", () => {
    g.ATTACK_POWER = 30;
    const raid = { ...raided(), invaderStrength: { heal: 30, damage: 60, hits: 1000 } };
    const runts = [knight("W4N5", 1000, 2), knight("W4N5", 1000, 2)];
    expect(shouldSpawnRemoteDefender(home({ remotes: [raid], creeps: runts }))).toBe(false);
  });

  it("raises another knight when the one out there has lost the parts to win", () => {
    g.ATTACK_POWER = 30;
    const raid = { ...raided(), invaderStrength: { heal: 30, damage: 60, hits: 1000 } };
    const wounded = knight("W4N5", 1000);
    wounded.body = wounded.body.map((p, i) => (i < 3 ? { ...p, hits: 0 } : p));
    expect(shouldSpawnRemoteDefender(home({ remotes: [raid], creeps: [wounded] }))).toBe(true);
  });

  it("is not raised by a castle below level 3, which sends no vendors out", () => {
    expect(shouldSpawnRemoteDefender(home({ remotes: [raided()], rcl: 2 }))).toBe(false);
  });

  // A 1300-gold castle's full knight has six ATTACK.
  const knight = (targetRoom: string, ticksToLive: number, attack = 6) =>
    Object.assign(creep(ROLE_KNIGHT, 0, { targetRoom }), {
      ticksToLive,
      body: Array(attack).fill({ type: "attack", hits: 100 }),
    });

  // One Invader of ten parts: 1,000 hits, a melee and a ranged strike.
  const loneRaider = { heal: 0, damage: 40, hits: 1000 };

  function purse(room: Room, energy: number): Room {
    (room as { energyAvailable: number }).energyAvailable = energy;
    return room;
  }

  function raise(room: Room): string[][] {
    const bodies: string[][] = [];
    const spawn = {
      name: "Spawn1",
      spawning: null,
      spawnCreep(body: string[]) {
        bodies.push(body);
        return g.OK;
      },
    } as unknown as StructureSpawn;
    spawnRemoteDefender(room, spawn);
    return bodies;
  }

  it("raises a knight only as big as a lone raider calls for, without waiting on a full purse", () => {
    g.ATTACK_POWER = 30;
    // At twice the raider's strength, four groups are the fewest that outlast
    // its blows while they cut down its hits.
    const room = purse(home({ remotes: [{ ...raided(), invaderStrength: loneRaider }] }), 700);
    expect(shouldSpawnRemoteDefender(room)).toBe(false);
    expect(shouldSpawnRemoteDefender(purse(room, 800))).toBe(true);
    const bodies = raise(purse(room, 1300));
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toHaveLength(16);
    expect(bodies[0].filter((p) => p === "attack")).toHaveLength(4);
  });

  it("waits for a full purse when the raid calls for the biggest knight", () => {
    g.ATTACK_POWER = 30;
    const strong = { ...raided(), invaderStrength: { heal: 0, damage: 100, hits: 3000 } };
    expect(shouldSpawnRemoteDefender(purse(home({ remotes: [strong] }), 800))).toBe(false);
    clock += 1;
    const room = purse(home({ remotes: [{ ...strong }] }), 1300);
    expect(shouldSpawnRemoteDefender(room)).toBe(true);
    expect(raise(room)[0].filter((p) => p === "attack")).toHaveLength(6);
  });

  it("leaves a knight raised for a lesser raid at home, and raises one fit for this", () => {
    const small = knight("W6N5", 1000, 4);
    const room = home({ remotes: [remote("W6N5", [60]), raided()], creeps: [small] });
    sendIdleRemoteKnights(room);
    expect(small.memory.targetRoom).toBe("W6N5");
    expect(shouldSpawnRemoteDefender(room)).toBe(true);
  });

  it("sends a small knight to a raid no bigger than it was raised for", () => {
    g.ATTACK_POWER = 30;
    const small = knight("W6N5", 1000, 4);
    const room = home({
      remotes: [remote("W6N5", [60]), { ...raided(), invaderStrength: loneRaider }],
      creeps: [small],
    });
    sendIdleRemoteKnights(room);
    expect(small.memory.targetRoom).toBe("W4N5");
  });

  it("sends a knight standing watch for a clear remote to one raiders hold, rather than raise another", () => {
    const watch = knight("W6N5", 1000);
    const room = home({ remotes: [remote("W6N5", [60]), raided()], creeps: [watch] });
    sendIdleRemoteKnights(room);
    expect(watch.memory.targetRoom).toBe("W4N5");
    expect(shouldSpawnRemoteDefender(room)).toBe(false);
  });

  it("keeps a knight at its own remote while raiders hold that too", () => {
    const guard = knight("W6N5", 1000);
    const room = home({ remotes: [{ ...remote("W6N5", [60]), invaderUntil: clock + 500 }, raided()], creeps: [guard] });
    sendIdleRemoteKnights(room);
    expect(guard.memory.targetRoom).toBe("W6N5");
  });

  it("leaves a raided remote a bigger castle also works to that castle's knights", () => {
    expect(shouldSpawnRemoteDefender(shared(2300, clock + 500))).toBe(false);
    clock += 1;
    expect(shouldSpawnRemoteDefender(shared(800, clock + 500))).toBe(true);
  });

  it("does not send a knight near its end", () => {
    const old = knight("W6N5", 100);
    const room = home({ remotes: [remote("W6N5", [60]), raided()], creeps: [old] });
    sendIdleRemoteKnights(room);
    expect(old.memory.targetRoom).toBe("W6N5");
    expect(shouldSpawnRemoteDefender(room)).toBe(true);
  });
});
