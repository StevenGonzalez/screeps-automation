import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;

// Body part costs and the find constants the spawning chain reaches for.
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
g.RESOURCE_ENERGY = "energy";
g.FIND_MY_SPAWNS = 108;
g.FIND_HOSTILE_CREEPS = 103;
g.FIND_STRUCTURES = 101;
g.FIND_CONSTRUCTION_SITES = 111;
g.OK = 0;

import { processRoomSpawning } from "../src/orchestrators/orchestrator.spawning";
import {
  ROLE_MINER,
  ROLE_HAULER,
  ROLE_FILLER,
} from "../src/config/config.roles";

type SpawnCall = { body: string[]; name: string; role: string };

let clock = 1000;
let spawnCalls: SpawnCall[] = [];

function makeCreep(role: string, roomName: string, work: number): Creep {
  const body = [
    ...Array(work).fill({ type: g.WORK, hits: 100 }),
    { type: g.CARRY, hits: 100 },
    { type: g.MOVE, hits: 100 },
  ];
  return {
    name: `${role}${Math.random()}`,
    spawning: false,
    room: { name: roomName },
    body,
    memory: { role, homeRoom: roomName },
  } as unknown as Creep;
}

/**
 * The room from the RCL 6 stall: two full-size miners, one hauler, no filler,
 * a fat storage and a core that is short of a capacity-sized hauler body.
 */
function makeRoom(creeps: Creep[], energyAvailable: number) {
  const roomName = "W48S8";

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
    name: roomName,
    controller: { my: true, level: 6, ticksToDowngrade: 20_000, pos: { x: 9, y: 5 } },
    energyAvailable,
    energyCapacityAvailable: 2300,
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
    rooms: { [roomName]: room },
    cpu: { bucket: 10_000, limit: 20, getUsed: () => 0 },
    getObjectById: (id: string) => {
      if (id === "spawn1") return spawn;
      if (id === "storage1") return storage;
      return containers.find((c) => c.id === id) ?? null;
    },
  };
  g.Memory = { creeps: {}, rooms: { [roomName]: room.memory } };
  g.PathFinder = {
    search: () => ({ incomplete: false, path: new Array(20).fill({ x: 0, y: 0 }) }),
  };

  return { room, spawn };
}

beforeEach(() => {
  clock += 1;
  spawnCalls = [];
});

describe("RCL 6 spawn stall", () => {
  it("spawns the filler instead of holding the spawn for a full-size hauler", () => {
    const creeps = [
      makeCreep(ROLE_MINER, "W48S8", 5),
      makeCreep(ROLE_MINER, "W48S8", 5),
      makeCreep(ROLE_HAULER, "W48S8", 0),
    ];
    const { room, spawn } = makeRoom(creeps, 1448);

    processRoomSpawning(room, spawn as unknown as StructureSpawn);

    expect(spawnCalls.map((c) => c.role)).toEqual([ROLE_FILLER]);
  });

  it("gives up the hauler hold once it has starved the room for 100 ticks", () => {
    const creeps = [
      makeCreep(ROLE_MINER, "W48S8", 5),
      makeCreep(ROLE_MINER, "W48S8", 5),
      makeCreep(ROLE_HAULER, "W48S8", 0),
      makeCreep(ROLE_FILLER, "W48S8", 0),
    ];
    const { room, spawn } = makeRoom(creeps, 1448);

    // A filler is already alive, so the chain reaches the hauler and holds.
    processRoomSpawning(room, spawn as unknown as StructureSpawn);
    expect(spawnCalls).toEqual([]);

    for (let i = 1; i <= 100; i++) {
      (g.Game as { time: number }).time = clock + i;
      processRoomSpawning(room, spawn as unknown as StructureSpawn);
    }

    expect(spawnCalls.map((c) => c.role)).toEqual([ROLE_HAULER]);
  });
});
