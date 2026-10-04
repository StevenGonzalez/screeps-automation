import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.OK = 0;
g.ERR_NOT_OWNER = -1;
g.ERR_NOT_IN_RANGE = -9;
g.FIND_HOSTILE_CREEPS = 103;
g.FIND_SOURCES = 105;
g.FIND_STRUCTURES = 107;
g.FIND_MY_CONSTRUCTION_SITES = 114;
g.FIND_HOSTILE_STRUCTURES = 109;
g.RoomPosition = class {
  constructor(public x: number, public y: number, public roomName: string) {}
};

import { runReserver } from "../src/roles/role.reserver";
import { runRemoteMiner } from "../src/roles/role.remote_miner";
import { runSkHauler } from "../src/roles/role.sk_hauler";
import { loop as skLoop } from "../src/orchestrators/orchestrator.sourcekeeper";

const HOME = "W1N1";
const REMOTE = "W1N2";
const ME = "Me";

let remote: RemoteRoomData;

beforeEach(() => {
  remote = { roomName: REMOTE, sources: [], lastSeen: 0, hostile: false };
  g.Game = { time: 1000, creeps: {}, rooms: {}, getObjectById: () => null };
  g.Memory = { rooms: { [HOME]: { remoteRooms: [remote] } }, allies: ["Pal"] };
});

describe("reserver", () => {
  function reserverIn(controller: unknown) {
    return {
      owner: { username: ME },
      room: { name: REMOTE, controller, memory: {} as RoomMemory },
      pos: { getRangeTo: () => 1 },
      memory: { role: "reserver", homeRoom: HOME, targetRoom: REMOTE },
      reserveController: vi.fn(() => 0),
      signController: vi.fn(() => 0),
      attackController: vi.fn(() => 0),
      suicide: vi.fn(),
      moveTo: vi.fn(),
    };
  }

  it("attacks a controller someone else (incl. Invader) reserves", () => {
    const c = reserverIn({ reservation: { username: "Invader" } });
    runReserver(c as unknown as Creep);
    expect(c.attackController).toHaveBeenCalled();
    expect(c.reserveController).not.toHaveBeenCalled();
  });

  it("reserves an unreserved or self-reserved controller", () => {
    const c = reserverIn({ reservation: { username: ME } });
    runReserver(c as unknown as Creep);
    expect(c.reserveController).toHaveBeenCalled();
  });

  it("signs the remote's controller with a proclamation", () => {
    const c = reserverIn({ reservation: { username: ME }, pos: {} });
    runReserver(c as unknown as Creep);
    expect(c.signController).toHaveBeenCalledWith(c.room.controller, expect.any(String));
  });

  it("leaves a sign alone once it is ours and current", () => {
    const first = reserverIn({ reservation: { username: ME }, pos: {} });
    runReserver(first as unknown as Creep);
    const text = first.signController.mock.calls[0][1];
    (g.Game as any).time += 10000;
    const c = reserverIn({ reservation: { username: ME }, pos: {}, sign: { username: ME, text } });
    runReserver(c as unknown as Creep);
    expect(c.signController).not.toHaveBeenCalled();
  });

  it("gives up on a room another player owns", () => {
    const c = reserverIn({ my: false, owner: { username: "Stranger" } });
    runReserver(c as unknown as Creep);
    expect(c.suicide).toHaveBeenCalled();
    expect(c.attackController).not.toHaveBeenCalled();
  });

  it("stands down once the remote has become one of our own keeps", () => {
    const c = reserverIn({ my: true, owner: { username: ME } });
    runReserver(c as unknown as Creep);
    expect(c.suicide).toHaveBeenCalled();
    expect(c.reserveController).not.toHaveBeenCalled();
  });
});

