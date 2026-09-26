import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;

g.WORK = "work";
g.CARRY = "carry";
g.MOVE = "move";
g.ATTACK = "attack";
g.RANGED_ATTACK = "ranged_attack";
g.HEAL = "heal";
g.TOUGH = "tough";
g.CLAIM = "claim";
g.BODYPART_COST = {
  work: 100,
  carry: 50,
  move: 50,
  attack: 80,
  ranged_attack: 150,
  heal: 250,
  tough: 10,
  claim: 600,
};
g.ATTACK_POWER = 30;
g.RANGED_ATTACK_POWER = 10;
g.DISMANTLE_POWER = 50;
g.HEAL_POWER = 12;
g.CREEP_SPAWN_TIME = 3;
g.RESOURCE_ENERGY = "energy";
g.FIND_MY_SPAWNS = 108;
g.FIND_MY_STRUCTURES = 109;
g.TOWER_ENERGY_COST = 10;
g.FIND_HOSTILE_CREEPS = 103;
g.FIND_STRUCTURES = 101;
g.FIND_SOURCES = 105;
g.FIND_CONSTRUCTION_SITES = 111;
g.FIND_MY_CONSTRUCTION_SITES = 114;
g.OK = 0;

import {
  processRoomSpawning,
  buildKnightBody,
  buildSiegerBody,
  buildReserverBody,
  buildPowerAttackerBody,
} from "../src/orchestrators/orchestrator.spawning";
import {
  ROLE_MINER,
  ROLE_HAULER,
  ROLE_FILLER,
  ROLE_UPGRADER,
  ROLE_REPAIRER,
  ROLE_KNIGHT,
  ROLE_HARVESTER,
  ROLE_REMOTE_MINER,
  ROLE_REMOTE_HAULER,
  ROLE_RESERVER,
} from "../src/config/config.roles";

type SpawnCall = { body: string[]; memory: CreepMemory };

const ROOM = "W5N5";
const REMOTE = "W6N5";
let clock = 20_000;
let spawnCalls: SpawnCall[] = [];

function part(type: unknown) {
  return { type, hits: 100 };
}

function makeCreep(
  role: string,
  parts: { work?: number; carry?: number; claim?: number },
  opts: { ttl?: number; memory?: Partial<CreepMemory>; room?: string } = {}
): Creep {
  const body = [
    ...Array(parts.work ?? 0).fill(part(g.WORK)),
    ...Array(parts.carry ?? 0).fill(part(g.CARRY)),
    ...Array(parts.claim ?? 0).fill(part(g.CLAIM)),
    part(g.MOVE),
  ];
  return {
    name: `${role}${Math.random()}`,
    spawning: false,
    ticksToLive: opts.ttl ?? 1400,
    room: { name: opts.room ?? ROOM },
    body,
    memory: { role, homeRoom: ROOM, ...opts.memory },
  } as unknown as Creep;
}

function hostile(types: unknown[]): Creep {
  return {
    name: `hostile${Math.random()}`,
    owner: { username: "Enemy" },
    body: types.map(part),
    pos: { x: 10, y: 10 },
  } as unknown as Creep;
}

interface RoomOpts {
  rcl: number;
  capacity: number;
  energy: number;
  storageEnergy?: number;
  containerIds?: string[];
  minerContainerIds?: string[];
  hostiles?: Creep[];
  remoteRooms?: RemoteRoomData[];
  extraRooms?: Record<string, unknown>;
  intel?: Record<string, Partial<RoomIntelData>>;
}

