import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;

g.FIND_STRUCTURES = 107;
g.FIND_HOSTILE_CREEPS = 103;
g.RESOURCE_ENERGY = "energy";
g.STRUCTURE_SPAWN = "spawn";
g.STRUCTURE_EXTENSION = "extension";
g.STRUCTURE_TOWER = "tower";

import { findCoreFillTarget, coreFillSpace } from "../src/services/services.creep";
import { runFiller } from "../src/roles/role.filler";

let tick = 1;

function building(id: string, structureType: string, free: number) {
  return { id, structureType, store: { getFreeCapacity: () => free } };
}

function fillerIn(structures: unknown[]) {
  return {
    name: "barmaid",
    room: { name: "W1N1", memory: {}, find: () => structures },
    pos: { findClosestByPath: (targets: unknown[]) => targets[0] ?? null },
  } as unknown as Creep;
}

// Towers repairing in peace lose ten gold a shot, and topping them up after each
// shot kept a barmaid walking the core for almost nothing.
describe("core fill targets", () => {
  beforeEach(() => {
    g.Game = { time: tick++, creeps: {} };
  });

  it("leaves a nearly full tower alone", () => {
    expect(findCoreFillTarget(fillerIn([building("t", "tower", 80)]))).toBeNull();
  });

  it("refills a tower once a trip is worth it", () => {
    const tower = building("t", "tower", 250);
    expect(findCoreFillTarget(fillerIn([tower]))).toBe(tower);
  });

  it("still fills any gap in an extension or spawn", () => {
    const extension = building("e", "extension", 10);
    expect(findCoreFillTarget(fillerIn([building("t", "tower", 80), extension]))).toBe(extension);
    expect(coreFillSpace(building("s", "spawn", 1) as unknown as AnyStoreStructure)).toBe(1);
  });

  it("reads no extension's store while the spawns and extensions are full", () => {
    const read = vi.fn(() => 0);
    const extension = { id: "e", structureType: "extension", store: { getFreeCapacity: read } };
    const tower = building("t", "tower", 400);
    const creep = fillerIn([extension, tower]);
    Object.assign(creep.room, { energyAvailable: 5600, energyCapacityAvailable: 5600 });

    expect(findCoreFillTarget(creep)).toBe(tower);
    expect(read).not.toHaveBeenCalled();
  });

  it("looks at the extensions once any of them has room", () => {
    const extension = building("e", "extension", 100);
    const creep = fillerIn([extension]);
    Object.assign(creep.room, { energyAvailable: 5500, energyCapacityAvailable: 5600 });

    expect(findCoreFillTarget(creep)).toBe(extension);
  });

  // The cached target is what held a barmaid at one tower, giving back the ten
  // gold of each shot every tick.
  it("lets go of a topped-up tower it was serving", () => {
    const tower = { ...building("t", "tower", 10), room: { name: "W1N1" } };
    g.Game = { time: tick++, creeps: {}, getObjectById: () => tower };
    const creep = fillerIn([tower]) as unknown as {
      memory: { fillTargetId?: string };
      store: Record<string, number>;
      room: { find: (type: number) => unknown[] };
    };
    creep.memory = { fillTargetId: "t" };
    creep.store = { energy: 400 };
    creep.room.find = (type) => (type === g.FIND_STRUCTURES ? [tower] : []);

    runFiller(creep as unknown as Creep);

    expect(creep.memory.fillTargetId).toBeUndefined();
  });
});
