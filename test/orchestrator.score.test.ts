import { describe, it, expect, beforeEach } from "vitest";

// pickPatrolRoom pulls in services.combat (isSourceKeeperRoom) and services.allies (isAlly)
// through its import chain. services.combat reads a few body-part constants; define them (with
// real values) the same way services.combat.test.ts does. Game/Memory are set up per test below
// — the import itself touches neither at load time.
const g = globalThis as Record<string, unknown>;
g.ATTACK = "attack";
g.RANGED_ATTACK = "ranged_attack";
g.HEAL = "heal";
g.TOUGH = "tough";
g.MOVE = "move";
g.WORK = "work";
g.ATTACK_POWER = 30;
g.RANGED_ATTACK_POWER = 10;
g.HEAL_POWER = 12;

import { pickPatrolRoom } from "../src/orchestrators/orchestrator.score";

const HOME = "W1N1";
const SEEKER = "grifter"; // ROLE_SCORE_HUNTER

// Parse a room name to signed world coords and take the Chebyshev room distance — matches how
// Screeps' Game.map.getRoomLinearDistance measures (max of the two axis deltas).
function coords(name: string): [number, number] {
  const m = name.match(/^([WE])(\d+)([NS])(\d+)$/)!;
  const x = m[1] === "E" ? +m[2] : -(+m[2] + 1);
  const y = m[3] === "S" ? +m[4] : -(+m[4] + 1);
  return [x, y];
}
function linearDist(a: string, b: string): number {
  const [ax, ay] = coords(a);
  const [bx, by] = coords(b);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

// Home has four unowned neighbours; each neighbour is a leaf (no further exits), so the safe
// region at radius 2 is exactly those four rooms.
const NEIGHBOURS = ["W1N2", "W2N1", "W1N0", "W0N1"];
const EXITS: Record<string, Record<string, string>> = {
  [HOME]: { "1": "W1N2", "3": "W2N1", "5": "W1N0", "7": "W0N1" },
};

function seeker(name: string, room: string): Creep {
  return {
    name,
    pos: { roomName: room },
    room: { name: room },
    memory: { role: SEEKER, homeRoom: HOME },
  } as unknown as Creep;
}

let creeps: Record<string, Creep>;
let seen: Record<string, number>;
let intel: Record<string, { owner?: string }>;

beforeEach(() => {
  creeps = {};
  seen = {};
  intel = {};
  g.Game = {
    time: 100000,
    creeps,
    rooms: { [HOME]: { controller: { my: true, owner: { username: "Me" } } } },
    map: {
      describeExits: (rn: string) => EXITS[rn] ?? {},
      getRoomLinearDistance: (a: string, b: string) => linearDist(a, b),
    },
  };
  g.Memory = { allies: [], intel, scorePatrol: { seen } };
});

describe("pickPatrolRoom", () => {
  it("gives a lone seeker the stalest reachable room", () => {
    const now = (g.Game as { time: number }).time;
    // Three rooms seen recently, one left stale — the stale one should win.
    seen.W1N2 = now - 5;
    seen.W2N1 = now - 5;
    seen.W1N0 = now - 5000;
    seen.W0N1 = now - 5;
    const s = seeker("s1", HOME);
    creeps.s1 = s;
    expect(pickPatrolRoom(s)).toBe("W1N0");
  });

  it("hands two seekers disjoint rooms even when stacked on the spawn", () => {
    const a = seeker("s1", HOME);
    const b = seeker("s2", HOME);
    creeps.s1 = a;
    creeps.s2 = b;
    const pa = pickPatrolRoom(a);
    const pb = pickPatrolRoom(b);
    expect(pa).not.toBe(pb);
    expect(NEIGHBOURS).toContain(pa);
    expect(NEIGHBOURS).toContain(pb);
  });

  it("keeps all four seekers on distinct rooms (full partition)", () => {
    const names = ["s1", "s2", "s3", "s4"];
    for (const n of names) creeps[n] = seeker(n, HOME);
    const picks = names.map((n) => pickPatrolRoom(creeps[n]));
    expect(new Set(picks).size).toBe(4); // one room each, no overlap
    for (const p of picks) expect(NEIGHBOURS).toContain(p);
  });

  it("agrees on its own pick regardless of which seeker computes the allocation", () => {
    // Each seeker replays the same sequential assignment, so s1's pick is stable no matter that
    // s2 also exists and computes the same sequence.
    const a = seeker("s1", HOME);
    const b = seeker("s2", HOME);
    creeps.s1 = a;
    creeps.s2 = b;
    const firstPick = pickPatrolRoom(a);
    // Recompute after b has "moved" — a still owns its slot.
    expect(pickPatrolRoom(a)).toBe(firstPick);
  });

  it("returns undefined when the whole region is hostile-owned (boxed in)", () => {
    for (const n of NEIGHBOURS) intel[n] = { owner: "Enemy" };
    const s = seeker("s1", HOME);
    creeps.s1 = s;
    expect(pickPatrolRoom(s)).toBeUndefined();
  });

  it("does not avoid a room just because an unarmed scout is present", () => {
    const now = (g.Game as { time: number }).time;
    seen.W1N2 = now - 5;
    seen.W2N1 = now - 5;
    seen.W1N0 = now - 5000;
    seen.W0N1 = now - 5;
    intel.W1N0 = { hostileCreeps: 1, hostileCombatParts: 0, threatLevel: 0 } as any;
    const s = seeker("s1", HOME);
    creeps.s1 = s;
    expect(pickPatrolRoom(s)).toBe("W1N0");
  });
});
