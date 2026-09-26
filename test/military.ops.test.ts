import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;

g.FIND_HOSTILE_CREEPS = 103;
g.FIND_MY_SPAWNS = 108;
g.FIND_STRUCTURES = 101;
g.FIND_MY_STRUCTURES = 109;
g.FIND_HOSTILE_STRUCTURES = 110;
g.FIND_HOSTILE_SPAWNS = 112;
g.LOOK_STRUCTURES = "structure";
g.LOOK_CREEPS = "creep";
g.STRUCTURE_CONTROLLER = "controller";
g.STRUCTURE_WALL = "constructedWall";
g.TERRAIN_MASK_WALL = 1;
g.OBSTACLE_OBJECT_TYPES = ["spawn", "constructedWall", "tower"];
g.TOWER_CAPACITY = 1000;
g.TOWER_ENERGY_COST = 10;
g.CREEP_LIFE_TIME = 1500;
g.ERR_NOT_IN_RANGE = -9;
g.RANGED_ATTACK_POWER = 10;
g.ATTACK_POWER = 30;
g.HEAL_POWER = 12;
g.DISMANTLE_POWER = 50;
g.PathFinder = { search: () => ({ path: [] }) };

// Minimal RoomPosition: Chebyshev range, and array-based finds.
class FakePos {
  constructor(public x: number, public y: number, public roomName: string) {}
  getRangeTo(t: FakePos | { pos: FakePos }): number {
    const p = "pos" in t ? t.pos : t;
    return Math.max(Math.abs(p.x - this.x), Math.abs(p.y - this.y));
  }
  inRangeTo(t: FakePos | { pos: FakePos }, r: number): boolean {
    return this.getRangeTo(t) <= r;
  }
  isNearTo(t: FakePos | { pos: FakePos }): boolean {
    return this.getRangeTo(t) <= 1;
  }
  isEqualTo(t: FakePos | { pos: FakePos }): boolean {
    return this.getRangeTo(t) === 0;
  }
  getDirectionTo(): number {
    return 1;
  }
  lookFor(): unknown[] {
    return [];
  }
  findInRange<T extends { pos: FakePos }>(list: T[] | number, r: number): T[] {
    return Array.isArray(list) ? list.filter((o) => this.getRangeTo(o) <= r) : [];
  }
  findClosestByRange<T extends { pos: FakePos }>(list: T[] | number): T | null {
    if (!Array.isArray(list) || list.length === 0) return null;
    return list.reduce((a, b) => (this.getRangeTo(a) <= this.getRangeTo(b) ? a : b));
  }
}
g.RoomPosition = FakePos;

import {
  loop,
  launchOp,
  enqueueOp,
  launchDrain,
  shouldHoldForDrain,
  runDefensiveKnight,
  runDefensiveWizard,
  runOffensiveKnight,
  runOffensiveCleric,
} from "../src/orchestrators/orchestrator.military";
import { ROLE_KNIGHT, ROLE_CLERIC, ROLE_DRAINER } from "../src/config/config.roles";

type Finds = Partial<Record<number, unknown[]>>;

function makeRoom(name: string, finds: Finds = {}, extra: Record<string, unknown> = {}): Room {
  return {
    name,
    memory: {},
    find: (type: number, opts?: { filter?: (o: unknown) => boolean }) => {
      const list = finds[type] ?? [];
      return opts?.filter ? list.filter(opts.filter) : list;
    },
    getTerrain: () => ({ get: () => 0 }),
    ...extra,
  } as unknown as Room;
}

let seq = 0;
function makeCreep(opts: {
  room: Room;
  x: number;
  y: number;
  owner?: string;
  body?: string[];
  memory?: Partial<CreepMemory>;
  hits?: number;
}): Creep & Record<string, ReturnType<typeof vi.fn>> {
  const id = `c${++seq}`;
  return {
    id,
    name: id,
    room: opts.room,
    pos: new FakePos(opts.x, opts.y, opts.room.name),
    hits: opts.hits ?? 100,
    hitsMax: 100,
    fatigue: 0,
    ticksToLive: 1000,
    owner: { username: opts.owner ?? "me" },
    body: (opts.body ?? ["attack"]).map((type) => ({ type, hits: 100 })),
    memory: { role: ROLE_KNIGHT, ...(opts.memory ?? {}) },
    attack: vi.fn(),
    rangedAttack: vi.fn(),
    rangedMassAttack: vi.fn(),
    heal: vi.fn(),
    rangedHeal: vi.fn(),
    move: vi.fn(),
    moveTo: vi.fn(),
  } as unknown as Creep & Record<string, ReturnType<typeof vi.fn>>;
}

function baseOp(extra: Partial<MilitaryOp> = {}): MilitaryOp {
  return {
    targetRoom: "W2N1",
    homeRoom: "W1N1",
    phase: "attacking",
    startedAt: 1,
    formation: "box",
    tactic: "assault",
    requiredMelee: 1,
    requiredRanged: 0,
    requiredHealers: 0,
    requiredSiege: 0,
    ...extra,
  };
}