function makeRoom(creeps: Creep[], o: RoomOpts) {
  const spawn = {
    id: "spawn1",
    name: "Spawn1",
    spawning: null,
    pos: { x: 25, y: 25 },
    spawnCreep(body: string[], _name: string, opts: { memory: CreepMemory }) {
      spawnCalls.push({ body, memory: opts.memory });
      return g.OK;
    },
  };

  const storage =
    o.storageEnergy === undefined
      ? undefined
      : {
          id: "storage1",
          structureType: "storage",
          store: {
            energy: o.storageEnergy,
            getUsedCapacity: () => 0,
            getFreeCapacity: () => 100_000,
          },
        };

  const containers = ["cont1", "cont2"].map((id) => ({
    id,
    structureType: "container",
    pos: { x: 40, y: 20 },
    store: { energy: 1000 },
  }));

  const room = {
    name: ROOM,
    controller: {
      my: true,
      level: o.rcl,
      ticksToDowngrade: 100_000,
      owner: { username: "Me" },
      pos: { x: 9, y: 5 },
    },
    energyAvailable: o.energy,
    energyCapacityAvailable: o.capacity,
    storage,
    memory: {
      spawnId: "spawn1",
      containerIds: o.containerIds ?? [],
      minerContainerIds: o.minerContainerIds ?? [],
      remoteRooms: o.remoteRooms,
    } as unknown as RoomMemory,
    // Filters are ignored on purpose: nothing here has hits, so a structure
    // filter would find nothing either way.
    find: (type: number) => {
      if (type === g.FIND_MY_SPAWNS) return [spawn];
      if (type === g.FIND_HOSTILE_CREEPS) return o.hostiles ?? [];
      return [];
    },
  } as unknown as Room;

  const byName: Record<string, Creep> = {};
  for (const c of creeps) byName[c.name] = c;

  g.Game = {
    time: clock,
    creeps: byName,
    rooms: { [ROOM]: room, ...(o.extraRooms ?? {}) },
    cpu: { bucket: 10_000, limit: 20, getUsed: () => 0 },
    map: { getRoomLinearDistance: () => 1 },
    getObjectById: (id: string) => {
      if (id === "spawn1") return spawn;
      if (id === "storage1") return storage ?? null;
      return containers.find((c) => c.id === id) ?? null;
    },
  };
  g.Memory = { creeps: {}, rooms: { [ROOM]: room.memory }, intel: o.intel ?? {} };
  g.PathFinder = {
    search: () => ({ incomplete: false, path: new Array(10).fill({ x: 0, y: 0 }) }),
  };

  return { room, spawn: spawn as unknown as StructureSpawn };
}

function roles(): string[] {
  return spawnCalls.map((c) => c.memory.role);
}

beforeEach(() => {
  clock += 1000;
  spawnCalls = [];
});

describe("a miner with nothing refilling the core", () => {
  const minerRoom = { rcl: 4, capacity: 1300, energy: 500, minerContainerIds: ["cont1", "cont2"] };

  function miners() {
    return [
      makeCreep(ROLE_MINER, { work: 5, carry: 1 }, {
        memory: { assignedSourceId: "src1" as Id<Source>, assignedContainerId: "cont1" as Id<StructureContainer> },
      }),
      makeCreep(ROLE_MINER, { work: 5, carry: 1 }, {
        ttl: 10,
        memory: { assignedSourceId: "src2" as Id<Source>, assignedContainerId: "cont2" as Id<StructureContainer> },
      }),
    ];
  }

  it("orders the first hauler ahead of the replacement miner", () => {
    const { room, spawn } = makeRoom(miners(), { ...minerRoom, containerIds: ["cont1", "cont2"] });
    processRoomSpawning(room, spawn);
    expect(roles()).toEqual([ROLE_HAULER]);
  });

  it("spawns what it can afford instead of holding the spawn", () => {
    const { room, spawn } = makeRoom(miners(), minerRoom);
    processRoomSpawning(room, spawn);
    expect(roles()).toEqual([ROLE_MINER]);
  });

  it("still holds for a full-size miner while a hauler refills the core", () => {
    const creeps = [...miners(), makeCreep(ROLE_HAULER, { carry: 10 })];
    const { room, spawn } = makeRoom(creeps, minerRoom);
    processRoomSpawning(room, spawn);
    expect(spawnCalls).toEqual([]);
  });

  it("sends the replacement to the retiring miner's post", () => {
    const { room, spawn } = makeRoom(miners(), minerRoom);
    processRoomSpawning(room, spawn);
    expect(spawnCalls[0].memory.assignedSourceId).toBe("src2");
    expect(spawnCalls[0].memory.assignedContainerId).toBe("cont2");
  });
});

