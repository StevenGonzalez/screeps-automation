import { describe, it, expect, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.OK = 0;
g.ERR_NOT_IN_RANGE = -9;
g.FIND_MY_CREEPS = 102;
g.LAB_MINERAL_CAPACITY = 3000;

vi.mock("../src/services/services.labs", () => ({
  getBoostRequests: () => new Map(),
  assignBoostLabs: () => new Map(),
}));

import { runApothecary } from "../src/roles/role.apothecary";

function store(contents: Record<string, number>, capacity = 3000) {
  const used = (r?: string) =>
    r === undefined ? Object.values(contents).reduce((a, b) => a + b, 0) : contents[r] ?? 0;
  return {
    ...contents,
    getUsedCapacity: used,
    getFreeCapacity: (r?: string) => capacity - used(r),
  };
}

function scene(opts: {
  input: [Record<string, number>, Record<string, number>];
  output: Record<string, number>;
  inputCompounds?: [string, string];
  queue?: { compound: string; amount: number }[];
}) {
  const calls: string[] = [];
  const labs: Record<string, unknown> = {
    in0: { id: "in0", store: store(opts.input[0]) },
    in1: { id: "in1", store: store(opts.input[1]) },
    out0: { id: "out0", store: store(opts.output) },
  };
  const storage = { id: "storage", store: store({ H: 10_000, O: 10_000 }, 1_000_000) };
  const room = {
    name: "W1N1",
    storage,
    memory: {
      labSystem: {
        queue: opts.queue ?? [],
        inputLabIds: ["in0", "in1"],
        outputLabIds: ["out0"],
        inputCompounds: opts.inputCompounds,
      },
    },
    find: () => [],
  };
  g.Game = { getObjectById: (id: string) => labs[id] ?? null };
  const creep = {
    room,
    pos: { isNearTo: () => true },
    store: store({}, 500),
    withdraw: (t: { id: string }, r: string) => {
      calls.push(`withdraw ${r} ${t.id}`);
      return 0;
    },
    transfer: () => 0,
    moveTo: () => 0,
  } as unknown as Creep;
  return { creep, calls };
}

describe("apothecary", () => {
  it("refills inputs before emptying an output lab that is far from full", () => {
    const { creep, calls } = scene({
      input: [{ H: 100 }, { O: 100 }],
      output: { OH: 500 },
      inputCompounds: ["H", "O"],
      queue: [{ compound: "OH", amount: 3000 }],
    });
    runApothecary(creep);
    expect(calls).toEqual(["withdraw H storage"]);
  });

  it("empties an output lab that is filling up before refilling inputs", () => {
    const { creep, calls } = scene({
      input: [{ H: 100 }, { O: 100 }],
      output: { OH: 2500 },
      inputCompounds: ["H", "O"],
      queue: [{ compound: "OH", amount: 3000 }],
    });
    runApothecary(creep);
    expect(calls).toEqual(["withdraw OH out0"]);
  });

  it("returns leftover inputs to storage once nothing is queued", () => {
    const { creep, calls } = scene({ input: [{ H: 40 }, {}], output: {} });
    runApothecary(creep);
    expect(calls).toEqual(["withdraw H in0"]);
  });

  it("leaves the inputs alone while a chain is between steps", () => {
    const { creep, calls } = scene({
      input: [{ H: 40 }, {}],
      output: {},
      queue: [{ compound: "OH", amount: 3000 }],
    });
    runApothecary(creep);
    expect(calls).toEqual([]);
  });
});
