import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.OK = 0;
g.ATTACK_POWER = 30;
g.FIND_STRUCTURES = 101;
g.FIND_DEPOSITS = 120;
g.FIND_MY_CREEPS = 107;
g.STRUCTURE_POWER_BANK = "powerBank";
g.POWER_CREEP_MAX_LEVEL = 25;
g.POWER_CLASS = { OPERATOR: "operator" };

g.ERR_NOT_ENOUGH_RESOURCES = -6;
g.ERR_NOT_IN_RANGE = -9;
[
  "PWR_GENERATE_OPS", "PWR_REGEN_SOURCE", "PWR_OPERATE_SPAWN", "PWR_OPERATE_EXTENSION",
  "PWR_OPERATE_FACTORY", "PWR_OPERATE_LAB", "PWR_OPERATE_STORAGE", "PWR_OPERATE_TOWER",
  "PWR_OPERATE_TERMINAL", "PWR_OPERATE_POWER",
].forEach((n, i) => {
  if (g[n] === undefined) g[n] = i + 1;
});

// Imported after the globals above, which these modules read at load time.
const { loop: observerLoop, powerOpTicksNeeded } = await import(
  "../src/orchestrators/orchestrator.observer"
);
const { loop: powerCreepLoop } = await import("../src/orchestrators/orchestrator.powercreep");
const { runDepositMiner } = await import("../src/roles/role.depositminer");
const { runDepositHauler } = await import("../src/roles/role.deposithauler");
const { spawnNextDepositCreep } = await import("../src/orchestrators/orchestrator.spawning.ops");
const { ROLE_DEPOSIT_HAULER } = await import("../src/config/config.roles");
const { wildsName } = await import("../src/services/services.chronicle");

let clock = 7000;
beforeEach(() => {
  clock += 1;
  g.Memory = {};
});

describe("power bank ops", () => {
  function world(
    homeLevel: number,
    bank: { power: number; hits: number; ticksToDecay: number },
    distance = 2
  ) {
    const home = { name: "W1N1", controller: { my: true, level: homeLevel }, memory: {} };
    const bankObj = { id: "pb", structureType: "powerBank", ...bank };
    const highway = {
      name: "W0N1",
      memory: {},
      find: (type: number) => (type === g.FIND_STRUCTURES ? [bankObj] : []),
    };
    g.Game = {
      time: clock,
      rooms: { W1N1: home, W0N1: highway },
      creeps: {},
      map: { getRoomLinearDistance: () => distance },
      getObjectById: (id: string) => (id === "pb" ? bankObj : null),
    };
  }

  it("counts spawn, travel and crack time", () => {
    // 2M hits at 2 x 25 ATTACK x 30 = 1500/tick -> 1334 ticks to crack.
    expect(powerOpTicksNeeded(2_000_000, 4)).toBe(750 + 200 + 1334 + 300);
  });

  it("only launches from an RCL8 room", () => {
    world(7, { power: 3000, hits: 2_000_000, ticksToDecay: 4900 });
    observerLoop();
    expect((g.Memory as Memory).powerOps ?? []).toHaveLength(0);

    world(8, { power: 3000, hits: 2_000_000, ticksToDecay: 4900 });
    observerLoop();
    expect((g.Memory as Memory).powerOps).toHaveLength(1);
  });

  it("skips a bank that will decay before the squad can crack it", () => {
    // Six rooms out needs 750 + 300 + 1667 + 300 = 3017 ticks.
    world(8, { power: 3000, hits: 2_000_000, ticksToDecay: 2600 }, 6);
    observerLoop();
    expect((g.Memory as Memory).powerOps ?? []).toHaveLength(0);
  });
});

describe("deposit ops", () => {
  function world(terminalAt: string[]) {
    const castle = (name: string) => ({
      name,
      controller: { my: true, level: 6 },
      terminal: terminalAt.includes(name) ? { id: `t-${name}` } : undefined,
      memory: {},
    });
    const deposit = { id: "d1", depositType: "silicon", lastCooldown: 5, ticksToDecay: 40_000 };
    const highway = {
      name: "W0N1",
      memory: {},
      find: (type: number) => (type === g.FIND_DEPOSITS ? [deposit] : []),
    };
    g.Game = {
      time: clock,
      rooms: { W1N1: castle("W1N1"), W2N1: castle("W2N1"), W0N1: highway },
      creeps: {},
      map: { getRoomLinearDistance: (a: string) => (a === "W1N1" ? 1 : 2) },
      getObjectById: (id: string) => (id === "d1" ? deposit : null),
    };
  }

  it("sends the caravans from the nearest castle with a terminal to sell the haul", () => {
    world(["W2N1"]);
    observerLoop();
    expect((g.Memory as Memory).depositOps?.map((op) => op.homeRoom)).toEqual(["W2N1"]);
  });

  it("digs nothing while no castle has a terminal", () => {
    world([]);
    observerLoop();
    expect((g.Memory as Memory).depositOps ?? []).toHaveLength(0);
  });
});

