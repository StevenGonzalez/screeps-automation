import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_HOSTILE_CREEPS = 103;
g.FIND_STRUCTURES = 107;
g.RESOURCE_ENERGY = "energy";
g.ERR_NOT_IN_RANGE = -9;
g.OK = 0;
g.RoomPosition = class {
  constructor(public x: number, public y: number, public roomName: string) {}
};

import { runRemoteHauler } from "../src/roles/role.remote_hauler";
import { ROLE_HAULER, ROLE_REMOTE_HAULER } from "../src/config/config.roles";

const HOME = "W1N1";
let tick = 1000;

type Store = { energy: number; getFreeCapacity: () => number };
function store(energy: number, capacity: number): Store {
  const s = { energy, getFreeCapacity: () => capacity - s.energy };
  return s;
}

// Grimford: storage in the south of the keep, the throne's container in the
// north beside the way in from the remote above it.
let storage: { id: string; pos: { x: number; y: number }; store: Store };
let throne: { id: string; pos: { x: number; y: number }; store: Store };
let roomMemory: Partial<RoomMemory>;
let creeps: Record<string, unknown>;

function merchantAt(x: number, y: number, load = 500) {
  const room = { name: HOME, storage, memory: roomMemory, find: () => [] };
  const unloaded: string[] = [];
  const creep = {
    name: "Merchant Aldo",
    room,
    hits: 1000,
    memory: { role: ROLE_REMOTE_HAULER, homeRoom: HOME, targetRoom: "W1N2", _hp: 1000, working: true } as CreepMemory,
    store: store(load, 500),
    pos: {
      x,
      y,
      roomName: HOME,
      getRangeTo: (o: { pos: { x: number; y: number } }) => Math.max(Math.abs(o.pos.x - x), Math.abs(o.pos.y - y)),
    },
    transfer: vi.fn((target: { id: string }) => (unloaded.push(target.id), g.ERR_NOT_IN_RANGE)),
    moveTo: vi.fn(() => 0),
  };
  creeps[creep.name] = creep;
  return { creep: creep as unknown as Creep, unloaded };
}

function nextTick() {
  tick++;
  (g.Game as { time: number }).time = tick;
}

beforeEach(() => {
  tick += 100;
  storage = { id: "storage", pos: { x: 22, y: 26 }, store: store(60_000, 1_000_000) };
  throne = { id: "throne", pos: { x: 14, y: 5 }, store: store(0, 2000) };
  roomMemory = { upgradeContainerId: "throne" as Id<StructureContainer>, minerContainerIds: [] };
  creeps = {};
  g.Game = {
    time: tick,
    creeps,
    rooms: {},
    getObjectById: (id: string) => (id === "throne" ? throne : id === "storage" ? storage : null),
  };
  g.Memory = { rooms: { [HOME]: { remoteRooms: [] } } };
});

describe("merchant unloading at home", () => {
  it("unloads at the throne's container when it comes in nearer the throne than the storage", () => {
    const { creep, unloaded } = merchantAt(15, 1);
    runRemoteHauler(creep);
    expect(unloaded).toEqual(["throne"]);
  });

  it("takes the load on to storage when it comes in nearer the storage", () => {
    const { creep, unloaded } = merchantAt(30, 40);
    runRemoteHauler(creep);
    expect(unloaded).toEqual(["storage"]);
  });

  it("leaves the throne to a link", () => {
    roomMemory.controllerLinkIds = ["link" as Id<StructureLink>];
    const { creep, unloaded } = merchantAt(15, 1);
    runRemoteHauler(creep);
    expect(unloaded).toEqual(["storage"]);
  });

  it("leaves a throne container that a miner fills alone", () => {
    roomMemory.minerContainerIds = ["throne" as Id<StructureContainer>];
    const { creep, unloaded } = merchantAt(15, 1);
    runRemoteHauler(creep);
    expect(unloaded).toEqual(["storage"]);
  });

  it("keeps the gold for the treasury when it is below its floor", () => {
    storage.store.energy = 5_000;
    const { creep, unloaded } = merchantAt(15, 1);
    runRemoteHauler(creep);
    expect(unloaded).toEqual(["storage"]);
  });

  it("takes the load on when the throne cannot hold all of it", () => {
    throne.store.energy = 1600;
    const { creep, unloaded } = merchantAt(15, 1);
    runRemoteHauler(creep);
    expect(unloaded).toEqual(["storage"]);
  });

  it("counts the gold a porter is already bringing to the throne", () => {
    throne.store.energy = 1100;
    creeps["Porter Wat"] = { name: "Porter Wat", memory: { role: ROLE_HAULER, fillTargetId: "throne" }, store: { energy: 500 } };
    const { creep, unloaded } = merchantAt(15, 1);
    runRemoteHauler(creep);
    expect(unloaded).toEqual(["storage"]);
  });

  it("keeps to the throne once bound for it while there is room, then goes on to storage", () => {
    const { creep, unloaded } = merchantAt(15, 1);
    runRemoteHauler(creep);
    expect(creep.memory.fillTargetId).toBe("throne");

    // A porter fills it up first, leaving room for part of the load.
    throne.store.energy = 1700;
    nextTick();
    runRemoteHauler(creep);
    throne.store.energy = 2000;
    nextTick();
    runRemoteHauler(creep);
    expect(unloaded).toEqual(["throne", "throne", "storage"]);
  });

  it("gives up its claim on the throne once it has unloaded", () => {
    const { creep } = merchantAt(15, 1);
    runRemoteHauler(creep);
    expect(creep.memory.fillTargetId).toBe("throne");
    (creep.store as unknown as Store).energy = 0;
    nextTick();
    runRemoteHauler(creep);
    expect(creep.memory.fillTargetId).toBeUndefined();
  });
});
