import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/services/services.creep", () => ({ mayBorrowHauler: () => true }));

const g = globalThis as Record<string, unknown>;
g.OK = 0;
g.ERR_NOT_IN_RANGE = -9;
g.FIND_MY_STRUCTURES = 104;
g.FIND_MY_CREEPS = 102;
g.RESOURCE_GHODIUM = "G";
g.RESOURCE_UTRIUM = "U";
g.RESOURCE_UTRIUM_BAR = "utrium_bar";
g.RESOURCE_BATTERY = "battery";
for (const n of [
  "HYDROGEN", "OXYGEN", "LEMERGIUM", "KEANIUM", "ZYNTHIUM", "CATALYST",
  "LEMERGIUM_BAR", "ZYNTHIUM_BAR", "KEANIUM_BAR", "OXIDANT", "REDUCTANT", "PURIFIER",
  "GHODIUM_MELT", "WIRE", "CELL", "ALLOY", "CONDENSATE", "COMPOSITE", "CRYSTAL", "LIQUID",
  "SWITCH", "TRANSISTOR", "MICROCHIP", "CIRCUIT", "DEVICE", "PHLEGM", "TISSUE", "MUSCLE",
  "ORGANOID", "ORGANISM", "TUBE", "FIXTURES", "FRAME", "HYDRAULICS", "MACHINE",
  "CONCENTRATE", "EXTRACT", "SPIRIT", "EMANATION", "ESSENCE",
]) {
  if (g[`RESOURCE_${n}`] === undefined) g[`RESOURCE_${n}`] = n.toLowerCase();
}
g.COMMODITIES = {
  utrium_bar: { components: { U: 500, energy: 200 }, amount: 100, cooldown: 20 },
};

const factoryMod = await import("../src/orchestrators/orchestrator.factory");
const nukerMod = await import("../src/orchestrators/orchestrator.nuker");

function store(contents: Record<string, number>, capacity: number | Record<string, number>) {
  const used = (r?: string) =>
    r === undefined ? Object.values(contents).reduce((a, b) => a + b, 0) : contents[r] ?? 0;
  return {
    ...contents,
    getUsedCapacity: used,
    getFreeCapacity: (r?: string) =>
      typeof capacity === "number" ? capacity - used() : r && r in capacity ? capacity[r] - used(r) : null,
  };
}

function courier(cargo: Record<string, number>) {
  const calls: string[] = [];
  const c = {
    name: "hauler1",
    memory: { role: "porter" },
    store: store(cargo, 800),
    pos: { getRangeTo: () => 1 },
    transfer: (t: { id: string }, r: string) => { calls.push(`transfer ${r} ${t.id}`); return 0; },
    withdraw: (t: { id: string }, r: string) => { calls.push(`withdraw ${r} ${t.id}`); return 0; },
    moveTo: () => 0,
  };
  return { c, calls };
}

function room(opts: {
  storage: Record<string, number>;
  structure: unknown;
  memory: Partial<RoomMemory>;
  hauler: { name: string };
}) {
  const r = {
    name: "W1N1",
    controller: { my: true },
    storage: { id: "storage", store: store(opts.storage, 1_000_000) },
    terminal: undefined,
    memory: opts.memory,
    find: (type: number) => (type === g.FIND_MY_CREEPS ? [opts.hauler] : [opts.structure]),
  };
  (opts.hauler as unknown as { room: unknown }).room = r;
  return r;
}

beforeEach(() => {
  g.Memory = {};
});

describe("factory courier", () => {
  function scene(cargo: Record<string, number>, factoryStore: Record<string, number>) {
    const { c, calls } = courier(cargo);
    const factory = { id: "factory", structureType: "factory", cooldown: 5, store: store(factoryStore, 50_000) };
    // Storage holds exactly the 3k mineral reserve: no spare U left to load.
    const r = room({
      storage: { U: 3_000, energy: 500_000 },
      structure: factory,
      hauler: c,
      memory: {
        factorySystem: { factoryId: "factory", activeCommodity: "utrium_bar", lastPlanTick: 100, courierName: "hauler1" },
      } as Partial<RoomMemory>,
    });
    g.Game = {
      time: 110,
      rooms: { W1N1: r },
      creeps: { hauler1: c },
      getObjectById: (id: string) => (id === "factory" ? factory : null),
    };
    return { calls, memory: r.memory };
  }

  it("delivers an input it took the last spare of instead of carrying it back", () => {
    const { calls } = scene({ U: 800 }, { energy: 800 });
    factoryMod.loop();
    expect(calls).toEqual(["transfer U factory"]);
  });

  it("puts away leftover cargo before releasing the courier", () => {
    const { calls, memory } = scene({ U: 300 }, { U: 2_000, energy: 800 });
    factoryMod.loop();
    expect(calls).toEqual(["transfer U storage"]);
    expect(memory.factorySystem?.courierName).toBe("hauler1");
  });
});

describe("nuker courier", () => {
  function scene(cargo: Record<string, number>, nukerG: number, storage: Record<string, number>) {
    const { c, calls } = courier(cargo);
    const nuker = {
      id: "nuker",
      structureType: "nuker",
      store: store({ G: nukerG, energy: 300_000 }, { G: 5_000, energy: 300_000 }),
    };
    const r = room({
      storage,
      structure: nuker,
      hauler: c,
      memory: { nukerSystem: { nukerId: "nuker", courierName: "hauler1" } } as Partial<RoomMemory>,
    });
    g.Game = {
      time: 110,
      rooms: { W1N1: r },
      creeps: { hauler1: c },
      getObjectById: (id: string) => (id === "nuker" ? nuker : null),
    };
    return { calls, memory: r.memory };
  }

  it("delivers the last ghodium it took rather than returning it", () => {
    const { calls } = scene({ G: 1_000 }, 3_000, { energy: 100_000 });
    nukerMod.loop();
    expect(calls).toEqual(["transfer G nuker"]);
  });

  it("puts away ghodium the full nuker cannot take before releasing", () => {
    const { calls, memory } = scene({ G: 200 }, 5_000, { energy: 100_000 });
    nukerMod.loop();
    expect(calls).toEqual(["transfer G storage"]);
    expect(memory.nukerSystem?.courierName).toBe("hauler1");
  });
});
