import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/orchestrators/orchestrator.terminal", () => ({
  MINERAL_LAB_RESERVE: 20_000,
  MINERAL_TERMINAL_CAP: 20_000,
}));

const g = globalThis as Record<string, unknown>;
g.WORK = "work";
g.HARVEST_MINERAL_POWER = 1;
g.ERR_NOT_IN_RANGE = -9;
g.OK = 0;

import { runMineralMiner } from "../src/roles/role.mineral_miner";

function store(contents: Record<string, number>, capacity: number) {
  const used = () => Object.values(contents).reduce((a, b) => a + b, 0);
  return {
    ...contents,
    getUsedCapacity: (r?: string) => (r === undefined ? used() : contents[r] ?? 0),
    getFreeCapacity: () => capacity - used(),
  };
}

function scene(opts: { carried: number; spilled: number; mineralAmount?: number }) {
  const calls: string[] = [];
  const containerPos = { x: 10, y: 10 };
  const mineral = { id: "min", mineralType: "H", mineralAmount: opts.mineralAmount ?? 30_000 };
  const container = { id: "cont", pos: containerPos, store: store({ H: opts.spilled }, 2000) };
  const storage = { id: "storage", store: store({ H: 0 }, 1_000_000) };
  const objects: Record<string, unknown> = { min: mineral, cont: container };
  g.Game = { getObjectById: (id: string) => objects[id] ?? null };
  const creep = {
    room: { memory: { mineralId: "min", mineralContainerId: "cont" }, storage },
    pos: { isEqualTo: (p: unknown) => p === containerPos },
    store: store({ H: opts.carried }, 200),
    getActiveBodyparts: () => 5,
    harvest: () => { calls.push("harvest"); return 0; },
    withdraw: (_t: unknown, r: string, n: number) => { calls.push(`withdraw ${r} ${n}`); return 0; },
    transfer: (t: { id: string }) => { calls.push(`transfer ${t.id}`); return 0; },
    moveTo: () => 0,
    suicide: () => { calls.push("suicide"); return 0; },
  };
  return { creep: creep as unknown as Creep, calls };
}

describe("mineral miner", () => {
  beforeEach(() => {
    g.Game = undefined;
  });

  it("delivers before a harvest would spill onto the container", () => {
    const { creep, calls } = scene({ carried: 197, spilled: 0 });
    runMineralMiner(creep);
    expect(calls).toEqual(["transfer storage"]);
  });

  it("harvests while the next harvest still fits", () => {
    const { creep, calls } = scene({ carried: 195, spilled: 0 });
    runMineralMiner(creep);
    expect(calls).toEqual(["harvest"]);
  });

  it("takes back spilled minerals, leaving room for the harvest", () => {
    const { creep, calls } = scene({ carried: 100, spilled: 1500 });
    runMineralMiner(creep);
    expect(calls).toEqual(["withdraw H 95", "harvest"]);
  });

  it("drains the container before retiring on a depleted mineral", () => {
    const { creep, calls } = scene({ carried: 0, spilled: 300, mineralAmount: 0 });
    runMineralMiner(creep);
    expect(calls).toEqual(["withdraw H 200"]);
  });

  it("retires once the depleted mineral's container is empty", () => {
    const { creep, calls } = scene({ carried: 0, spilled: 0, mineralAmount: 0 });
    runMineralMiner(creep);
    expect(calls).toEqual(["suicide"]);
  });
});
