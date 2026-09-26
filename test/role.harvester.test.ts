import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;

// Module-level caches in services.creep are keyed on Game.time, so each case
// advances the clock to avoid inheriting the previous case's lookups.
let clock = 300;

beforeEach(() => {
  g.RESOURCE_ENERGY = "energy";
  g.FIND_STRUCTURES = 101;
  g.FIND_MY_CONSTRUCTION_SITES = 102;
  g.FIND_HOSTILE_CREEPS = 103;
  g.FIND_SOURCES = 105;
  g.FIND_TOMBSTONES = 107;
  g.FIND_DROPPED_RESOURCES = 109;
  g.FIND_MY_CREEPS = 110;
  g.STRUCTURE_WALL = "constructedWall";
  g.STRUCTURE_KEEPER_LAIR = "keeperLair";
  g.ERR_NOT_IN_RANGE = -9;
  g.OK = 0;
  clock += 1;
});

import { runHarvester } from "../src/roles/role.harvester";
import { ROLE_MINER } from "../src/config/config.roles";

const miner = { memory: { role: ROLE_MINER } };

function setup(opts: { full: boolean }) {
  const calls: string[] = [];
  const container = {
    id: "cont1",
    structureType: "container",
    pos: { x: 11, y: 11 },
    store: { energy: 800, getFreeCapacity: () => 1200 },
  };
  const room = {
    name: "W1N1",
    memory: {},
    controller: { my: true, id: "ctrl", pos: { x: 9, y: 5 } },
    find: (type: number) => {
      if (type === g.FIND_SOURCES) return [source];
      if (type === g.FIND_STRUCTURES) return [container];
      return [];
    },
  };
  const source = {
    id: "src1",
    room,
    energy: 3000,
    pos: {
      x: 10,
      y: 10,
      // A miner stands on the source's container.
      findInRange: (type: number, _r: number, o?: { filter: (c: unknown) => boolean }) =>
        type === g.FIND_MY_CREEPS ? [miner].filter((c) => !o || o.filter(c)) : [],
    },
  };
  const creep = {
    name: "harvester1",
    room,
    memory: { role: "intern", working: opts.full, assignedSourceId: "src1" },
    store: {
      energy: opts.full ? 50 : 0,
      getFreeCapacity: () => (opts.full ? 0 : 50),
    },
    pos: {
      x: 25,
      y: 25,
      getRangeTo: () => 5,
      findInRange: () => [],
      findClosestByPath: <T>(targets: T[]) => targets[0] ?? null,
    },
    getActiveBodyparts: () => 1,
    suicide: () => calls.push("suicide"),
    harvest: () => (calls.push("harvest"), g.OK),
    withdraw: (t: { id: string }) => (calls.push(`withdraw:${t.id}`), g.ERR_NOT_IN_RANGE),
    transfer: (t: { id: string }) => (calls.push(`transfer:${t.id}`), g.OK),
    upgradeController: () => (calls.push("upgradeController"), g.OK),
    signController: () => g.OK,
    moveTo: () => g.OK,
  } as unknown as Creep;

  g.Memory = { creeps: {} };
  g.Game = {
    time: clock,
    creeps: {},
    getObjectById: (id: string) => (id === "src1" ? source : id === "cont1" ? container : null),
  };
  return { creep, calls };
}

describe("harvester once miners hold every source", () => {
  it("carries from the miners' containers instead of suiciding", () => {
    const { creep, calls } = setup({ full: false });

    runHarvester(creep);

    expect(calls).not.toContain("suicide");
    expect(calls).toContain("withdraw:cont1");
  });

  it("does not put container energy back into a container", () => {
    const { creep, calls } = setup({ full: true });

    runHarvester(creep);

    expect(calls).not.toContain("transfer:cont1");
    expect(calls).toContain("upgradeController");
  });
});
