import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_STRUCTURES = 107;
g.FIND_HOSTILE_CREEPS = 103;
g.OK = 0;
g.ERR_NOT_IN_RANGE = -9;
g.ERR_NOT_ENOUGH_RESOURCES = -6;
g.STRUCTURE_KEEPER_LAIR = "keeperLair";
g.FIND_MY_CONSTRUCTION_SITES = 114;

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
