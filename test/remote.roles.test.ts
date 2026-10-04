import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.OK = 0;
g.ERR_NOT_OWNER = -1;
g.ERR_NOT_IN_RANGE = -9;
g.FIND_HOSTILE_CREEPS = 103;
g.ATTACK_POWER = 30;
g.RANGED_ATTACK_POWER = 10;
g.DISMANTLE_POWER = 50;
g.HEAL_POWER = 12;
g.FIND_SOURCES = 105;
g.FIND_STRUCTURES = 107;
g.FIND_MY_CONSTRUCTION_SITES = 114;
g.FIND_HOSTILE_STRUCTURES = 109;
g.LOOK_RESOURCES = "resource";
g.RESOURCE_ENERGY = "energy";
g.RoomPosition = class {
  constructor(public x: number, public y: number, public roomName: string) {}
};

import { runReserver } from "../src/roles/role.reserver";
import { runRemoteMiner } from "../src/roles/role.remote_miner";
import { runSkHauler } from "../src/roles/role.sk_hauler";
import { loop as skLoop } from "../src/orchestrators/orchestrator.sourcekeeper";
import { cryFor } from "../src/services/services.herald";

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

  describe("raising its container", () => {
    const site = { structureType: "container" };
    const pile = { resourceType: "energy", amount: 3000 };
    let tick = 2000;

    function builderBeside(piles: unknown[], carried: number, at: unknown = site) {
      // A fresh tick, so no threat cached by the tests above is read back.
      (g.Game as any).time = ++tick;
      const source = {
        id: "src",
        pos: { findInRange: (type: number) => (type === g.FIND_MY_CONSTRUCTION_SITES ? [at] : []) },
      };
      (g.Game as any).getObjectById = (id: string) => (id === "src" ? source : null);
      const creep = minerIn(REMOTE, {
        store: { energy: carried, getFreeCapacity: () => 50 - carried },
        build: vi.fn(() => 0),
        pickup: vi.fn(() => 0),
        name: "Peddler Edric",
        getActiveBodyparts: () => 6,
      });
      creep.pos = { ...creep.pos, findInRange: () => piles } as any;
      creep.memory._hp = 100;
      runRemoteMiner(creep as unknown as Creep);
      return creep;
    }

    it("builds every tick with the gold lying at its feet", () => {
      const creep = builderBeside([pile], 20);
      expect(creep.pickup).toHaveBeenCalledWith(pile);
      expect(creep.build).toHaveBeenCalledWith(site);
      expect(creep.harvest).not.toHaveBeenCalled();
    });

    it("digs a full load before building when none lies there", () => {
      const creep = builderBeside([], 20);
      expect(creep.harvest).toHaveBeenCalled();
      expect(creep.build).not.toHaveBeenCalled();
      expect(builderBeside([], 50).build).toHaveBeenCalledWith(site);
    });

    it("tells the chronicle once when it lays the last of the container", () => {
      const last = { id: "c1", structureType: "container", progress: 4980, progressTotal: 5000, pos: { roomName: REMOTE } };
      builderBeside([pile], 20, { ...last, progress: 4900 });
      expect((g.Memory as any).chronicle ?? []).toHaveLength(0);
      builderBeside([pile], 20, last);
      builderBeside([pile], 20, last);
      const lines = (g.Memory as any).chronicle;
      expect(lines).toHaveLength(1);
      expect(lines[0].text).toMatch(/^Peddler Edric raised a waystation in the /);
    });

    it("tells the second waystation in a remote as the second", () => {
      const last = { id: "c2", structureType: "container", progress: 4980, progressTotal: 5000, pos: { roomName: REMOTE } };
      (g.Memory as any).chronicle = [];
      const first = { structureType: "container" };
      (g.Game as any).time = ++tick;
      const source = {
        id: "src",
        pos: { findInRange: (type: number) => (type === g.FIND_MY_CONSTRUCTION_SITES ? [last] : []) },
      };
      (g.Game as any).getObjectById = (id: string) => (id === "src" ? source : null);
      const creep = minerIn(REMOTE, {
        store: { energy: 20, getFreeCapacity: () => 30 },
        build: vi.fn(() => 0),
        pickup: vi.fn(() => 0),
        name: "Peddler Lucan",
        getActiveBodyparts: () => 6,
      });
      creep.pos = { ...creep.pos, findInRange: () => [pile] } as any;
      creep.room.find = ((type: number) => (type === g.FIND_STRUCTURES ? [first] : [])) as any;
      creep.memory._hp = 100;
      runRemoteMiner(creep as unknown as Creep);
      const lines = (g.Memory as any).chronicle;
      expect(lines).toHaveLength(1);
      expect(lines[0].text).toMatch(/^Peddler Lucan raised a second waystation in the .*, so the merchants of .* load at both its diggings\.$/);
    });
  });

  describe("on its container", () => {
    let tick = 2500;

    function minerOn(free: number, lying: number) {
      // A fresh tick, so no threat cached by another test is read back.
      (g.Game as any).time = ++tick;
      const container = { id: "c1", hits: 250_000, hitsMax: 250_000, store: { getFreeCapacity: () => free } };
      const source = { id: "src", pos: { findInRange: () => [] } };
      (g.Game as any).getObjectById = (id: string) => (id === "src" ? source : id === "c1" ? container : null);
      const creep = minerIn(REMOTE, { name: "Peddler Osric" });
      creep.memory._hp = 100;
      (creep.memory as CreepMemory).assignedContainerId = "c1" as Id<StructureContainer>;
      creep.pos = { ...creep.pos, lookFor: () => [{ resourceType: "energy", amount: lying }] } as any;
      runRemoteMiner(creep as unknown as Creep);
      return creep;
    }

    it("rests while its container is full and a load and more lies beside it", () => {
      expect(minerOn(0, 1500).harvest).not.toHaveBeenCalled();
    });

    it("calls for a buyer now and then while it rests", () => {
      tick = 2524;
      expect(cryFor(minerOn(0, 1500) as unknown as Creep)).toBe("no buyers");
      expect(cryFor(minerOn(0, 1500) as unknown as Creep)).toBeUndefined();
    });

    it("digs while the container has room or the merchants have taken the pile", () => {
      expect(minerOn(100, 1500).harvest).toHaveBeenCalled();
      expect(minerOn(0, 400).harvest).toHaveBeenCalled();
    });
  });

  // Another player's workers passing through cannot hurt a vendor. Taking them
  // for raiders cost Embercrag the Witch Weald's gold for thousands of ticks.
  describe("meeting another player's creeps in the remote", () => {
    let tick = 3000;

    function minerAmong(...parts: string[]) {
      // A fresh tick, so no threat cached by another test is read back.
      (g.Game as any).time = ++tick;
      const source = { id: "src", pos: { findInRange: () => [] } };
      (g.Game as any).getObjectById = (id: string) => (id === "src" ? source : null);
      const stranger = { owner: { username: "Stranger" }, body: parts.map((type) => ({ type, hits: 100 })) };
      const creep = minerIn(REMOTE);
      creep.memory._hp = 100;
      creep.room.find = ((type: number) => (type === g.FIND_HOSTILE_CREEPS ? [stranger] : [])) as any;
      runRemoteMiner(creep as unknown as Creep);
      return creep;
    }

    it("keeps digging past unarmed workers", () => {
      const creep = minerAmong("work", "work", "carry", "move");
      expect(remote.hostile).toBe(false);
      expect(creep.harvest).toHaveBeenCalled();
    });

    it("flees an armed creep and marks the remote hostile", () => {
      const creep = minerAmong("ranged_attack", "move");
      expect(remote.hostile).toBe(true);
      expect(creep.harvest).not.toHaveBeenCalled();
    });
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
