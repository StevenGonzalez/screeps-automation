import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;

// Module-level caches in services.creep are keyed on Game.time, so each case
// advances the clock to avoid inheriting the previous case's cached lookups.
let clock = 100;

beforeEach(() => {
  g.RESOURCE_ENERGY = "energy";
  g.FIND_STRUCTURES = 101;
  g.FIND_MY_CONSTRUCTION_SITES = 102;
  g.FIND_HOSTILE_CREEPS = 103;
  g.FIND_MY_STRUCTURES = 104;
  g.FIND_SOURCES = 105;
  g.FIND_MINERALS = 106;
  g.FIND_TOMBSTONES = 107;
  g.FIND_RUINS = 108;
  g.FIND_DROPPED_RESOURCES = 109;
  g.STRUCTURE_ROAD = "road";
  g.STRUCTURE_LINK = "link";
  g.STRUCTURE_CONTAINER = "container";
  g.STRUCTURE_RAMPART = "rampart";
  g.STRUCTURE_WALL = "wall";
  g.ERR_NOT_IN_RANGE = -1;
  g.OK = 0;
  g.Memory = {};
  clock += 1;
});

import { runUpgrader } from "../src/roles/role.upgrader";

const controller = {
  my: true,
  id: "controller",
  ticksToDowngrade: 5171,
  pos: { x: 9, y: 5 },
} as unknown as StructureController;

function runFullUpgraderIn(room: Room): string[] {
  const calls: string[] = [];
  const creep = {
    room,
    name: "consultant1",
    memory: {} as CreepMemory,
    pos: {
      x: 25,
      y: 25,
      getRangeTo: () => 5,
      findInRange: () => [],
      // Stand-in for pathfinding: the nearest target is simply the first one.
      findClosestByPath: <T>(targets: T[]) => targets[0] ?? null,
    },
    store: {
      getFreeCapacity: () => 0,
      [g.RESOURCE_ENERGY as string]: 50,
    },
    owner: { username: "Me" },
    getActiveBodyparts: () => 4,
    moveTo: () => g.OK as number,
    upgradeController: () => {
      calls.push("upgradeController");
      return g.OK as number;
    },
    build: () => {
      calls.push("build");
      return g.OK as number;
    },
    repair: () => {
      calls.push("repair");
      return g.OK as number;
    },
    signController: () => g.OK as number,
  } as unknown as Creep;

  runUpgrader(creep);
  return calls;
}

function runEmptyUpgraderIn(room: Room): string[] {
  const calls: string[] = [];
  const creep = {
    room,
    name: "consultant2",
    memory: {} as CreepMemory,
    pos: {
      x: 25,
      y: 25,
      getRangeTo: () => 5,
      findInRange: () => [],
      findClosestByPath: <T>(targets: T[]) => targets[0] ?? null,
      findClosestByRange: <T>(targets: T[]) => (Array.isArray(targets) ? targets[0] ?? null : null),
    },
    store: {
      getFreeCapacity: () => 50,
      getUsedCapacity: () => 0,
      [g.RESOURCE_ENERGY as string]: 0,
    },
    owner: { username: "Me" },
    moveTo: () => g.OK as number,
    upgradeController: () => g.OK as number,
    withdraw: (target: { id: string }) => {
      calls.push(`withdraw:${target.id}`);
      return g.OK as number;
    },
    pickup: () => g.OK as number,
    harvest: () => g.OK as number,
  } as unknown as Creep;

  runUpgrader(creep);
  return calls;
}

function roomWithStorage(storedEnergy: number): Room {
  const storage = {
    id: "storage1",
    structureType: "storage",
    store: { [g.RESOURCE_ENERGY as string]: storedEnergy },
    pos: { x: 20, y: 20, getRangeTo: () => 5 },
  };
  g.Game = {
    time: clock,
    getObjectById: (id: string) => (id === "storage1" ? storage : null),
  };
  return {
    name: `W48S8-${clock}`,
    controller: {
      ...controller,
      pos: { x: 9, y: 5, getRangeTo: () => 5, findInRange: () => [] },
    },
    storage,
    memory: {} as RoomMemory,
    find: () => [],
  } as unknown as Room;
}

