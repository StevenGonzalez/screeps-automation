import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_HOSTILE_CREEPS = 103;
g.ATTACK_POWER = 30;
g.RANGED_ATTACK_POWER = 10;
g.DISMANTLE_POWER = 50;
g.HEAL_POWER = 12;
g.FIND_DROPPED_RESOURCES = 106;
g.FIND_HOSTILE_STRUCTURES = 109;
g.FIND_SOURCES = 105;
g.FIND_STRUCTURES = 107;
g.RESOURCE_ENERGY = "energy";
g.STRUCTURE_SPAWN = "spawn";
g.STRUCTURE_EXTENSION = "extension";
g.STRUCTURE_TOWER = "tower";
g.ERR_NOT_IN_RANGE = -9;
g.OK = 0;
g.RoomPosition = class {
  constructor(public x: number, public y: number, public roomName: string) {}
};

import { runRemoteHauler } from "../src/roles/role.remote_hauler";
import { ROLE_REMOTE_HAULER } from "../src/config/config.roles";
import { cryFor } from "../src/services/services.herald";

const HOME = "W1N1";
const REMOTE = "W2N1";

function pos(x: number, y: number) {
  return {
    x,
    y,
    roomName: REMOTE,
    inRangeTo: (other: { pos?: { x: number; y: number } }, range: number) => {
      const o = other.pos ?? (other as unknown as { x: number; y: number });
      return Math.max(Math.abs(o.x - x), Math.abs(o.y - y)) <= range;
    },
  };
}

let dropped: { amount: number; resourceType: string; pos: ReturnType<typeof pos> }[];
let container: { id: string; pos: ReturnType<typeof pos>; store: Record<string, number> };

let strangers: unknown[];

function hauler(): Creep {
  const room = {
    name: REMOTE,
    find: (type: number) =>
      type === g.FIND_DROPPED_RESOURCES ? dropped : type === g.FIND_HOSTILE_CREEPS ? strangers : [],
  };
  return {
    name: "Merchant Aldo",
    room,
    hits: 1000,
    memory: { role: ROLE_REMOTE_HAULER, homeRoom: HOME, targetRoom: REMOTE, _hp: 1000 } as CreepMemory,
    store: {
      energy: 0,
      [g.RESOURCE_ENERGY as string]: 0,
      getFreeCapacity: () => 1000,
    },
    pos: {
      ...pos(20, 20),
      findClosestByRange: (type: number, opts?: { filter: (o: unknown) => boolean }) => {
        const list = type === g.FIND_DROPPED_RESOURCES ? dropped : [];
        return list.filter((o) => !opts || opts.filter(o))[0] ?? null;
      },
    },
    withdraw: vi.fn(() => g.ERR_NOT_IN_RANGE),
    pickup: vi.fn(() => g.ERR_NOT_IN_RANGE),
    moveTo: vi.fn(() => 0),
  } as unknown as Creep;
}

beforeEach(() => {
  container = { id: "cont1", pos: pos(30, 30), store: { energy: 2000 } };
  dropped = [];
  strangers = [];
  g.Game = {
    time: 1000,
    getObjectById: (id: string) => (id === "cont1" ? container : null),
  };
  g.Memory = {
    rooms: {
      [HOME]: {
        remoteRooms: [
          { roomName: REMOTE, sources: [{ sourceId: "s1", containerId: "cont1" }], lastSeen: 0, hostile: false },
        ],
      },
    },
  };
});

describe("remote hauler pickup", () => {
  it("takes the pile spilled beside a full container before the container", () => {
    dropped = [{ amount: 3000, resourceType: "energy", pos: pos(30, 31) }];
    const creep = hauler();

    runRemoteHauler(creep);

    expect(creep.pickup).toHaveBeenCalledWith(dropped[0]);
    expect(creep.withdraw).not.toHaveBeenCalled();
  });

  it("withdraws from the container when nothing lies beside it", () => {
    dropped = [{ amount: 3000, resourceType: "energy", pos: pos(5, 5) }];
    const creep = hauler();

    runRemoteHauler(creep);

    expect(creep.withdraw).toHaveBeenCalledWith(container, "energy");
    expect(creep.pickup).not.toHaveBeenCalled();
  });
});

