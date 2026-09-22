import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;

import { findEnergyDepositTarget } from "../src/services/services.creep";
import { ROLE_HARVESTER } from "../src/config/config.roles";

g.FIND_STRUCTURES = 107;

let tick = 1;

function container(id: string) {
  return {
    id,
    structureType: "container",
    store: { getFreeCapacity: () => 2000 },
  };
}

function harvesterIn(structures: unknown[], mineralContainerId?: string) {
  const room = {
    name: "W1N1",
    memory: { mineralContainerId },
    find: () => structures,
  };
  return {
    room,
    pos: { findClosestByPath: (targets: unknown[]) => targets[0] ?? null },
  } as unknown as Creep;
}

// The mineral container is where the mineral miner stands. Harvesters filling
// it strand energy at the far edge of the base where nothing collects it.
describe("findEnergyDepositTarget", () => {
  beforeEach(() => {
    g.Game = { time: tick++ };
  });

  it("never deposits energy into the mineral container", () => {
    const creep = harvesterIn([container("mineral")], "mineral");

    expect(findEnergyDepositTarget(creep, ROLE_HARVESTER)).toBeNull();
  });

  it("still deposits into other containers", () => {
    const source = container("source");
    const creep = harvesterIn([container("mineral"), source], "mineral");

    expect(findEnergyDepositTarget(creep, ROLE_HARVESTER)).toBe(source);
  });
});
