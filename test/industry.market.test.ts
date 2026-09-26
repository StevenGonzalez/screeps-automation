import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.OK = 0;
g.ERR_TIRED = -11;
g.ERR_NOT_ENOUGH_RESOURCES = -6;
g.ERR_FULL = -8;
g.ORDER_SELL = "sell";
g.ORDER_BUY = "buy";
g.RESOURCE_GHODIUM = "G";
g.RESOURCE_BATTERY = "battery";
g.RESOURCE_UTRIUM_BAR = "utrium_bar";
g.RESOURCE_WIRE = "wire";
g.RESOURCE_SWITCH = "switch";
g.PWR_OPERATE_FACTORY = 19;
// COMMODITY_TARGETS lists every commodity; give any unset RESOURCE_* its name.
for (const n of [
  "LEMERGIUM_BAR", "ZYNTHIUM_BAR", "KEANIUM_BAR", "OXIDANT", "REDUCTANT", "PURIFIER",
  "GHODIUM_MELT", "CELL", "ALLOY", "CONDENSATE", "COMPOSITE", "CRYSTAL", "LIQUID",
  "TRANSISTOR", "MICROCHIP", "CIRCUIT", "DEVICE", "PHLEGM", "TISSUE", "MUSCLE",
  "ORGANOID", "ORGANISM", "TUBE", "FIXTURES", "FRAME", "HYDRAULICS", "MACHINE",
  "CONCENTRATE", "EXTRACT", "SPIRIT", "EMANATION", "ESSENCE",
]) {
  if (g[`RESOURCE_${n}`] === undefined) g[`RESOURCE_${n}`] = n.toLowerCase();
}
g.COMMODITIES = {
  battery: { components: { energy: 600 }, amount: 50, cooldown: 10 },
  utrium_bar: { components: { U: 500, energy: 200 }, amount: 100, cooldown: 20 },
  wire: { components: { utrium_bar: 20, silicon: 100, energy: 40 }, amount: 20, cooldown: 8 },
  switch: { components: { wire: 40, oxidant: 95, utrium_bar: 35, energy: 20 }, amount: 5, cooldown: 70, level: 1 },
};

for (const [n, v] of Object.entries({
  HYDROGEN: "H", OXYGEN: "O", UTRIUM: "U", LEMERGIUM: "L", KEANIUM: "K", ZYNTHIUM: "Z", CATALYST: "X",
})) {
  g[`RESOURCE_${n}`] = v;
}

// Imported after the globals above, which these modules read at load time.
const { sellableMineral, feedsLocalRecipe, loop } = await import(
  "../src/orchestrators/orchestrator.terminal"
);
const { factoryCanRun } = await import("../src/orchestrators/orchestrator.factory");
const { queuedBaseMineralNeed } = await import("../src/services/services.labs");

function store(contents: Record<string, number>) {
  return {
    ...contents,
    getUsedCapacity: (r?: string) =>
      r === undefined ? Object.values(contents).reduce((a, b) => a + b, 0) : contents[r] ?? 0,
    getFreeCapacity: () => 100_000,
  };
}

let clock = 1000;
beforeEach(() => {
  clock += 1000;
  g.Memory = {};
});

describe("sellableMineral", () => {
  it("keeps the lab reserve across storage and terminal", () => {
    const room = {
      memory: {},
      storage: { store: store({ H: 15_000 }) },
    } as unknown as Room;
    const terminal = { store: store({ H: 8_000 }) } as unknown as StructureTerminal;
    // 23k total, 20k reserve: 3k may go.
    expect(sellableMineral(room, terminal, "H" as MineralConstant)).toBe(3_000);
  });

  it("does not sell what a pending send has claimed", () => {
    const room = {
      memory: { pendingSend: { resource: "H", loadTarget: 5_000 } },
      storage: { store: store({ H: 40_000 }) },
    } as unknown as Room;
    const terminal = { store: store({ H: 8_000 }) } as unknown as StructureTerminal;
    expect(sellableMineral(room, terminal, "H" as MineralConstant)).toBe(3_000);
  });
});

