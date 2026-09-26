import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.OK = 0;
g.ERR_NOT_IN_RANGE = -9;
g.FIND_MY_SPAWNS = 108;
g.FIND_STRUCTURES = 107;
g.FIND_SOURCES = 105;
g.FIND_HOSTILE_CREEPS = 103;
g.FIND_HOSTILE_STRUCTURES = 109;
g.FIND_DROPPED_RESOURCES = 106;
g.FIND_MY_CONSTRUCTION_SITES = 114;
g.LOOK_STRUCTURES = "structure";
g.LOOK_CONSTRUCTION_SITES = "constructionSite";
g.OBSTACLE_OBJECT_TYPES = ["spawn", "extension", "wall", "tower"];
g.RoomPosition = class {
  constructor(public x: number, public y: number, public roomName: string) {}
};

const activeRemotes = vi.fn((_room: Room): RemoteRoomData[] => []);
vi.mock("../src/orchestrators/orchestrator.spawning", () => ({
  getActiveRemoteRooms: (room: Room) => activeRemotes(room),
  getPickedRemoteRoomNames: (room: Room) => new Set(activeRemotes(room).map((r) => r.roomName)),
}));

import { getRemoteSourcePathLength, UNREACHABLE_REMOTE_PATH } from "../src/services/services.remote";
import { planRemoteRoads, cleanupSitesOutsideOwnedRooms } from "../src/orchestrators/orchestrator.structures";
import { runRemoteHauler } from "../src/roles/role.remote_hauler";

const HOME = "W1N1";
const REMOTE = "W1N2";
const ME = "Me";
let clock = 10_000;

class FakeCostMatrix {
  private v: Record<string, number> = {};
  get(x: number, y: number) {
    return this.v[`${x},${y}`] ?? 0;
  }
  set(x: number, y: number, c: number) {
    this.v[`${x},${y}`] = c;
  }
}

beforeEach(() => {
  clock += 1000;
  activeRemotes.mockReset();
  activeRemotes.mockReturnValue([]);
});

