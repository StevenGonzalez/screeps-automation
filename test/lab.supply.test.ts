import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.OK = 0;
g.ERR_TIRED = -11;
g.ERR_NOT_ENOUGH_RESOURCES = -6;
g.ERR_FULL = -8;
g.ORDER_SELL = "sell";
g.ORDER_BUY = "buy";
g.RESOURCE_GHODIUM = "G";
g.COMMODITIES = {};
g.FIND_MY_STRUCTURES = 108;
g.FIND_MY_CREEPS = 102;

vi.mock("../src/config/config.factory", () => ({ MANAGED_COMMODITIES: [] }));
vi.mock("../src/orchestrators/orchestrator.nuker", () => ({ NUKER_GHODIUM_RESERVE: 5000 }));
vi.mock("../src/services/services.combat", () => ({ advanceBoost: () => undefined }));

const { loop: terminalLoop, sellableMineral } = await import("../src/orchestrators/orchestrator.terminal");
const { stallTimeout, planAutoProduction, loop: labLoop } = await import("../src/orchestrators/orchestrator.labs");
const { queuedBaseMineralNeed, labMineralShortfall, resolveChain } = await import(
  "../src/services/services.labs"
);
const { brewName } = await import("../src/services/services.herald");

function store(contents: Record<string, number>) {
  return {
    ...contents,
    getUsedCapacity: (r?: string) =>
      r === undefined ? Object.values(contents).reduce((a, b) => a + b, 0) : contents[r] ?? 0,
    getFreeCapacity: () => 100_000,
  };
}

type Setup = {
  name: string;
  storage?: Record<string, number>;
  terminal?: Record<string, number>;
  inputLab?: Record<string, number>;
  queue?: { compound: string; amount: number }[];
  lastProduced?: number;
};

const objects: Record<string, unknown> = {};

function makeRoom(o: Setup) {
  const terminal = {
    id: `${o.name}-t`,
    cooldown: 0,
    store: store({ energy: 20_000, ...(o.terminal ?? {}) }),
    send: () => 0,
  };
  objects[terminal.id] = terminal;
  const labIds: string[] = [];
  if (o.queue) {
    for (const i of [0, 1]) {
      const lab = { id: `${o.name}-lab${i}`, store: store(i === 0 ? o.inputLab ?? {} : {}) };
      objects[lab.id] = lab;
      labIds.push(lab.id);
    }
  }
  const room = {
    name: o.name,
    controller: { my: true },
    storage: { store: store(o.storage ?? {}) },
    terminal,
    memory: {
      terminalId: terminal.id,
      labSystem: o.queue
        ? {
            queue: o.queue,
            inputLabIds: labIds,
            outputLabIds: [],
            activeCompound: o.lastProduced !== undefined ? o.queue[0].compound : undefined,
            lastProduced: o.lastProduced,
          }
        : undefined,
    } as Record<string, unknown>,
    find: () => [],
  };
  return room;
}

let deals: { id: string; amount: number }[] = [];

function setGame(rooms: ReturnType<typeof makeRoom>[], time: number, sellOrders: unknown[] = []) {
  g.Game = {
    time,
    rooms: Object.fromEntries(rooms.map((r) => [r.name, r])),
    getObjectById: (id: string) => objects[id] ?? null,
    map: { getRoomLinearDistance: () => 2 },
    gcl: { level: 1 },
    market: {
      credits: 0,
      orders: {},
      getAllOrders: () => sellOrders,
      getHistory: () => [{ avgPrice: 1 }],
      calcTransactionCost: (amount: number) => Math.ceil(amount * 0.05),
      deal: (id: string, amount: number) => {
        deals.push({ id, amount });
        return 0;
      },
    },
  };
}

beforeEach(() => {
  g.Memory = {};
  deals = [];
  for (const k of Object.keys(objects)) delete objects[k];
});

