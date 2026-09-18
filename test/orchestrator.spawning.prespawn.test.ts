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
g.CREEP_SPAWN_TIME = 3;
g.RESOURCE_ENERGY = "energy";
g.FIND_MY_SPAWNS = 108;
g.FIND_HOSTILE_CREEPS = 103;
g.FIND_STRUCTURES = 101;
g.FIND_CONSTRUCTION_SITES = 111;
g.FIND_MY_CONSTRUCTION_SITES = 114;
g.OK = 0;

import { processRoomSpawning } from "../src/orchestrators/orchestrator.spawning";
import {
  ROLE_MINER,
  ROLE_HAULER,
  ROLE_FILLER,
  ROLE_REPAIRER,
} from "../src/config/config.roles";

type SpawnCall = { body: string[]; name: string; role: string };

const ROOM = "W21S31";
const CAPACITY = 2300;

// 90% of capacity: the threshold the anti-runt gate waits for.
const FULL_ENERGY = CAPACITY;
const DIPPED_ENERGY = 1448;

let clock = 5000;
let spawnCalls: SpawnCall[] = [];

function makeCreep(
  role: string,
  parts: { work?: number; carry?: number },
  ticksToLive: number
): Creep {
  const body = [
    ...Array(parts.work ?? 0).fill({ type: g.WORK, hits: 100 }),
    ...Array(parts.carry ?? 0).fill({ type: g.CARRY, hits: 100 }),
    { type: g.MOVE, hits: 100 },
  ];
  return {
    name: `${role}${Math.random()}`,
    spawning: false,
    ticksToLive,
    room: { name: ROOM },
    body,
    memory: { role, homeRoom: ROOM },
  } as unknown as Creep;
}

function makeRoom(creeps: Creep[], energyAvailable: number) {
  const spawn = {
    id: "spawn1",
    name: "Spawn1",
    spawning: null,
    pos: { x: 25, y: 25 },
    spawnCreep(body: string[], name: string, opts: { memory: { role: string } }) {
      spawnCalls.push({ body, name, role: opts.memory.role });
      return g.OK;
    },
  };

  const storage = {
    id: "storage1",
    structureType: "storage",
    store: { energy: 815_300, getFreeCapacity: () => 100_000 },
  };

  const containers = ["cont1", "cont2"].map((id) => ({
    id,
    structureType: "container",
    pos: { x: 40, y: 20 },
    store: { energy: 1000 },
  }));

  const room = {
    name: ROOM,
    controller: { my: true, level: 6, ticksToDowngrade: 20_000, pos: { x: 9, y: 5 } },
    energyAvailable,
    energyCapacityAvailable: CAPACITY,
    storage,
    memory: {
      spawnId: "spawn1",
      containerIds: ["cont1", "cont2"],
      minerContainerIds: ["cont1", "cont2"],
    } as unknown as RoomMemory,
    find: (type: number) => {
      if (type === g.FIND_MY_SPAWNS) return [spawn];
      if (type === g.FIND_STRUCTURES) return [storage, ...containers];
      return [];
    },
  } as unknown as Room;

  const byName: Record<string, Creep> = {};
  for (const c of creeps) byName[c.name] = c;

  g.Game = {
    time: clock,
    creeps: byName,
    rooms: { [ROOM]: room },
    cpu: { bucket: 10_000, limit: 20, getUsed: () => 0 },
    getObjectById: (id: string) => {
      if (id === "spawn1") return spawn;
      if (id === "storage1") return storage;
      return containers.find((c) => c.id === id) ?? null;
    },
  };
  g.Memory = { creeps: {}, rooms: { [ROOM]: room.memory } };
  g.PathFinder = {
    search: () => ({ incomplete: false, path: new Array(20).fill({ x: 0, y: 0 }) }),
  };

  return { room, spawn: spawn as unknown as StructureSpawn };
}

/** A settled RCL 6 room: every income role is at target and healthy. */
function settledCreeps() {
  return [
    makeCreep(ROLE_FILLER, { carry: 10 }, 1200),
    makeCreep(ROLE_MINER, { work: 5, carry: 1 }, 1400),
    makeCreep(ROLE_MINER, { work: 5, carry: 1 }, 1400),
    makeCreep(ROLE_HAULER, { carry: 16 }, 1400),
    makeCreep(ROLE_HAULER, { carry: 16 }, 1400),
  ];
}

beforeEach(() => {
  clock += 500;
  spawnCalls = [];
});

describe("pre-spawning replacements", () => {
  it("leaves a healthy miner pair alone", () => {
    const { room, spawn } = makeRoom(settledCreeps(), FULL_ENERGY);

    processRoomSpawning(room, spawn);

    expect(spawnCalls.some((c) => c.role === ROLE_MINER)).toBe(false);
  });

  it("orders a miner while the one it replaces is still working", () => {
    const creeps = settledCreeps();
    // Spawn time for a 7-part miner plus the 20-step walk to the container.
    (creeps[1] as unknown as { ticksToLive: number }).ticksToLive = 30;
    const { room, spawn } = makeRoom(creeps, FULL_ENERGY);

    processRoomSpawning(room, spawn);

    expect(spawnCalls.map((c) => c.role)).toContain(ROLE_MINER);
  });

  it("does not order a miner one tick before the lead time starts", () => {
    const creeps = settledCreeps();
    (creeps[1] as unknown as { ticksToLive: number }).ticksToLive = 60;
    const { room, spawn } = makeRoom(creeps, FULL_ENERGY);

    processRoomSpawning(room, spawn);

    expect(spawnCalls.some((c) => c.role === ROLE_MINER)).toBe(false);
  });

  it("orders a hauler while the one it replaces is still hauling", () => {
    const creeps = settledCreeps();
    (creeps[3] as unknown as { ticksToLive: number }).ticksToLive = 20;
    const { room, spawn } = makeRoom(creeps, FULL_ENERGY);

    processRoomSpawning(room, spawn);

    expect(spawnCalls.map((c) => c.role)).toContain(ROLE_HAULER);
  });
});

describe("anti-runt body gate", () => {
  it("spawns immediately when the core is full", () => {
    const { room, spawn } = makeRoom(settledCreeps(), FULL_ENERGY);

    processRoomSpawning(room, spawn);

    expect(spawnCalls.map((c) => c.role)).toEqual([ROLE_REPAIRER]);
  });

  it("waits out a dip in the core rather than building a runt", () => {
    const { room, spawn } = makeRoom(settledCreeps(), DIPPED_ENERGY);

    processRoomSpawning(room, spawn);

    expect(spawnCalls).toEqual([]);
  });

  it("gives up the wait so a room that never refills still gets its creep", () => {
    const { room, spawn } = makeRoom(settledCreeps(), DIPPED_ENERGY);

    let firstSpawnAt = -1;
    for (let i = 0; i <= 40; i++) {
      (g.Game as { time: number }).time = clock + i;
      processRoomSpawning(room, spawn);
      if (firstSpawnAt === -1 && spawnCalls.length > 0) firstSpawnAt = i;
    }

    expect(firstSpawnAt).toBe(40);
    expect(spawnCalls.map((c) => c.role)).toEqual([ROLE_REPAIRER]);
  });
});