describe("filler during an energy emergency", () => {
  it("replaces the filler, which is the one creep that ends the emergency", () => {
    const creeps = [
      makeCreep(ROLE_MINER, { work: 5, carry: 1 }),
      makeCreep(ROLE_MINER, { work: 5, carry: 1 }),
    ];
    const { room, spawn } = makeRoom(creeps, {
      rcl: 5,
      capacity: 1800,
      energy: 300,
      storageEnergy: 20_000,
      minerContainerIds: ["cont1", "cont2"],
    });
    processRoomSpawning(room, spawn);
    expect(roles()).toEqual([ROLE_FILLER]);
  });
});

describe("full-body wait", () => {
  function settled(upgraders: number) {
    return [
      makeCreep(ROLE_FILLER, { carry: 10 }),
      makeCreep(ROLE_MINER, { work: 5, carry: 1 }),
      makeCreep(ROLE_MINER, { work: 5, carry: 1 }),
      makeCreep(ROLE_HAULER, { carry: 16 }),
      makeCreep(ROLE_HAULER, { carry: 16 }),
      ...Array.from({ length: upgraders }, () => makeCreep(ROLE_UPGRADER, { work: 10, carry: 5 })),
    ];
  }
  const opts = {
    rcl: 6,
    capacity: 2300,
    energy: 1448,
    storageEnergy: 815_000,
    containerIds: ["cont1", "cont2"],
    minerContainerIds: ["cont1", "cont2"],
  };

  it("does not use up the wait on ticks when nothing was needed", () => {
    // Three upgraders is the target at this storage level, so none is needed.
    const full = makeRoom(settled(3), opts);
    for (let i = 0; i < 60; i++) {
      (g.Game as { time: number }).time = clock + i;
      processRoomSpawning(full.room, full.spawn);
    }
    expect(spawnCalls).toEqual([]);

    // One dies. The room has to wait for a full body now, not spawn a runt.
    const short = makeRoom(settled(2), opts);
    (short.room as unknown as { memory: RoomMemory }).memory = full.room.memory;
    (g.Game as { time: number }).time = clock + 60;
    processRoomSpawning(short.room, short.spawn);
    expect(spawnCalls).toEqual([]);
  });
});

describe("RCL 8 upgrader", () => {
  const opts = {
    rcl: 8,
    capacity: 12_900,
    energy: 12_900,
    storageEnergy: 900_000,
    containerIds: ["cont1", "cont2"],
    minerContainerIds: ["cont1", "cont2"],
  };
  function settled() {
    return [
      makeCreep(ROLE_FILLER, { carry: 10 }),
      makeCreep(ROLE_FILLER, { carry: 10 }),
      makeCreep(ROLE_MINER, { work: 5, carry: 1 }),
      makeCreep(ROLE_MINER, { work: 5, carry: 1 }),
      makeCreep(ROLE_HAULER, { carry: 32 }),
      makeCreep(ROLE_HAULER, { carry: 32 }),
      makeCreep(ROLE_REPAIRER, { work: 10, carry: 10 }),
    ];
  }

  it("builds no more WORK than the controller will take", () => {
    const { room, spawn } = makeRoom(settled(), opts);
    processRoomSpawning(room, spawn);
    expect(roles()).toEqual([ROLE_UPGRADER]);
    expect(spawnCalls[0].body.filter((p) => p === g.WORK)).toHaveLength(15);
  });

  it("stops at one upgrader however much energy is stored", () => {
    const creeps = [...settled(), makeCreep(ROLE_UPGRADER, { work: 15, carry: 3 })];
    const { room, spawn } = makeRoom(creeps, opts);
    processRoomSpawning(room, spawn);
    expect(roles()).not.toContain(ROLE_UPGRADER);
  });
});