describe("lab mineral need", () => {
  it("counts only what the running reaction has left to make", () => {
    const need = queuedBaseMineralNeed(
      [
        { compound: "OH", amount: 3000 },
        { compound: "UH", amount: 1000 },
      ],
      2000
    );
    expect(need.get("O")).toBe(1000);
    expect(need.get("H")).toBe(2000);
    expect(need.get("U")).toBe(1000);
  });

  it("nets storage, terminal, input labs and incoming sends out of the shortfall", () => {
    const room = makeRoom({
      name: "R",
      storage: { O: 500 },
      terminal: { O: 500 },
      inputLab: { O: 1000 },
      queue: [{ compound: "OH", amount: 3000 }],
    });
    const donor = makeRoom({ name: "D" });
    donor.memory.pendingSend = { resource: "H", amount: 2000, loadTarget: 2000, to: "R" };
    setGame([room, donor], 1);
    const shortfall = labMineralShortfall(room as unknown as Room);
    expect(shortfall.get("O")).toBe(1000);
    expect(shortfall.get("H")).toBe(1000);
  });

  it("plans reactions net of terminal stock", () => {
    const room = makeRoom({ name: "R", terminal: { OH: 3000 } });
    setGame([room], 1);
    const chain = resolveChain("OH", 3000, room as unknown as Room);
    expect(chain).toEqual([]);
  });

  it("keeps the room's own mineral when the lab queue needs more than the reserve", () => {
    const room = makeRoom({
      name: "R",
      storage: { H: 20_000 },
      terminal: { H: 10_000 },
      queue: [{ compound: "OH", amount: 25_000 }],
    });
    setGame([room], 1);
    const t = room.terminal as unknown as StructureTerminal;
    expect(sellableMineral(room as unknown as Room, t, "H" as MineralConstant)).toBe(5_000);
  });
});

// The terminal keeps each resource's order book for a few ticks, so tests that
// set their own orders run at ticks well apart, ahead of the terminal tests.
describe("lab stall timeout", () => {
  const cheapO = { id: "sellO", type: "sell", resourceType: "O", price: 1, amount: 50_000, roomName: "W9N9" };

  it("waits for a base mineral the market sells", () => {
    const room = makeRoom({ name: "R", storage: { H: 1000 }, queue: [{ compound: "OH", amount: 3000 }] });
    setGame([room], 100, [cheapO]);
    expect(stallTimeout(room as unknown as Room, ["O", "H"])).toBe(3000);
  });

  it("waits for a base mineral another room is sending", () => {
    const room = makeRoom({ name: "R", storage: { H: 1000 }, queue: [{ compound: "OH", amount: 3000 }] });
    const donor = makeRoom({ name: "D" });
    donor.memory.pendingSend = { resource: "O", amount: 3000, loadTarget: 3000, to: "R" };
    setGame([room, donor], 120);
    expect(stallTimeout(room as unknown as Room, ["O", "H"])).toBe(3000);
  });

  it("does not wait for a base mineral nobody will send or sell", () => {
    const room = makeRoom({ name: "R", storage: { H: 1000 }, queue: [{ compound: "OH", amount: 3000 }] });
    setGame([room], 140);
    expect(stallTimeout(room as unknown as Room, ["O", "H"])).toBe(200);
  });

  it("aborts quickly when both inputs are on hand", () => {
    const room = makeRoom({ name: "R", storage: { H: 1000, O: 1000 }, queue: [{ compound: "OH", amount: 3000 }] });
    setGame([room], 1);
    expect(stallTimeout(room as unknown as Room, ["O", "H"])).toBe(200);
  });

  it("aborts quickly when a missing input is a compound only an earlier reaction makes", () => {
    const room = makeRoom({ name: "R", storage: { UH: 1000 }, queue: [{ compound: "UH2O", amount: 3000 }] });
    setGame([room], 1);
    expect(stallTimeout(room as unknown as Room, ["UH", "OH"])).toBe(200);
  });
});

