import { describe, it, expect, vi, beforeEach } from "vitest";

const threat = vi.hoisted(() => ({ score: 0 }));
vi.mock("../src/services/services.combat", async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  getThreatInfo: () => threat,
}));

import { getFillerPopulationTarget } from "../src/orchestrators/orchestrator.spawning.economy";

function room(level: number, storage = true): Room {
  return { name: "W1N1", controller: { level }, storage: storage ? {} : undefined } as unknown as Room;
}

beforeEach(() => {
  threat.score = 0;
});

describe("barmaid population", () => {
  it("keeps none before a storage stands", () => {
    expect(getFillerPopulationTarget(room(7, false))).toBe(0);
  });

  it("keeps one in a peaceful RCL 7 castle", () => {
    expect(getFillerPopulationTarget(room(7))).toBe(1);
  });

  it("keeps a second under threat, for the towers", () => {
    threat.score = 3;
    expect(getFillerPopulationTarget(room(7))).toBe(2);
  });

  it("keeps one below RCL 7 even under threat", () => {
    threat.score = 3;
    expect(getFillerPopulationTarget(room(6))).toBe(1);
  });
});
