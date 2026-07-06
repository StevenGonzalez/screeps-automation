import { describe, it, expect, beforeEach } from "vitest";

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
g.DISMANTLE_POWER = 50;
g.FIND_HOSTILE_CREEPS = 113;
g.Game = { time: 1 };
g.Memory = {};

import {
  isSourceKeeperRoom,
  formationOffset,
  getThreatInfo,
  getThreatSeverity,
  structureDamagePerTick,
  refreshBlockade,
  isBlockaded,
} from "../src/services/services.combat";

type TestPart = { type: string; hits?: number; boost?: string };

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

function makeRoom(name: string, hostiles: Creep[]): Room {
  return {
    name,
    find: (type: number) => (type === g.FIND_HOSTILE_CREEPS ? hostiles : []),
  } as unknown as Room;
}

let tick = 100;
beforeEach(() => {
  tick++;
  (g.Game as { time: number }).time = tick;
  g.Memory = {};
});

describe("isSourceKeeperRoom", () => {
  it("flags the full 3x3 keeper cluster (coords 4-6), including the coord-6 rooms", () => {
    for (const name of ["W4N4", "W5N4", "W6N4", "W4N5", "W6N5", "W4N6", "W5N6", "W6N6"]) {
      expect(isSourceKeeperRoom(name)).toBe(true);
    }
  });

  it("excludes the sector centre (5,5), which is the central/portal room", () => {
    expect(isSourceKeeperRoom("W5N5")).toBe(false);
    expect(isSourceKeeperRoom("E15N25")).toBe(false);
  });

  it("excludes normal and highway rooms", () => {
    expect(isSourceKeeperRoom("W1N1")).toBe(false);
    expect(isSourceKeeperRoom("W10N10")).toBe(false);
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
    const box = formationOffset("box", 9);
    expect(box[1]).toBeGreaterThanOrEqual(3);
  });
});

