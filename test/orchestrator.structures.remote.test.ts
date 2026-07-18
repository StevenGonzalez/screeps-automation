import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;

import {
  canBuildInRemote,
  cleanupSitesOutsideOwnedRooms,
} from "../src/orchestrators/orchestrator.structures";

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
