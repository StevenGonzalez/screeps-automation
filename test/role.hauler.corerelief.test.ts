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
import { ROLE_FILLER, ROLE_HAULER } from "../src/config/config.roles";

let clock = 2000;
let withdrawn: string[] = [];
let transferred: string[] = [];

/**
 * A hauler under the storage model with drained miner containers and a core
 * well short of capacity - the RCL 6 room where the courier sat idle beside
 * empty extensions.
 */
function scenario(carrying: number, energyAvailable = 300, fillerCarrying = 0, reliefCarrying = 0) {
  clock += 1;
  const roomName = `W48S8-${clock}`;

  const storage = {
    id: "storage1",
    structureType: "storage",
    pos: { x: 24, y: 25 },
    store: { energy: 815_300, getFreeCapacity: () => 100_000 },
  };

  const extension = {
    id: "ext1",
    structureType: "extension",
    pos: { x: 26, y: 25 },
    store: { energy: 0, getFreeCapacity: () => 50 },
  };

  // Drained: below the 100 the hauler needs before it will make the trip.
  const minerContainer = {
    id: "cont1",
    structureType: "container",
    pos: { x: 40, y: 20 },
    store: { energy: 0, getFreeCapacity: () => 2000 },
  };

  const filler = {
    name: "stuffer1",
    spawning: false,
    memory: { role: ROLE_FILLER },
    store: { energy: fillerCarrying },
  };

  // Another porter already on a relief run.
  const reliever = {
    name: "courier2",
    spawning: false,
    memory: { role: ROLE_HAULER, coreRelief: true },
    store: { energy: reliefCarrying },
  };

  const room = {
    name: roomName,
    controller: { my: true, level: 6, pos: { x: 9, y: 5 } },
    energyAvailable,
    energyCapacityAvailable: 2300,
    storage,
    memory: {
      minerContainerIds: ["cont1"],
      containerIds: ["cont1"],
    } as unknown as RoomMemory,
    find: (type: number) => {
      if (type === g.FIND_MY_CREEPS) return [filler, reliever];
      if (type === g.FIND_STRUCTURES) return [storage, extension, minerContainer];
      return [];
    },
  } as unknown as Room;

  g.Game = {
    time: clock,
    creeps: {},
    rooms: { [roomName]: room },
    getObjectById: (id: string) =>
      ({ storage1: storage, ext1: extension, cont1: minerContainer } as Record<string, unknown>)[id] ??
      null,
  };
  g.Memory = { creeps: {}, rooms: { [roomName]: room.memory } };

  const creep = {
    name: "courier1",
    room,
    pos: {
      x: 25,
      y: 25,
      getRangeTo: () => 1,
      isNearTo: () => true,
      inRangeTo: () => true,
      findClosestByRange: <T>(list: T[]) => list[0] ?? null,
      findClosestByPath: <T>(list: T[]) => list[0] ?? null,
      findInRange: () => [],
    },
    store: {
      energy: carrying,
      getFreeCapacity: () => 1300 - carrying,
      getUsedCapacity: () => carrying,
    },
    memory: { role: ROLE_HAULER, assignedContainerId: "cont1" } as unknown as CreepMemory,
    getActiveBodyparts: () => 0,
    withdraw: (target: { id: string }) => {
      withdrawn.push(target.id);
      return g.OK;
    },
    transfer: (target: { id: string }) => {
      transferred.push(target.id);
      return g.OK;
    },
    moveTo: () => g.OK,
    pickup: () => g.OK,
  } as unknown as Creep;

  return { creep, room };
}

beforeEach(() => {
  withdrawn = [];
  transferred = [];
});

describe("hauler core relief under the storage model", () => {
  it("pulls from storage instead of idling when there is nothing to haul", () => {
    const { creep } = scenario(0);

    runHauler(creep);

    expect(withdrawn).toEqual(["storage1"]);
    expect(creep.memory.coreRelief).toBe(true);
  });

  it("leaves the run alone when the barmaid already carries what the core lacks", () => {
    const { creep } = scenario(0, 2100, 200);

    runHauler(creep);

    expect(withdrawn).toEqual([]);
    expect(creep.memory.coreRelief).toBeUndefined();
  });

  it("leaves the run alone when another porter on one carries what the core lacks", () => {
    const { creep } = scenario(0, 2100, 0, 200);

    runHauler(creep);

    expect(withdrawn).toEqual([]);
  });

  it("still takes the run when the gold on its way falls short of what the core lacks", () => {
    const { creep } = scenario(0, 2100, 100, 50);

    runHauler(creep);

    expect(withdrawn).toEqual(["storage1"]);
    expect(creep.memory.coreRelief).toBe(true);
  });

  it("delivers that load to the core rather than back into storage", () => {
    const { creep } = scenario(1300);
    creep.memory.coreRelief = true;
    creep.memory.working = true;

    runHauler(creep);

    expect(transferred).toEqual(["ext1"]);
  });

  it("clears the relief flag once the load is spent and the core is full", () => {
    const { creep } = scenario(0, 2300);
    creep.memory.coreRelief = true;
    creep.memory.working = true;

    runHauler(creep);

    expect(creep.memory.working).toBe(false);
    expect(creep.memory.coreRelief).toBeUndefined();
  });
});

describe("hauler stocking the container by the throne", () => {
  // Grimford: one spawn always at work, so the core was never full, and the
  // container its enchanter draws from stood empty.
  function withUpgradeContainer(energyAvailable: number) {
    const { creep, room } = scenario(1300, energyAvailable);
    const upgradeContainer = {
      id: "up1",
      structureType: "container",
      pos: { x: 10, y: 6 },
      store: { energy: 0, getFreeCapacity: () => 2000 },
    };
    room.memory.upgradeContainerId = "up1" as Id<StructureContainer>;
    const find = room.find.bind(room);
    (room as unknown as { find: unknown }).find = (type: number, opts?: { filter?: (o: unknown) => boolean }) =>
      (find(type) as unknown[]).filter((o) => !opts?.filter || opts.filter(o));
    const game = g.Game as { creeps: Record<string, Creep>; getObjectById: (id: string) => unknown };
    const byId = game.getObjectById;
    game.getObjectById = (id: string) => (id === "up1" ? upgradeContainer : byId(id));
    game.creeps[creep.name] = creep;
    (creep as unknown as { id: string }).id = "courier1";
    creep.memory.working = true;
    return creep;
  }

  it("stocks it while the barmaid feeds a core that is not full", () => {
    const creep = withUpgradeContainer(300);

    runHauler(creep);

    expect(transferred).toEqual(["up1"]);
  });
});
