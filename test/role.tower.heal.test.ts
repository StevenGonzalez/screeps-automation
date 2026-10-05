import { describe, it, expect, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_MY_CREEPS = 102;
g.FIND_STRUCTURES = 107;
g.RESOURCE_ENERGY = "energy";

vi.mock("../src/services/services.creep", () => ({
  findTowerRepairTarget: () => ({ id: "road" }),
  findTowerDefenseRepairTarget: () => ({ id: "rampart" }),
}));

import { runTower } from "../src/roles/role.tower";

function knightAt(x: number, y: number, hits = 1300) {
  return { name: "Dragonknight Matilda", hits, hitsMax: 1600, pos: { x, y } };
}

function towerSeeing(creeps: ReturnType<typeof knightAt>[]) {
  const tower = {
    store: { energy: 1000, getCapacity: () => 1000 },
    room: {
      find: (type: number, opts?: { filter: (c: unknown) => boolean }) =>
        type === g.FIND_MY_CREEPS ? creeps.filter((c) => !opts || opts.filter(c)) : [],
    },
    pos: { findClosestByRange: (list: unknown[]) => list[0] ?? null },
    heal: vi.fn(),
    repair: vi.fn(),
    attack: vi.fn(),
  };
  return tower;
}

describe("tower healing", () => {
  it("heals our wounded with no threat in the room", () => {
    const knight = knightAt(14, 20);
    const tower = towerSeeing([knight]);
    runTower(tower as unknown as StructureTower, null, false);
    expect(tower.heal).toHaveBeenCalledWith(knight);
    expect(tower.repair).not.toHaveBeenCalled();
  });

  it("heals before it shores up the barriers in a raid", () => {
    const knight = knightAt(14, 20);
    const tower = towerSeeing([knight]);
    runTower(tower as unknown as StructureTower, null, true);
    expect(tower.heal).toHaveBeenCalledWith(knight);
    expect(tower.repair).not.toHaveBeenCalled();
  });

  it("leaves a creep on the edge rows and the whole to the repairs", () => {
    const tower = towerSeeing([knightAt(1, 20), knightAt(14, 20, 1600)]);
    runTower(tower as unknown as StructureTower, null, false);
    expect(tower.heal).not.toHaveBeenCalled();
    expect(tower.repair).toHaveBeenCalledWith({ id: "road" });
  });
});