describe("auto production planning", () => {
  const minerals = { H: 1000, O: 1000, U: 1000, K: 1000, L: 1000, Z: 1000, X: 1000 };
  const withoutU = { H: 1000, O: 1000, K: 1000, L: 1000, Z: 1000, X: 1000 };

  it("plans the first target under its cap", () => {
    const room = makeRoom({ name: "R", storage: minerals, queue: [] });
    setGame([room], 1000);
    planAutoProduction(room as unknown as Room);
    expect((room.memory.labSystem as LabSystemMemory).plannedTarget).toBe("XUH2O");
  });

  it("passes over a target short of a base mineral nobody will send or sell", () => {
    const room = makeRoom({ name: "R", storage: withoutU, queue: [] });
    setGame([room], 300);
    planAutoProduction(room as unknown as Room);
    const ls = room.memory.labSystem as LabSystemMemory;
    expect(ls.plannedTarget).toBe("XKHO2");
    expect(ls.queue.some((e) => e.compound === "UH")).toBe(false);
  });

  it("plans a target whose missing base mineral the market sells", () => {
    const room = makeRoom({ name: "R", storage: withoutU, queue: [] });
    const cheapU = { id: "sellU", type: "sell", resourceType: "U", price: 1, amount: 50_000, roomName: "W9N9" };
    setGame([room], 400, [cheapU]);
    planAutoProduction(room as unknown as Room);
    expect((room.memory.labSystem as LabSystemMemory).plannedTarget).toBe("XUH2O");
  });

  it("plans a target whose missing base mineral another room has to spare", () => {
    const room = makeRoom({ name: "R", storage: withoutU, queue: [] });
    const donor = makeRoom({ name: "D", storage: { U: 20_000 } });
    setGame([room, donor], 500);
    planAutoProduction(room as unknown as Room);
    expect((room.memory.labSystem as LabSystemMemory).plannedTarget).toBe("XUH2O");
  });

  it("skips a benched target so the ones after it get a turn", () => {
    const room = makeRoom({ name: "R", storage: minerals, queue: [] });
    const ls = room.memory.labSystem as LabSystemMemory;
    ls.benchedUntil = { XUH2O: 2000 };
    setGame([room], 1000);
    planAutoProduction(room as unknown as Room);
    expect(ls.plannedTarget).toBe("XKHO2");
    expect(ls.queue.at(-1)?.compound).toBe("XKHO2");
  });

  it("plans a benched target again once its bench ends", () => {
    const room = makeRoom({ name: "R", storage: minerals, queue: [] });
    const ls = room.memory.labSystem as LabSystemMemory;
    ls.benchedUntil = { XUH2O: 2000 };
    setGame([room], 2000);
    planAutoProduction(room as unknown as Room);
    expect(ls.plannedTarget).toBe("XUH2O");
  });

  it("benches the target and drops its chain when a step stalls", () => {
    const queue = [
      { compound: "UH2O", amount: 3000, auto: true },
      { compound: "XUH2O", amount: 3000, auto: true },
      { compound: "GH", amount: 1000 },
    ];
    const room = makeRoom({ name: "R", queue, lastProduced: 0 });
    const out = { id: "R-out", store: store({}), runReaction: () => 0 };
    objects[out.id] = out;
    const ls = room.memory.labSystem as LabSystemMemory;
    Object.assign(ls, {
      outputLabIds: [out.id],
      inputCompounds: ["UH", "OH"],
      startStock: 0,
      targetAmount: 3000,
      lastProgressTick: 1000,
      lastPlanTick: 1500,
      plannedTarget: "XUH2O",
    });
    setGame([room], 1500);
    labLoop();
    // The console order queued behind the auto chain survives.
    expect(ls.queue).toEqual([{ compound: "GH", amount: 1000 }]);
    expect(ls.plannedTarget).toBeUndefined();
    expect(ls.benchedUntil?.XUH2O).toBe(11_500);
  });
});