describe("upgrader storage floor", () => {
  it("draws on storage while the room has a buffer", () => {
    const calls = runEmptyUpgraderIn(roomWithStorage(50_000));

    expect(calls).toContain("withdraw:storage1");
  });

  it("leaves the last of the storage alone", () => {
    const calls = runEmptyUpgraderIn(roomWithStorage(5_000));

    expect(calls).not.toContain("withdraw:storage1");
  });

  it("takes nothing from storage or a source link below the floor", () => {
    // Here the room's structure scan sees storage and a stocked source link,
    // the buffer the upgrader used to fall back on.
    const room = roomWithStorage(5_000);
    const sourceLink = {
      id: "srcLink",
      structureType: "link",
      store: { [g.RESOURCE_ENERGY as string]: 600 },
      pos: { x: 40, y: 20, getRangeTo: () => 20 },
    };
    (room as unknown as { find: () => unknown[] }).find = () => [room.storage, sourceLink];

    const calls = runEmptyUpgraderIn(room);

    expect(calls).toEqual([]);
  });

  it("empties storage anyway rather than let the controller downgrade", () => {
    const room = roomWithStorage(5_000);
    (room.controller as unknown as { ticksToDowngrade: number }).ticksToDowngrade = 1000;

    const calls = runEmptyUpgraderIn(room);

    expect(calls).toContain("withdraw:storage1");
  });
});

describe("upgrader in a keep with no storage", () => {
  function youngKeep(porterBringing: boolean): Room {
    const container = (id: string, energy: number) => ({
      id,
      structureType: "container",
      store: { [g.RESOURCE_ENERGY as string]: energy },
      pos: { x: 14, y: 5, getRangeTo: () => 5 },
    });
    const upgradeCont = container("upgradeCont", 0);
    const minerCont = container("minerCont", 1400);
    const porter = { store: { [g.RESOURCE_ENERGY as string]: 300 }, memory: { fillTargetId: "upgradeCont" } };
    g.Game = {
      time: clock,
      creeps: porterBringing ? { "Porter Warin": porter } : {},
      getObjectById: (id: string) => ({ upgradeCont, minerCont } as Record<string, unknown>)[id] ?? null,
    };
    return {
      name: `W48S7-${clock}`,
      controller: { ...controller, pos: { x: 12, y: 6, getRangeTo: () => 5, findInRange: () => [] } },
      memory: { upgradeContainerId: "upgradeCont" } as RoomMemory,
      find: (type: number) => (type === g.FIND_STRUCTURES ? [upgradeCont, minerCont] : []),
    } as unknown as Room;
  }

  it("waits by the upgrade container while a porter brings gold to it", () => {
    // Walking off to a miner container across the keep, an enchanter turned
    // back each time a porter refilled the upgrade container behind it.
    const calls = runEmptyUpgraderIn(youngKeep(true));
    expect(calls).not.toContain("withdraw:minerCont");
  });

  it("fetches its own gold when no porter is bringing any", () => {
    const calls = runEmptyUpgraderIn(youngKeep(false));
    expect(calls).toContain("withdraw:minerCont");
  });
});

describe("upgrader in a castle with storage", () => {
  function castle(porterBringing: boolean): Room {
    const room = roomWithStorage(50_000);
    const upgradeCont = {
      id: "upgradeCont",
      structureType: "container",
      store: { [g.RESOURCE_ENERGY as string]: 0 },
      pos: { x: 14, y: 5, getRangeTo: () => 5 },
    };
    const porter = { store: { [g.RESOURCE_ENERGY as string]: 400 }, memory: { fillTargetId: "upgradeCont" } };
    const game = g.Game as { creeps: Record<string, unknown>; getObjectById: (id: string) => unknown };
    const byId = game.getObjectById;
    game.creeps = porterBringing ? { "Porter Osric": porter } : {};
    game.getObjectById = (id: string) => (id === "upgradeCont" ? upgradeCont : byId(id));
    room.memory.upgradeContainerId = "upgradeCont" as Id<StructureContainer>;
    return room;
  }

  // Grimford's storage stands twenty tiles from the throne. Its enchanters set
  // off for it whenever the container ran dry, and turned back when a porter
  // a few tiles off filled it behind them.
  it("waits by the upgrade container while a porter brings gold to it", () => {
    const calls = runEmptyUpgraderIn(castle(true));
    expect(calls).not.toContain("withdraw:storage1");
  });

  it("goes to storage when no porter is bringing any", () => {
    const calls = runEmptyUpgraderIn(castle(false));
    expect(calls).toContain("withdraw:storage1");
  });
});

