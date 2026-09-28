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

vi.mock("../src/config/config.factory", () => ({ MANAGED_COMMODITIES: [] }));
vi.mock("../src/orchestrators/orchestrator.nuker", () => ({ NUKER_GHODIUM_RESERVE: 5000 }));
vi.mock("../src/services/services.combat", () => ({ advanceBoost: () => undefined }));

const { loop: terminalLoop, sellableMineral } = await import("../src/orchestrators/orchestrator.terminal");
const { stallTimeout } = await import("../src/orchestrators/orchestrator.labs");
const { queuedBaseMineralNeed, labMineralShortfall, resolveChain } = await import(
  "../src/services/services.labs"
);

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

describe("lab stall timeout", () => {
  it("waits for a base mineral that is being supplied", () => {
    const room = makeRoom({ name: "R", storage: { H: 1000 }, queue: [{ compound: "OH", amount: 3000 }] });
    setGame([room], 1);
    expect(stallTimeout(room as unknown as Room, ["O", "H"])).toBe(3000);
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
