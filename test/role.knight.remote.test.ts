import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_HOSTILE_CREEPS = 103;
g.FIND_MY_CREEPS = 107;
g.FIND_MY_SPAWNS = 108;
g.FIND_HOSTILE_STRUCTURES = 109;
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
import { markRemoteInvader } from "../src/services/services.creep";
import { ROLE_KNIGHT } from "../src/config/config.roles";

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
  g.Game = { time: 1000 };
  g.Memory = { rooms: { [HOME]: { remoteRooms: [remoteEntry] } } };
});

describe("remote knight", () => {
  it("rides out while invaders hold its remote", () => {
    remoteEntry.invaderUntil = 1500;
    const knight = knightIn(HOME);
    runKnight(knight);
    expect(destination(knight)).toBe(REMOTE);
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
      "Raiders fell upon the vendors in the Shadow March.",
    ]);
  });
});
