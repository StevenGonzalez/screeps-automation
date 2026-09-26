import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.ATTACK_POWER = 30;
g.RANGED_ATTACK_POWER = 10;
g.HEAL_POWER = 12;
g.RANGED_HEAL_POWER = 4;
g.TOWER_ENERGY_COST = 10;
g.FIND_MY_CREEPS = 102;
g.FIND_STRUCTURES = 107;
g.STRUCTURE_WALL = "constructedWall";

import { summarizeHostiles, meleeDefendersToWin } from "../src/services/services.combat";
import { towersCanHold } from "../src/roles/role.tower";
import { buildKnightBody } from "../src/orchestrators/orchestrator.spawning";

interface Part { type: string; hits: number; boost?: string }

function parts(type: unknown, n: number, boost?: string): Part[] {
  return Array.from({ length: n }, () => ({ type: type as string, hits: 100, boost }));
}

function creep(x: number, y: number, body: Part[]): Creep {
  const hits = body.reduce((s, p) => s + p.hits, 0);
  return {
    hits,
    body,
    pos: {
      x,
      y,
      getRangeTo: (o: { x: number; y: number; pos?: { x: number; y: number } }) => {
        const p = o.pos ?? o;
        return Math.max(Math.abs(p.x - x), Math.abs(p.y - y));
      },
    },
  } as unknown as Creep;
}

describe("summarizeHostiles", () => {
  it("counts heal and damage boosts and boosted TOUGH at the damage it takes to break", () => {
    const s = summarizeHostiles([
      creep(10, 10, [...parts(TOUGH, 2, "XGHO2"), ...parts(ATTACK, 2, "UH"), ...parts(HEAL, 1, "XLHO2")]),
      creep(11, 10, [...parts(RANGED_ATTACK, 1), ...parts(MOVE, 1)]),
    ]);
    expect(s.heal).toBe(48);
    expect(s.damage).toBe(2 * 60 + 10);
    expect(s.hits).toBeCloseTo(2 * (100 / 0.3) + 300 + 200);
  });
});

describe("meleeDefendersToWin", () => {
  // 720 energy (RCL 3 less the margin): three groups, 90 damage a tick.
  const rcl3Knight = buildKnightBody(720);

  it("sends one knight against a lone unhealed invader", () => {
    expect(meleeDefendersToWin({ heal: 0, damage: 60, hits: 1500 }, rcl3Knight, 3)).toBe(1);
  });

  it("sends enough ATTACK to take a 100k-hit core down in good time", () => {
    // One knight needs 1111 ticks; two need 556.
    expect(meleeDefendersToWin({ heal: 0, damage: 0, hits: 100_000 }, rcl3Knight, 3)).toBe(2);
  });

  it("adds knights until their damage beats the group's healing", () => {
    // 150 heal: one knight (90) can't break it, two (180) can.
    expect(meleeDefendersToWin({ heal: 150, damage: 0, hits: 2000 }, rcl3Knight, 3)).toBe(2);
  });

  it("returns the cap when nothing affordable wins", () => {
    expect(meleeDefendersToWin({ heal: 1000, damage: 0, hits: 2000 }, rcl3Knight, 3)).toBe(3);
  });
});

describe("towersCanHold", () => {
  let towerEnergy = 1000;

  function room(): Room {
    const tower = { pos: creep(20, 20, []).pos, store: { energy: towerEnergy } };
    g.Game = { time: 1, getObjectById: () => tower };
    return { name: "W1N1", memory: { towerIds: ["t1"] }, find: () => [] } as unknown as Room;
  }

  beforeEach(() => {
    towerEnergy = 1000;
  });

  it("holds against an unhealed attacker", () => {
    expect(towersCanHold(room(), [creep(25, 20, [...parts(ATTACK, 5), ...parts(MOVE, 5)])])).toBe(true);
  });

  it("does not hold when boosted heal out-heals the towers", () => {
    // 13 XLHO2 HEAL heals 624 a tick; one tower at range 5 deals 600.
    const target = creep(25, 20, [...parts(WORK, 5), ...parts(MOVE, 5)]);
    const healer = creep(26, 20, parts(HEAL, 13, "XLHO2"));
    expect(towersCanHold(room(), [target, healer])).toBe(false);
  });

  it("assumes spread-out healers can close in on the target", () => {
    const target = creep(25, 20, [...parts(WORK, 5), ...parts(MOVE, 5)]);
    const healer = creep(40, 40, parts(HEAL, 13, "XLHO2"));
    expect(towersCanHold(room(), [target, healer])).toBe(false);
  });

  it("does not hold when the towers lack the energy to finish the job", () => {
    // 5000 hits at 600 a tick is 9 shots, 90 energy.
    towerEnergy = 50;
    expect(towersCanHold(room(), [creep(25, 20, parts(WORK, 50))])).toBe(false);
    towerEnergy = 100;
    expect(towersCanHold(room(), [creep(25, 20, parts(WORK, 50))])).toBe(true);
  });

  it("does not hold with no towers", () => {
    g.Game = { time: 1, getObjectById: () => null };
    const r = { name: "W1N1", memory: {}, find: () => [] } as unknown as Room;
    expect(towersCanHold(r, [creep(25, 20, parts(ATTACK, 1))])).toBe(false);
  });
});