describe("runUpgrader", () => {
  it("upgrades the controller even while the room has construction sites", () => {
    const site = {
      id: "site",
      structureType: g.STRUCTURE_ROAD,
      progress: 0,
      progressTotal: 300,
      pos: { x: 25, y: 24, getRangeTo: () => 1, findInRange: () => [] },
    };
    g.Game = { time: clock, getObjectById: (id: string) => (id === "site" ? site : null) };

    const room = {
      name: `W48S8-${clock}`,
      controller,
      memory: {} as RoomMemory,
      find: (type: number) => (type === g.FIND_MY_CONSTRUCTION_SITES ? [site] : []),
    } as unknown as Room;

    const calls = runFullUpgraderIn(room);

    expect(calls).toContain("upgradeController");
    expect(calls).not.toContain("build");
  });

  it("upgrades the controller even while a road in the room is damaged", () => {
    const road = {
      id: "road",
      structureType: g.STRUCTURE_ROAD,
      hits: 4900,
      hitsMax: 5000,
      pos: { x: 25, y: 24, getRangeTo: () => 1, findInRange: () => [] },
    };
    g.Game = { time: clock, getObjectById: (id: string) => (id === "road" ? road : null) };

    const room = {
      name: `W48S8-${clock}`,
      controller,
      memory: {} as RoomMemory,
      find: (type: number) => (type === g.FIND_STRUCTURES ? [road] : []),
    } as unknown as Room;

    const calls = runFullUpgraderIn(room);

    expect(calls).toContain("upgradeController");
    expect(calls).not.toContain("repair");
  });
});

describe("enchanter's seat at the throne", () => {
  // Grimford's throne: the controller at 12,6, its container at 14,5, rock to
  // the west of the container, swamp at 14,4 and 14,6, and the porters' road
  // coming in from the east along row 5.
  const WALLS = new Set(["13,4", "13,5"]);

  function grimford(opts: {
    at: [number, number];
    taken?: string[];
    working?: boolean;
    link?: boolean;
    throne?: [number, number];
    built?: Record<string, string>;
  }): string[] {
    const moves: string[] = [];
    g.LOOK_CREEPS = "creep";
    g.LOOK_STRUCTURES = "structure";
    g.TERRAIN_MASK_WALL = 1;
    g.OBSTACLE_OBJECT_TYPES = ["spawn", "extension", "constructedWall", "link"];
    g.WORK = "work";
    // Its own id each case, as the seats are kept by container.
    const contId = `upgradeCont${clock}`;
    const upgradeCont = {
      id: contId,
      structureType: "container",
      store: { [g.RESOURCE_ENERGY as string]: 0 },
      pos: { x: 14, y: 5, getRangeTo: () => 1 },
    };
    const link = { id: "link1", structureType: "link", store: { [g.RESOURCE_ENERGY as string]: 0 } };
    const porter = { store: { [g.RESOURCE_ENERGY as string]: 400 }, memory: { fillTargetId: contId } };
    g.Game = {
      time: clock,
      creeps: { "Porter Ralph": porter },
      getObjectById: (id: string) => ({ [contId]: upgradeCont, link1: link } as Record<string, unknown>)[id] ?? null,
    };
    const taken = new Set(opts.taken ?? []);
    const room = {
      name: `W48S7-${clock}`,
      controller: {
        ...controller,
        pos: {
          x: opts.throne?.[0] ?? 12,
          y: opts.throne?.[1] ?? 6,
          getRangeTo: () => 3,
          findInRange: () => (opts.link ? [link] : []),
        },
      },
      memory: { upgradeContainerId: contId, lastSigned: clock } as RoomMemory,
      find: () => [],
      getTerrain: () => ({ get: (x: number, y: number) => (WALLS.has(`${x},${y}`) ? 1 : 0) }),
      lookForAt: (type: string, x: number, y: number) => {
        if (type === g.LOOK_CREEPS) return taken.has(`${x},${y}`) ? [{ name: "Enchanter Other" }] : [];
        const built = opts.built?.[`${x},${y}`];
        return built ? [{ structureType: built }] : [];
      },
    } as unknown as Room;
    const [x, y] = opts.at;
    const energy = opts.working ? 30 : 0;
    const creep = {
      room,
      name: "Enchanter Edwin",
      memory: { working: !!opts.working } as CreepMemory,
      pos: { x, y, getRangeTo: () => 1 },
      store: { getFreeCapacity: () => 50 - energy, getUsedCapacity: () => energy, [g.RESOURCE_ENERGY as string]: energy },
      owner: { username: "Me" },
      getActiveBodyparts: () => 4,
      moveTo: (tx: number | { x: number; y: number }, ty?: number) => {
        moves.push(typeof tx === "number" ? `${tx},${ty}` : `${tx.x},${tx.y}`);
        return g.OK as number;
      },
      upgradeController: () => g.OK as number,
      withdraw: () => g.OK as number,
    } as unknown as Creep;
    runUpgrader(creep);
    return moves;
  }

  it("moves up from the porters' tile to a free seat nearer the throne", () => {
    expect(grimford({ at: [15, 5], working: true })).toEqual(["13,6"]);
  });

  it("does so too while it waits on a porter for gold", () => {
    expect(grimford({ at: [15, 5], taken: ["13,6"] })).toEqual(["14,4"]);
  });

  it("takes the nearest free seat, whichever side of the container the throne lies", () => {
    expect(grimford({ at: [13, 6], working: true, throne: [16, 6] })).toEqual(["15,5"]);
  });

  it("passes over a seat built on", () => {
    expect(grimford({ at: [15, 5], working: true, built: { "13,6": "extension", "14,4": "road" } })).toEqual(["14,4"]);
  });

  it("does not shuffle to a seat no nearer the throne", () => {
    expect(grimford({ at: [14, 6], working: true, taken: ["13,6"] })).toEqual([]);
  });

  it("keeps off seats out of the throne's reach", () => {
    expect(grimford({ at: [13, 6], working: true, throne: [18, 8], taken: ["15,5", "15,6"] })).toEqual([]);
  });

  it("leaves an enchanter that is not beside the container where it is", () => {
    expect(grimford({ at: [16, 5], working: true })).toEqual([]);
  });

  it("stays put when every seat nearer the throne is taken", () => {
    expect(grimford({ at: [15, 5], working: true, taken: ["13,6", "14,4", "14,6"] })).toEqual([]);
  });

  it("stays by the link where a link feeds the throne", () => {
    expect(grimford({ at: [15, 5], working: true, link: true })).toEqual([]);
  });
});

