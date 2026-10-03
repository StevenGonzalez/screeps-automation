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

import { runFiller, getTerminalEnergyJob } from "../src/roles/role.filler";

function makeStore(id: string, energy: number, free: number) {
  return {
    id,
    pos: { x: 25, y: 25 },
    store: {
      energy,
      getFreeCapacity: () => free,
      getUsedCapacity: (r?: string) => (r === undefined || r === "energy" ? energy : 0),
    },
  };
}

function makeFiller(
  energy: number,
  opts: { storageEnergy?: number; terminalEnergy?: number; pendingSend?: unknown } = {}
) {
  const calls: string[] = [];
  const storage = makeStore("storage1", opts.storageEnergy ?? 200_000, 800_000);
  const terminal = makeStore("terminal1", opts.terminalEnergy ?? 0, 100_000);
  const room = {
    name: "W1N1",
    storage,
    terminal,
    memory: { pendingSend: opts.pendingSend },
  };
  const creep = {
    room,
    memory: {},
    pos: { isNearTo: () => true, findClosestByRange: () => null },
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
  return { creep, calls, room: room as unknown as Room };
}

beforeEach(() => {
  g.Game = { time: 1, getObjectById: () => null };
  relayLink = null;
  coreTarget = null;
});

describe("filler terminal energy", () => {
  it("draws from storage to fill a starved terminal", () => {
    const { creep, calls } = makeFiller(0, { terminalEnergy: 0 });
    runFiller(creep);
    expect(calls).toEqual(["withdraw:storage1"]);
  });

  it("delivers its load to a starved terminal", () => {
    const { creep, calls } = makeFiller(400, { terminalEnergy: 0 });
    runFiller(creep);
    expect(calls).toEqual(["transfer:terminal1"]);
  });

  it("leaves the terminal alone when storage is near empty", () => {
    const { creep, calls } = makeFiller(0, { storageEnergy: 15_000, terminalEnergy: 0 });
    runFiller(creep);
    expect(calls).toEqual([]);
  });

  it("drains a terminal holding delivered energy into storage", () => {
    const { creep, calls } = makeFiller(0, { terminalEnergy: 40_000 });
    runFiller(creep);
    expect(calls).toEqual(["withdraw:terminal1"]);

    const loaded = makeFiller(400, { terminalEnergy: 40_000 });
    runFiller(loaded.creep);
    expect(loaded.calls).toEqual(["transfer:storage1"]);
  });

  it("keeps energy loaded for a queued send and helps load it", () => {
    const pendingSend = { resource: "energy", amount: 30_000, loadTarget: 31_000, to: "W2N2" };
    const loading = makeFiller(0, { terminalEnergy: 20_000, pendingSend });
    expect(getTerminalEnergyJob(loading.room, loading.room.storage)?.kind).toBe("fill");

    const loaded = makeFiller(0, { terminalEnergy: 31_000, pendingSend });
    expect(getTerminalEnergyJob(loaded.room, loaded.room.storage)).toBeNull();
  });

  it("does nothing inside the working band", () => {
    const { creep, calls, room } = makeFiller(0, { terminalEnergy: 12_000 });
    expect(getTerminalEnergyJob(room, room.storage)).toBeNull();
    runFiller(creep);
    expect(calls).toEqual([]);
  });

  it("fills the core before the terminal", () => {
    coreTarget = { id: "ext1", store: {} };
    const { creep, calls } = makeFiller(400, { terminalEnergy: 0 });
    runFiller(creep);
    expect(calls).toEqual(["transfer:ext1"]);
  });

  it("feeds the relay before the terminal", () => {
    relayLink = { id: "storageLink", store: { energy: 0, getFreeCapacity: () => 800 } };
    const { creep, calls } = makeFiller(400, { terminalEnergy: 0 });
    runFiller(creep);
    expect(calls).toEqual(["transfer:storageLink"]);
  });
});
