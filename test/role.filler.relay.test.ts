import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;

g.ERR_NOT_IN_RANGE = -9;
g.OK = 0;
g.RESOURCE_POWER = "power";

let relayLink: unknown = null;
let coreTarget: unknown = null;

vi.mock("../src/services/services.creep", () => ({
  findEmptiestTower: () => null,
  findCoreFillTarget: () => coreTarget,
  getRoomStructures: () => [],
}));
vi.mock("../src/services/services.combat", () => ({
  getThreatInfo: () => ({ hostiles: [] }),
}));
vi.mock("../src/orchestrators/orchestrator.links", () => ({
  findRelayLink: () => relayLink,
}));

import { runFiller } from "../src/roles/role.filler";

const storage = {
  id: "storage1",
  pos: { x: 25, y: 25 },
  store: { energy: 50_000, getFreeCapacity: () => 950_000 },
};

function makeLink(free: number) {
  return { id: "storageLink", store: { energy: 800 - free, getFreeCapacity: () => free } };
}

function makeFiller(energy: number) {
  const calls: string[] = [];
  const taken: (number | undefined)[] = [];
  const creep = {
    room: { name: "W1N1", storage, memory: {} },
    memory: {},
    pos: { isNearTo: () => true, findClosestByRange: () => null },
    store: { energy, getFreeCapacity: () => 1600 - energy },
    withdraw: (t: { id: string }, _resource: string, amount?: number) => {
      calls.push(`withdraw:${t.id}`);
      taken.push(amount);
      return g.OK;
    },
    transfer: (t: { id: string }) => {
      calls.push(`transfer:${t.id}`);
      return g.OK;
    },
    moveTo: () => g.OK,
  } as unknown as Creep;
  return { creep, calls, taken };
}

function withStorage(creep: Creep, energy: number) {
  (creep.room as unknown as { storage: unknown }).storage = {
    ...storage,
    store: { energy, getFreeCapacity: () => 900_000 },
  };
}

beforeEach(() => {
  g.Game = { time: 1, getObjectById: () => null };
  g.Memory = {};
  relayLink = null;
  coreTarget = null;
});

describe("filler storage-link relay", () => {
  it("draws from storage when idle and the relay is wanted", () => {
    relayLink = makeLink(800);
    const { creep, calls } = makeFiller(0);

    runFiller(creep);

    expect(calls).toEqual(["withdraw:storage1"]);
  });

  it("takes only what the link can hold", () => {
    relayLink = makeLink(300);
    const { creep, taken } = makeFiller(0);

    runFiller(creep);

    expect(taken).toEqual([300]);
  });

  // A full load dropped storage under the floor, the relay switched off, and
  // the barmaid carried the load back and took it again, every tick.
  it("leaves storage alone when the link's load would cross the treasury floor", () => {
    relayLink = makeLink(800);
    const { creep, calls } = makeFiller(0);
    withStorage(creep, 10_500);

    runFiller(creep);

    expect(calls).toEqual([]);
  });

  it("refills the link when storage stays above the floor", () => {
    relayLink = makeLink(800);
    const { creep, calls } = makeFiller(0);
    withStorage(creep, 10_801);

    runFiller(creep);

    expect(calls).toEqual(["withdraw:storage1"]);
  });

  it("puts its load into the storage link rather than back into storage", () => {
    relayLink = makeLink(800);
    const { creep, calls } = makeFiller(400);

    runFiller(creep);

    expect(calls).toEqual(["transfer:storageLink"]);
  });

  it("returns its load to storage when the storage link is full", () => {
    relayLink = makeLink(0);
    const { creep, calls } = makeFiller(400);

    runFiller(creep);

    expect(calls).toEqual(["transfer:storage1"]);
  });

  it("stays idle beside storage when no relay is wanted", () => {
    const { creep, calls } = makeFiller(0);

    runFiller(creep);

    expect(calls).toEqual([]);
  });

  it("fills the core before feeding the link", () => {
    relayLink = makeLink(800);
    coreTarget = { id: "ext1", store: {} };
    const { creep, calls } = makeFiller(400);

    runFiller(creep);

    expect(calls).toEqual(["transfer:ext1"]);
  });

  it("feeds the relay ahead of the power spawn's energy", () => {
    relayLink = makeLink(800);
    const ps = { id: "ps", store: { power: 100, energy: 0, getFreeCapacity: () => 5000 } };
    g.Game = { time: 1, getObjectById: (id: string) => (id === "ps" ? ps : null) };
    const { creep, calls } = makeFiller(400);
    const room = (creep as unknown as { room: { memory: Record<string, unknown>; storage: unknown } }).room;
    room.memory.powerSpawnId = "ps";
    room.storage = { ...storage, store: { energy: 500_000, getFreeCapacity: () => 500_000 } };

    runFiller(creep);

    expect(calls).toEqual(["transfer:storageLink"]);
  });
});
