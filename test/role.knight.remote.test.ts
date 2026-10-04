import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_HOSTILE_CREEPS = 103;
g.FIND_MY_CREEPS = 107;
g.FIND_MY_SPAWNS = 108;
g.FIND_HOSTILE_STRUCTURES = 109;
g.ATTACK_POWER = 30;
g.RoomPosition = class {
  constructor(public x: number, public y: number, public roomName: string) {}
};

vi.mock("../src/orchestrators/orchestrator.military", () => ({
  getDefenseOp: () => null,
  getOffensiveOp: () => null,
  runDefensiveKnight: vi.fn(),
  runOffensiveKnight: vi.fn(),
}));

import { runKnight } from "../src/roles/role.knight";
import { clearRemoteInvaderEntry, markRemoteInvader } from "../src/services/services.creep";
import { cryFor } from "../src/services/services.herald";
import { ROLE_KNIGHT } from "../src/config/config.roles";
import { warbandLoss } from "../src/services/services.chronicle";

const HOME = "W1N1";
const REMOTE = "W2N1";

let remoteEntry: RemoteRoomData;

function knightIn(roomName: string): Creep {
  const room = { name: roomName, memory: {}, find: () => [] };
  return {
    name: "Dragon Knight Godric",
    room,
    hits: 1000,
    hitsMax: 1000,
    memory: { role: ROLE_KNIGHT, homeRoom: HOME, targetRoom: REMOTE } as CreepMemory,
    pos: { findInRange: () => [], findClosestByRange: () => null, isNearTo: () => true },
    moveTo: vi.fn(() => 0),
  } as unknown as Creep;
}

function destination(knight: Creep): string | undefined {
  const call = (knight.moveTo as unknown as { mock: { calls: [{ roomName: string }][] } }).mock.calls[0];
  return call?.[0].roomName;
}

beforeEach(() => {
  remoteEntry = { roomName: REMOTE, sources: [], lastSeen: 0, hostile: false } as RemoteRoomData;
  g.Game = { time: 1000, rooms: {}, creeps: {} };
  g.Memory = { rooms: { [HOME]: { remoteRooms: [remoteEntry] } } };
});

describe("remote knight", () => {
  it("rides out while invaders hold its remote", () => {
    remoteEntry.invaderUntil = 1500;
    const knight = knightIn(HOME);
    runKnight(knight);
    expect(destination(knight)).toBe(REMOTE);
  });

  it("cries out and is chronicled riding out, once for each raid", () => {
    remoteEntry.invaderUntil = 1500;
    const knight = knightIn(HOME);
    runKnight(knight);
    expect(cryFor(knight)).toBe("Ride out!");
    g.Game = { time: 1001 };
    runKnight(knight);
    expect(cryFor(knight)).toBeUndefined();

    // The raid ends, and another comes.
    remoteEntry.invaderUntil = undefined;
    g.Game = { time: 1002 };
    runKnight(knight);
    remoteEntry.invaderUntil = 3000;
    g.Game = { time: 2000 };
    runKnight(knight);
    expect((g.Memory as Memory).chronicle?.map((l) => l.text)).toEqual([
      "Dragon Knight Godric rides out against the raiders in the Shadow March.",
      "Dragon Knight Godric rides out against the raiders in the Shadow March.",
    ]);
  });

  it("heads home once its remote is clear, instead of loitering at the border", () => {
    remoteEntry.invaderUntil = 1500;
    const knight = knightIn(REMOTE);
    runKnight(knight);
    expect(remoteEntry.invaderUntil).toBeUndefined();
    expect(destination(knight)).toBe(HOME);
    expect((g.Memory as Memory).chronicle?.map((l) => l.text)).toEqual([
      "The Shadow March is safe again. The vendors take to the road.",
    ]);
  });

  it("waits at home for the second knight it takes to out-hit the raiders' healers", () => {
    remoteEntry.invaderUntil = 1500;
    remoteEntry.invaderStrength = { heal: 120, damage: 80, hits: 2085 };
    const knight = knightIn(HOME);
    const second = { spawning: true, memory: { role: ROLE_KNIGHT, homeRoom: HOME, targetRoom: REMOTE } };
    const home = { name: HOME, energyCapacityAvailable: 850, memory: (g.Memory as Memory).rooms[HOME] };
    g.Game = { time: 1000, rooms: { [HOME]: home }, creeps: { a: knight, b: second } };
    runKnight(knight);
    expect(destination(knight)).toBeUndefined();

    second.spawning = false;
    g.Game = { ...(g.Game as object), time: 1001 };
    runKnight(knight);
    expect(destination(knight)).toBe(REMOTE);
  });

  it("tells of knights who ride out together in one line", () => {
    remoteEntry.invaderUntil = 1500;
    g.Game = { time: 1003, rooms: {}, creeps: {} };
    runKnight(knightIn(HOME));
    runKnight(Object.assign(knightIn(HOME), { name: "Dragon Knight Alaric" }));
    expect((g.Memory as Memory).chronicle?.map((l) => l.text)).toEqual([
      "Dragon Knight Godric and Dragon Knight Alaric ride out together against the raiders in the Shadow March.",
    ]);
  });

  it("stays home against raiders two knights could not beat", () => {
    remoteEntry.invaderUntil = 1500;
    remoteEntry.invaderStrength = { heal: 1000, damage: 80, hits: 2085 };
    const knight = knightIn(HOME);
    const second = { memory: { role: ROLE_KNIGHT, homeRoom: HOME, targetRoom: REMOTE } };
    const home = { name: HOME, energyCapacityAvailable: 850, memory: (g.Memory as Memory).rooms[HOME] };
    g.Game = { time: 1002, rooms: { [HOME]: home }, creeps: { a: knight, b: second } };
    runKnight(knight);
    expect(destination(knight)).toBeUndefined();
  });

  it("stays home while the remote is only marked hostile by a player", () => {
    remoteEntry.hostile = true;
    remoteEntry.hostileUntil = 5000;
    const knight = knightIn(HOME);
    runKnight(knight);
    expect(destination(knight)).toBeUndefined();
  });
});