describe("remote miner", () => {
  function minerIn(roomName: string, extra: Record<string, unknown> = {}) {
    return {
      hits: 100,
      owner: { username: ME },
      store: { energy: 0 },
      pos: { isNearTo: () => true, isEqualTo: () => true },
      room: { name: roomName, controller: undefined, find: () => [] },
      memory: { role: "remote_miner", homeRoom: HOME, targetRoom: REMOTE, remoteSourceId: "src", _hp: 200 },
      moveTo: vi.fn(),
      suicide: vi.fn(),
      harvest: vi.fn(() => 0),
      ...extra,
    };
  }

  it("does not flag the remote over damage taken in a transit room", () => {
    runRemoteMiner(minerIn("W5N5") as unknown as Creep);
    expect(remote.hostile).toBe(false);
  });

  it("flags the remote hostile over damage from a player inside it", () => {
    const player = { owner: { username: "Stranger" }, body: [{ type: "attack", hits: 100 }] };
    const creep = minerIn(REMOTE);
    creep.room.find = ((type: number) => (type === g.FIND_HOSTILE_CREEPS ? [player] : [])) as any;
    runRemoteMiner(creep as unknown as Creep);
    expect(remote.hostile).toBe(true);
    expect(remote.hostileStrikes).toBe(1);
  });

  it("calls a knight, not a player strike, over damage from Invaders inside it", () => {
    const creep = minerIn(REMOTE);
    const invader = { owner: { username: "Invader" }, body: [{ type: "work", hits: 100 }] };
    creep.room.find = ((type: number) => (type === g.FIND_HOSTILE_CREEPS ? [invader] : [])) as any;
    runRemoteMiner(creep as unknown as Creep);
    expect(remote.hostile).toBe(false);
    expect(remote.hostileStrikes).toBeUndefined();
    expect(remote.invaderUntil).toBeGreaterThan(1000);
  });

  it("marks the remote hostile when a player's reservation blocks harvesting", () => {
    const source = { id: "src", pos: { findInRange: () => [] } };
    (g.Game as any).getObjectById = (id: string) => (id === "src" ? source : null);
    const creep = minerIn(REMOTE, { harvest: vi.fn(() => -1) });
    creep.memory._hp = 100;
    creep.room.controller = { reservation: { username: "Stranger" } } as any;
    runRemoteMiner(creep as unknown as Creep);
    expect(creep.harvest).toHaveBeenCalled();
    expect(remote.hostile).toBe(true);
  });
});

describe("sk hauler", () => {
  it("keeps collecting until full, then delivers", () => {
    (g.Memory as any).skOps = [{ id: 1, roomName: "W5N5", homeRoom: HOME, sourceIds: [] }];
    let used = 100;
    const creep = {
      room: { name: "W4N5" },
      pos: { x: 25, y: 25 },
      ticksToLive: 1000,
      store: {
        getUsedCapacity: () => used,
        getFreeCapacity: () => 500 - used,
      },
      memory: { role: "sk_hauler", skOpId: 1 } as CreepMemory,
      moveTo: vi.fn(),
    };
    runSkHauler(creep as unknown as Creep);
    // Partly full and outside the SK room: heading to the SK room, not home.
    expect(creep.memory.working).toBeFalsy();
    expect(creep.moveTo.mock.calls[0][0].roomName).toBe("W5N5");

    used = 500;
    creep.moveTo.mockClear();
    runSkHauler(creep as unknown as Creep);
    expect(creep.memory.working).toBe(true);
    expect(creep.moveTo.mock.calls[0][0].roomName).toBe(HOME);
  });
});

describe("source keeper op contest", () => {
  function opRoomWith(hostiles: unknown[]) {
    (g.Memory as any).skOps = [
      { id: 1, roomName: "W5N5", homeRoom: HOME, startedAt: 1000, discovered: true, sourceIds: [] },
    ];
    (g.Game as any).rooms = {
      W5N5: {
        find: (_t: number, opts?: { filter?: (c: unknown) => boolean }) =>
          opts?.filter ? hostiles.filter(opts.filter) : hostiles,
      },
    };
    skLoop();
    return (g.Memory as any).skOps[0] as SourceKeeperOp;
  }
  const body = (...types: string[]) => types.map((type) => ({ type, hits: 100 }));

  it("ignores allies and unarmed scouts", () => {
    const op = opRoomWith([
      { owner: { username: "Pal" }, body: body("attack") },
      { owner: { username: "Stranger" }, body: body("move") },
    ]);
    expect(op.lastFailure).toBeUndefined();
  });

  it("pauses for an armed player creep", () => {
    const op = opRoomWith([{ owner: { username: "Stranger" }, body: body("attack") }]);
    expect(op.lastFailure).toBe(1000);
  });
});