describe("remote hauler among another player's creeps", () => {
  function stranger(...parts: string[]) {
    return { owner: { username: "Stranger" }, body: parts.map((type) => ({ type, hits: 100 })) };
  }
  const remote = () => (g.Memory as any).rooms[HOME].remoteRooms[0] as RemoteRoomData;

  it("keeps collecting past unarmed workers", () => {
    // Ticks apart from the other tests', so no threat cached by them is read back.
    (g.Game as any).time = 2001;
    strangers = [stranger("work", "carry", "move")];
    const creep = hauler();
    runRemoteHauler(creep);
    expect(creep.withdraw).toHaveBeenCalledWith(container, "energy");
    expect(remote().hostile).toBe(false);
  });

  it("flees an armed creep and marks the remote hostile", () => {
    (g.Game as any).time = 2002;
    strangers = [stranger("attack", "move")];
    const creep = hauler();
    runRemoteHauler(creep);
    expect(creep.withdraw).not.toHaveBeenCalled();
    expect(remote().hostile).toBe(true);
  });
});

describe("remote hauler at home", () => {
  it("calls out the gold it unloads at the treasury", () => {
    const storage = { store: { getFreeCapacity: () => 50_000 } };
    const c = hauler() as unknown as Record<string, unknown>;
    Object.assign(c, {
      room: { name: HOME, storage, find: () => [] },
      memory: { ...(c.memory as CreepMemory), working: true },
      store: { energy: 800, getFreeCapacity: () => 200 },
      transfer: vi.fn(() => 0),
    });
    runRemoteHauler(c as unknown as Creep);
    expect(c.transfer).toHaveBeenCalledWith(storage, "energy");
    expect(cryFor(c as unknown as Creep)).toBe("+800 gold");
  });

  it("unloads at the throne's container once a keep without storage is full", () => {
    const full = { getFreeCapacity: () => 0 };
    const core = [
      { structureType: "spawn", store: full },
      { structureType: "extension", store: full },
      { structureType: "tower", store: full },
    ];
    const throne = { id: "up1", store: { getFreeCapacity: () => 1500 } };
    (g.Game as any).getObjectById = (id: string) => (id === "up1" ? throne : null);
    const c = hauler() as unknown as Record<string, unknown>;
    Object.assign(c, {
      room: {
        name: HOME,
        memory: { upgradeContainerId: "up1" },
        find: (_type: number, opts?: { filter: (s: unknown) => boolean }) => core.filter((s) => !opts || opts.filter(s)),
      },
      memory: { ...(c.memory as CreepMemory), working: true },
      store: { energy: 350, getFreeCapacity: () => 0 },
      transfer: vi.fn(() => g.ERR_NOT_IN_RANGE),
    });
    runRemoteHauler(c as unknown as Creep);
    expect(c.transfer).toHaveBeenCalledWith(throne, "energy");
    expect(c.moveTo).toHaveBeenCalledWith(throne, expect.anything());
  });

  it("calls out and counts the gold it hands to a keep with no storage", () => {
    const extension = { structureType: "extension", store: { getFreeCapacity: () => 50 } };
    const c = hauler() as unknown as Record<string, unknown>;
    Object.assign(c, {
      room: {
        name: HOME,
        memory: {},
        find: (_type: number, opts?: { filter: (s: unknown) => boolean }) =>
          [extension].filter((s) => !opts || opts.filter(s)),
      },
      pos: { findClosestByRange: (targets: unknown[]) => targets[0] },
      memory: { ...(c.memory as CreepMemory), working: true, hauled: 1000 },
      store: { energy: 350, getFreeCapacity: () => 0 },
      transfer: vi.fn(() => g.OK),
    });
    runRemoteHauler(c as unknown as Creep);
    expect(c.transfer).toHaveBeenCalledWith(extension, "energy");
    expect(cryFor(c as unknown as Creep)).toBe("+50 gold");
    expect((c.memory as CreepMemory).hauled).toBe(1050);
  });
});
