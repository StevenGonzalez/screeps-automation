import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.OK = 0;
g.ERR_NOT_OWNER = -1;
g.ERR_NOT_IN_RANGE = -9;
g.FIND_HOSTILE_CREEPS = 103;
g.ATTACK_POWER = 30;
g.RANGED_ATTACK_POWER = 10;
g.DISMANTLE_POWER = 50;
g.HEAL_POWER = 12;
g.FIND_SOURCES = 105;
g.FIND_STRUCTURES = 107;
g.FIND_MY_CONSTRUCTION_SITES = 114;
g.FIND_HOSTILE_STRUCTURES = 109;
g.FIND_EXIT = 10;
g.TERRAIN_MASK_WALL = 1;
g.LOOK_RESOURCES = "resource";
g.RESOURCE_ENERGY = "energy";
g.RoomPosition = class {
  constructor(public x: number, public y: number, public roomName: string) {}
};

import { runReserver } from "../src/roles/role.reserver";
import { runRemoteMiner } from "../src/roles/role.remote_miner";
import { runSkHauler } from "../src/roles/role.sk_hauler";
import { loop as skLoop } from "../src/orchestrators/orchestrator.sourcekeeper";
import { cryFor } from "../src/services/services.herald";
import { isSafeRefuge } from "../src/services/services.creep";

const HOME = "W1N1";
const REMOTE = "W1N2";
const ME = "Me";

let remote: RemoteRoomData;

beforeEach(() => {
  remote = { roomName: REMOTE, sources: [], lastSeen: 0, hostile: false };
  g.Game = { time: 1000, creeps: {}, rooms: {}, getObjectById: () => null, map: { describeExits: () => null } };
  g.Memory = { rooms: { [HOME]: { remoteRooms: [remote] } }, allies: ["Pal"] };
});

describe("reserver", () => {
  function reserverIn(controller: unknown) {
    return {
      owner: { username: ME },
      room: { name: REMOTE, controller, memory: {} as RoomMemory, find: (): unknown[] => [] },
      pos: { getRangeTo: () => 1 },
      memory: { role: "reserver", homeRoom: HOME, targetRoom: REMOTE } as CreepMemory,
      reserveController: vi.fn(() => 0),
      signController: vi.fn(() => 0),
      attackController: vi.fn(() => 0),
      suicide: vi.fn(),
      moveTo: vi.fn(),
    };
  }

  it("attacks a controller someone else (incl. Invader) reserves", () => {
    const c = reserverIn({ reservation: { username: "Invader" } });
    runReserver(c as unknown as Creep);
    expect(c.attackController).toHaveBeenCalled();
    expect(c.reserveController).not.toHaveBeenCalled();
  });

  it("reserves an unreserved or self-reserved controller", () => {
    const c = reserverIn({ reservation: { username: ME } });
    runReserver(c as unknown as Creep);
    expect(c.reserveController).toHaveBeenCalled();
  });

  it("signs the remote's controller with a proclamation", () => {
    const c = reserverIn({ reservation: { username: ME }, pos: {} });
    runReserver(c as unknown as Creep);
    expect(c.signController).toHaveBeenCalledWith(c.room.controller, expect.any(String));
  });

  it("leaves a sign alone once it is ours and current", () => {
    const first = reserverIn({ reservation: { username: ME }, pos: {} });
    runReserver(first as unknown as Creep);
    const text = first.signController.mock.calls[0][1];
    (g.Game as any).time += 10000;
    const c = reserverIn({ reservation: { username: ME }, pos: {}, sign: { username: ME, text } });
    runReserver(c as unknown as Creep);
    expect(c.signController).not.toHaveBeenCalled();
  });

  it("gives up on a room another player owns", () => {
    const c = reserverIn({ my: false, owner: { username: "Stranger" } });
    runReserver(c as unknown as Creep);
    expect(c.suicide).toHaveBeenCalled();
    expect(c.attackController).not.toHaveBeenCalled();
  });

  it("notes how long its walk out took once it reaches the controller", () => {
    const c = Object.assign(reserverIn({ reservation: { username: ME } }), { ticksToLive: 520 });
    runReserver(c as unknown as Creep);
    expect((c.memory as CreepMemory).walk).toBe(80);
  });

  it("leaves for home when raiders come, and calls the knights", () => {
    // A fresh tick, so no threat cached by another test is read back.
    (g.Game as any).time = 2001;
    const c = reserverIn({ reservation: { username: ME } });
    const raider = { owner: { username: "Invader" }, body: [{ type: "attack", hits: 100 }] };
    c.room.find = () => [raider];
    runReserver(c as unknown as Creep);
    expect(c.reserveController).not.toHaveBeenCalled();
    expect(c.moveTo).toHaveBeenCalledWith(expect.objectContaining({ roomName: HOME }), expect.anything());
    expect(remote.invaderUntil).toBeGreaterThan(2001);
    expect(cryFor(c as unknown as Creep)).toBe("Bandits!");
  });

  it("waits at home until the raid on its remote is over", () => {
    remote.invaderUntil = 1100;
    const c = Object.assign(reserverIn(undefined), { ticksToLive: 400 });
    c.room = { ...c.room, name: HOME };
    runReserver(c as unknown as Creep);
    expect(c.moveTo).not.toHaveBeenCalled();
    expect(c.memory.walk).toBe(0);

    (g.Game as any).time = 1100;
    runReserver(c as unknown as Creep);
    expect(c.moveTo).toHaveBeenCalledWith(expect.objectContaining({ roomName: REMOTE }), expect.anything());
    expect(c.memory.fled).toBeUndefined();
  });

  it("steps off the exit it came home by before it waits", () => {
    remote.invaderUntil = 1100;
    const c = reserverIn(undefined);
    c.room = { ...c.room, name: HOME };
    // Left on the exit tile, it would be carried back into the raided remote.
    c.pos = { x: 49, y: 17 } as typeof c.pos;
    runReserver(c as unknown as Creep);
    expect(c.moveTo).toHaveBeenCalledWith(expect.objectContaining({ roomName: HOME }), expect.anything());

    c.moveTo.mockClear();
    c.pos = { x: 48, y: 17 } as typeof c.pos;
    runReserver(c as unknown as Creep);
    expect(c.moveTo).not.toHaveBeenCalled();
  });

  it("stands down once the remote has become one of our own keeps", () => {
    const c = reserverIn({ my: true, owner: { username: ME } });
    runReserver(c as unknown as Creep);
    expect(c.suicide).toHaveBeenCalled();
    expect(c.reserveController).not.toHaveBeenCalled();
  });
});