describe("ad-hoc defenders", () => {
  function bootstrap(hostiles: Creep[]) {
    return makeRoom([makeCreep(ROLE_HARVESTER, { work: 2, carry: 1 }), makeCreep(ROLE_HARVESTER, { work: 2, carry: 1 })], {
      rcl: 2,
      capacity: 550,
      energy: 550,
      hostiles,
    });
  }

  it("defends a bootstrap room against a hostile that can hit it", () => {
    const { room, spawn } = bootstrap([hostile([g.ATTACK, g.ATTACK, g.MOVE])]);
    processRoomSpawning(room, spawn);
    expect(roles()).toEqual([ROLE_KNIGHT]);
  });

  it("defends against a dismantler", () => {
    const { room, spawn } = bootstrap([hostile([g.WORK, g.WORK, g.CARRY, g.MOVE])]);
    processRoomSpawning(room, spawn);
    expect(roles()).toEqual([ROLE_KNIGHT]);
  });

  it("ignores a hostile that can only carry and move", () => {
    const { room, spawn } = bootstrap([hostile([g.CARRY, g.MOVE])]);
    processRoomSpawning(room, spawn);
    expect(roles()).not.toContain(ROLE_KNIGHT);
  });
});

describe("remote rooms", () => {
  const remote: RemoteRoomData = {
    roomName: REMOTE,
    sources: [{ sourceId: "rsrc1" } as unknown as RemoteSourceData],
    lastSeen: 0,
    hostile: false,
  };
  const base = {
    rcl: 4,
    capacity: 1300,
    energy: 1300,
    storageEnergy: 100_000,
    containerIds: ["cont1", "cont2"],
    minerContainerIds: ["cont1", "cont2"],
  };
  function settled(extra: Creep[] = []) {
    return [
      makeCreep(ROLE_FILLER, { carry: 10 }),
      makeCreep(ROLE_MINER, { work: 5, carry: 1 }),
      makeCreep(ROLE_MINER, { work: 5, carry: 1 }),
      makeCreep(ROLE_HAULER, { carry: 16 }),
      makeCreep(ROLE_HAULER, { carry: 16 }),
      makeCreep(ROLE_UPGRADER, { work: 8, carry: 4 }),
      makeCreep(ROLE_UPGRADER, { work: 8, carry: 4 }),
      makeCreep(ROLE_UPGRADER, { work: 8, carry: 4 }),
      makeCreep(ROLE_REPAIRER, { work: 5, carry: 5 }),
      ...extra,
    ];
  }

  it("mines a free remote", () => {
    const { room, spawn } = makeRoom(settled(), { ...base, remoteRooms: [remote] });
    processRoomSpawning(room, spawn);
    expect(roles()).toEqual([ROLE_REMOTE_MINER]);
  });

  it("leaves a remote another home already mines", () => {
    const other = makeCreep(ROLE_REMOTE_MINER, { work: 5 }, {
      memory: { homeRoom: "W9N9", targetRoom: REMOTE, remoteSourceId: "rsrc1" as Id<Source> },
      room: REMOTE,
    });
    const { room, spawn } = makeRoom(settled([other]), { ...base, remoteRooms: [remote] });
    processRoomSpawning(room, spawn);
    expect(roles()).not.toContain(ROLE_REMOTE_MINER);
  });

  it("stops mining a remote once we have claimed it", () => {
    const { room, spawn } = makeRoom(settled(), {
      ...base,
      remoteRooms: [remote],
      extraRooms: { [REMOTE]: { name: REMOTE, controller: { my: true, owner: { username: "Me" } } } },
    });
    processRoomSpawning(room, spawn);
    expect(spawnCalls).toEqual([]);
  });

  it("leaves a remote another player reserves", () => {
    const { room, spawn } = makeRoom(settled(), {
      ...base,
      remoteRooms: [remote],
      intel: { [REMOTE]: { reservedBy: "Enemy" } },
    });
    processRoomSpawning(room, spawn);
    expect(spawnCalls).toEqual([]);
  });

  it("sends only a reserver to an Invader-reserved remote", () => {
    const { room, spawn } = makeRoom(settled(), {
      ...base,
      remoteRooms: [remote],
      intel: { [REMOTE]: { reservedBy: "Invader" } },
    });
    processRoomSpawning(room, spawn);
    expect(roles()).toEqual([ROLE_RESERVER]);
  });

  it("sends nothing new into a remote with invaders in it", () => {
    // A defender is already on its way, so the remote defender path is idle.
    const knight = makeCreep(ROLE_KNIGHT, {}, { memory: { targetRoom: REMOTE } });
    const { room, spawn } = makeRoom(settled([knight]), {
      ...base,
      remoteRooms: [{ ...remote, invaderUntil: clock + 500 }],
    });
    processRoomSpawning(room, spawn);
    expect(roles()).not.toContain(ROLE_REMOTE_MINER);
    expect(roles()).not.toContain(ROLE_REMOTE_HAULER);
    expect(roles()).not.toContain(ROLE_RESERVER);
  });

  it("does not send a reserver while the reservation is healthy", () => {
    const miner = makeCreep(ROLE_REMOTE_MINER, { work: 5 }, {
      memory: { targetRoom: REMOTE, remoteSourceId: "rsrc1" as Id<Source> },
      room: REMOTE,
    });
    const haulers = Array.from({ length: 6 }, () =>
      makeCreep(ROLE_REMOTE_HAULER, { carry: 13 }, { memory: { targetRoom: REMOTE }, room: REMOTE })
    );
    const visible = (ticksToEnd: number) => ({
      [REMOTE]: {
        name: REMOTE,
        controller: { my: false, reservation: { username: "Me", ticksToEnd } },
      },
    });

    const healthy = makeRoom(settled([miner, ...haulers]), {
      ...base,
      remoteRooms: [remote],
      extraRooms: visible(4000),
    });
    processRoomSpawning(healthy.room, healthy.spawn);
    expect(roles()).not.toContain(ROLE_RESERVER);

    const low = makeRoom(settled([miner, ...haulers]), {
      ...base,
      remoteRooms: [remote],
      extraRooms: visible(800),
    });
    processRoomSpawning(low.room, low.spawn);
    expect(roles()).toContain(ROLE_RESERVER);
  });
});

