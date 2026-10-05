import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/services/services.combat", () => ({
  getThreatInfo: () => ({ hostiles: [] }),
  evaluateRoomThreatLevel: () => 0,
}));
vi.mock("../src/orchestrators/orchestrator.nuker", () => ({ launchNukeFrom: () => false }));
vi.mock("../src/orchestrators/orchestrator.military.ops", () => ({
  onTargetCooldown: () => false,
  recommendComposition: () => null,
  launchOp: () => false,
  isCapableOffensiveHome: () => false,
  isAllyPlayer: () => false,
}));

const g = globalThis as Record<string, unknown>;
g.FIND_HOSTILE_STRUCTURES = 109;
g.FIND_SOURCES = 105;
g.FIND_MINERALS = 116;
g.FIND_STRUCTURES = 107;
g.STRUCTURE_TOWER = "tower";
g.STRUCTURE_SPAWN = "spawn";
g.STRUCTURE_RAMPART = "rampart";
g.STRUCTURE_WALL = "constructedWall";
g.RESOURCE_ENERGY = "energy";

import { runWarCouncil } from "../src/orchestrators/orchestrator.military.council";
import { lordName, wildsName } from "../src/services/services.chronicle";

const HOLD = "W51S8";

function rivalKeep(level: number) {
  return {
    name: HOLD,
    controller: { my: false, level, owner: { username: "Jumpp" }, pos: { x: 20, y: 20 } },
    find: () => [],
  };
}

// The war council scans every fifty ticks; this runs it as if a scan were due.
function council(time: number, rooms: Record<string, unknown>) {
  g.Game = { time, rooms };
  (g.Memory as Memory).warCouncil = { autoAttack: false, lastScan: time - 50 };
  runWarCouncil();
}

beforeEach(() => {
  g.Memory = {} as Memory;
});

describe("war council intel", () => {
  // A room beyond the remotes is seen only when a scout passes, and scouts go
  // back once its report is ten thousand ticks old.
  it("keeps a rival hold's report until a scout looks again, so the herald can tell what changed", () => {
    council(1_000, { [HOLD]: rivalKeep(3) });
    for (let t = 1_050; t < 11_000; t += 50) council(t, {});
    council(11_000, { [HOLD]: rivalKeep(4) });
    expect(((g.Memory as Memory).chronicle ?? []).map((l) => l.text)).toEqual([
      `The keep of ${lordName("Jumpp")} in the ${wildsName(HOLD)} rises to level 4.`,
    ]);
  });

  it("forgets a hold no scout has looked at for twice the scouts' round", () => {
    council(1_000, { [HOLD]: rivalKeep(3) });
    council(20_950, {});
    expect((g.Memory as Memory).intel?.[HOLD]).toBeDefined();
    council(21_050, {});
    expect((g.Memory as Memory).intel?.[HOLD]).toBeUndefined();
    expect((g.Memory as Memory).players?.Jumpp).toBeUndefined();
  });
});