let tick = 1001;
beforeEach(() => {
  tick += 2;
  const home = makeRoom("W1N1", {}, { controller: { my: true, level: 5 } });
  g.Game = {
    time: tick,
    rooms: { W1N1: home },
    creeps: {},
    map: { getRoomLinearDistance: () => 1 },
  };
  g.Memory = {
    warCouncil: { autoAttack: false, lastScan: tick },
    rooms: {},
    intel: {},
    allies: [],
  };
});

describe("failed op attempts", () => {
  it("reforms once, then abandons the op and cools the target down", () => {
    (Memory as unknown as { intel: Record<string, unknown> }).intel.W2N1 = { owner: "Enemy" };
    Memory.militaryOps = { W1N1: baseOp() };

    loop();
    expect(Memory.militaryOps.W1N1.phase).toBe("forming");
    expect(Memory.militaryOps.W1N1.attempts).toBe(1);

    Memory.militaryOps.W1N1.phase = "attacking";
    loop();
    expect(Memory.militaryOps.W1N1).toBeUndefined();
    const cd = Memory.warCouncil!.targetCooldown!;
    expect(cd.W2N1).toBeGreaterThan(Game.time);
    expect(cd.Enemy).toBeGreaterThan(Game.time);
  });

  it("drops a manual retreat once nobody is left instead of respawning", () => {
    Memory.militaryOps = { W1N1: baseOp({ phase: "retreating", tactic: "retreat" }) };
    loop();
    expect(Memory.militaryOps.W1N1).toBeUndefined();
  });

  it("stands down when the target room goes into safe mode", () => {
    const target = makeRoom("W2N1", {}, { controller: { my: false, safeMode: 5000 } });
    (Game.rooms as Record<string, Room>).W2N1 = target;
    const k = makeCreep({ room: target, x: 25, y: 25, memory: { offensiveTarget: "W2N1", homeRoom: "W1N1" } });
    (Game.creeps as Record<string, Creep>)[k.name] = k;
    Memory.militaryOps = { W1N1: baseOp() };
    loop();
    expect(Memory.militaryOps.W1N1).toBeUndefined();
  });
});

describe("ally targets are refused", () => {
  beforeEach(() => {
    (Memory as unknown as { allies: string[] }).allies = ["Friend"];
  });
  const comp = { melee: 1, ranged: 0, healers: 0, siege: 0 };

  it("refuses an ally-owned room (from intel)", () => {
    (Memory as unknown as { intel: Record<string, unknown> }).intel.W3N1 = { owner: "Friend" };
    expect(launchOp("W3N1", "box", "assault", comp, "W1N1")).toMatch(/ally/);
    expect(enqueueOp("W3N1", "box", "assault", comp)).toMatch(/ally/);
    expect(launchDrain("W3N1", "W1N1")).toMatch(/ally/);
  });

  it("refuses an ally-reserved room (visible)", () => {
    (Game.rooms as Record<string, Room>).W3N1 = makeRoom("W3N1", {}, {
      controller: { my: false, reservation: { username: "Friend" } },
    });
    expect(launchOp("W3N1", "box", "assault", comp, "W1N1")).toMatch(/ally/);
  });

  it("still allows a non-ally room", () => {
    (Memory as unknown as { intel: Record<string, unknown> }).intel.W3N1 = { owner: "Enemy" };
    expect(launchOp("W3N1", "box", "assault", comp, "W1N1")).toBeNull();
  });
});

describe("shouldHoldForDrain", () => {
  function towerRoom(energy: number): Room {
    const towers = [0, 1].map(() => ({ structureType: "tower", store: { energy } }));
    return makeRoom("W2N1", { [g.FIND_HOSTILE_STRUCTURES as number]: towers });
  }

  it("does not hold when no drainer is alive", () => {
    const op = baseOp({ tactic: "siege" });
    expect(shouldHoldForDrain(op, towerRoom(1000))).toBe(false);
  });

  it("holds while a drainer works, then gives up after the cap", () => {
    const op = baseOp({ tactic: "siege" });
    const d = makeCreep({
      room: towerRoom(1000),
      x: 1,
      y: 1,
      memory: { role: ROLE_DRAINER, offensiveTarget: "W2N1", homeRoom: "W1N1" },
    });
    (Game.creeps as Record<string, Creep>)[d.name] = d;

    expect(shouldHoldForDrain(op, towerRoom(1000))).toBe(true);
    (Game as { time: number }).time += 299;
    expect(shouldHoldForDrain(op, towerRoom(1000))).toBe(true);
    (Game as { time: number }).time += 1;
    expect(shouldHoldForDrain(op, towerRoom(1000))).toBe(false);
  });

  it("stops holding once towers are drained", () => {
    const op = baseOp({ tactic: "siege", holdSince: 1 });
    expect(shouldHoldForDrain(op, towerRoom(0))).toBe(false);
    expect(op.holdSince).toBeUndefined();
  });
});

