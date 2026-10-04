import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.RESOURCE_ENERGY = "energy";

import { upgradingFunded } from "../src/services/services.treasury";

const HOME = "W1N1";

function room(stored: number, ticksToDowngrade = 100_000): Room {
  return {
    name: HOME,
    controller: { my: true, ticksToDowngrade },
    storage: { store: { energy: stored } },
  } as unknown as Room;
}

describe("treasury floor", () => {
  beforeEach(() => {
    g.Memory = {};
  });

  it("funds upgrading above the usual floor", () => {
    expect(upgradingFunded(room(20_000))).toBe(true);
    expect(upgradingFunded(room(8_000))).toBe(false);
  });

  it("holds the keep fund while the castle saves for a keep", () => {
    (g.Memory as Memory).expansionSavings = { room: HOME, target: "W1N2" };
    expect(upgradingFunded(room(30_000))).toBe(false);
    expect(upgradingFunded(room(50_000))).toBe(true);
  });

  it("holds the keep fund while the castle funds a keep, until it is established", () => {
    const exp = { roomName: "W1N2", homeRoom: HOME, phase: "bootstrapping", startedAt: 0 } as ExpansionData;
    (g.Memory as Memory).expansion = exp;
    expect(upgradingFunded(room(30_000))).toBe(false);
    exp.phase = "established";
    expect(upgradingFunded(room(30_000))).toBe(true);
  });

  it("spends anyway rather than let the controller downgrade", () => {
    (g.Memory as Memory).expansionSavings = { room: HOME, target: "W1N2" };
    expect(upgradingFunded(room(30_000, 1000))).toBe(true);
  });
});
