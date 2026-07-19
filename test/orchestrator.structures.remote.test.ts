import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;

import {
  canBuildInRemote,
  cleanupSitesOutsideOwnedRooms,
  countRemoteContainerSites,
  planRemoteRoomContainers,
} from "../src/orchestrators/orchestrator.structures";

g.FIND_STRUCTURES = 107;
g.FIND_CONSTRUCTION_SITES = 111;
g.TERRAIN_MASK_WALL = 1;
g.OK = 0;

const ME = "arca";

function room(controller: unknown): Room {
  return { controller } as unknown as Room;
}

function site(id: string, roomName: string, structureType: string) {
  const s = {
    id,
    structureType,
    pos: { roomName },
    removed: false,
    remove() {
      s.removed = true;
    },
  };
  return s;
}

describe("canBuildInRemote", () => {
  it("allows a neutral unreserved room", () => {
    expect(canBuildInRemote(room({}), ME)).toBe(true);
  });

  it("allows a room we reserve ourselves", () => {
    expect(canBuildInRemote(room({ reservation: { username: ME } }), ME)).toBe(true);
  });

  it("rejects a room another player reserves", () => {
    expect(canBuildInRemote(room({ reservation: { username: "enemy" } }), ME)).toBe(false);
  });

  it("rejects a room another player owns", () => {
    expect(canBuildInRemote(room({ owner: { username: "enemy" }, my: false }), ME)).toBe(false);
  });

  it("rejects a room with no controller (highway / SK centre)", () => {
    expect(canBuildInRemote(room(undefined), ME)).toBe(false);
  });
});

// Each open remote container site is 5000 energy the miner burns instead of
// hauling home, so the source earns nothing until it closes. These cover the
// in-flight cap that keeps every remote from stalling at once.
describe("remote container budgeting", () => {
  // A remote room whose sources have no container and no site yet, so every
  // source is a placement candidate.
  function remoteRoom(roomName: string, sourceCount: number, created: string[]) {
    const sources = Array.from({ length: sourceCount }, (_, i) => ({
      id: `${roomName}-s${i}`,
      pos: {
        x: 25,
        y: 10 + i * 5,
        roomName,
        findInRange: () => [],
      },
    }));

    const room = {
      controller: {},
      getTerrain: () => ({ get: () => 0 }),
      createConstructionSite(x: number, y: number, type: string) {
        created.push(`${roomName}:${x},${y}:${type}`);
        return 0;
      },
    };

    return { room, sources };
  }

  function scenario(sourceCount: number) {
    const created: string[] = [];
    const { room, sources } = remoteRoom("W1N2", sourceCount, created);

    g.Game = {
      rooms: { W1N2: room },
      constructionSites: {},
      getObjectById: (id: string) => sources.find((s) => s.id === id) ?? null,
    };

    const home = {
      controller: { owner: { username: ME } },
      memory: {
        remoteRooms: [
          {
            roomName: "W1N2",
            hostile: false,
            sources: sources.map((s) => ({ sourceId: s.id })),
          },
        ],
      },
    } as unknown as Room;

    return { home, created };
  }

  it("places exactly one container per source, not one per free tile", () => {
    const { home, created } = scenario(1);

    planRemoteRoomContainers(home, 5);

    expect(created).toHaveLength(1);
  });

  it("stops placing once the budget is spent", () => {
    const { home, created } = scenario(4);

    const left = planRemoteRoomContainers(home, 2);

    expect(created).toHaveLength(2);
    expect(left).toBe(0);
  });

  it("places nothing when the budget is already exhausted", () => {
    const { home, created } = scenario(3);

    planRemoteRoomContainers(home, 0);

    expect(created).toHaveLength(0);
  });

  it("returns the unspent budget so later rooms can use it", () => {
    const { home } = scenario(1);

    expect(planRemoteRoomContainers(home, 3)).toBe(2);
  });
});

describe("countRemoteContainerSites", () => {
  beforeEach(() => {
    g.Game = {
      rooms: {
        W1N1: { controller: { my: true } },
        W1N2: { controller: { my: false } },
      },
      constructionSites: {},
    };
  });

  it("counts container sites outside owned rooms", () => {
    (g.Game as any).constructionSites = {
      a: site("a", "W1N2", "container"),
      b: site("b", "W9N9", "container"),
    };

    expect(countRemoteContainerSites()).toBe(2);
  });

  it("ignores containers inside owned rooms", () => {
    (g.Game as any).constructionSites = { a: site("a", "W1N1", "container") };

    expect(countRemoteContainerSites()).toBe(0);
  });

  it("ignores non-container sites", () => {
    (g.Game as any).constructionSites = { a: site("a", "W1N2", "road") };

    expect(countRemoteContainerSites()).toBe(0);
  });
});

describe("cleanupSitesOutsideOwnedRooms", () => {
  beforeEach(() => {
    g.Game = {
      rooms: {
        W1N1: { controller: { my: true } },
        W1N2: { controller: { my: false } },
      },
      constructionSites: {},
    };
  });

  it("removes orphaned roads in rooms we do not own", () => {
    const orphan = site("a", "W1N2", "road");
    (g.Game as any).constructionSites = { a: orphan };

    cleanupSitesOutsideOwnedRooms();

    expect(orphan.removed).toBe(true);
  });

  it("removes sites in rooms we have no vision of at all", () => {
    const blind = site("b", "W9N9", "road");
    (g.Game as any).constructionSites = { b: blind };

    cleanupSitesOutsideOwnedRooms();

    expect(blind.removed).toBe(true);
  });

  it("keeps remote source containers", () => {
    const container = site("c", "W1N2", "container");
    (g.Game as any).constructionSites = { c: container };

    cleanupSitesOutsideOwnedRooms();

    expect(container.removed).toBe(false);
  });

  it("never touches anything inside an owned room", () => {
    const road = site("d", "W1N1", "road");
    const rampart = site("e", "W1N1", "rampart");
    (g.Game as any).constructionSites = { d: road, e: rampart };

    cleanupSitesOutsideOwnedRooms();

    expect(road.removed).toBe(false);
    expect(rampart.removed).toBe(false);
  });
});