describe("remote source path cache", () => {
  const storage = { id: "storage1", pos: { x: 25, y: 25, roomName: HOME } };
  const source = { id: "src1", pos: { x: 10, y: 10, roomName: REMOTE } };
  const container = { id: "cont1", pos: { x: 11, y: 10, roomName: REMOTE } };
  let search: ReturnType<typeof vi.fn>;

  function setup(result: { incomplete: boolean; path: Array<{ x: number; y: number; roomName: string }> }) {
    search = vi.fn(() => result);
    g.PathFinder = { search, CostMatrix: FakeCostMatrix };
    g.Game = {
      time: clock,
      rooms: {},
      getObjectById: (id: string) => (id === "src1" ? source : id === "cont1" ? container : null),
    };
    const home = { name: HOME, storage, find: () => [] } as unknown as Room;
    const src = { sourceId: "src1" } as unknown as RemoteSourceData;
    const remote = { roomName: REMOTE, sources: [src], lastSeen: 0, hostile: false };
    return { home, src, remote };
  }

  const path = [
    { x: 25, y: 1, roomName: HOME },
    { x: 25, y: 0, roomName: HOME },
    { x: 25, y: 49, roomName: REMOTE },
    { x: 24, y: 48, roomName: REMOTE },
  ];

  it("measures once, keeps the remote room's tiles, and reuses the result", () => {
    const { home, src, remote } = setup({ incomplete: false, path });
    expect(getRemoteSourcePathLength(home, remote, src)).toBe(4);
    expect(src.roadTiles).toBe("25,49;24,48");

    (g.Game as any).time = clock + 1;
    expect(getRemoteSourcePathLength(home, remote, src)).toBe(4);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("measures again once the container stands", () => {
    const { home, src, remote } = setup({ incomplete: false, path });
    getRemoteSourcePathLength(home, remote, src);
    src.containerId = "cont1" as Id<StructureContainer>;
    (g.Game as any).time = clock + 1;
    getRemoteSourcePathLength(home, remote, src);
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[1][1].pos).toBe(container.pos);
  });

  it("marks an unreachable source as too far to be worth it", () => {
    const { home, src, remote } = setup({ incomplete: true, path: [] });
    expect(getRemoteSourcePathLength(home, remote, src)).toBe(UNREACHABLE_REMOTE_PATH);
    expect(src.roadTiles).toBeUndefined();
  });

  it("keeps searches inside the home and the remote", () => {
    const { home, src, remote } = setup({ incomplete: false, path });
    getRemoteSourcePathLength(home, remote, src);
    const cb = search.mock.calls[0][2].roomCallback as (rn: string) => unknown;
    expect(cb("W9N9")).toBe(false);
    expect(cb(REMOTE)).toBeInstanceOf(FakeCostMatrix);
  });
});

describe("remote road placement", () => {
  function remoteRoom(roads: string[], sites: string[]) {
    const created: string[] = [];
    const room = {
      name: REMOTE,
      controller: {},
      lookForAt: (type: string, x: number, y: number) => {
        const k = `${x},${y}`;
        if (type === g.LOOK_STRUCTURES) return roads.includes(k) ? [{ structureType: "road" }] : [];
        return sites.includes(k) ? [{}] : [];
      },
      createConstructionSite: (x: number, y: number, type: string) => {
        created.push(`${x},${y}:${type}`);
        return 0;
      },
    };
    g.Game = { time: clock, rooms: { [REMOTE]: room } };
    return created;
  }
  const home = { controller: { owner: { username: ME } } } as unknown as Room;
  const withRoad = (containerId?: string): RemoteRoomData => ({
    roomName: REMOTE,
    lastSeen: 0,
    hostile: false,
    sources: [{ sourceId: "src1", containerId, roadTiles: "25,49;25,48;25,47;25,46" } as unknown as RemoteSourceData],
  });

  it("lays road sites along the path where nothing stands yet", () => {
    const created = remoteRoom(["25,48"], ["25,47"]);
    const left = planRemoteRoads(home, [withRoad("cont1")], 5);
    expect(created).toEqual(["25,49:road", "25,46:road"]);
    expect(left).toBe(3);
  });

  it("stops at the site budget", () => {
    const created = remoteRoom([], []);
    expect(planRemoteRoads(home, [withRoad("cont1")], 1)).toBe(0);
    expect(created).toHaveLength(1);
  });

  it("waits for the source's container first", () => {
    const created = remoteRoom([], []);
    planRemoteRoads(home, [withRoad(undefined)], 5);
    expect(created).toEqual([]);
  });
});

describe("remote road site cleanup", () => {
  function site(roomName: string, structureType: string) {
    const s = { structureType, pos: { roomName }, removed: false, remove: () => (s.removed = true) };
    return s;
  }

  it("keeps road sites in active remotes of a home that lays roads, and sweeps the rest", () => {
    const active = site(REMOTE, "road");
    const dropped = site("W2N1", "road");
    g.Game = {
      rooms: {
        [HOME]: { controller: { my: true, level: 4 }, storage: {} },
        [REMOTE]: { controller: {} },
        W2N1: { controller: {} },
      },
      constructionSites: { a: active, b: dropped },
    };
    activeRemotes.mockReturnValue([{ roomName: REMOTE } as RemoteRoomData]);
    cleanupSitesOutsideOwnedRooms();
    expect(active.removed).toBe(false);
    expect(dropped.removed).toBe(true);
  });

  it("sweeps remote road sites while the home is too young to lay roads", () => {
    const early = site(REMOTE, "road");
    g.Game = {
      rooms: { [HOME]: { controller: { my: true, level: 3 } }, [REMOTE]: { controller: {} } },
      constructionSites: { a: early },
    };
    activeRemotes.mockReturnValue([{ roomName: REMOTE } as RemoteRoomData]);
    cleanupSitesOutsideOwnedRooms();
    expect(early.removed).toBe(true);
  });
});

describe("remote hauler road upkeep", () => {
  function haulerOn(opts: { roomName: string; work: boolean; road?: { hits: number; hitsMax: number }; site?: boolean }) {
    const road = opts.road ? { structureType: "road", ...opts.road } : undefined;
    const site = opts.site ? { structureType: "road" } : undefined;
    g.Game = { time: clock, creeps: {}, rooms: {}, getObjectById: () => null };
    g.Memory = { rooms: { [HOME]: { remoteRooms: [] } } };
    return {
      hits: 100,
      owner: { username: ME },
      body: [...(opts.work ? [{ type: "work", hits: 100 }] : []), { type: "carry", hits: 100 }],
      store: { energy: 50, getFreeCapacity: () => 0 },
      pos: {
        lookFor: () => (road ? [road] : []),
        findInRange: () => (site ? [site] : []),
      },
      room: { name: opts.roomName, controller: undefined, find: () => [] },
      memory: { role: "remote_hauler", homeRoom: HOME, targetRoom: REMOTE, working: true },
      ticksToLive: 1000,
      moveTo: vi.fn(),
      repair: vi.fn(() => 0),
      build: vi.fn(() => 0),
      suicide: vi.fn(),
      road,
      site,
    };
  }

  it("patches a worn road under it on the way home", () => {
    const c = haulerOn({ roomName: REMOTE, work: true, road: { hits: 1000, hitsMax: 5000 } });
    runRemoteHauler(c as unknown as Creep);
    expect(c.repair).toHaveBeenCalledWith(c.road);
    expect(c.moveTo).toHaveBeenCalled();
  });

  it("builds a road site in reach when the road under it is fine", () => {
    const c = haulerOn({ roomName: REMOTE, work: true, road: { hits: 5000, hitsMax: 5000 }, site: true });
    runRemoteHauler(c as unknown as Creep);
    expect(c.repair).not.toHaveBeenCalled();
    expect(c.build).toHaveBeenCalledWith(c.site);
  });

  it("leaves roads alone without a WORK part", () => {
    const c = haulerOn({ roomName: REMOTE, work: false, road: { hits: 1000, hitsMax: 5000 }, site: true });
    runRemoteHauler(c as unknown as Creep);
    expect(c.repair).not.toHaveBeenCalled();
    expect(c.build).not.toHaveBeenCalled();
  });
});