describe("power creep creation", () => {
  it("spends a free GPL level on upgrading, not on a second operator", () => {
    let created = 0;
    (g as Record<string, unknown>).PowerCreep = {
      create: () => {
        created++;
        return 0;
      },
    };
    g.Game = {
      time: clock,
      gpl: { level: 3 },
      rooms: { W1N1: { name: "W1N1", controller: { my: true }, memory: { powerSpawnId: "ps" } } },
      powerCreeps: {},
      getObjectById: () => ({ id: "ps" }),
    };
    // One operator at level 1 uses 2 of 3 GPL levels.
    (g.Game as { powerCreeps: Record<string, unknown> }).powerCreeps = {
      op1: { name: "op1", level: 1, memory: { homeRoom: "W9N9" }, ticksToLive: undefined, upgrade: () => -6, spawn: () => -1 },
    };
    powerCreepLoop();
    expect(created).toBe(0);
  });

  it("seeds the new operator's memory without touching Game.powerCreeps", () => {
    (g as Record<string, unknown>).PowerCreep = { create: () => 0 };
    g.Game = {
      time: clock,
      gpl: { level: 1 },
      rooms: { W1N1: { name: "W1N1", controller: { my: true }, memory: { powerSpawnId: "ps" } } },
      powerCreeps: {},
      getObjectById: () => ({ id: "ps" }),
    };
    expect(() => powerCreepLoop()).not.toThrow();
    expect(Object.values((g.Memory as Memory).powerCreeps ?? {})).toEqual([{ homeRoom: "W1N1" }]);
  });
});

describe("deposit miner", () => {
  function miner(haulerAdjacent: boolean, free = 88) {
    const calls: string[] = [];
    (g.Memory as Memory).depositOps = [
      { id: 1, depositId: "d1", roomName: "W0N1", depositType: "silicon", phase: "mining" } as DepositOp,
    ];
    const hauler = { memory: { role: ROLE_DEPOSIT_HAULER, depositOpId: 1 }, store: { getFreeCapacity: () => 500 } };
    g.Game = { time: clock, getObjectById: () => ({ id: "d1" }) };
    const creep = {
      room: { name: "W0N1" },
      memory: { depositOpId: 1 },
      store: { silicon: 12, getFreeCapacity: () => free },
      getActiveBodyparts: () => 20,
      pos: {
        getRangeTo: () => 1,
        findInRange: (_t: number, _r: number, opts: { filter: (c: unknown) => boolean }) =>
          haulerAdjacent ? [hauler].filter(opts.filter) : [],
      },
      transfer: () => calls.push("transfer"),
      drop: () => calls.push("drop"),
      harvest: () => calls.push("harvest"),
    } as unknown as Creep;
    runDepositMiner(creep);
    return calls;
  }

  it("hands cargo to an adjacent hauler each tick and keeps harvesting", () => {
    expect(miner(true)).toEqual(["transfer", "harvest"]);
  });

  it("holds cargo while the next harvest still fits and no hauler is beside it", () => {
    expect(miner(false)).toEqual(["harvest"]);
  });

  it("drops cargo when the next harvest would not fit", () => {
    expect(miner(false, 10)).toEqual(["drop", "harvest"]);
  });
});

describe("nomads in the chronicle", () => {
  const chronicled = () => ((g.Memory as Memory).chronicle ?? []).map((l) => l.text);

  function castle() {
    const spawned: CreepMemory[] = [];
    const room = {
      name: "W1N1",
      energyAvailable: 2300,
      energyCapacityAvailable: 2300,
      memory: {} as RoomMemory,
      find: () => [],
    } as unknown as Room;
    const spawn = {
      spawnCreep: (_body: unknown, _name: string, opts: { memory: CreepMemory }) => {
        spawned.push(opts.memory);
        return g.OK;
      },
    } as unknown as StructureSpawn;
    return { room, spawn, spawned };
  }

  it("tells of the first nomad setting out for a deposit, and not of the ones sent after it", () => {
    g.Memory = { rooms: { W1N1: { townName: "Ravenhold" } }, creeps: {} } as unknown as Memory;
    (g.Memory as Memory).depositOps = [
      { id: 1, roomName: "W0N1", homeRoom: "W1N1", depositType: "silicon", phase: "mining", requiredMiners: 1, requiredHaulers: 1 } as DepositOp,
    ];
    for (const t of [clock, clock + 1500]) {
      g.Game = { time: t, creeps: {}, rooms: {} };
      const { room, spawn, spawned } = castle();
      expect(spawnNextDepositCreep(room, spawn)).toBe(true);
      expect(spawned[0]).toMatchObject({ targetRoom: "W0N1", depositOpId: 1 });
    }

    expect(chronicled()).toEqual([`Nomads ride out from Ravenhold to dig the glass sand of the ${wildsName("W0N1")}.`]);
  });

  it("tells the loads a deposit's caravans bring home as one line", () => {
    g.Memory = { rooms: { W1N1: { townName: "Ravenhold" } } } as unknown as Memory;
    const storage = { id: "s1" };
    const caravan = (time: number, load: number) => {
      g.Game = { time };
      runDepositHauler({
        room: { name: "W1N1", storage },
        memory: { homeRoom: "W1N1", targetRoom: "W0N1", depositOpId: 1 },
        store: { silicon: load, getFreeCapacity: () => 0 },
        transfer: () => g.OK,
      } as unknown as Creep);
    };
    caravan(clock, 550);
    caravan(clock + 400, 600);

    expect(chronicled()).toEqual([`The caravans of Ravenhold bring 1150 glass sand home from the ${wildsName("W0N1")}.`]);
  });
});
