import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;

g.ERR_NOT_IN_RANGE = -9;
g.OK = 0;
g.RESOURCE_POWER = "power";

vi.mock("../src/services/services.creep", () => ({
  findEmptiestTower: () => null,
  findCoreFillTarget: () => null,
  getRoomStructures: () => [],
}));
vi.mock("../src/services/services.combat", () => ({
  getThreatInfo: () => ({ hostiles: [] }),
}));
vi.mock("../src/orchestrators/orchestrator.links", () => ({
  findRelayLink: () => null,
}));

import { runFiller } from "../src/roles/role.filler";
import { terminalStockJob } from "../src/orchestrators/orchestrator.terminal";

function store(id: string, contents: Record<string, number>, capacity: number) {
  const used = (r?: string) =>
    r === undefined ? Object.values(contents).reduce((a, b) => a + b, 0) : contents[r] ?? 0;
  return {
    id,
    pos: { x: 25, y: 25 },
    store: { ...contents, getUsedCapacity: used, getFreeCapacity: () => capacity - used() },
  };
}

function makeRoom(opts: {
  storageH: number;
  terminalH: number;
  storageO?: number;
  storageExtra?: Record<string, number>;
  pendingSend?: unknown;
}) {
  return {
    name: "W1N1",
    // Energy in both sits inside the filler's working band, so no energy job.
    storage: store("storage1", { energy: 200_000, H: opts.storageH, O: opts.storageO ?? 0, ...opts.storageExtra }, 1_000_000),
    terminal: store("terminal1", { energy: 12_000, H: opts.terminalH }, 300_000),
    memory: { mineralId: "min1", pendingSend: opts.pendingSend },
  } as unknown as Room;
}

function makeFiller(room: Room, cargo: Record<string, number>) {
  const calls: string[] = [];
  const creep = {
    room,
    memory: {},
    pos: { isNearTo: () => true },
    store: { ...cargo, getFreeCapacity: () => 800 },
    withdraw: (t: { id: string }, r: string, n?: number) => {
      calls.push(`withdraw:${t.id}:${r}:${n}`);
      return g.OK;
    },
    transfer: (t: { id: string }, r: string) => {
      calls.push(`transfer:${t.id}:${r}`);
      return g.OK;
    },
    moveTo: () => g.OK,
  } as unknown as Creep;
  return { creep, calls };
}

beforeEach(() => {
  g.Game = {
    time: 1,
    getObjectById: (id: string) => (id === "min1" ? { mineralType: "H" } : null),
  };
});

describe("terminalStockJob", () => {
  it("stages the room's mineral surplus above the lab reserve", () => {
    // 35k held, 20k reserve: 15k may sit in the terminal for sale.
    expect(terminalStockJob(makeRoom({ storageH: 30_000, terminalH: 5_000 }))).toEqual({
      resource: "H",
      amount: 10_000,
    });
  });

  it("leaves the reserve in storage", () => {
    expect(terminalStockJob(makeRoom({ storageH: 20_000, terminalH: 0 }))).toBeNull();
  });

  it("does not stage past the terminal cap", () => {
    expect(terminalStockJob(makeRoom({ storageH: 100_000, terminalH: 20_000 }))).toBeNull();
  });

  it("loads a pending mineral send first", () => {
    const pendingSend = { resource: "O", amount: 3_000, loadTarget: 3_000, to: "W2N2" };
    const room = makeRoom({ storageH: 30_000, terminalH: 0, storageO: 5_000, pendingSend });
    expect(terminalStockJob(room)).toEqual({ resource: "O", amount: 3_000 });
  });
});

describe("raw stock staging", () => {
  it("stages raw deposit a room without a factory cannot use", () => {
    const room = makeRoom({ storageH: 0, terminalH: 0, storageExtra: { silicon: 3_000 } });
    expect(terminalStockJob(room)).toEqual({ resource: "silicon", amount: 3_000 });
  });

  it("keeps power for the power spawn", () => {
    const room = makeRoom({ storageH: 0, terminalH: 0, storageExtra: { power: 9_000 } });
    (room.memory as RoomMemory).powerSpawnId = "ps1" as Id<StructurePowerSpawn>;
    expect(terminalStockJob(room)).toBeNull();
  });
});

describe("filler mineral staging", () => {
  it("draws surplus mineral from storage when idle", () => {
    const { creep, calls } = makeFiller(makeRoom({ storageH: 30_000, terminalH: 0 }), { energy: 0 });
    runFiller(creep);
    expect(calls).toEqual(["withdraw:storage1:H:800"]);
  });

  it("carries mineral it holds to the terminal", () => {
    const { creep, calls } = makeFiller(makeRoom({ storageH: 30_000, terminalH: 0 }), { H: 800 });
    runFiller(creep);
    expect(calls).toEqual(["transfer:terminal1:H"]);
  });
});