describe("raids in the chronicle", () => {
  const remoteRoom = { name: REMOTE, find: () => [] } as unknown as Room;

  it("writes a raid once, not on every tick the remote is flagged", () => {
    markRemoteInvader(remoteEntry, remoteRoom);
    g.Game = { time: 1001 };
    markRemoteInvader(remoteEntry, remoteRoom);

    expect((g.Memory as Memory).chronicle?.map((l) => l.text)).toEqual([
      "Raiders under Brakka the Gaunt fell upon the vendors in the Shadow March.",
    ]);
  });

  it("names the raid's warlord when a knight rides out and when the raid ends", () => {
    markRemoteInvader(remoteEntry, remoteRoom);
    runKnight(knightIn(HOME));
    g.Game = { time: 1400 };
    clearRemoteInvaderEntry(remoteEntry);

    expect((g.Memory as Memory).chronicle?.map((l) => l.text)).toEqual([
      "Raiders under Brakka the Gaunt fell upon the vendors in the Shadow March.",
      "Dragon Knight Godric rides out against Brakka the Gaunt's raiders in the Shadow March.",
      "The Shadow March is rid of Brakka the Gaunt's raiders. The vendors take to the road.",
    ]);
  });

  it("names one warlord when a second castle sees the raid a few ticks later", () => {
    markRemoteInvader(remoteEntry, remoteRoom);
    g.Game = { time: 1004 };
    markRemoteInvader({ ...remoteEntry, invaderUntil: undefined }, remoteRoom);
    g.Game = { time: 1400 };
    clearRemoteInvaderEntry(remoteEntry);

    expect((g.Memory as Memory).chronicle?.map((l) => l.text)).toEqual([
      "Raiders under Brakka the Gaunt fell upon the vendors in the Shadow March.",
      "The Shadow March is rid of Brakka the Gaunt's raiders. The vendors take to the road.",
    ]);
  });

  it("brings the same warlord back raid after raid", () => {
    markRemoteInvader(remoteEntry, remoteRoom);
    clearRemoteInvaderEntry(remoteEntry);
    g.Game = { time: 6000 };
    markRemoteInvader(remoteEntry, remoteRoom);
    clearRemoteInvaderEntry(remoteEntry);
    g.Game = { time: 9000 };
    markRemoteInvader(remoteEntry, remoteRoom);

    expect((g.Memory as Memory).chronicle?.map((l) => l.text).filter((t) => !t.includes(" is rid of "))).toEqual([
      "Raiders under Brakka the Gaunt fell upon the vendors in the Shadow March.",
      "Brakka the Gaunt comes back to the Shadow March for a second raid on the vendors.",
      "Brakka the Gaunt comes back to the Shadow March for a third raid on the vendors. The Crown puts a price on the warlord's head.",
    ]);
    expect((g.Memory as Memory).gossip?.line).toBe("a bounty!");
  });

  it("does not draw a warlord whose band still raids another remote", () => {
    (g.Memory as Memory).warbands = { W9N9: { name: "Brakka the Gaunt", at: 1 } };
    markRemoteInvader(remoteEntry, remoteRoom);
    const name = (g.Memory as Memory).warbands![REMOTE].name;
    expect(name).not.toBe("Brakka the Gaunt");
    expect((g.Memory as Memory).chronicle!.at(-1)!.text).toBe(`Raiders under ${name} fell upon the vendors in the Shadow March.`);
  });

  it("draws a new warlord once the last one's band is broken", () => {
    markRemoteInvader(remoteEntry, remoteRoom);
    const first = (g.Memory as Memory).warbands![REMOTE];
    for (let i = 0; i < 5; i++) warbandLoss(REMOTE);
    expect(first.broken).toBe(true);
    clearRemoteInvaderEntry(remoteEntry);
    g.Game = { time: 6000 };
    markRemoteInvader(remoteEntry, remoteRoom);

    const next = (g.Memory as Memory).warbands![REMOTE];
    expect(next.name).not.toBe(first.name);
    expect((g.Memory as Memory).chronicle!.at(-1)!.text).toBe(
      `Raiders under ${next.name} fell upon the vendors in the Shadow March.`
    );
  });
});
