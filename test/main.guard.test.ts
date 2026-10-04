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

import { loop } from "../src/main";

let used: number;

function tick(bucket: number) {
  used = 0;
  g.Game = { time: 1, cpu: { limit: 20, bucket, getUsed: () => used } };
  g.Memory = {};
  loop();
}

beforeEach(() => {
  for (const s of systems) loops[s].mockReset();
  // The creeps use 80% of the limit, as the realm's do.
  loops.creep.mockImplementation(() => (used += 16));
});

describe("CPU guard in main", () => {
  it("runs structures on a busy tick while the bucket is healthy", () => {
    tick(5000);
    expect(loops.structures).toHaveBeenCalled();
    // Visuals still give way on a busy tick.
    expect(loops.visuals).not.toHaveBeenCalled();
  });

  it("holds structures back when the bucket is critical", () => {
    tick(1000);
    expect(loops.structures).not.toHaveBeenCalled();
  });
});
