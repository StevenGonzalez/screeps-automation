import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.RoomPosition = class {
  constructor(public x: number, public y: number, public roomName: string) {}
};

import { describeCensus, drawGraves, drawRealmMap } from "../src/orchestrators/orchestrator.visuals";
import {
  ROLE_FILLER,
  ROLE_HAULER,
  ROLE_KNIGHT,
  ROLE_REMOTE_HAULER,
  ROLE_REMOTE_MINER,
  ROLE_TOWNSFOLK,
} from "../src/config/config.roles";

const HOME = "W1N1";

type Drawn = { kind: string; args: unknown[] };
let drawn: Drawn[];

function creep(role: string, roomName: string, targetRoom?: string): Creep {
  return {
    name: `${role}${Math.random()}`,
    room: { name: roomName },
    memory: { role, homeRoom: HOME, targetRoom },
  } as unknown as Creep;
}

function world(creeps: Creep[], remoteRooms: Partial<RemoteRoomData>[] = []): Room {
  const room = {
    name: HOME,
    controller: { my: true, level: 6 },
    memory: { remoteRooms },
  } as unknown as Room;
  const byName: Record<string, Creep> = {};
  for (const c of creeps) byName[c.name] = c;
  const record = (kind: string) => (...args: unknown[]) => {
    drawn.push({ kind, args });
  };
  g.Game = {
    time: 1000,
    creeps: byName,
    rooms: { [HOME]: room },
    map: { visual: { text: record("text"), line: record("line"), circle: record("circle") } },
  };
  g.Memory = { rooms: { [HOME]: { townName: "Ravenhold" } } };
  return room;
}

beforeEach(() => {
  drawn = [];
});

describe("census", () => {
  it("counts the castle's people by title, home and abroad", () => {
    const room = world([
      creep(ROLE_HAULER, HOME),
      creep(ROLE_HAULER, HOME),
      creep(ROLE_FILLER, HOME),
      creep(ROLE_TOWNSFOLK, HOME),
      // A merchant bringing its load home still serves abroad.
      creep(ROLE_REMOTE_HAULER, HOME, "W2N1"),
      creep(ROLE_KNIGHT, "W2N1", "W2N1"),
    ]);

    expect(describeCensus(room)).toEqual(["2 Porters · 1 Barmaid", "1 Dragon Knight · 1 Merchant"]);
  });
});

describe("realm map", () => {
  it("names the castle and draws a road to each remote its peddlers work", () => {
    world(
      [creep(ROLE_REMOTE_MINER, "W2N1", "W2N1")],
      [
        { roomName: "W2N1", hostile: false, sources: [] },
        { roomName: "W1N2", hostile: false, sources: [] },
      ]
    );

    drawRealmMap();

    const texts = drawn.filter((d) => d.kind === "text").map((d) => d.args[0]);
    expect(texts).toContain("Ravenhold");
    expect(texts).toContain("vendors");
    const lines = drawn.filter((d) => d.kind === "line");
    expect(lines).toHaveLength(1);
    expect((lines[0].args[1] as RoomPosition).roomName).toBe("W2N1");
  });

  it("marks a raided remote and the keep being saved for", () => {
    world(
      [creep(ROLE_REMOTE_MINER, "W2N1", "W2N1")],
      [{ roomName: "W2N1", hostile: false, invaderUntil: 1500, sources: [] }]
    );
    (g.Memory as Memory).expansionSavings = { room: HOME, target: "W1N2" };

    drawRealmMap();

    const texts = drawn.filter((d) => d.kind === "text").map((d) => d.args[0]);
    expect(texts).toContain("raided");
    expect(texts).toContain("keep planned");
    expect(drawn.filter((d) => d.kind === "circle")).toHaveLength(1);
  });
});

describe("graves", () => {
  it("marks the tombstones of ours with their names, and no one else's", () => {
    const tombs = [
      { pos: { x: 10, y: 12 }, creep: { my: true, name: "Merchant Leofric" } },
      { pos: { x: 30, y: 30 }, creep: { my: false, name: "Invader123" } },
    ];
    const visual = {
      text: (...args: unknown[]) => drawn.push({ kind: "text", args }),
      line: (...args: unknown[]) => drawn.push({ kind: "line", args }),
    };
    const room = {
      name: "W2N1",
      visual,
      find: (_type: number, opts?: { filter: (t: unknown) => boolean }) => tombs.filter(opts?.filter ?? (() => true)),
    } as unknown as Room;

    drawGraves(room);

    expect(drawn.filter((d) => d.kind === "text").map((d) => d.args[0])).toEqual(["Merchant Leofric"]);
    expect(drawn.filter((d) => d.kind === "line")).toHaveLength(2);
  });
});
