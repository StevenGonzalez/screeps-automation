import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;

// Every system is a stub, so the test sees only which ones the CPU guard in
// main lets run.
const systems = [
  "creep", "labs", "factory", "links", "memory", "strategy", "expansion", "spawning", "score",
  "structures", "tower", "terminal", "military", "nukes", "nuker", "sourcekeeper", "powercreep",
  "observer", "visuals",
] as const;
const loops = Object.fromEntries(systems.map((s) => [s, vi.fn()])) as Record<(typeof systems)[number], ReturnType<typeof vi.fn>>;

vi.mock("../src/orchestrators/orchestrator.creep", () => ({ loop: () => loops.creep() }));
vi.mock("../src/orchestrators/orchestrator.labs", () => ({ loop: () => loops.labs() }));
vi.mock("../src/orchestrators/orchestrator.factory", () => ({ loop: () => loops.factory() }));
vi.mock("../src/orchestrators/orchestrator.links", () => ({ loop: () => loops.links() }));
vi.mock("../src/orchestrators/orchestrator.memory", () => ({ loop: () => loops.memory() }));
vi.mock("../src/orchestrators/orchestrator.strategy", () => ({ loop: () => loops.strategy() }));
vi.mock("../src/orchestrators/orchestrator.expansion", () => ({ loop: () => loops.expansion() }));
vi.mock("../src/orchestrators/orchestrator.pixels", () => ({ loop: vi.fn(), inPixelRefill: () => false }));
vi.mock("../src/orchestrators/orchestrator.spawning", () => ({ loop: () => loops.spawning() }));
vi.mock("../src/orchestrators/orchestrator.score", () => ({ loop: () => loops.score() }));
vi.mock("../src/orchestrators/orchestrator.structures", () => ({ loop: () => loops.structures() }));
vi.mock("../src/orchestrators/orchestrator.tower", () => ({ loop: () => loops.tower() }));
vi.mock("../src/orchestrators/orchestrator.terminal", () => ({ loop: () => loops.terminal() }));
vi.mock("../src/orchestrators/orchestrator.military", () => ({ loop: () => loops.military() }));
vi.mock("../src/orchestrators/orchestrator.nukes", () => ({ loop: () => loops.nukes() }));
vi.mock("../src/orchestrators/orchestrator.nuker", () => ({ loop: () => loops.nuker() }));
vi.mock("../src/orchestrators/orchestrator.sourcekeeper", () => ({ loop: () => loops.sourcekeeper() }));
vi.mock("../src/orchestrators/orchestrator.powercreep", () => ({ loop: () => loops.powercreep() }));
vi.mock("../src/orchestrators/orchestrator.observer", () => ({ loop: () => loops.observer() }));
vi.mock("../src/orchestrators/orchestrator.visuals", () => ({ loop: () => loops.visuals() }));
vi.mock("../src/services/services.allies", () => ({ runAllies: vi.fn() }));
vi.mock("../src/services/services.exchequer", () => ({ loop: vi.fn() }));
vi.mock("../src/services/services.rebrand", () => ({ migrateRoleNames: vi.fn() }));
vi.mock("../src/console", () => ({ setupConsole: vi.fn() }));
vi.mock("../src/services/services.movement", () => ({}));
const replay = vi.fn();
vi.mock("../src/services/services.visualreplay", () => ({ drawAndKeep: (draw: () => void) => draw(), replayKept: () => replay() }));

import { loop } from "../src/main";

let used: number;

function tick(bucket: number, time = 1) {
  used = 0;
  g.Game = { time, cpu: { limit: 20, bucket, getUsed: () => used } };
  g.Memory = {};
  loop();
}

beforeEach(() => {
  for (const s of systems) loops[s].mockReset();
  replay.mockReset();
  // The creeps use 80% of the limit, as the realm's do.
  loops.creep.mockImplementation(() => (used += 16));
});

describe("CPU guard in main", () => {
  it("runs structures on a busy tick while the bucket is healthy", () => {
    tick(5000);
    expect(loops.structures).toHaveBeenCalled();
  });

  const quiet = () => loops.creep.mockImplementation(() => (used += 2));
  const busy = () => loops.creep.mockImplementation(() => (used += 16));

  it("draws the visuals afresh on a quiet tick", () => {
    quiet();
    tick(5000, 100);
    expect(loops.visuals).toHaveBeenCalled();
    expect(replay).not.toHaveBeenCalled();
  });

  it("shows the last drawing again on a busy tick soon after it", () => {
    quiet();
    tick(5000, 200);
    loops.visuals.mockReset();
    busy();
    tick(5000, 205);
    expect(loops.visuals).not.toHaveBeenCalled();
    expect(replay).toHaveBeenCalled();
  });

  it("draws the visuals on a busy tick once the last drawing is ten ticks old", () => {
    quiet();
    tick(5000, 300);
    loops.visuals.mockReset();
    busy();
    tick(5000, 310);
    expect(loops.visuals).toHaveBeenCalled();
    expect(replay).not.toHaveBeenCalled();
  });

  it("warns of a tick only once it runs past the limit", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    loops.creep.mockImplementation(() => (used += 18));
    tick(5000, 500);
    expect(log).not.toHaveBeenCalled();
    loops.creep.mockImplementation(() => (used += 21));
    tick(5000, 600);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[CPU] High usage: 21.0/20"));
    log.mockRestore();
  });

  it("holds structures and the visuals back when the bucket is critical", () => {
    tick(1000, 400);
    expect(loops.structures).not.toHaveBeenCalled();
    expect(loops.visuals).not.toHaveBeenCalled();
  });
});
