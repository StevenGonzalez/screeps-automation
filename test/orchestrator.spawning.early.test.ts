import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;

g.RESOURCE_ENERGY = "energy";
g.FIND_MY_SPAWNS = 108;
g.FIND_HOSTILE_CREEPS = 103;
g.FIND_STRUCTURES = 101;
g.FIND_SOURCES = 105;
g.FIND_CONSTRUCTION_SITES = 111;
g.FIND_MY_CONSTRUCTION_SITES = 114;
g.TERRAIN_MASK_WALL = 1;
g.STRUCTURE_WALL = "constructedWall";
g.OK = 0;

import { processRoomSpawning } from "../src/orchestrators/orchestrator.spawning";
import {
  ROLE_HARVESTER,
  ROLE_MINER,
  ROLE_HAULER,
  ROLE_UPGRADER,
} from "../src/config/config.roles";

type SpawnCall = { body: string[]; role: string };

const ROOM = "W5N5";

let clock = 20_000;
let spawnCalls: SpawnCall[] = [];

function makeCreep(
  role: string,
  parts: { work?: number; carry?: number },
  memory: Partial<CreepMemory> = {}
): Creep {
  const body = [
    ...Array(parts.work ?? 0).fill({ type: g.WORK, hits: 100 }),
    ...Array(parts.carry ?? 0).fill({ type: g.CARRY, hits: 100 }),
    { type: g.MOVE, hits: 100 },
  ];
  return {
    name: `${role}${Math.random()}`,
    spawning: false,
    ticksToLive: 1400,
    room: { name: ROOM },
    body,
    memory: { role, homeRoom: ROOM, ...memory },
  } as unknown as Creep;
}

interface RoomSetup {
  rcl: number;
  capacity: number;
  energy: number;
  creeps: Creep[];
  // Energy held in each of the room's two source containers; none when omitted.
  containerEnergy?: number;
  // Walkable tiles around each source; the rest of its ring is wall.
  openTiles?: number;
}

function makeRoom(setup: RoomSetup) {
  const spawn = {
    id: "spawn1",
    name: "Spawn1",
    spawning: null,
    pos: { x: 25, y: 25 },
    spawnCreep(body: string[], _name: string, opts: { memory: { role: string } }) {
      spawnCalls.push({ body, role: opts.memory.role });
      return g.OK;
    },
  };

  const sources = [
    { id: "src1", pos: { x: 10, y: 10 } },
    { id: "src2", pos: { x: 40, y: 40 } },
  ];
  const open = setup.openTiles ?? 8;
  // The first `open` tiles of each source's ring (row by row) are plain.
  const ringIndex = (x: number, y: number): number => {
    for (const s of sources) {
      const dx = x - s.pos.x;
      const dy = y - s.pos.y;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) continue;
      const i = (dy + 1) * 3 + (dx + 1);
      return i > 4 ? i - 1 : i;
    }
    return -1;
  };
  const terrain = {
    get: (x: number, y: number) => {
      const i = ringIndex(x, y);
      return i >= 0 && i >= open ? g.TERRAIN_MASK_WALL : 0;
    },
  };

  const containers =
    setup.containerEnergy === undefined
      ? []
      : ["cont1", "cont2"].map((id) => ({
          id,
          structureType: "container",
          pos: { x: 11, y: 11 },
          store: { energy: setup.containerEnergy },
        }));
  const containerIds = containers.map((c) => c.id);

  const room = {
    name: ROOM,
    controller: { my: true, level: setup.rcl, ticksToDowngrade: 20_000, pos: { x: 9, y: 5 } },
    energyAvailable: setup.energy,
    energyCapacityAvailable: setup.capacity,
    memory: {
      spawnId: "spawn1",
      containerIds,
      minerContainerIds: containerIds,
    } as unknown as RoomMemory,
    getTerrain: () => terrain,
    find: (type: number, opts?: { filter?: (o: unknown) => boolean }) => {
      let list: unknown[] = [];
      if (type === g.FIND_MY_SPAWNS) list = [spawn];
      if (type === g.FIND_STRUCTURES) list = containers;
      if (type === g.FIND_SOURCES) list = sources;
      return opts?.filter ? list.filter(opts.filter) : list;
    },
  } as unknown as Room;

  const byName: Record<string, Creep> = {};
  for (const c of setup.creeps) byName[c.name] = c;

  g.Game = {
    time: clock,
    creeps: byName,
    rooms: { [ROOM]: room },
    cpu: { bucket: 10_000, limit: 20, getUsed: () => 0 },
    getObjectById: (id: string) => {
      if (id === "spawn1") return spawn;
      return (
        containers.find((c) => c.id === id) ?? sources.find((s) => s.id === id) ?? null
      );
    },
  };
  g.Memory = { creeps: {}, rooms: { [ROOM]: room.memory } };
  g.PathFinder = {
    search: () => ({ incomplete: false, path: new Array(10).fill({ x: 0, y: 0 }) }),
  };

  return { room, spawn: spawn as unknown as StructureSpawn };
}

