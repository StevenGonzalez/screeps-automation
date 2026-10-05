import { describe, it, expect } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_STRUCTURES = 107;
g.FIND_TOMBSTONES = 118;
g.FIND_RUINS = 123;
g.FIND_SOURCES_ACTIVE = 104;
g.FIND_SOURCES = 105;
g.ERR_NOT_IN_RANGE = -9;
g.OK = 0;

import { acquireEnergy } from "../src/services/services.creep";
import { ROLE_HAULER, ROLE_UPGRADER } from "../src/config/config.roles";

let clock = 3000;

function run(role: string): string[] {
  clock++;
  g.Game = { time: clock, getObjectById: () => null };
  g.Memory = { rooms: {}, creeps: {} };
  const controllerLink = { id: "ctrlLink", structureType: "link", store: { energy: 600 } };
  const room = {
    name: "W1N1",
    memory: { controllerLinkIds: ["ctrlLink"] },
    find: (type: number) => (type === g.FIND_STRUCTURES ? [controllerLink] : []),
  };
  const withdrawn: string[] = [];
  const creep = {
    room,
    memory: { role },
    pos: {
      findInRange: () => [],
      findClosestByPath: (targets: unknown[] | number) => (Array.isArray(targets) ? targets[0] ?? null : null),
    },
    withdraw: (t: { id: string }) => {
      withdrawn.push(t.id);
      return 0;
    },
    moveTo: () => 0,
  } as unknown as Creep;
  acquireEnergy(creep, { bufferOnly: true });
  return withdrawn;
}

describe("acquireEnergy link fallback", () => {
  it("leaves the controller link to upgraders", () => {
    expect(run(ROLE_HAULER)).toEqual([]);
    expect(run(ROLE_UPGRADER)).toEqual(["ctrlLink"]);
  });
});

describe("acquireEnergy's chosen store", () => {
  type Store = { id: string; structureType: string; store: { energy: number } };
  const far: Store = { id: "far", structureType: "container", store: { energy: 500 } };
  const near: Store = { id: "near", structureType: "container", store: { energy: 500 } };

  function trip(cached: string | undefined, inRange: boolean) {
    clock++;
    g.Game = { time: clock, getObjectById: (id: string) => [far, near].find((s) => s.id === id) ?? null };
    g.Memory = { rooms: {}, creeps: {} };
    const room = { name: "W1N1", memory: {}, find: (type: number) => (type === g.FIND_STRUCTURES ? [far, near] : []) };
    const withdrawn: string[] = [];
    const creep = {
      room,
      memory: { role: "builder", energySourceId: cached },
      store: { getFreeCapacity: () => 50 },
      pos: {
        findInRange: () => [],
        findClosestByPath: (targets: unknown[] | number) => (Array.isArray(targets) ? targets.find((t) => t === near) ?? null : null),
      },
      withdraw: (t: { id: string }) => {
        withdrawn.push(t.id);
        return inRange ? 0 : -9;
      },
      moveTo: () => 0,
    } as unknown as Creep;
    acquireEnergy(creep, { bufferOnly: true });
    return { withdrawn, cached: creep.memory.energySourceId };
  }

  it("is kept for the walk to it", () => {
    expect(trip(undefined, false)).toEqual({ withdrawn: ["near"], cached: "near" });
    expect(trip("far", false)).toEqual({ withdrawn: ["far"], cached: "far" });
  });

  it("is let go once the creep draws from it, so the next load comes from the nearest store", () => {
    expect(trip("far", true)).toEqual({ withdrawn: ["far"], cached: undefined });
    expect(trip(undefined, true)).toEqual({ withdrawn: ["near"], cached: undefined });
  });
});
