import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_STRUCTURES = 101;
g.FIND_HOSTILE_CREEPS = 103;
g.FIND_MY_STRUCTURES = 104;
g.ERR_NOT_IN_RANGE = -9;
g.OK = 0;
g.RESOURCE_POWER = "power";
g.POWER_SPAWN_POWER_CAPACITY = 100;

import { runFiller } from "../src/roles/role.filler";
import { runMiner } from "../src/roles/role.miner";

let clock = 5000;

function store(contents: Record<string, number>, capacity = 1000) {
  const s = {
    ...contents,
    getUsedCapacity: (r?: string) =>
      r === undefined ? Object.values(contents).reduce((a, b) => a + b, 0) : contents[r] ?? 0,
    getFreeCapacity: (r?: string) => {
      void r;
      return capacity - Object.values(contents).reduce((a, b) => a + b, 0);
    },
  };
  return s;
}

beforeEach(() => {
  clock += 1;
  g.Memory = {};
});

function fillerRoom(opts: { extensionFree: boolean; psPower: number; psEnergy: number; storagePower: number }) {
  const calls: string[] = [];
  const storage = {
    id: "storage",
    structureType: "storage",
    pos: { x: 25, y: 25 },
    store: store({ energy: 500_000, power: opts.storagePower }, 1_000_000),
  };
  const extension = {
    id: "ext",
    structureType: "extension",
    pos: { x: 27, y: 25 },
    room: { name: "W1N1" },
    store: store({ energy: opts.extensionFree ? 0 : 50 }, 50),
  };
  const powerSpawn = {
    id: "ps",
    structureType: "powerSpawn",
    pos: { x: 24, y: 25 },
    store: {
      power: opts.psPower,
      energy: opts.psEnergy,
      getFreeCapacity: (r: string) => (r === "power" ? 100 - opts.psPower : 5000 - opts.psEnergy),
    },
  };
  const objects: Record<string, unknown> = { storage, ext: extension, ps: powerSpawn };
  const room = {
    name: "W1N1",
    storage,
    terminal: undefined,
    memory: { powerSpawnId: "ps" },
    find: (type: number) => (type === g.FIND_STRUCTURES ? [storage, extension, powerSpawn] : []),
  };
  let pathSearches = 0;
  const creep = {
    name: "filler1",
    room,
    memory: { role: "filler" } as CreepMemory,
    store: store({ energy: 0 }, 400),
    pos: {
      isNearTo: () => true,
      inRangeTo: () => true,
      findClosestByPath: (targets: unknown[]) => {
        pathSearches++;
        return targets[0] ?? null;
      },
    },
    withdraw: (target: { id: string }, resource: string, amount?: number) => {
      calls.push(amount === undefined ? `withdraw ${resource} from ${target.id}` : `withdraw ${resource} ${amount} from ${target.id}`);
      return 0;
    },
    transfer: (target: { id: string }, resource: string) => {
      calls.push(`transfer ${resource} to ${target.id}`);
      return 0;
    },
    moveTo: () => 0,
    drop: (resource: string) => {
      calls.push(`drop ${resource}`);
      return 0;
    },
  };
  g.Game = {
    time: clock,
    getObjectById: (id: string) => objects[id] ?? null,
  };
  return { creep: creep as unknown as Creep, calls, searches: () => pathSearches };
}

describe("filler power spawn upkeep", () => {
  it("loads power into a low power spawn once the core is full", () => {
    const { creep, calls } = fillerRoom({ extensionFree: false, psPower: 10, psEnergy: 5000, storagePower: 500 });
    runFiller(creep);
    expect(calls).toEqual(["withdraw power 90 from storage"]);
  });

  it("puts core fill ahead of power", () => {
    const { creep, calls } = fillerRoom({ extensionFree: true, psPower: 0, psEnergy: 5000, storagePower: 500 });
    runFiller(creep);
    expect(calls).toEqual(["withdraw energy from storage"]);
  });

  it("carries energy to the power spawn when the core is full and storage is rich", () => {
    const { creep, calls } = fillerRoom({ extensionFree: false, psPower: 100, psEnergy: 1000, storagePower: 0 });
    runFiller(creep);
    expect(calls).toEqual(["withdraw energy from storage"]);
  });

  it("delivers carried power to the power spawn", () => {
    const { creep, calls } = fillerRoom({ extensionFree: false, psPower: 10, psEnergy: 5000, storagePower: 500 });
    (creep as unknown as { store: unknown }).store = store({ power: 90 }, 400);
    runFiller(creep);
    expect(calls).toEqual(["transfer power to ps"]);
  });

  it("falls back to storage when the power spawn is full, and drops power with nowhere to put it", () => {
    const { creep, calls } = fillerRoom({ extensionFree: false, psPower: 100, psEnergy: 5000, storagePower: 0 });
    (creep as unknown as { store: unknown }).store = store({ power: 90 }, 400);
    runFiller(creep);
    expect(calls).toEqual(["transfer power to storage"]);

    const full = fillerRoom({ extensionFree: false, psPower: 100, psEnergy: 5000, storagePower: 500_000 });
    (full.creep as unknown as { store: unknown }).store = store({ power: 90 }, 400);
    runFiller(full.creep);
    expect(full.calls).toEqual(["drop power"]);
  });
});

describe("filler target cache", () => {
  it("reuses the cached core target instead of pathing every tick", () => {
    const { creep, searches } = fillerRoom({ extensionFree: true, psPower: 100, psEnergy: 5000, storagePower: 0 });
    runFiller(creep);
    expect(creep.memory.fillTargetId).toBe("ext");
    runFiller(creep);
    expect(searches()).toBe(1);
  });
});

describe("miner at a link", () => {
  it("empties into the link and still harvests the same tick", () => {
    const calls: string[] = [];
    const container = { id: "c1", hits: 250_000, hitsMax: 250_000, pos: { id: "cpos" } };
    const source = { id: "s1", pos: {} };
    const link = { id: "l1", structureType: "link", store: store({ energy: 0 }, 800) };
    const room = {
      name: "W1N1",
      controller: { safeMode: 1 },
      find: () => [],
    };
    g.Game = {
      time: clock,
      getObjectById: (id: string) => ({ s1: source, c1: container } as Record<string, unknown>)[id] ?? null,
    };
    const creep = {
      room,
      memory: { assignedSourceId: "s1", assignedContainerId: "c1" },
      store: store({ energy: 50 }, 50),
      pos: {
        isEqualTo: () => true,
        findInRange: () => [link],
      },
      transfer: () => {
        calls.push("transfer");
        return 0;
      },
      harvest: () => {
        calls.push("harvest");
        return 0;
      },
      moveTo: () => 0,
    } as unknown as Creep;
    (source as { room?: unknown }).room = room;
    runMiner(creep);
    expect(calls).toEqual(["transfer", "harvest"]);
  });
});