describe("tower-gated home defense", () => {
  const base = {
    rcl: 4,
    capacity: 1300,
    storageEnergy: 100_000,
    containerIds: ["cont1", "cont2"],
    minerContainerIds: ["cont1", "cont2"],
  };
  const settled = () => [
    makeCreep(ROLE_FILLER, { carry: 10 }),
    makeCreep(ROLE_MINER, { work: 5, carry: 1 }),
    makeCreep(ROLE_MINER, { work: 5, carry: 1 }),
    makeCreep(ROLE_HAULER, { carry: 16 }),
    makeCreep(ROLE_HAULER, { carry: 16 }),
    makeCreep(ROLE_UPGRADER, { work: 8, carry: 4 }),
    makeCreep(ROLE_UPGRADER, { work: 8, carry: 4 }),
    makeCreep(ROLE_UPGRADER, { work: 8, carry: 4 }),
    makeCreep(ROLE_REPAIRER, { work: 5, carry: 5 }),
  ];

  function enemy(x: number, body: { type: unknown; boost?: string }[]): Creep {
    return {
      name: `enemy${Math.random()}`,
      owner: { username: "Enemy" },
      hits: body.length * 100,
      body: body.map((p) => ({ ...p, hits: 100 })),
      pos: { x, y: 25 },
    } as unknown as Creep;
  }
  const many = (type: unknown, n: number, boost?: string) =>
    Array.from({ length: n }, () => ({ type, boost }));

  // One tower 5 tiles from the hostiles: 600 damage a tick.
  function towerRoom(energy: number, hostiles: Creep[], spawnHurt = false) {
    const made = makeRoom(settled(), { ...base, energy, hostiles });
    const tower = {
      id: "tower1",
      structureType: g.STRUCTURE_TOWER,
      hits: 3000,
      hitsMax: 3000,
      store: { energy: 1000 },
      pos: { getRangeTo: () => 5 },
    };
    const spawnHits = { structureType: g.STRUCTURE_SPAWN, hits: spawnHurt ? 4000 : 5000, hitsMax: 5000 };
    made.room.memory.towerIds = ["tower1" as Id<StructureTower>];
    const find = made.room.find.bind(made.room);
    (made.room as unknown as { find: unknown }).find = (type: number, opts?: unknown) =>
      type === g.FIND_MY_STRUCTURES ? [tower, spawnHits] : find(type as FindConstant, opts as never);
    const game = g.Game as { getObjectById: (id: string) => unknown };
    const get = game.getObjectById;
    game.getObjectById = (id: string) => (id === "tower1" ? tower : get(id));
    return made;
  }

  const healedDismantler = () => [
    enemy(20, [...many(g.WORK, 5), ...many(g.MOVE, 5)]),
    // 13 XLHO2 HEAL heals 624 a tick, more than the tower deals.
    enemy(21, many(g.HEAL, 13, "XLHO2")),
  ];

  it("leaves an attacker the towers can kill to the towers", () => {
    const { room, spawn } = towerRoom(1300, [enemy(20, [...many(g.ATTACK, 2), ...many(g.MOVE, 2)])]);
    processRoomSpawning(room, spawn);
    expect(roles()).not.toContain(ROLE_KNIGHT);
  });

  it("raises a knight when the hostiles out-heal the towers", () => {
    const { room, spawn } = towerRoom(1300, healedDismantler());
    processRoomSpawning(room, spawn);
    expect(roles()).toContain(ROLE_KNIGHT);
  });

  it("waits for a full-size knight while the base is holding", () => {
    const { room, spawn } = towerRoom(400, healedDismantler());
    processRoomSpawning(room, spawn);
    expect(roles()).not.toContain(ROLE_KNIGHT);
  });

  it("spawns what it can straight away once a spawn is taking hits", () => {
    const { room, spawn } = towerRoom(400, healedDismantler(), true);
    processRoomSpawning(room, spawn);
    expect(roles()).toContain(ROLE_KNIGHT);
  });
});