describe("defensive creeps", () => {
  function breachRoom(withSpawnNextToHostile: boolean) {
    const farRampart = { structureType: "rampart", pos: new FakePos(10, 10, "W1N1") };
    const spawn = { structureType: "spawn", pos: new FakePos(25, 29, "W1N1") };
    const mine = withSpawnNextToHostile ? [farRampart, spawn] : [farRampart];
    const room = makeRoom("W1N1", { [g.FIND_MY_STRUCTURES as number]: mine }, { controller: { my: true } });
    const hostile = makeCreep({ room, x: 25, y: 28, owner: "Enemy", body: ["work"] });
    (room as unknown as { find: unknown }).find = (type: number, opts?: { filter?: (o: unknown) => boolean }) => {
      const list = type === g.FIND_HOSTILE_CREEPS ? [hostile] : type === g.FIND_MY_STRUCTURES ? mine : [];
      return opts?.filter ? list.filter(opts.filter) : list;
    };
    return { room, hostile, farRampart };
  }

  it("knight walks at a hostile working on the base when no rampart is next to it", () => {
    const { room, hostile } = breachRoom(true);
    const knight = makeCreep({ room, x: 25, y: 22 });

    runDefensiveKnight(knight, "W1N1");
    expect(knight.moveTo).toHaveBeenCalledWith(hostile, expect.objectContaining({ range: 1 }));
  });

  it("knight keeps to a rampart instead of chasing a hostile that isn't touching the base", () => {
    const { room, hostile, farRampart } = breachRoom(false);
    const knight = makeCreep({ room, x: 25, y: 22 });

    runDefensiveKnight(knight, "W1N1");
    expect(knight.moveTo).not.toHaveBeenCalledWith(hostile, expect.anything());
    expect(knight.moveTo).toHaveBeenCalledWith(farRampart, expect.objectContaining({ range: 0 }));
  });

  it("wizard focuses the creep the towers are shooting when it's in range", () => {
    const room = makeRoom("W1N1", {}, { controller: { my: true } });
    const brute = makeCreep({ room, x: 25, y: 27, owner: "Enemy", body: ["attack"] });
    const healer = makeCreep({ room, x: 25, y: 28, owner: "Enemy", body: ["heal"] });
    (room as unknown as { find: unknown }).find = (type: number) =>
      type === g.FIND_HOSTILE_CREEPS ? [brute, healer] : [];
    (room.memory as RoomMemory).lastTowerTargetId = brute.id as Id<Creep>;
    const wiz = makeCreep({ room, x: 25, y: 25, body: ["ranged_attack"] });

    runDefensiveWizard(wiz, "W1N1");
    expect(wiz.rangedAttack).toHaveBeenCalledWith(brute);
  });
});

describe("offensive squad", () => {
  it("parked knight hits an adjacent hostile but not an adjacent ally", () => {
    (Memory as unknown as { allies: string[] }).allies = ["Friend"];
    const room = makeRoom("W1N1", {}, { controller: { my: true } });
    const ally = makeCreep({ room, x: 26, y: 25, owner: "Friend" });
    (room as unknown as { find: unknown }).find = (type: number) =>
      type === g.FIND_HOSTILE_CREEPS ? [ally] : [];
    const op = baseOp({ phase: "forming" });
    const knight = makeCreep({ room, x: 25, y: 25, memory: { offensiveTarget: "W2N1", homeRoom: "W1N1" } });
    (Game.creeps as Record<string, Creep>)[knight.name] = knight;

    runOffensiveKnight(knight, op);
    expect(knight.attack).not.toHaveBeenCalled();

    const enemy = makeCreep({ room, x: 24, y: 25, owner: "Enemy" });
    (room as unknown as { find: unknown }).find = (type: number) =>
      type === g.FIND_HOSTILE_CREEPS ? [ally, enemy] : [];
    (Game as { time: number }).time += 1;
    runOffensiveKnight(knight, op);
    expect(knight.attack).toHaveBeenCalledWith(enemy);
  });

  it("cleric pre-heals the leader when nobody is hurt", () => {
    const room = makeRoom("W5N5");
    const mem = { offensiveTarget: "W2N1", homeRoom: "W1N1" };
    const knight = makeCreep({ room, x: 25, y: 25, memory: { ...mem, role: ROLE_KNIGHT } });
    const cleric = makeCreep({ room, x: 25, y: 27, body: ["heal"], memory: { ...mem, role: ROLE_CLERIC } });
    (Game.creeps as Record<string, Creep>)[knight.name] = knight;
    (Game.creeps as Record<string, Creep>)[cleric.name] = cleric;

    runOffensiveCleric(cleric, baseOp());
    expect(cleric.rangedHeal).toHaveBeenCalledWith(knight);
  });
});
