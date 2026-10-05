import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_STRUCTURES = 107;
g.FIND_HOSTILE_CREEPS = 103;
g.OK = 0;
g.ERR_NOT_IN_RANGE = -9;
g.ERR_NOT_ENOUGH_RESOURCES = -6;
g.STRUCTURE_KEEPER_LAIR = "keeperLair";
g.FIND_MY_CONSTRUCTION_SITES = 114;
g.FIND_CONSTRUCTION_SITES = 111;
g.STRUCTURE_STORAGE = "storage";

import { runRepairer } from "../src/roles/role.repairer";

let tick = 20_000;

// A blacksmith with a full load, at home beside a badly worn road, with the
// treasury below its floor so that with nothing to mend it only waits.
function smithBesideRoad() {
  const road = { id: "road", structureType: "road", pos: { x: 10, y: 10 }, hits: 1000, hitsMax: 5000 };
  let looks = 0;
  const room = {
    name: `W1N1-${tick}`,
    controller: { my: true, level: 6 },
    storage: { store: { energy: 5_000 } },
    memory: {},
    find: (type: number) => {
      if (type !== g.FIND_STRUCTURES) return [];
      looks++;
      return [road];
    },
  };
  const mended: string[] = [];
  const creep = {
    name: "Blacksmith Simon",
    room,
    memory: { role: "blacksmith", working: true } as CreepMemory,
    pos: { x: 11, y: 10, getRangeTo: () => 1 },
    store: { getUsedCapacity: () => 100, getFreeCapacity: () => 0, energy: 100 },
    repair: (s: { id: string }) => (mended.push(s.id), g.OK),
  };
  g.Game = { time: tick, getObjectById: (id: string) => (id === "road" ? road : null) };
  return { road, creep: creep as unknown as Creep, mended, looks: () => looks };
}

describe("blacksmith repair target", () => {
  beforeEach(() => {
    tick += 1000;
    g.Memory = {};
  });

  it("keeps mending what it chose without looking over the keep again", () => {
    const { creep, mended, looks } = smithBesideRoad();
    runRepairer(creep);
    const first = looks();
    expect(first).toBeGreaterThan(0);

    (g.Game as { time: number }).time = tick + 1;
    runRepairer(creep);
    expect(mended).toEqual(["road", "road"]);
    expect(looks()).toBe(first);
  });

  it("leaves a rampart at its goal rather than mending on toward its cap", () => {
    // Held until whole, a rampart was mended on to its cap of millions: Grimford's
    // stood at up to 61K against a goal of 50K, its town walls at 29K against 20K.
    const near = { id: "near", structureType: "rampart", pos: { x: 10, y: 10 }, hits: 30_000, hitsMax: 3_000_000 };
    const far = { id: "far", structureType: "rampart", pos: { x: 40, y: 40 }, hits: 28_000, hitsMax: 3_000_000 };
    const room = {
      name: `W1N1-${tick}`,
      controller: { my: true, level: 4 },
      memory: {},
      find: (type: number) => (type === g.FIND_STRUCTURES ? [near, far] : []),
    };
    const mended: string[] = [];
    const creep = {
      name: "Blacksmith Osric",
      room,
      memory: { role: "blacksmith", working: true } as CreepMemory,
      pos: { x: 11, y: 10, getRangeTo: (t: { pos: { x: number } }) => Math.abs(t.pos.x - 11) },
      store: { getUsedCapacity: () => 100, getFreeCapacity: () => 0, energy: 100 },
      repair: (s: { id: string }) => (mended.push(s.id), g.OK),
    };
    const byId: Record<string, unknown> = { near, far };
    g.Game = { time: tick, getObjectById: (id: string) => byId[id] ?? null };
    runRepairer(creep as unknown as Creep);

    near.hits = 50_000;
    (g.Game as { time: number }).time = tick + 1;
    runRepairer(creep as unknown as Creep);
    expect(mended).toEqual(["near", "far"]);
  });

  it("looks again once what it chose is whole", () => {
    const { road, creep, looks } = smithBesideRoad();
    runRepairer(creep);
    const first = looks();

    road.hits = road.hitsMax;
    (g.Game as { time: number }).time = tick + 1;
    runRepairer(creep);
    expect(looks()).toBeGreaterThan(first);
  });
});