describe("remote miner", () => {
  function minerIn(roomName: string, extra: Record<string, unknown> = {}) {
    return {
      hits: 100,
      owner: { username: ME },
      store: { energy: 0 },
      pos: { isNearTo: () => true, isEqualTo: () => true, inRangeTo: () => true, findClosestByPath: () => null },
      room: { name: roomName, controller: undefined, find: () => [] },
      memory: { role: "remote_miner", homeRoom: HOME, targetRoom: REMOTE, remoteSourceId: "src", _hp: 200 },
      moveTo: vi.fn(),
      suicide: vi.fn(),
      harvest: vi.fn(() => 0),
      ...extra,
    };
  }

  it("does not flag the remote over damage taken in a transit room", () => {
    runRemoteMiner(minerIn("W5N5") as unknown as Creep);
    expect(remote.hostile).toBe(false);
  });

  it("flags the remote hostile over damage from a player inside it", () => {
    const player = { owner: { username: "Stranger" }, body: [{ type: "attack", hits: 100 }] };
    const creep = minerIn(REMOTE);
    creep.room.find = ((type: number) => (type === g.FIND_HOSTILE_CREEPS ? [player] : [])) as any;
    runRemoteMiner(creep as unknown as Creep);
    expect(remote.hostile).toBe(true);
    expect(remote.hostileStrikes).toBe(1);
  });

  it("calls a knight, not a player strike, over damage from Invaders inside it", () => {
    const creep = minerIn(REMOTE);
    const invader = { owner: { username: "Invader" }, body: [{ type: "work", hits: 100 }] };
    creep.room.find = ((type: number) => (type === g.FIND_HOSTILE_CREEPS ? [invader] : [])) as any;
    runRemoteMiner(creep as unknown as Creep);
    expect(remote.hostile).toBe(false);
    expect(remote.hostileStrikes).toBeUndefined();
    expect(remote.invaderUntil).toBeGreaterThan(1000);
  });

  it("marks the remote hostile when a player's reservation blocks harvesting", () => {
    const source = { id: "src", pos: { findInRange: () => [] } };
    (g.Game as any).getObjectById = (id: string) => (id === "src" ? source : null);
    const creep = minerIn(REMOTE, { harvest: vi.fn(() => -1) });
    creep.memory._hp = 100;
    creep.room.controller = { reservation: { username: "Stranger" } } as any;
    runRemoteMiner(creep as unknown as Creep);
    expect(creep.harvest).toHaveBeenCalled();
    expect(remote.hostile).toBe(true);
  });

  describe("raising its container", () => {
    const site = { structureType: "container" };
    const pile = { resourceType: "energy", amount: 3000 };
    let tick = 2000;

    function builderBeside(piles: unknown[], carried: number, at: unknown = site) {
      // A fresh tick, so no threat cached by the tests above is read back.
      (g.Game as any).time = ++tick;
      const source = {
        id: "src",
        pos: { findInRange: (type: number) => (type === g.FIND_MY_CONSTRUCTION_SITES ? [at] : []) },
      };
      (g.Game as any).getObjectById = (id: string) => (id === "src" ? source : null);
      const creep = minerIn(REMOTE, {
        store: { energy: carried, getFreeCapacity: () => 50 - carried },
        build: vi.fn(() => 0),
        pickup: vi.fn(() => 0),
        name: "Peddler Edric",
        getActiveBodyparts: () => 6,
      });
      creep.pos = { ...creep.pos, findInRange: () => piles } as any;
      creep.memory._hp = 100;
      runRemoteMiner(creep as unknown as Creep);
      return creep;
    }

    it("builds every tick with the gold lying at its feet", () => {
      const creep = builderBeside([pile], 20);
      expect(creep.pickup).toHaveBeenCalledWith(pile);
      expect(creep.build).toHaveBeenCalledWith(site);
      expect(creep.harvest).not.toHaveBeenCalled();
    });

    it("digs a full load before building when none lies there", () => {
      const creep = builderBeside([], 20);
      expect(creep.harvest).toHaveBeenCalled();
      expect(creep.build).not.toHaveBeenCalled();
      expect(builderBeside([], 50).build).toHaveBeenCalledWith(site);
    });

    it("tells the chronicle once when it lays the last of the container", () => {
      const last = { id: "c1", structureType: "container", progress: 4980, progressTotal: 5000, pos: { roomName: REMOTE } };
      builderBeside([pile], 20, { ...last, progress: 4900 });
      expect((g.Memory as any).chronicle ?? []).toHaveLength(0);
      builderBeside([pile], 20, last);
      builderBeside([pile], 20, last);
      const lines = (g.Memory as any).chronicle;
      expect(lines).toHaveLength(1);
      expect(lines[0].text).toMatch(/^Peddler Edric raised a waystation in the /);
    });

    function secondBuilt(firstId: string) {
      const last = { id: "c2", structureType: "container", progress: 4980, progressTotal: 5000, pos: { roomName: REMOTE } };
      (g.Memory as any).chronicle = [];
      const first = { id: firstId, structureType: "container" };
      (g.Game as any).time = ++tick;
      const source = {
        id: "src",
        pos: { findInRange: (type: number) => (type === g.FIND_MY_CONSTRUCTION_SITES ? [last] : []) },
      };
      (g.Game as any).getObjectById = (id: string) => (id === "src" ? source : null);
      const creep = minerIn(REMOTE, {
        store: { energy: 20, getFreeCapacity: () => 30 },
        build: vi.fn(() => 0),
        pickup: vi.fn(() => 0),
        name: "Peddler Lucan",
        getActiveBodyparts: () => 6,
      });
      creep.pos = { ...creep.pos, findInRange: () => [pile] } as any;
      creep.room.find = ((type: number) => (type === g.FIND_STRUCTURES ? [first] : [])) as any;
      creep.memory._hp = 100;
      runRemoteMiner(creep as unknown as Creep);
      return (g.Memory as any).chronicle;
    }

    it("tells the second waystation in a remote as the second", () => {
      const lines = secondBuilt("c1");
      expect(lines).toHaveLength(1);
      expect(lines[0].text).toMatch(/^Peddler Lucan raised a second waystation in the .*, so the merchants of .* load at both its diggings\.$/);
    });

    it("tells a castle's first waystation in a remote it shares as its first", () => {
      const theirs = { name: "Peddler Warin", memory: { role: "peddler", homeRoom: "W9N9", assignedContainerId: "c1" } };
      (g.Game as any).creeps = { [theirs.name]: theirs };
      const lines = secondBuilt("c1");
      (g.Game as any).creeps = {};
      expect(lines).toHaveLength(1);
      expect(lines[0].text).toMatch(/^Peddler Lucan raised a waystation in the /);
    });
  });

  describe("on its container", () => {
    let tick = 2500;

    function minerOn(free: number, lying: number) {
      // A fresh tick, so no threat cached by another test is read back.
      (g.Game as any).time = ++tick;
      const container = { id: "c1", hits: 250_000, hitsMax: 250_000, store: { getFreeCapacity: () => free } };
      const source = { id: "src", pos: { findInRange: () => [] } };
      (g.Game as any).getObjectById = (id: string) => (id === "src" ? source : id === "c1" ? container : null);
      const creep = minerIn(REMOTE, { name: "Peddler Osric" });
      creep.memory._hp = 100;
      (creep.memory as CreepMemory).assignedContainerId = "c1" as Id<StructureContainer>;
      creep.pos = { ...creep.pos, lookFor: () => [{ resourceType: "energy", amount: lying }] } as any;
      runRemoteMiner(creep as unknown as Creep);
      return creep;
    }

    it("rests while its container is full and a load and more lies beside it", () => {
      expect(minerOn(0, 1500).harvest).not.toHaveBeenCalled();
    });

    it("calls for a buyer now and then while it rests", () => {
      tick = 2524;
      expect(cryFor(minerOn(0, 1500) as unknown as Creep)).toBe("no buyers");
      expect(cryFor(minerOn(0, 1500) as unknown as Creep)).toBeUndefined();
    });

    it("digs while the container has room or the merchants have taken the pile", () => {
      expect(minerOn(100, 1500).harvest).toHaveBeenCalled();
      expect(minerOn(0, 400).harvest).toHaveBeenCalled();
    });
  });

  // Another player's workers passing through cannot hurt a vendor. Taking them
  // for raiders cost Embercrag the Witch Weald's gold for thousands of ticks.
  describe("meeting another player's creeps in the remote", () => {
    let tick = 3000;

    function minerAmong(...parts: string[]) {
      // A fresh tick, so no threat cached by another test is read back.
      (g.Game as any).time = ++tick;
      const source = { id: "src", pos: { findInRange: () => [] } };
      (g.Game as any).getObjectById = (id: string) => (id === "src" ? source : null);
      const stranger = { owner: { username: "Stranger" }, body: parts.map((type) => ({ type, hits: 100 })) };
      const creep = minerIn(REMOTE);
      creep.memory._hp = 100;
      creep.room.find = ((type: number) => (type === g.FIND_HOSTILE_CREEPS ? [stranger] : [])) as any;
      runRemoteMiner(creep as unknown as Creep);
      return creep;
    }

    it("keeps digging past unarmed workers", () => {
      const creep = minerAmong("work", "work", "carry", "move");
      expect(remote.hostile).toBe(false);
      expect(creep.harvest).toHaveBeenCalled();
    });

    it("flees an armed creep and marks the remote hostile", () => {
      const creep = minerAmong("ranged_attack", "move");
      expect(remote.hostile).toBe(true);
      expect(creep.harvest).not.toHaveBeenCalled();
    });
  });

  it("steps off the exit it came home by before it waits out a raid", () => {
    remote.invaderUntil = 1100;
    for (const [x, y, walks] of [[0, 17, true], [12, 49, true], [1, 17, false]] as const) {
      const creep = minerIn(HOME);
      creep.pos = { ...creep.pos, x, y } as typeof creep.pos;
      runRemoteMiner(creep as unknown as Creep);
      if (walks) expect(creep.moveTo).toHaveBeenCalledWith(expect.objectContaining({ roomName: HOME }), expect.anything());
      else expect(creep.moveTo).not.toHaveBeenCalled();
    }
  });

  it("steps off the exit it came home by when sent home hurt", () => {
    const creep = minerIn(HOME, { memory: { role: "remote_miner", homeRoom: HOME, targetRoom: REMOTE, remoteSourceId: "src", remoteBackoffUntil: 1100 } });
    creep.pos = { ...creep.pos, x: 49, y: 30 } as typeof creep.pos;
    runRemoteMiner(creep as unknown as Creep);
    expect(creep.moveTo).toHaveBeenCalledWith(expect.objectContaining({ roomName: HOME }), expect.anything());
  });

  describe("waiting out a raid", () => {
    // The remote's borders, nearest first: unscouted to the north, another
    // room to the west, and home to the south.
    const NORTH = "W1N3";
    const WEST = "W2N2";
    const borders = [
      { x: 20, y: 0, roomName: REMOTE },
      { x: 0, y: 12, roomName: REMOTE },
      { x: 20, y: 49, roomName: REMOTE },
    ];
    const intel = (extra: Partial<RoomIntelData> = {}) => ({
      roomName: WEST, lastSeen: 900, rcl: 0, towers: 0, spawns: 0, hostileCreeps: 0,
      hostileCombatParts: 0, hostileHealParts: 0, threatLevel: 0, ...extra,
    });

    function fleeing(roomName: string, x: number, y: number, hostiles: unknown[] = []) {
      remote.invaderUntil = 2100;
      (g.Game as any).map = { describeExits: () => ({ 1: NORTH, 7: WEST, 5: HOME }) };
      const creep = minerIn(roomName);
      creep.memory._hp = 100;
      creep.room.find = ((type: number) => (type === g.FIND_HOSTILE_CREEPS ? hostiles : [])) as any;
      const findClosestByPath = vi.fn((_type: number, opts: { filter: (p: unknown) => boolean }) => borders.find(opts.filter) ?? null);
      creep.pos = { ...creep.pos, x, y, findClosestByPath } as typeof creep.pos;
      return creep;
    }
    const movedTo = (creep: ReturnType<typeof fleeing>) => creep.moveTo.mock.calls.map((c) => (c[0] as RoomPosition).roomName);
    // Carried over the west border, onto the edge of the room beyond.
    const crossWest = (creep: ReturnType<typeof fleeing>) => {
      creep.room = { ...creep.room, name: WEST, find: () => [] };
      creep.pos = { ...creep.pos, x: 49 } as typeof creep.pos;
    };

    it("crosses the nearest border into a room safe to stand in, not the whole remote", () => {
      (g.Game as any).time = 2001;
      (g.Memory as any).intel = { [WEST]: intel() };
      const creep = fleeing(REMOTE, 3, 12);
      runRemoteMiner(creep as unknown as Creep);
      expect(creep.memory.refuge).toBe(WEST);
      expect(movedTo(creep)).toEqual([WEST]);
    });

    it("tells the chronicle once a raid of the peddlers hiding in each room", () => {
      (g.Game as any).time = 2002;
      (g.Memory as any).intel = { [WEST]: intel() };
      const lines = () => ((g.Memory as any).chronicle ?? []).map((l: { text: string }) => l.text);
      const first = Object.assign(fleeing(REMOTE, 3, 12), { name: "Peddler Nesta" });
      runRemoteMiner(first as unknown as Creep);
      // Only set off for the border, it may yet fall on the way.
      expect(lines()).toEqual([]);
      crossWest(first);
      runRemoteMiner(first as unknown as Creep);
      expect(lines()).toEqual([expect.stringMatching(/^Peddler Nesta slipped over the border into the .+ to hide from the raiders\.$/)]);
      // Still on the border, it is not told again.
      runRemoteMiner(first as unknown as Creep);
      const second = Object.assign(fleeing(REMOTE, 3, 12), { name: "Peddler Gervase" });
      runRemoteMiner(second as unknown as Creep);
      crossWest(second);
      runRemoteMiner(second as unknown as Creep);
      expect(lines()).toEqual([expect.stringMatching(/^2 peddlers slipped over the border/)]);
    });

    it("takes refuge as well when the raiders have wounded it", () => {
      (g.Game as any).time = 2005;
      (g.Memory as any).intel = { [WEST]: intel() };
      const raider = { owner: { username: "Invader" }, body: [{ type: "attack", hits: 100 }] };
      const creep = fleeing(REMOTE, 3, 12, [raider]);
      creep.memory._hp = 200;
      runRemoteMiner(creep as unknown as Creep);
      expect(creep.memory.remoteBackoffUntil).toBeGreaterThan(2005);
      expect(movedTo(creep)).toEqual([WEST]);
    });

    // Applies a flight's cost callback to the remote, where a creep stands two
    // tiles west of the raider and a wall one tile east of it, and reads back
    // what each tile costs.
    function shunned(costCallback: (room: string, m: CostMatrix) => CostMatrix, at: { x: number; y: number }) {
      const cells = new Map<string, number>([[`${at.x - 2},${at.y}`, 255]]);
      const matrix = {
        get: (x: number, y: number) => cells.get(`${x},${y}`) ?? 0,
        set: (x: number, y: number, v: number) => void cells.set(`${x},${y}`, v),
      };
      (g.Game as any).map.getRoomTerrain = () => ({ get: (x: number, y: number) => (x === at.x + 1 && y === at.y ? 1 : 0) });
      costCallback(REMOTE, matrix as unknown as CostMatrix);
      return matrix.get;
    }
    const raiderAt = (x: number, y: number) =>
      ({ owner: { username: "Invader" }, body: [{ type: "attack", hits: 100 }], pos: { x, y, roomName: REMOTE } });

    it("picks its border by a walk that keeps clear of the raiders, and goes round them on the way", () => {
      (g.Game as any).time = 2006;
      (g.Memory as any).intel = { [WEST]: intel() };
      const creep = fleeing(REMOTE, 3, 12, [raiderAt(30, 12)]);
      runRemoteMiner(creep as unknown as Creep);
      const chosen = (creep.pos.findClosestByPath as any).mock.calls[0][1];
      const [, walk] = creep.moveTo.mock.calls[0] as [unknown, { reusePath: number; costCallback: never }];
      expect(walk.reusePath).toBe(5);
      for (const costCallback of [chosen.costCallback, walk.costCallback]) {
        const cost = shunned(costCallback, { x: 30, y: 12 });
        expect(cost(30, 12)).toBe(60);
        expect(cost(34, 16)).toBe(60);
        expect(cost(26, 8)).toBe(60);
        expect(cost(35, 12)).toBe(0);
        expect(cost(30, 7)).toBe(0);
        // A wall stays a wall, and a tile already blocked stays blocked.
        expect(cost(31, 12)).toBe(0);
        expect(cost(28, 12)).toBe(255);
      }
      // The raiders are in the remote, so the walk's other rooms are left be.
      const home = { get: () => 0, set: vi.fn() };
      (walk.costCallback as (room: string, m: unknown) => unknown)(HOME, home);
      expect(home.set).not.toHaveBeenCalled();
    });

    it("waits at home while a lord holds the remote, though none of the lord's men is in sight", () => {
      (g.Game as any).time = 2035;
      (g.Memory as any).intel = { [WEST]: intel() };
      const creep = fleeing(REMOTE, 3, 12);
      remote.invaderUntil = undefined;
      remote.hostile = true;
      runRemoteMiner(creep as unknown as Creep);
      expect(movedTo(creep)).toEqual([HOME]);
    });

    it("takes refuge in a keep of ours", () => {
      (g.Memory as any).intel = {};
      (g.Game as any).rooms[WEST] = { controller: { my: true } };
      expect(isSafeRefuge(WEST, ME)).toBe(true);
    });

    it("names the warlord it hides from, and a keep of ours it shelters in", () => {
      (g.Game as any).time = 2003;
      (g.Memory as any).intel = {};
      (g.Memory as any).warbands = { [REMOTE]: { name: "Hask One-Eye" } };
      (g.Memory as any).rooms[WEST] = { townName: "Thornbarrow" };
      (g.Game as any).rooms[WEST] = { controller: { my: true } };
      const creep = Object.assign(fleeing(REMOTE, 3, 12), { name: "Peddler Nesta" });
      runRemoteMiner(creep as unknown as Creep);
      crossWest(creep);
      runRemoteMiner(creep as unknown as Creep);
      expect((g.Memory as any).chronicle.map((l: { text: string }) => l.text)).toEqual([
        "Peddler Nesta slipped over the border into Thornbarrow to hide from Hask One-Eye's raiders.",
      ]);
    });

    it("keeps out of lair keepers' rooms", () => {
      (g.Memory as any).intel = { W4N4: { ...intel(), roomName: "W4N4" }, W5N5: { ...intel(), roomName: "W5N5" } };
      expect(isSafeRefuge("W4N4", ME)).toBe(false);
      expect(isSafeRefuge("W5N5", ME)).toBe(true);
    });

    it("keeps out of rooms unscouted, held, towered or raided", () => {
      for (const [i, west] of [
        intel({ owner: "Stranger" }),
        intel({ towers: 1 }),
        intel({ reservedBy: "Stranger" }),
        undefined,
      ].entries()) {
        (g.Game as any).time = 2010 + i;
        (g.Memory as any).intel = west ? { [WEST]: west } : {};
        const creep = fleeing(REMOTE, 3, 12);
        runRemoteMiner(creep as unknown as Creep);
        expect(creep.memory.refuge).toBe(HOME);
      }
      (g.Game as any).time = 2020;
      (g.Memory as any).intel = { [WEST]: intel() };
      (g.Memory as any).rooms.W9N9 = { remoteRooms: [{ roomName: WEST, sources: [], lastSeen: 0, hostile: false, invaderUntil: 2500 }] };
      const creep = fleeing(REMOTE, 3, 12);
      runRemoteMiner(creep as unknown as Creep);
      expect(creep.memory.refuge).toBe(HOME);
      // Going home is no news.
      expect((g.Memory as any).chronicle ?? []).toEqual([]);
    });

    it("waits out a lord's men at home, since they can follow it over a border", () => {
      (g.Game as any).time = 2030;
      (g.Memory as any).intel = { [WEST]: intel() };
      const armed = { owner: { username: "Stranger" }, body: [{ type: "attack", hits: 100 }] };
      const creep = fleeing(REMOTE, 3, 12, [armed]);
      runRemoteMiner(creep as unknown as Creep);
      expect(movedTo(creep)).toEqual([HOME]);
      // Coming home is no news.
      creep.room = { ...creep.room, name: HOME, find: () => [] };
      creep.pos = { ...creep.pos, y: 0 } as typeof creep.pos;
      runRemoteMiner(creep as unknown as Creep);
      const told = ((g.Memory as any).chronicle ?? []).map((l: { text: string }) => l.text);
      expect(told.filter((t: string) => t.includes("slipped"))).toEqual([]);
    });

    it("steps off the border into its refuge, waits there, and goes back once the raid is over", () => {
      (g.Game as any).time = 2040;
      const creep = fleeing(WEST, 49, 12);
      creep.memory.refuge = WEST;
      runRemoteMiner(creep as unknown as Creep);
      expect(movedTo(creep)).toEqual([WEST]);

      creep.moveTo.mockClear();
      creep.pos = { ...creep.pos, x: 48 } as typeof creep.pos;
      runRemoteMiner(creep as unknown as Creep);
      expect(creep.moveTo).not.toHaveBeenCalled();

      (g.Game as any).time = 2100;
      runRemoteMiner(creep as unknown as Creep);
      expect(movedTo(creep)).toEqual([REMOTE]);
      expect(creep.memory.refuge).toBeUndefined();
      // The next raid it hides from is told again.
      expect(creep.memory.hid).toBeUndefined();
    });
  });

  describe("walking out to its source", () => {
    // Near: two tiles from the source, held back by the peddler it relieves.
    function minerArriving(near: boolean) {
      (g.Game as any).time = 4000;
      const source = { id: "src", pos: { findInRange: () => [] } };
      (g.Game as any).getObjectById = (id: string) => (id === "src" ? source : null);
      const creep = minerIn(REMOTE, { ticksToLive: 1330 });
      creep.memory._hp = 100;
      creep.pos = { ...creep.pos, isNearTo: () => false, inRangeTo: (_: unknown, range: number) => range >= (near ? 2 : 3) };
      runRemoteMiner(creep as unknown as Creep);
      return creep.memory as CreepMemory;
    }

    it("notes how long the walk took once it stands by the source", () => {
      expect(minerArriving(false).walk).toBeUndefined();
      expect(minerArriving(true).walk).toBe(170);
    });

    it("does not count a walk it broke off to flee", () => {
      const creep = minerIn(REMOTE, { ticksToLive: 1330 });
      creep.memory._hp = 100;
      (g.Game as any).time = 4001;
      creep.room.find = ((type: number) =>
        type === g.FIND_HOSTILE_CREEPS ? [{ owner: { username: "Stranger" }, body: [{ type: "attack", hits: 100 }] }] : []) as any;
      runRemoteMiner(creep as unknown as Creep);
      expect((creep.memory as CreepMemory).walk).toBe(0);
    });
  });

  describe("going home to be healed", () => {
    // Back from waiting out a raid in a room without towers, short of WORK.
    function wounded(roomName: string, deadWork: number, ticksToLive = 1100) {
      (g.Game as any).time = 5000;
      (g.Memory as any).rooms[HOME].towerIds = ["t1"];
      const body = [0, 1, 2, 3, 4, 5].map((i) => ({ type: "work", hits: i < deadWork ? 0 : 100 }));
      const creep = minerIn(roomName, { name: "Peddler Rohese", hitsMax: 1700, body, ticksToLive });
      creep.memory._hp = 100;
      (creep.memory as CreepMemory).walk = 114;
      creep.pos = { ...creep.pos, inRangeTo: () => false } as typeof creep.pos;
      return creep;
    }
    const movedTo = (creep: { moveTo: { mock: { calls: unknown[][] } } }) =>
      creep.moveTo.mock.calls.map((c) => (c[0] as RoomPosition).roomName);

    it("walks home from its post when a raid broke most of its WORK", () => {
      const creep = wounded(REMOTE, 4);
      runRemoteMiner(creep as unknown as Creep);
      expect(movedTo(creep)).toEqual([HOME]);
      expect(creep.harvest).not.toHaveBeenCalled();
      expect(cryFor(creep as unknown as Creep)).toBe("Wounded!");
    });

    it("keeps digging when too little life is left to pay for the walk", () => {
      // Two of six WORK dig four a tick, whole they dig ten: home and back takes
      // 228 ticks, so going pays only with more than 380 left.
      const source = { id: "src", pos: { findInRange: () => [] } };
      (g.Game as any).getObjectById = (id: string) => (id === "src" ? source : null);
      const short = wounded(REMOTE, 4, 380);
      runRemoteMiner(short as unknown as Creep);
      expect(short.harvest).toHaveBeenCalled();
      const long = wounded(REMOTE, 4, 381);
      runRemoteMiner(long as unknown as Creep);
      expect(movedTo(long)).toEqual([HOME]);
    });

    it("keeps digging when the WORK it lost did not slow it", () => {
      // Five WORK dig the ten a tick the source gives.
      const source = { id: "src", pos: { findInRange: () => [] } };
      (g.Game as any).getObjectById = (id: string) => (id === "src" ? source : null);
      const creep = wounded(REMOTE, 1, 1500);
      runRemoteMiner(creep as unknown as Creep);
      expect(creep.harvest).toHaveBeenCalled();
    });

    it("keeps digging when its castle has no towers to heal it", () => {
      const source = { id: "src", pos: { findInRange: () => [] } };
      (g.Game as any).getObjectById = (id: string) => (id === "src" ? source : null);
      const creep = wounded(REMOTE, 4);
      (g.Memory as any).rooms[HOME].towerIds = [];
      runRemoteMiner(creep as unknown as Creep);
      expect(creep.harvest).toHaveBeenCalled();
    });

    it("walks in off the edge, waits to be healed, and goes back once whole", () => {
      const creep = wounded(HOME, 4);
      runRemoteMiner(creep as unknown as Creep);
      expect(movedTo(creep)).toEqual([HOME]);

      // Well inside, it waits for the towers.
      creep.moveTo.mockClear();
      creep.pos = { ...creep.pos, inRangeTo: () => true } as typeof creep.pos;
      runRemoteMiner(creep as unknown as Creep);
      expect(creep.moveTo).not.toHaveBeenCalled();

      creep.hits = 1700;
      creep.body.forEach((p: { hits: number }) => (p.hits = 100));
      runRemoteMiner(creep as unknown as Creep);
      expect(movedTo(creep)).toEqual([REMOTE]);
      expect((creep.memory as CreepMemory).mending).toBeUndefined();
    });
  });
});

