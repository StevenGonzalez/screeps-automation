import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;

g.FIND_DROPPED_RESOURCES = 106;
g.FIND_MY_CREEPS = 107;
g.FIND_STRUCTURES = 101;
g.FIND_HOSTILE_CREEPS = 103;
g.FIND_MY_SPAWNS = 108;
g.ERR_NOT_IN_RANGE = -9;
g.OK = 0;

import { runHauler } from "../src/roles/role.hauler";
import { ROLE_HAULER } from "../src/config/config.roles";

let clock = 5000;
let withdrawn: string[] = [];

/**
 * A young keep with no storage: one source container close to the controller,
 * the other far round the hills. The near one holds a trickle; the far one is
 * full and spilling.
 */
function scenario(nearEnergy: number, farEnergy: number, carrying = 0, farRange = 30) {
  clock += 1;
  const roomName = `W48S7-${clock}`;
  const container = (id: string, energy: number, range: number) => ({
    id,
    structureType: "container",
    range,
    pos: { x: 0, y: 0 },
    store: { energy, getFreeCapacity: () => 2000 - energy },
  });
  const near = container("near", nearEnergy, 5);
  const far = container("far", farEnergy, farRange);

  const room = {
    name: roomName,
    controller: { my: true, level: 2 },
    energyAvailable: 550,
    energyCapacityAvailable: 550,
    memory: { minerContainerIds: ["near", "far"], containerIds: ["near", "far"] } as unknown as RoomMemory,
    find: (type: number) => (type === g.FIND_STRUCTURES ? [near, far] : []),
  } as unknown as Room;

  g.Game = {
    time: clock,
    creeps: {},
    rooms: { [roomName]: room },
    getObjectById: (id: string) => ({ near, far } as Record<string, unknown>)[id] ?? null,
  };
  g.Memory = { creeps: {}, rooms: { [roomName]: room.memory } };

  const creep = {
    name: "Porter Warin",
    room,
    pos: {
      getRangeTo: (t: { range: number }) => t.range,
      findClosestByRange: <T>(list: T[]) => list[0] ?? null,
      findClosestByPath: <T extends { range: number }>(list: T[]) =>
        [...list].sort((a, b) => a.range - b.range)[0] ?? null,
      findInRange: () => [],
    },
    store: { energy: carrying, getFreeCapacity: () => 300 - carrying, getUsedCapacity: () => carrying },
    memory: { role: ROLE_HAULER, assignedContainerId: "near", working: false } as unknown as CreepMemory,
    withdraw: (target: { id: string; range: number }) => {
      if (target.range > 1) return g.ERR_NOT_IN_RANGE;
      withdrawn.push(target.id);
      return g.OK;
    },
    getActiveBodyparts: () => 0,
    moveTo: (target: { id: string }) => {
      withdrawn.push(`walk:${target.id}`);
      return g.OK;
    },
  } as unknown as Creep;

  return creep;
}

/** Another empty porter already on its way to load at a container. */
function boundFor(containerId: string, range: number) {
  (g.Game as { creeps: Record<string, unknown> }).creeps["Porter Hild"] = {
    name: "Porter Hild",
    pos: { getRangeTo: () => range },
    store: { energy: 0, getFreeCapacity: () => 300 },
    memory: { role: ROLE_HAULER, haulFromId: containerId, working: false },
  };
}

beforeEach(() => {
  withdrawn = [];
});

describe("hauler pickup", () => {
  it("fetches from the fullest source container when its own holds too little to fetch", () => {
    runHauler(scenario(60, 2000));
    expect(withdrawn).toEqual(["walk:far"]);
  });

  it("keeps to its own container while that has enough to fetch", () => {
    runHauler(scenario(400, 2000));
    expect(withdrawn).toEqual(["walk:near"]);
  });

  it("tops up a part load only from a container close by", () => {
    runHauler(scenario(60, 2000, 100));
    expect(withdrawn).toEqual([]);
    runHauler(scenario(60, 2000, 100, 8));
    expect(withdrawn).toEqual(["walk:far"]);
  });

  it("leaves a load to a porter that will reach it first", () => {
    const creep = scenario(60, 150);
    creep.memory.haulFromId = "far" as Id<StructureContainer>;
    boundFor("far", 10);
    runHauler(creep);
    expect(withdrawn).toEqual([]);
    expect(creep.memory.haulFromId).toBeUndefined();
  });

  it("still goes for a load when the porter bound there is farther off", () => {
    const creep = scenario(60, 150);
    boundFor("far", 50);
    runHauler(creep);
    expect(withdrawn).toEqual(["walk:far"]);
    expect(creep.memory.haulFromId).toBe("far");
  });

  it("leaves its own container to a nearer porter and goes where there is gold to spare", () => {
    const creep = scenario(150, 2000);
    boundFor("near", 2);
    runHauler(creep);
    expect(withdrawn).toEqual(["walk:far"]);
  });

  it("lets go of the container once it is full", () => {
    const creep = scenario(400, 2000, 300);
    creep.memory.haulFromId = "far" as Id<StructureContainer>;
    runHauler(creep);
    expect(creep.memory.working).toBe(true);
    expect(creep.memory.haulFromId).toBeUndefined();
  });

  it("keeps to the container it set out for while there is a load there", () => {
    const creep = scenario(400, 2000);
    creep.memory.haulFromId = "far" as Id<StructureContainer>;
    runHauler(creep);
    expect(withdrawn).toEqual(["walk:far"]);
  });
});
