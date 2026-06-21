import { describe, it, expect, beforeEach } from "vitest";

// services.combat references several ambient Screeps globals inside getThreatInfo
// (body-part constants, power constants, Game.time, Memory.allies). Node has no Screeps
// runtime, so define them here — with their real game values — before importing the
// module under test.
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
g.FIND_HOSTILE_CREEPS = 113; // arbitrary; our mock room.find keys off it
g.Game = { time: 1 };
g.Memory = {};

import {
  isSourceKeeperRoom,
  formationOffset,
  getThreatInfo,
  getThreatSeverity,
} from "../src/services/services.combat";

// ── Threat-scoring test helpers ──────────────────────────────────────────────────

type TestPart = { type: string; hits?: number; boost?: string };

// Build a mock creep with a body of [count×type] parts. `boost` applies to every part
// of the given combat type. Parts default to full hits (100) so they all count.
function makeCreep(
  parts: Array<{ type: string; count: number; boost?: string }>,
  username = "Enemy"
): Creep {
  const body: TestPart[] = [];
  for (const p of parts) {
    for (let i = 0; i < p.count; i++) {
      body.push({ type: p.type, hits: 100, boost: p.boost });
    }
  }
  return { body, owner: { username } } as unknown as Creep;
}

// Minimal room whose find(FIND_HOSTILE_CREEPS) returns the given creeps.
function makeRoom(name: string, hostiles: Creep[]): Room {
  return {
    name,
    find: (type: number) => (type === g.FIND_HOSTILE_CREEPS ? hostiles : []),
  } as unknown as Room;
}

// Bump Game.time each test so getThreatInfo's per-tick cache never returns stale data.
let tick = 100;
beforeEach(() => {
  tick++;
  (g.Game as { time: number }).time = tick;
  g.Memory = {};
});

describe("isSourceKeeperRoom", () => {
  it("flags the full 3×3 keeper cluster (coords 4–6), including the coord-6 rooms", () => {
    for (const name of ["W4N4", "W5N4", "W6N4", "W4N5", "W6N5", "W4N6", "W5N6", "W6N6"]) {
      expect(isSourceKeeperRoom(name)).toBe(true);
    }
  });

  it("excludes the sector centre (5,5), which is the central/portal room", () => {
    expect(isSourceKeeperRoom("W5N5")).toBe(false);
    expect(isSourceKeeperRoom("E15N25")).toBe(false); // 15%10=5, 25%10=5
  });

  it("excludes normal and highway rooms", () => {
    expect(isSourceKeeperRoom("W1N1")).toBe(false);
    expect(isSourceKeeperRoom("W10N10")).toBe(false); // 0,0 → highway
    expect(isSourceKeeperRoom("W0N0")).toBe(false);
  });

  it("returns false for malformed names", () => {
    expect(isSourceKeeperRoom("not-a-room")).toBe(false);
    expect(isSourceKeeperRoom("")).toBe(false);
  });
});

describe("formationOffset", () => {
  it("puts the leader (slot 0) at the origin for every formation", () => {
    for (const f of ["line", "box", "wedge", "scatter"] as const) {
      expect(formationOffset(f, 0)).toEqual([0, 0]);
    }
  });

  it("stacks members beyond the template further back so large squads still cohere", () => {
    const box = formationOffset("box", 9); // first slot past the 9-entry box template
    expect(box[1]).toBeGreaterThanOrEqual(3);
  });
});

