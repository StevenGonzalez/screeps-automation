import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_CONSTRUCTION_SITES = 111;
g.RESOURCE_ENERGY = "energy";

import { getBuilderPopulationTarget } from "../src/orchestrators/orchestrator.spawning.economy";

let tick = 9000;

function site(progressTotal: number, progress = 0) {
  return { progress, progressTotal };
}

// An RCL 6 room with full extensions and the treasury on the savings floor.
function roomWith(sites: unknown[]): Room {
  return {
    name: `W1N1-${tick}`,
    controller: { level: 6 },
    energyAvailable: 2300,
    energyCapacityAvailable: 2300,
    storage: { store: { energy: 45_000 } },
    memory: {},
    find: (type: number) => (type === g.FIND_CONSTRUCTION_SITES ? sites : []),
  } as unknown as Room;
}

describe("mason population", () => {
  beforeEach(() => {
    tick += 1;
    g.Game = { time: tick };
  });

  it("sends one mason for a short road however many tiles it has", () => {
    const road = Array.from({ length: 8 }, () => site(300));
    expect(getBuilderPopulationTarget(roomWith(road))).toBe(1);
  });

  it("sends more for a new level's extensions", () => {
    const extensions = Array.from({ length: 10 }, () => site(3000));
    expect(getBuilderPopulationTarget(roomWith(extensions))).toBe(2);
  });

  it("counts only the work a site still needs", () => {
    const extensions = Array.from({ length: 10 }, () => site(3000, 2500));
    expect(getBuilderPopulationTarget(roomWith(extensions))).toBe(1);
  });
});