function harvesters(n: number, work = 1): Creep[] {
  return Array.from({ length: n }, () => makeCreep(ROLE_HARVESTER, { work, carry: work }));
}

const WORK = "work";

beforeEach(() => {
  clock += 500;
  spawnCalls = [];
});

describe("harvester crew before miners", () => {
  it("keeps adding one-WORK harvesters past two until the sources are covered", () => {
    // RCL 1: 300 energy buys one WORK, so draining a source takes five of them,
    // and three open tiles per source cap that at three.
    const { room, spawn } = makeRoom({
      rcl: 1,
      capacity: 300,
      energy: 300,
      creeps: harvesters(2),
      openTiles: 3,
    });

    processRoomSpawning(room, spawn);

    expect(spawnCalls.map((c) => c.role)).toEqual([ROLE_HARVESTER]);
  });

  it("stops at the tiles the sources have room for", () => {
    const { room, spawn } = makeRoom({
      rcl: 1,
      capacity: 300,
      energy: 300,
      creeps: harvesters(6),
      openTiles: 3,
    });

    processRoomSpawning(room, spawn);

    expect(spawnCalls.some((c) => c.role === ROLE_HARVESTER)).toBe(false);
  });

  it("needs fewer harvesters once each one carries more WORK", () => {
    // RCL 3: 800 energy buys four WORK, so two harvesters drain a source.
    const { room, spawn } = makeRoom({
      rcl: 3,
      capacity: 800,
      energy: 800,
      creeps: harvesters(4, 4),
    });

    processRoomSpawning(room, spawn);

    expect(spawnCalls.some((c) => c.role === ROLE_HARVESTER)).toBe(false);
  });

  it("waits for a full body instead of spawning a one-WORK runt", () => {
    const { room, spawn } = makeRoom({
      rcl: 2,
      capacity: 550,
      energy: 250,
      creeps: harvesters(1, 2),
    });

    processRoomSpawning(room, spawn);
    expect(spawnCalls.some((c) => c.role === ROLE_HARVESTER)).toBe(false);

    (room as unknown as { energyAvailable: number }).energyAvailable = 550;
    (g.Game as { time: number }).time = clock + 1;
    processRoomSpawning(room, spawn);
    const harvester = spawnCalls.find((c) => c.role === ROLE_HARVESTER);
    expect(harvester?.body.filter((p) => p === WORK)).toHaveLength(2);
  });
});

describe("miner sizing at low capacity", () => {
  it("gives an RCL 2 miner the four WORK that 550 capacity can buy", () => {
    const { room, spawn } = makeRoom({
      rcl: 2,
      capacity: 550,
      energy: 550,
      containerEnergy: 0,
      creeps: [
        makeCreep(ROLE_MINER, { work: 4, carry: 1 }, {
          assignedSourceId: "src1" as Id<Source>,
          assignedContainerId: "cont1" as Id<StructureContainer>,
        }),
        makeCreep(ROLE_HAULER, { carry: 6 }),
        ...harvesters(3, 2),
      ],
    });

    processRoomSpawning(room, spawn);

    expect(spawnCalls.map((c) => c.role)).toEqual([ROLE_MINER]);
    expect(spawnCalls[0].body.filter((p) => p === WORK)).toHaveLength(4);
  });
});

describe("upgraders before storage", () => {
  function settledRcl2(containerEnergy: number) {
    return makeRoom({
      rcl: 2,
      capacity: 550,
      energy: 550,
      containerEnergy,
      creeps: [
        makeCreep(ROLE_MINER, { work: 4, carry: 1 }, {
          assignedSourceId: "src1" as Id<Source>,
          assignedContainerId: "cont1" as Id<StructureContainer>,
        }),
        makeCreep(ROLE_MINER, { work: 4, carry: 1 }, {
          assignedSourceId: "src2" as Id<Source>,
          assignedContainerId: "cont2" as Id<StructureContainer>,
        }),
        makeCreep(ROLE_HAULER, { carry: 6 }),
        makeCreep(ROLE_HAULER, { carry: 6 }),
        makeCreep(ROLE_UPGRADER, { work: 2, carry: 1 }),
      ],
    });
  }

  it("adds upgraders while energy banks up in the containers", () => {
    const { room, spawn } = settledRcl2(1500);

    processRoomSpawning(room, spawn);

    expect(spawnCalls.map((c) => c.role)).toEqual([ROLE_UPGRADER]);
  });

  it("keeps the single upgrader while the containers are drawn down", () => {
    const { room, spawn } = settledRcl2(400);

    processRoomSpawning(room, spawn);

    expect(spawnCalls.some((c) => c.role === ROLE_UPGRADER)).toBe(false);
  });
});
