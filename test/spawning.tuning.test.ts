import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_MY_SPAWNS = 108;
g.OK = 0;

import {
  getUpgraderPopulationTarget,
  buildUpgraderBody,
} from "../src/orchestrators/orchestrator.spawning.economy";
import { waitForFullBody, creepName, trackedSpawn } from "../src/orchestrators/orchestrator.spawning.shared";
import {
  getActiveRemoteRooms,
  getPickedRemoteRoomNames,
} from "../src/orchestrators/orchestrator.spawning.remote";
import { ROLE_REMOTE_MINER, ROLE_UPGRADER } from "../src/config/config.roles";

let clock = 90_000;

beforeEach(() => {
  clock += 1000;
});

function storageRoom(stored: number): Room {
  const room = {
    name: "W1N1",
    controller: { my: true, level: 5, ticksToDowngrade: 50_000 },
    energyAvailable: 1800,
    energyCapacityAvailable: 1800,
    storage: { store: { energy: stored } },
    memory: {},
    find: () => [],
  } as unknown as Room;
  g.Game = { time: clock, rooms: { W1N1: room }, creeps: {} };
  g.Memory = { rooms: { W1N1: room.memory }, creeps: {} };
  return room;
}

describe("upgraders with storage", () => {
  it("adds a second upgrader once 20k sits above the upgraders' floor", () => {
    expect(getUpgraderPopulationTarget(storageRoom(25_000))).toBe(1);
    expect(getUpgraderPopulationTarget(storageRoom(30_000))).toBe(2);
    expect(getUpgraderPopulationTarget(storageRoom(50_000))).toBe(3);
  });

  it("stays at the cap however much is stored", () => {
    expect(getUpgraderPopulationTarget(storageRoom(900_000))).toBe(3);
  });
});

describe("upgrader body", () => {
  const cost = (body: string[]) => body.reduce((n, p) => n + (BODYPART_COST as Record<string, number>)[p], 0);

  it("spends an RCL 2 room's 550 energy instead of stopping at 300", () => {
    const body = buildUpgraderBody(550);
    expect(cost(body)).toBe(550);
    expect(body.filter((p) => p === WORK)).toHaveLength(4);
    expect(body.filter((p) => p === MOVE)).toHaveLength(2);
  });

  it("fills an RCL 3 room's 800 energy to within 50", () => {
    const body = buildUpgraderBody(800);
    expect(800 - cost(body)).toBeLessThanOrEqual(50);
    expect(body.filter((p) => p === CARRY)).toHaveLength(2);
  });

  it("stays within 50 parts", () => {
    expect(buildUpgraderBody(12_900).length).toBeLessThanOrEqual(50);
  });
});

describe("waitForFullBody", () => {
  function lowRoom(): Room {
    const room = {
      name: "W1N1",
      energyAvailable: 300,
      energyCapacityAvailable: 1300,
      memory: {},
    } as unknown as Room;
    g.Memory = { rooms: { W1N1: room.memory }, creeps: {} };
    return room;
  }

  it("gives each creep its own wait after giving up on the last", () => {
    const room = lowRoom();
    g.Game = { time: clock };
    expect(waitForFullBody(room, ROLE_UPGRADER, true)).toBe(true);
    g.Game = { time: clock + 40 };
    expect(waitForFullBody(room, ROLE_UPGRADER, true)).toBe(false);
    // Still short: the next one waits again rather than going out as a runt.
    g.Game = { time: clock + 41 };
    expect(waitForFullBody(room, ROLE_UPGRADER, true)).toBe(true);
  });

  it("keeps waiting while the extensions still fill, even after other spawns drew on them", () => {
    const room = lowRoom();
    const at = (time: number, energy: number) => {
      g.Game = { time };
      (room as { energyAvailable: number }).energyAvailable = energy;
      return waitForFullBody(room, ROLE_UPGRADER, true);
    };
    expect(at(clock, 900)).toBe(true);
    // A cheaper role below it spawned and emptied the extensions.
    expect(at(clock + 30, 50)).toBe(true);
    // Refilling: the wait runs from the last rise, not from when it began.
    expect(at(clock + 60, 600)).toBe(true);
    expect(at(clock + 99, 600)).toBe(true);
    // Stuck short of the mark for the whole wait: settle for a smaller body.
    expect(at(clock + 100, 600)).toBe(false);
  });
});

