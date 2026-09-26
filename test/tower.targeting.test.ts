import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.HEAL_POWER = 12;
g.RANGED_HEAL_POWER = 4;
g.TOWER_ENERGY_COST = 10;
g.FIND_MY_CREEPS = 102;
g.FIND_STRUCTURES = 107;
g.STRUCTURE_WALL = "constructedWall";

import { selectRoomAttackTarget } from "../src/roles/role.tower";

interface Part { type: string; hits: number; boost?: string }

function pos(x: number, y: number, structuresNear: unknown[] = []) {
  return {
    x,
    y,
    getRangeTo(o: { x: number; y: number; pos?: { x: number; y: number } }) {
      const p = o.pos ?? o;
      return Math.max(Math.abs(p.x - x), Math.abs(p.y - y));
    },
    findInRange: () => structuresNear,
  };
}

function creep(id: string, x: number, y: number, body: Part[], structuresNear: unknown[] = []) {
  return { id, pos: pos(x, y, structuresNear), body } as unknown as Creep;
}

function parts(type: string, n: number, boost?: string): Part[] {
  return Array.from({ length: n }, () => ({ type, hits: 100, boost }));
}

function makeRoom(myCreeps: Creep[] = []): Room {
  const tower = { pos: pos(20, 20), store: { energy: 1000 } };
  g.Game = { time: 1, getObjectById: () => tower };
  return {
    name: "W1N1",
    memory: { towerIds: ["t1"] },
    find: (type: number) => (type === g.FIND_MY_CREEPS ? myCreeps : []),
  } as unknown as Room;
}

// One tower at range 5 deals 600 a tick.
describe("selectRoomAttackTarget boosts", () => {
  beforeEach(() => {
    g.Game = { time: 1 };
  });

  it("holds fire when boosted heal out-heals the towers", () => {
    const target = creep("t", 25, 20, parts(MOVE as string, 5));
    // 13 HEAL: 156/tick unboosted, 624/tick with XLHO2.
    const healer = creep("h", 26, 20, parts(HEAL as string, 13, "XLHO2"));
    expect(selectRoomAttackTarget([target, healer], makeRoom())).toBeNull();
  });

  it("still fires when the same healer is unboosted", () => {
    const target = creep("t", 25, 20, parts(MOVE as string, 5));
    const healer = creep("h", 26, 20, parts(HEAL as string, 13));
    expect(selectRoomAttackTarget([target, healer], makeRoom())).not.toBeNull();
  });

  it("counts boosted TOUGH when judging whether damage beats healing", () => {
    // XGHO2 TOUGH turns 600 raw into 180 real damage; 16 HEAL heals 192.
    const target = creep("t", 25, 20, [...parts(TOUGH as string, 10, "XGHO2"), ...parts(MOVE as string, 5)]);
    const healer = creep("h", 26, 20, parts(HEAL as string, 16));
    expect(selectRoomAttackTarget([target, healer], makeRoom())).toBeNull();
  });
});

describe("selectRoomAttackTarget on an undamageable attacker", () => {
  function tank(structuresNear: unknown[] = []) {
    return creep("t", 25, 20, [...parts(ATTACK as string, 5), ...parts(MOVE as string, 5)], structuresNear);
  }
  const healer = () => creep("h", 26, 20, parts(HEAL as string, 13, "XLHO2"));

  it("holds fire when nobody is engaging it and it is touching nothing of ours", () => {
    expect(selectRoomAttackTarget([tank(), healer()], makeRoom())).toBeNull();
  });

  it("keeps firing while our fighters are on it", () => {
    const fighter = creep("f", 27, 21, parts(ATTACK as string, 5));
    expect(selectRoomAttackTarget([tank(), healer()], makeRoom([fighter]))?.id).toBe("t");
  });

  it("ignores our fighters that are elsewhere", () => {
    const fighter = creep("f", 40, 40, parts(ATTACK as string, 5));
    expect(selectRoomAttackTarget([tank(), healer()], makeRoom([fighter]))).toBeNull();
  });

  it("keeps firing while it is hitting one of our structures", () => {
    const rampart = { structureType: "rampart", my: true };
    expect(selectRoomAttackTarget([tank([rampart]), healer()], makeRoom())?.id).toBe("t");
  });
});