describe("getThreatInfo scoring", () => {
  it("returns score 0 for an empty room", () => {
    expect(getThreatInfo(makeRoom("W1N1", [])).score).toBe(0);
  });

  it("scores an unboosted melee attacker by its DPS and effective HP", () => {
    const room = makeRoom("W1N1", [
      makeCreep([{ type: "attack", count: 10 }, { type: "move", count: 10 }]),
    ]);
    expect(getThreatInfo(room).score).toBeCloseTo(22, 5);
  });

  it("scores a healer by its (weighted) heal output and effective HP", () => {
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
    expect(boosted).toBeCloseTo(52, 5);
    expect(unboosted).toBeCloseTo(22, 5);
    expect(boosted).toBeGreaterThan(unboosted * 1.5);
  });

  it("counts TOUGH boost as extra effective HP (tankier => higher score)", () => {
    const plain = getThreatInfo(
      makeRoom("W1N1", [makeCreep([{ type: "tough", count: 5 }])])
    ).score;
    const armored = getThreatInfo(
      makeRoom("W2N2", [makeCreep([{ type: "tough", count: 5, boost: "XGHO2" }])])
    ).score;
    expect(plain).toBeCloseTo(10.5, 5);
    expect(armored).toBeGreaterThan(plain);
  });

  it("ignores destroyed parts (hits === 0)", () => {
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
  const attacker = () =>
    makeCreep([{ type: "attack", count: 25 }, { type: "move", count: 25 }]);
  const healer = () =>
    makeCreep([{ type: "heal", count: 25 }, { type: "move", count: 25 }]);

  it("rates a lone attacker as low", () => {
    expect(getThreatSeverity(makeRoom("W1N1", [attacker()]))).toBe("low");
  });

  it("rates a small unhealed squad as medium", () => {
    const room = makeRoom("W1N1", [attacker(), attacker(), attacker()]);
    expect(getThreatSeverity(room)).toBe("medium");
  });

  it("rates a healer-backed raid as high", () => {
    const room = makeRoom("W1N1", [attacker(), attacker(), attacker(), healer()]);
    expect(getThreatSeverity(room)).toBe("high");
  });
});

describe("dismantle threat scoring", () => {
  it("counts a WORK dismantler's damage so it is no longer invisible", () => {
    const room = makeRoom("W1N1", [
      makeCreep([{ type: "work", count: 20 }, { type: "move", count: 20 }]),
    ]);
    expect(getThreatInfo(room).score).toBeCloseTo(47.333, 2);
  });

  it("scores a boosted dismantler far above the same body unboosted", () => {
    const plain = getThreatInfo(
      makeRoom("W1N1", [makeCreep([{ type: "work", count: 20 }])])
    ).score;
    const boosted = getThreatInfo(
      makeRoom("W2N2", [makeCreep([{ type: "work", count: 20, boost: "XZH2O" }])])
    ).score;
    expect(boosted).toBeGreaterThan(plain);
  });
});

describe("exit blockade detection", () => {
  const STICKY = 1500;

  function makeGuard(
    x: number,
    y: number,
    parts: Array<{ type: string; count: number }>,
    username = "Enemy"
  ): Creep {
    const c = makeCreep(parts, username);
    (c as unknown as { pos: { x: number; y: number } }).pos = { x, y };
    return c;
  }

  function makeHome(memory: Record<string, unknown> = {}): Room {
    return { name: "W1N1", controller: { my: true }, memory } as unknown as Room;
  }

  function setNorthNeighbour(hostiles: Creep[] | null): void {
    (g.Game as { map?: unknown }).map = {
      describeExits: () => ({ "1": "W1N2" }),
    };
    (g.Game as { rooms?: unknown }).rooms =
      hostiles === null ? {} : { W1N2: makeRoom("W1N2", hostiles) };
  }

  const armed = [{ type: "attack", count: 5 }, { type: "move", count: 5 }];
  const unarmed = [{ type: "move", count: 1 }];

  it("arms the blockade when an armed hostile camps the exit border facing home", () => {
    setNorthNeighbour([makeGuard(25, 48, armed)]);
    const home = makeHome();
    refreshBlockade(home);
    expect(isBlockaded(home)).toBe(true);
    expect(home.memory.blockade?.guards).toBe(1);
  });

  it("ignores unarmed hostiles (a scout at the border is not a guard)", () => {
    setNorthNeighbour([makeGuard(25, 48, unarmed)]);
    const home = makeHome();
    refreshBlockade(home);
    expect(isBlockaded(home)).toBe(false);
  });

  it("ignores an armed hostile that is NOT in the border band facing home", () => {
    setNorthNeighbour([makeGuard(25, 20, armed)]);
    const home = makeHome();
    refreshBlockade(home);
    expect(isBlockaded(home)).toBe(false);
  });

  it("does not arm from a neighbour we have no vision of", () => {
    setNorthNeighbour(null);
    const home = makeHome();
    refreshBlockade(home);
    expect(isBlockaded(home)).toBe(false);
  });

  it("stays armed within the sticky window after the guards vanish, then expires", () => {
    const startTick = (g.Game as { time: number }).time;
    setNorthNeighbour([makeGuard(25, 49, armed)]);
    const home = makeHome();
    refreshBlockade(home);
    expect(isBlockaded(home)).toBe(true);

    setNorthNeighbour([]);
    (g.Game as { time: number }).time = startTick + STICKY - 1;
    refreshBlockade(home);
    expect(isBlockaded(home)).toBe(true);

    (g.Game as { time: number }).time = startTick + STICKY + 1;
    refreshBlockade(home);
    expect(isBlockaded(home)).toBe(false);
    expect(home.memory.blockade).toBeUndefined();
  });

  it("a manual lockdown holds regardless of the timer or absent guards", () => {
    setNorthNeighbour([]);
    const home = makeHome({
      blockade: { detectedAt: 1, until: 1, manual: true },
    });
    expect(isBlockaded(home)).toBe(true);
    refreshBlockade(home);
    expect(isBlockaded(home)).toBe(true);
    expect(home.memory.blockade?.manual).toBe(true);
  });
});

describe("structureDamagePerTick (safe-mode lethality)", () => {
  it("sums boost-aware ATTACK + RANGED + WORK dismantle over live parts", () => {
    const creep = makeCreep([
      { type: "attack", count: 10 },
      { type: "ranged_attack", count: 5 },
      { type: "work", count: 10 },
    ]);
    expect(structureDamagePerTick([creep])).toBeCloseTo(850, 5);
  });

  it("flags a lethal boosted RANGED raid the severity buckets under-rate as low", () => {
    const raider = makeCreep([{ type: "ranged_attack", count: 40, boost: "XKHO2" }]);
    expect(getThreatSeverity(makeRoom("W1N1", [raider]))).toBe("low");
    expect(structureDamagePerTick([raider])).toBeCloseTo(1600, 5);
    expect(structureDamagePerTick([raider])).toBeGreaterThan(400);
  });

  it("ignores destroyed parts", () => {
    const creep = {
      body: [
        { type: "attack", hits: 0 },
        { type: "work", hits: 0 },
        { type: "ranged_attack", hits: 100 },
      ],
      owner: { username: "Enemy" },
    } as unknown as Creep;
    expect(structureDamagePerTick([creep])).toBeCloseTo(10, 5);
  });
});
