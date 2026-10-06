import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_HOSTILE_CREEPS = 103;
g.FIND_STRUCTURES = 107;
g.FIND_MY_SPAWNS = 112;
g.RESOURCE_ENERGY = "energy";
g.ERR_NOT_IN_RANGE = -9;
g.OK = 0;
g.RoomPosition = class {
  constructor(public x: number, public y: number, public roomName: string) {}
};

import { runRemoteHauler } from "../src/roles/role.remote_hauler";
import { ROLE_HAULER, ROLE_REMOTE_HAULER } from "../src/config/config.roles";
import { cryFor } from "../src/services/services.herald";

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
let spawn: { id: string; recycleCreep: ReturnType<typeof vi.fn> };

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
      findClosestByRange: (type: number) => (type === g.FIND_MY_SPAWNS ? spawn : null),
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
  spawn = { id: "spawn", recycleCreep: vi.fn(() => g.OK) };
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

describe("a merchant near the end of its days", () => {
  // The merchant has just unloaded at home with `ticksToLive` left.
  function unloaded(creep: Creep, ticksToLive: number) {
    (creep.moveTo as ReturnType<typeof vi.fn>).mockClear();
    creep.memory.working = true;
    (creep.store as unknown as Store).energy = 0;
    (creep as { ticksToLive?: number }).ticksToLive = ticksToLive;
    runRemoteHauler(creep);
  }

  function wait(ticks: number) {
    tick += ticks;
    (g.Game as { time: number }).time = tick;
  }

  function setsOut(creep: Creep): boolean {
    return (creep.moveTo as ReturnType<typeof vi.fn>).mock.calls.some(
      ([to]) => (to as { roomName?: string }).roomName === "W1N2"
    );
  }

  it("sets out again while it has the days for a trip as long as its last", () => {
    const { creep } = merchantAt(15, 1, 0);
    unloaded(creep, 1000);
    wait(200);
    unloaded(creep, 200);
    expect(setsOut(creep)).toBe(true);
    // Once on its way it keeps on, though fewer days are left than the trip.
    nextTick();
    (creep as { ticksToLive?: number }).ticksToLive = 199;
    runRemoteHauler(creep);
    expect(spawn.recycleCreep).not.toHaveBeenCalled();
  });

  it("bids the road farewell and is recycled once its days fall short of another trip", () => {
    const { creep } = merchantAt(15, 1, 0);
    unloaded(creep, 1000);
    wait(200);
    spawn.recycleCreep.mockReturnValue(g.ERR_NOT_IN_RANGE);
    unloaded(creep, 199);
    expect(setsOut(creep)).toBe(false);
    expect(creep.moveTo).toHaveBeenCalledWith(spawn, expect.anything());
    expect(cryFor(creep)).toBe("Farewell!");
    // It keeps on to the spawn on the ticks after.
    nextTick();
    (creep as { ticksToLive?: number }).ticksToLive = 198;
    spawn.recycleCreep.mockClear().mockReturnValue(g.OK);
    runRemoteHauler(creep);
    expect(spawn.recycleCreep).toHaveBeenCalledWith(creep);
  });

  it.each([
    ["is struck on the road", (c: Creep) => (c.memory.remoteBackoffUntil = tick + 300)],
    ["flees raiders", () => (g.Memory as { rooms: Record<string, RoomMemory> }).rooms[HOME].remoteRooms!.push(
      { roomName: "W1N2", hostile: true, sources: [], lastSeen: 0 } as RemoteRoomData)],
  ])("does not time a trip it cut short when it %s", (_, flee) => {
    const { creep } = merchantAt(15, 1, 0);
    unloaded(creep, 1000);
    wait(200);
    unloaded(creep, 1000);
    wait(100);
    flee(creep);
    runRemoteHauler(creep);
    wait(500);
    delete creep.memory.remoteBackoffUntil;
    (g.Memory as { rooms: Record<string, RoomMemory> }).rooms[HOME].remoteRooms = [];
    unloaded(creep, 250);
    expect(setsOut(creep)).toBe(true);
  });
});