describe("brews in the chronicle", () => {
  function brewing(
    queue: LabQueueEntry[],
    plannedTarget: string,
    stock: number,
    lastProduced: number,
    time: number,
    idle = 10
  ) {
    const room = makeRoom({ name: "R", storage: { [queue[0].compound]: stock }, queue, lastProduced });
    const out = { id: "R-out", store: store({}), runReaction: () => 0 };
    objects[out.id] = out;
    Object.assign(room.memory.labSystem as LabSystemMemory, {
      outputLabIds: [out.id],
      inputCompounds: REACTION_INPUTS[queue[0].compound],
      startStock: 0,
      targetAmount: queue[0].amount,
      lastProgressTick: time - idle,
      lastPlanTick: time,
      plannedTarget,
    });
    setGame([room], time);
    labLoop();
    return ((Memory.chronicle ?? []) as { text: string }[]).map((e) => e.text);
  }
  const REACTION_INPUTS: Record<string, [string, string]> = { OH: ["O", "H"], UH2O: ["UH", "OH"] };

  it("names each brew for what it does", () => {
    expect(brewName("OH")).toBe("cinnabar");
    expect(brewName("KO")).toBe("draughts of the far shot");
    expect(brewName("UH2O")).toBe("elixirs of strength");
    expect(brewName("GHO2")).toBe("elixirs of iron skin");
    expect(brewName("XZHO2")).toBe("philters of swiftness");
  });

  it("tells of a chain that finishes what it was planned for", () => {
    const lines = brewing([{ compound: "OH", amount: 3000, auto: true }], "OH", 3000, 2990, 600);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^The goblin of \w+'s labs brewed 3\.0K cinnabar\.$/);
  });

  it("tells what a chain made before it ran short", () => {
    const lines = brewing([{ compound: "OH", amount: 7000, auto: true }], "OH", 1490, 1490, 700, 500);
    expect(lines).toEqual([expect.stringMatching(/brewed 1\.5K cinnabar\.$/)]);
  });

  it("says nothing of a step that only feeds the next", () => {
    const queue = [
      { compound: "UH2O", amount: 3000, auto: true },
      { compound: "XUH2O", amount: 3000, auto: true },
    ];
    expect(brewing(queue, "XUH2O", 3000, 2990, 800)).toEqual([]);
  });
});

describe("lab supply through the terminal", () => {
  const cheapH = { id: "sellH", type: "sell", resourceType: "H", price: 1, amount: 50_000, roomName: "W9N9" };

  it("sends a lab shortfall from a room with spare stock instead of buying it", () => {
    const receiver = makeRoom({ name: "R", queue: [{ compound: "OH", amount: 3000 }], storage: { O: 3000 } });
    const donor = makeRoom({ name: "D", storage: { H: 10_000 } });
    setGame([receiver, donor], 1000, [cheapH]);

    terminalLoop();

    expect(donor.memory.pendingSend).toMatchObject({ resource: "H", amount: 3000, to: "R" });
    expect(deals).toEqual([]);
  });

  it("does not take minerals a donor's own labs need", () => {
    const receiver = makeRoom({ name: "R", queue: [{ compound: "OH", amount: 3000 }], storage: { O: 3000 } });
    const donor = makeRoom({ name: "D", storage: { H: 10_000 }, queue: [{ compound: "UH", amount: 6000 }] });
    setGame([receiver, donor], 1000, [cheapH]);

    terminalLoop();

    expect(donor.memory.pendingSend).toBeUndefined();
    expect(deals).toEqual([{ id: "sellH", amount: 3000 }]);
  });

  it("buys a large shortfall in big lots and checks again soon", () => {
    const receiver = makeRoom({ name: "R", queue: [{ compound: "OH", amount: 12_000 }], storage: { O: 12_000 } });
    setGame([receiver], 1001, [cheapH]);

    terminalLoop();

    expect(deals).toEqual([{ id: "sellH", amount: 5000 }]);
    expect(receiver.memory.nextMarketBuyTick).toBe(1021);
  });
});