describe("feedsLocalRecipe", () => {
  function roomWithFactory(level: number | undefined) {
    const factory = { level };
    g.Game = { getObjectById: () => factory };
    return { memory: { factorySystem: { factoryId: "f1" } } } as unknown as Room;
  }

  it("treats a bar as an intermediate when the factory can make wire from it", () => {
    expect(feedsLocalRecipe(roomWithFactory(undefined), "utrium_bar" as ResourceConstant)).toBe(true);
  });

  it("treats wire as an end product for a level-0 factory, an input for level 1", () => {
    expect(feedsLocalRecipe(roomWithFactory(undefined), "wire" as ResourceConstant)).toBe(false);
    expect(feedsLocalRecipe(roomWithFactory(1), "wire" as ResourceConstant)).toBe(true);
  });

  it("sells everything when the room has no factory", () => {
    g.Game = { getObjectById: () => null };
    const room = { memory: {} } as unknown as Room;
    expect(feedsLocalRecipe(room, "utrium_bar" as ResourceConstant)).toBe(false);
  });
});

describe("factoryCanRun", () => {
  const operated = [{ effect: 19 }];
  it("runs unleveled recipes anywhere", () => {
    expect(factoryCanRun({ level: undefined } as unknown as StructureFactory, 0)).toBe(true);
  });
  it("needs an exact level match and an active operate effect for leveled recipes", () => {
    expect(factoryCanRun({ level: 2, effects: operated } as unknown as StructureFactory, 1)).toBe(false);
    expect(factoryCanRun({ level: 1, effects: [] } as unknown as StructureFactory, 1)).toBe(false);
    expect(factoryCanRun({ level: 1, effects: operated } as unknown as StructureFactory, 1)).toBe(true);
  });
});

describe("queuedBaseMineralNeed", () => {
  it("sums the base minerals the queued reactions consume", () => {
    const need = queuedBaseMineralNeed([
      { compound: "OH", amount: 1000 },
      { compound: "UH", amount: 500 },
      { compound: "UH2O", amount: 500 },
    ]);
    expect(need.get("H")).toBe(1500);
    expect(need.get("O")).toBe(1000);
    expect(need.get("U")).toBe(500);
    expect(need.has("OH")).toBe(false);
  });
});

describe("terminal transactions", () => {
  function setup(cooldown: number) {
    const calls: string[] = [];
    const terminal = {
      id: "t1",
      cooldown,
      store: store({ energy: 50_000, H: 30_000 }),
      send: () => {
        calls.push("send");
        return 0;
      },
    };
    const room = {
      name: "W1N1",
      controller: { my: true },
      storage: { store: store({ energy: 500_000, H: 30_000 }) },
      memory: {
        terminalId: "t1",
        mineralId: "m1",
        pendingSend: { resource: "energy", amount: 10_000, loadTarget: 10_000, to: "W2N1", queuedAt: clock },
      },
      find: () => [],
    };
    g.Game = {
      time: clock + 1,
      rooms: { W1N1: room },
      getObjectById: (id: string) => (id === "t1" ? terminal : id === "m1" ? { mineralType: "H" } : null),
      map: { getRoomLinearDistance: () => 2 },
      gcl: { level: 1 },
      market: {
        credits: 0,
        orders: {},
        getAllOrders: () => [
          { id: "o1", type: "buy", resourceType: "H", price: 10, amount: 1000, roomName: "W3N1" },
        ],
        getHistory: () => [{ avgPrice: 5 }],
        calcTransactionCost: () => 10,
        deal: () => {
          calls.push("deal");
          return 0;
        },
      },
    };
    return calls;
  }

  it("does nothing while the terminal is on cooldown", () => {
    const calls = setup(5);
    loop();
    expect(calls).toEqual([]);
  });

  it("makes one transaction per tick", () => {
    const calls = setup(0);
    loop();
    expect(calls).toEqual(["send"]);
  });
});