describe("getThreatInfo scoring", () => {
  it("returns score 0 for an empty room", () => {
    expect(getThreatInfo(makeRoom("W1N1", [])).score).toBe(0);
  });

  it("scores an unboosted melee attacker by its DPS and effective HP", () => {
    // 10 ATTACK (30 dmg each) + 10 MOVE:
    //   10 + (10×30)/30 + 0 + (20×100)/1000 = 10 + 10 + 2 = 22
    const room = makeRoom("W1N1", [
      makeCreep([{ type: "attack", count: 10 }, { type: "move", count: 10 }]),
    ]);
    expect(getThreatInfo(room).score).toBeCloseTo(22, 5);
  });

  it("scores a healer by its (weighted) heal output and effective HP", () => {
    // 5 HEAL (12 each) + 5 MOVE: 10 + 0 + (5×12)×0.10 + (10×100)/1000 = 10 + 6 + 1 = 17
    const room = makeRoom("W1N1", [
      makeCreep([{ type: "heal", count: 5 }, { type: "move", count: 5 }]),
    ]);
    expect(getThreatInfo(room).score).toBeCloseTo(17, 5);
  });

  it("scores a T3-boosted attacker FAR higher than the same body unboosted", () => {
    const body = [{ type: "attack", count: 10 }, { type: "move", count: 10 }];
    const unboosted = getThreatInfo(makeRoom("W1N1", [makeCreep(body)])).score;
    const boosted = getThreatInfo(
      makeRoom("W2N2", [
        makeCreep([{ type: "attack", count: 10, boost: "XUH2O" }, { type: "move", count: 10 }]),
      ])
    ).score;
    // XUH2O is ×4 attack damage: 10 + (10×30×4)/30 + (20×100)/1000 = 10 + 40 + 2 = 52
    expect(boosted).toBeCloseTo(52, 5);
    expect(unboosted).toBeCloseTo(22, 5);
    expect(boosted).toBeGreaterThan(unboosted * 1.5);
  });

  it("counts TOUGH boost as extra effective HP (tankier ⇒ higher score)", () => {
    const plain = getThreatInfo(
      makeRoom("W1N1", [makeCreep([{ type: "tough", count: 5 }])])
    ).score;
    const armored = getThreatInfo(
      makeRoom("W2N2", [makeCreep([{ type: "tough", count: 5, boost: "XGHO2" }])])
    ).score;
    // plain: 10 + (5×100)/1000 = 10.5
    // XGHO2 takes ×0.3 damage ⇒ EHP ×(1/0.3): 10 + (5×100/0.3)/1000 ≈ 11.667
    expect(plain).toBeCloseTo(10.5, 5);
    expect(armored).toBeGreaterThan(plain);
  });

  it("ignores destroyed parts (hits === 0)", () => {
    // A melee attacker whose ATTACK parts are all chewed off scores like a bare frame.
    const room = makeRoom("W1N1", [
      {
        body: [
          { type: "attack", hits: 0 },
          { type: "attack", hits: 0 },
          { type: "move", hits: 100 },
        ],
        owner: { username: "Enemy" },
      } as unknown as Creep,
    ]);
    // Only the live MOVE contributes EHP: 10 + 0 + 0 + 100/1000 = 10.1
    expect(getThreatInfo(room).score).toBeCloseTo(10.1, 5);
  });

  it("does NOT count allied creeps as threats", () => {
    (g.Memory as { allies?: string[] }).allies = ["FriendlyPlayer"];
    const ally = makeCreep(
      [{ type: "attack", count: 10 }, { type: "move", count: 10 }],
      "FriendlyPlayer"
    );
    const info = getThreatInfo(makeRoom("W1N1", [ally]));
    expect(info.hostiles).toHaveLength(0);
    expect(info.score).toBe(0);
  });

  it("still counts a non-ally attacker standing beside an ally", () => {
    (g.Memory as { allies?: string[] }).allies = ["FriendlyPlayer"];
    const ally = makeCreep([{ type: "attack", count: 10 }], "FriendlyPlayer");
    const enemy = makeCreep(
      [{ type: "attack", count: 10 }, { type: "move", count: 10 }],
      "Enemy"
    );
    const info = getThreatInfo(makeRoom("W1N1", [ally, enemy]));
    expect(info.hostiles).toHaveLength(1);
    expect(info.score).toBeCloseTo(22, 5);
  });
});

describe("getThreatSeverity calibration", () => {
  // A full unboosted melee attacker: 25 ATTACK + 25 MOVE ⇒ 10 + 25 + 5 = 40.
  const attacker = () =>
    makeCreep([{ type: "attack", count: 25 }, { type: "move", count: 25 }]);
  // A full unboosted healer: 25 HEAL + 25 MOVE ⇒ 10 + 30 + 5 = 45.
  const healer = () =>
    makeCreep([{ type: "heal", count: 25 }, { type: "move", count: 25 }]);

  it("rates a lone attacker as low", () => {
    expect(getThreatSeverity(makeRoom("W1N1", [attacker()]))).toBe("low"); // 40 < 80
  });

  it("rates a small unhealed squad as medium", () => {
    // Three attackers ≈ 120: ≥ SEVERITY_MEDIUM (80), < SEVERITY_HIGH (160).
    const room = makeRoom("W1N1", [attacker(), attacker(), attacker()]);
    expect(getThreatSeverity(room)).toBe("medium");
  });

  it("rates a healer-backed raid as high", () => {
    // Three attackers (120) + a healer (45) ≈ 165 ≥ SEVERITY_HIGH (160).
    const room = makeRoom("W1N1", [attacker(), attacker(), attacker(), healer()]);
    expect(getThreatSeverity(room)).toBe("high");
  });
});
