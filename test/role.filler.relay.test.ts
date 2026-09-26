import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;

g.ERR_NOT_IN_RANGE = -9;
g.OK = 0;

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
  const creep = {
    room: { name: "W1N1", storage },
    pos: { isNearTo: () => true },
    store: { energy },
    withdraw: (t: { id: string }) => {
      calls.push(`withdraw:${t.id}`);
      return g.OK;
    },
    transfer: (t: { id: string }) => {
      calls.push(`transfer:${t.id}`);
      return g.OK;
    },
    moveTo: () => g.OK,
  } as unknown as Creep;
  return { creep, calls };
}

beforeEach(() => {
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
});
