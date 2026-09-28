import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_HOSTILE_CREEPS = 103;
g.FIND_MY_CREEPS = 107;
g.FIND_MY_SPAWNS = 108;
g.FIND_STRUCTURES = 101;

vi.mock("../src/orchestrators/orchestrator.military", () => ({
  getDefenseOp: () => null,
  getOffensiveOp: () => null,
  runDefensiveKnight: vi.fn(),
  runOffensiveKnight: vi.fn(),
  runDefensiveCleric: vi.fn(),
  runOffensiveCleric: vi.fn(),
}));

import { runKnight } from "../src/roles/role.knight";
import { runCleric } from "../src/roles/role.cleric";
import { ROLE_BUILDER, ROLE_CLERIC, ROLE_KNIGHT } from "../src/config/config.roles";

let myCreeps: Creep[] = [];
const spawn = { id: "spawn1", pos: { x: 25 } };

const room = {
  name: "W1N1",
  find: (type: number, opts?: { filter?: (o: unknown) => boolean }) => {
    const list =
      type === g.FIND_MY_CREEPS ? myCreeps : type === g.FIND_MY_SPAWNS ? [spawn] : [];
    return opts?.filter ? list.filter(opts.filter) : list;
  },
};

function makeCreep(name: string, role: string, x: number, hits: number) {
  const c = {
    name,
    room,
    spawning: false,
    hits,
    hitsMax: 1000,
    memory: { role } as CreepMemory,
    pos: {
      x,
      findInRange: () => [],
      getRangeTo: (o: { pos: { x: number } }) => Math.abs(o.pos.x - x),
      isNearTo: (o: { pos: { x: number } }) => Math.abs(o.pos.x - x) <= 1,
      findClosestByRange: (type: number, opts?: { filter?: (o: unknown) => boolean }) => {
        const list = room.find(type, opts) as { pos: { x: number } }[];
        return list.sort((a, b) => Math.abs(a.pos.x - x) - Math.abs(b.pos.x - x))[0] ?? null;
      },
    },
    moveTo: vi.fn(() => 0),
    heal: vi.fn(() => 0),
    rangedHeal: vi.fn(() => 0),
  } as unknown as Creep;
  myCreeps.push(c);
  return c;
}

beforeEach(() => {
  myCreeps = [];
  g.Game = { time: 1, creeps: {} };
});

describe("knight falls back to a cleric", () => {
  it("walks to the nearest cleric when badly hurt", () => {
    const knight = makeCreep("k", ROLE_KNIGHT, 10, 100);
    const cleric = makeCreep("c", ROLE_CLERIC, 15, 1000);
    runKnight(knight);
    expect(knight.moveTo).toHaveBeenCalledWith(cleric, { reusePath: 5 });
  });

  it("falls back to the spawn with no cleric in the room", () => {
    const knight = makeCreep("k", ROLE_KNIGHT, 10, 100);
    runKnight(knight);
    expect(knight.moveTo).toHaveBeenCalledWith(spawn, { reusePath: 5 });
  });
});

describe("cleric heals fighters first", () => {
  it("picks a wounded knight over a worse-hurt builder", () => {
    const cleric = makeCreep("c", ROLE_CLERIC, 10, 1000);
    makeCreep("b", ROLE_BUILDER, 11, 100);
    const knight = makeCreep("k", ROLE_KNIGHT, 11, 600);
    runCleric(cleric);
    expect(cleric.heal).toHaveBeenCalledWith(knight);
  });

  it("heals the builder when no fighter is hurt", () => {
    const cleric = makeCreep("c", ROLE_CLERIC, 10, 1000);
    const builder = makeCreep("b", ROLE_BUILDER, 11, 100);
    makeCreep("k", ROLE_KNIGHT, 11, 1000);
    runCleric(cleric);
    expect(cleric.heal).toHaveBeenCalledWith(builder);
  });
});