describe("home defense op", () => {
  it("counts the ad-hoc knight already at home toward the op", () => {
    const { room, spawn } = makeRoom(
      [
        makeCreep(ROLE_FILLER, { carry: 10 }),
        makeCreep(ROLE_MINER, { work: 5, carry: 1 }),
        makeCreep(ROLE_MINER, { work: 5, carry: 1 }),
        makeCreep(ROLE_HAULER, { carry: 16 }),
        makeCreep(ROLE_HAULER, { carry: 16 }),
        makeCreep(ROLE_KNIGHT, {}),
      ],
      {
        rcl: 4,
        capacity: 1300,
        energy: 1300,
        storageEnergy: 100_000,
        containerIds: ["cont1", "cont2"],
        minerContainerIds: ["cont1", "cont2"],
      }
    );
    (Memory as { defenseOps?: Record<string, DefenseOp> }).defenseOps = {
      [room.name]: {
        room: room.name,
        startedAt: clock,
        lastThreatTick: clock,
        threatScore: 50,
        requiredMelee: 1,
        requiredRanged: 0,
        requiredHealers: 0,
      },
    };
    processRoomSpawning(room, spawn);
    expect(roles()).not.toContain(ROLE_KNIGHT);
  });
});

describe("remote invader defense", () => {
  const remote: RemoteRoomData = {
    roomName: REMOTE,
    sources: [{ sourceId: "rsrc1" } as unknown as RemoteSourceData],
    lastSeen: 0,
    hostile: false,
  };
  function run(strength: RemoteRoomData["invaderStrength"], worked = remote) {
    const knight = makeCreep(ROLE_KNIGHT, {}, { memory: { targetRoom: REMOTE } });
    const { room, spawn } = makeRoom(
      [
        makeCreep(ROLE_FILLER, { carry: 10 }),
        makeCreep(ROLE_MINER, { work: 5, carry: 1 }),
        makeCreep(ROLE_MINER, { work: 5, carry: 1 }),
        makeCreep(ROLE_HAULER, { carry: 16 }),
        makeCreep(ROLE_HAULER, { carry: 16 }),
        makeCreep(ROLE_UPGRADER, { work: 8, carry: 4 }),
        makeCreep(ROLE_UPGRADER, { work: 8, carry: 4 }),
        makeCreep(ROLE_UPGRADER, { work: 8, carry: 4 }),
        makeCreep(ROLE_REPAIRER, { work: 5, carry: 5 }),
        knight,
      ],
      {
        rcl: 4,
        capacity: 1300,
        energy: 1300,
        storageEnergy: 100_000,
        containerIds: ["cont1", "cont2"],
        minerContainerIds: ["cont1", "cont2"],
        remoteRooms: [{ ...worked, invaderUntil: clock + 500, invaderStrength: strength }],
      }
    );
    processRoomSpawning(room, spawn);
  }

  it("sends a second knight when one cannot out-damage the invaders' healing", () => {
    // A 1300-capacity knight hits for 180; the invaders heal 300.
    run({ heal: 300, damage: 100, hits: 3000 });
    const knights = spawnCalls.filter((c) => c.memory.role === ROLE_KNIGHT);
    expect(knights).toHaveLength(1);
    expect(knights[0].memory.targetRoom).toBe(REMOTE);
  });

  it("keeps to one knight against a lone invader", () => {
    run({ heal: 0, damage: 60, hits: 1500 });
    expect(roles()).not.toContain(ROLE_KNIGHT);
  });

  it("sends no knight to a remote the home does not work", () => {
    // An unreachable source earns nothing, so the remote is never picked.
    const unworked = {
      ...remote,
      sources: [
        { sourceId: "rsrc1", pathLength: 999, pathKey: "k", pathTick: clock } as unknown as RemoteSourceData,
      ],
    };
    run({ heal: 300, damage: 100, hits: 3000 }, unworked);
    expect(roles()).not.toContain(ROLE_KNIGHT);
  });
});

describe("bodies", () => {
  const moveRatioOk = (body: string[]) =>
    body.filter((p) => p === g.MOVE).length >= body.filter((p) => p !== g.MOVE).length;

  it("gives knights and siegers one MOVE per other part", () => {
    for (const energy of [300, 800, 2300, 12_900]) {
      expect(moveRatioOk(buildKnightBody(energy) as unknown as string[])).toBe(true);
      expect(moveRatioOk(buildSiegerBody(energy) as unknown as string[])).toBe(true);
    }
  });

  it("gives power attackers 25 ATTACK and 25 MOVE", () => {
    const body = buildPowerAttackerBody() as unknown as string[];
    expect(body.filter((p) => p === g.ATTACK)).toHaveLength(25);
    expect(body.filter((p) => p === g.MOVE)).toHaveLength(25);
  });

  it("uses two CLAIM once the room can afford them, capped at three", () => {
    const claims = (e: number) =>
      (buildReserverBody(e) as unknown as string[]).filter((p) => p === g.CLAIM).length;
    expect(claims(800)).toBe(1);
    expect(claims(1300)).toBe(2);
    expect(claims(12_900)).toBe(3);
  });
});