describe("remote picks look past invaders", () => {
  function remote(roomName: string, invaded: boolean): RemoteRoomData {
    return {
      roomName,
      lastSeen: 0,
      hostile: false,
      invaderUntil: invaded ? clock + 500 : undefined,
      sources: [
        { sourceId: `${roomName}-s0`, pathLength: 40, pathKey: "k", pathTick: clock } as unknown as RemoteSourceData,
      ],
    };
  }

  function home(remotes: RemoteRoomData[], creeps: Creep[] = []): Room {
    const room = {
      name: "W5N5",
      controller: { my: true, level: 4, owner: { username: "Me" } },
      energyAvailable: 1300,
      energyCapacityAvailable: 1300,
      memory: { remoteRooms: remotes } as unknown as RoomMemory,
      find: (type: number) => (type === g.FIND_MY_SPAWNS ? [{ id: "spawn0" }] : []),
    } as unknown as Room;
    const byName: Record<string, Creep> = {};
    for (const c of creeps) byName[c.name] = c;
    g.Game = {
      time: clock,
      creeps: byName,
      rooms: { W5N5: room },
      cpu: { bucket: 10_000 },
      map: { getRoomLinearDistance: () => 1 },
      getObjectById: () => null,
    };
    g.Memory = { creeps: {}, rooms: { W5N5: room.memory }, intel: {} };
    return room;
  }

  it("keeps working a remote whose miner died while the bucket refills after a pixel", () => {
    // No miner alive at W6N5: its last one has just died.
    let room = home([remote("W6N5", false)]);
    (g.Game as { cpu: { bucket: number } }).cpu.bucket = 1_000;
    expect(getActiveRemoteRooms(room)).toEqual([]);

    clock += 1;
    room = home([remote("W6N5", false)]);
    (g.Game as { cpu: { bucket: number } }).cpu.bucket = 1_000;
    (g.Memory as Memory).lastPixelTick = clock - 70;
    expect(getActiveRemoteRooms(room).map((r) => r.roomName)).toEqual(["W6N5"]);
  });

  it("keeps an invaded remote picked while sending no economy creeps there", () => {
    const room = home([remote("W4N5", true), remote("W6N5", false)]);
    expect([...getPickedRemoteRoomNames(room)].sort()).toEqual(["W4N5", "W6N5"]);
    expect(getActiveRemoteRooms(room).map((r) => r.roomName)).toEqual(["W6N5"]);
  });

  it("keeps a mined source that a new one of equal worth would only just fit beside", () => {
    // Fill the home until the second source only fits without headroom. Each
    // upgrader takes 12 ticks of spawn time, finer than the headroom window.
    const upgraders = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        name: `u${i}`,
        room: { name: "W5N5" },
        body: Array(4).fill({ type: "work", hits: 100 }),
        memory: { role: ROLE_UPGRADER, homeRoom: "W5N5" },
      })) as unknown as Creep[];
    const miner = {
      name: "m",
      room: { name: "W6N5" },
      body: [],
      memory: { role: ROLE_REMOTE_MINER, homeRoom: "W5N5", remoteSourceId: "W6N5-s0" },
    } as unknown as Creep;
    const remotes = [remote("W4N5", false), remote("W6N5", false)];
    let busy = 0;
    // Find a load where both fit only when the mined one needs no headroom.
    for (let n = 0; n < 160; n++) {
      const fresh = getPickedRemoteRoomNames(home(remotes, upgraders(n)));
      clock += 1;
      const withMiner = getPickedRemoteRoomNames(home(remotes, [...upgraders(n), miner]));
      clock += 1;
      if (withMiner.size > fresh.size) {
        busy = n;
        expect(withMiner.has("W6N5")).toBe(true);
        break;
      }
    }
    expect(busy).toBeGreaterThan(0);
  });
});

describe("creep names", () => {
  it("styles a creep by its role and a given name", () => {
    storageRoom(0);
    expect(creepName(ROLE_UPGRADER)).toMatch(/^Enchanter [A-Z][a-z]+$/);
  });

  it("skips names worn by the living, left in Memory, or given out this tick", () => {
    const room = storageRoom(0);
    const first = creepName(ROLE_UPGRADER);
    (g.Game as any).creeps[first] = {};
    const second = creepName(ROLE_UPGRADER);
    expect(second).not.toBe(first);
    (g.Memory as any).creeps[second] = { role: ROLE_UPGRADER };
    const third = creepName(ROLE_UPGRADER);
    expect([first, second]).not.toContain(third);

    const named: string[] = [];
    const spawn = { spawnCreep: (_b: unknown, name: string) => (named.push(name), 0) };
    trackedSpawn(room, spawn as unknown as StructureSpawn, [], { memory: { role: ROLE_UPGRADER } as CreepMemory });
    trackedSpawn(room, spawn as unknown as StructureSpawn, [], { memory: { role: ROLE_REMOTE_MINER } as CreepMemory });
    expect(named[0]).toBe(third);
    expect(named[1]).toMatch(/^Peddler /);
    expect(creepName(ROLE_UPGRADER)).not.toBe(third);
    // Each recruit is counted in the season's annals.
    expect((g.Memory as Memory).annals?.recruits).toBe(2);
  });

  it("gives a name no creep of another role wears while one is free", () => {
    storageRoom(0);
    const given = (name: string) => name.slice(name.lastIndexOf(" ") + 1);
    const first = creepName(ROLE_UPGRADER);
    (g.Game as any).creeps[`Miner ${given(first)}`] = {};
    expect(given(creepName(ROLE_UPGRADER))).not.toBe(given(first));
  });

  it("shares a given name with another role once every one is worn", () => {
    storageRoom(0);
    for (let i = 0; i < 200; i++) {
      const name = creepName(ROLE_UPGRADER);
      if (/\d/.test(name)) break;
      (g.Game as any).creeps[name.replace("Enchanter", "Miner")] = {};
    }
    expect(creepName(ROLE_UPGRADER)).toMatch(/^Enchanter [A-Z][a-z]+$/);
  });

  it("skips a name on a fresh grave in the room", () => {
    const room = storageRoom(0);
    const first = creepName(ROLE_UPGRADER, room);
    (room as unknown as { find: () => unknown[] }).find = () => [{ creep: { name: first } }];
    expect(creepName(ROLE_UPGRADER, room)).not.toBe(first);
  });
});
