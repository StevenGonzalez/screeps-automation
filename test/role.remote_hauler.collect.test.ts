import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_HOSTILE_CREEPS = 103;
g.FIND_DROPPED_RESOURCES = 106;
g.FIND_HOSTILE_STRUCTURES = 109;
g.FIND_SOURCES = 105;
g.FIND_STRUCTURES = 107;
g.RESOURCE_ENERGY = "energy";
g.ERR_NOT_IN_RANGE = -9;

import { runRemoteHauler } from "../src/roles/role.remote_hauler";
import { ROLE_REMOTE_HAULER } from "../src/config/config.roles";

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

function hauler(): Creep {
  const room = {
    name: REMOTE,
    find: (type: number) => (type === g.FIND_DROPPED_RESOURCES ? dropped : []),
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
