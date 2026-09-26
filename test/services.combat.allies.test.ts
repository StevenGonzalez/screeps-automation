import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_HOSTILE_CREEPS = 103;
g.FIND_HOSTILE_STRUCTURES = 110;
g.FIND_STRUCTURES = 101;
g.LOOK_STRUCTURES = "structure";
g.STRUCTURE_CONTROLLER = "controller";
g.STRUCTURE_KEEPER_LAIR = "keeperLair";
g.STRUCTURE_POWER_BANK = "powerBank";
g.STRUCTURE_WALL = "constructedWall";

import { allyInMassAttackRange, selectStructureTarget } from "../src/services/services.combat";

function pos(x: number, y: number, finds: Record<number, Array<{ pos: { x: number; y: number } }>> = {}) {
  return {
    x,
    y,
    roomName: "W1N1",
    getRangeTo: (o: { pos: { x: number; y: number } }) => Math.max(Math.abs(o.pos.x - x), Math.abs(o.pos.y - y)),
    findInRange: (type: number, r: number) =>
      (finds[type] ?? []).filter((o) => Math.max(Math.abs(o.pos.x - x), Math.abs(o.pos.y - y)) <= r),
    lookFor: () => [],
  } as unknown as RoomPosition;
}

let tick = 5000;
beforeEach(() => {
  tick++;
  g.Game = { time: tick };
  g.Memory = { allies: ["Friend"] };
});

describe("allyInMassAttackRange", () => {
  it("flags an ally creep within 3", () => {
    const ally = { pos: { x: 3, y: 0 }, owner: { username: "Friend" } };
    expect(allyInMassAttackRange(pos(0, 0, { 103: [ally] }))).toBe(true);
  });

  it("ignores allies further than 3 and enemies nearby", () => {
    const ally = { pos: { x: 4, y: 0 }, owner: { username: "Friend" } };
    const enemy = { pos: { x: 1, y: 0 }, owner: { username: "Enemy" } };
    expect(allyInMassAttackRange(pos(0, 0, { 103: [ally, enemy] }))).toBe(false);
  });

  it("flags an ally structure within 3", () => {
    const s = { pos: { x: 2, y: 2 }, owner: { username: "Friend" } };
    expect(allyInMassAttackRange(pos(0, 0, { 110: [s] }))).toBe(true);
  });
});

describe("selectStructureTarget skips ally structures", () => {
  it("never picks an ally-owned spawn or rampart", () => {
    const allySpawn = { structureType: "spawn", owner: { username: "Friend" }, my: false, pos: pos(5, 5), hits: 1000 };
    const enemyExt = { structureType: "extension", owner: { username: "Enemy" }, my: false, pos: pos(9, 9), hits: 1000 };
    const room = {
      name: "W1N1",
      find: (_t: number, opts: { filter: (s: unknown) => boolean }) => [allySpawn, enemyExt].filter(opts.filter),
    } as unknown as Room;
    expect(selectStructureTarget(room, pos(0, 0), "assault")).toBe(enemyExt);
  });
});
