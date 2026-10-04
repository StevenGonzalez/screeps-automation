import { describe, it, expect } from "vitest";

import { cpuPerTick, getCpuStats, recordCpu } from "../src/services/services.profiler";

const g = globalThis as Record<string, unknown>;

describe("CPU per tick", () => {
  it("counts a system that ran one tick in ten for a tenth of its average", () => {
    g.Game = { time: 100 };
    recordCpu("labs", 2);
    g.Game = { time: 109 };
    expect(cpuPerTick(getCpuStats().labs)).toBeCloseTo(0.2);
  });

  it("counts a system that runs every tick at its average", () => {
    for (let t = 200; t < 210; t++) {
      g.Game = { time: t };
      recordCpu("creeps", 15);
    }
    expect(cpuPerTick(getCpuStats().creeps)).toBeCloseTo(15);
  });
});
