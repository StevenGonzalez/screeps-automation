import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_STRUCTURES = 107;
g.FIND_HOSTILE_CREEPS = 103;
g.STRUCTURE_WALL = "constructedWall";
g.RESOURCE_ENERGY = "energy";

import { getRepairerPopulationTarget } from "../src/orchestrators/orchestrator.spawning.economy";

let tick = 5000;

function road(x: number, y: number, hits: number) {
  return { id: `road${x},${y}`, structureType: "road", pos: { x, y }, hits, hitsMax: 5000 };
}

// An RCL 6 room with little in storage and one planned road, at 10,10.
function plannedRoom(structures: unknown[]): Room {
  return {
    name: `W1N1-${tick}`,
    controller: { level: 6 },
    energyCapacityAvailable: 0,
    storage: { store: { energy: 5_000 } },
    memory: {
      blueprint: { v: 1, at: tick, anchor: { x: 10, y: 12 }, hub: { x: 10, y: 11 }, s: "R10,10,2", exits: {} },
    },
    find: (type: number, opts?: { filter?: (s: unknown) => boolean }) =>
      type === g.FIND_STRUCTURES ? structures.filter(opts?.filter ?? (() => true)) : [],
  } as unknown as Room;
}

describe("repairer population", () => {
  beforeEach(() => {
    tick += 100;
    g.Game = { time: tick };
  });

  it("sends no repairers for roads left off the plan to decay", () => {
    const strays = Array.from({ length: 10 }, (_, i) => road(30 + i, 30, 1000));
    expect(getRepairerPopulationTarget(plannedRoom(strays))).toBe(0);
  });

  it("still sends one for a worn road on the plan", () => {
    expect(getRepairerPopulationTarget(plannedRoom([road(10, 10, 1000)]))).toBe(1);
  });
});