describe("upgrader top-up", () => {
  function upgraderBesideContainer(energy: number, stocked: number): string[] {
    const calls: string[] = [];
    const upgradeCont = {
      id: "upgradeCont",
      structureType: "container",
      store: { [g.RESOURCE_ENERGY as string]: stocked },
      pos: { x: 35, y: 20 },
    };
    g.WORK = "work";
    g.Game = { time: clock, getObjectById: (id: string) => (id === "upgradeCont" ? upgradeCont : null) };
    const room = {
      name: `W47S7-${clock}`,
      controller: { ...controller, pos: { x: 35, y: 17, getRangeTo: () => 2, findInRange: () => [] } },
      memory: { upgradeContainerId: "upgradeCont", lastSigned: clock } as RoomMemory,
      find: () => [],
      getTerrain: () => ({ get: () => 0 }),
      lookForAt: () => [],
    } as unknown as Room;
    const creep = {
      room,
      name: "Enchanter Sybil",
      memory: { working: true } as CreepMemory,
      pos: { x: 35, y: 19, getRangeTo: () => 1 },
      store: { getFreeCapacity: () => 50 - energy, [g.RESOURCE_ENERGY as string]: energy },
      owner: { username: "Me" },
      getActiveBodyparts: () => 4,
      moveTo: () => g.OK as number,
      upgradeController: () => {
        calls.push("upgradeController");
        return g.OK as number;
      },
      withdraw: (target: { id: string }) => {
        calls.push(`withdraw:${target.id}`);
        return g.OK as number;
      },
    } as unknown as Creep;
    runUpgrader(creep);
    return calls;
  }

  it("takes its next load in the same tick it spends its last", () => {
    // Running dry first and withdrawing the tick after left the controller
    // one tick in every load without an upgrade.
    expect(upgraderBesideContainer(2, 900)).toEqual(["upgradeController", "withdraw:upgradeCont"]);
  });

  it("does not top up while it still has gold for more than this tick", () => {
    expect(upgraderBesideContainer(30, 900)).toEqual(["upgradeController"]);
  });

  it("does not reach for an empty container", () => {
    expect(upgraderBesideContainer(2, 0)).toEqual(["upgradeController"]);
  });
});