describe("sk hauler", () => {
  it("keeps collecting until full, then delivers", () => {
    (g.Memory as any).skOps = [{ id: 1, roomName: "W5N5", homeRoom: HOME, sourceIds: [] }];
    let used = 100;
    const creep = {
      room: { name: "W4N5" },
      pos: { x: 25, y: 25 },
      ticksToLive: 1000,
      store: {
        getUsedCapacity: () => used,
        getFreeCapacity: () => 500 - used,
      },
      memory: { role: "sk_hauler", skOpId: 1 } as CreepMemory,
      moveTo: vi.fn(),
    };
    runSkHauler(creep as unknown as Creep);
    // Partly full and outside the SK room: heading to the SK room, not home.
    expect(creep.memory.working).toBeFalsy();
    expect(creep.moveTo.mock.calls[0][0].roomName).toBe("W5N5");

    used = 500;
    creep.moveTo.mockClear();
    runSkHauler(creep as unknown as Creep);
    expect(creep.memory.working).toBe(true);
    expect(creep.moveTo.mock.calls[0][0].roomName).toBe(HOME);
  });
});

describe("source keeper op contest", () => {
  function opRoomWith(hostiles: unknown[]) {
    (g.Memory as any).skOps = [
      { id: 1, roomName: "W5N5", homeRoom: HOME, startedAt: 1000, discovered: true, sourceIds: [] },
    ];
    (g.Game as any).rooms = {
      W5N5: {
        find: (_t: number, opts?: { filter?: (c: unknown) => boolean }) =>
          opts?.filter ? hostiles.filter(opts.filter) : hostiles,
      },
    };
    skLoop();
    return (g.Memory as any).skOps[0] as SourceKeeperOp;
  }
  const body = (...types: string[]) => types.map((type) => ({ type, hits: 100 }));

  it("ignores allies and unarmed scouts", () => {
    const op = opRoomWith([
      { owner: { username: "Pal" }, body: body("attack") },
      { owner: { username: "Stranger" }, body: body("move") },
    ]);
    expect(op.lastFailure).toBeUndefined();
  });

  it("pauses for an armed player creep", () => {
    const op = opRoomWith([{ owner: { username: "Stranger" }, body: body("attack") }]);
    expect(op.lastFailure).toBe(1000);
  });
});
