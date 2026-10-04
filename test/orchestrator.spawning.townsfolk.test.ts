import { describe, it, expect, vi } from "vitest";

const { stub, spawnTownsfolk } = vi.hoisted(() => {
  const spawnTownsfolk = vi.fn(() => true);
  // A module whose every export says no, apart from the ones given: every role
  // ahead of the town in the spawn order is already satisfied.
  const stub = (given: Record<string, unknown>) =>
    new Proxy(given, {
      has: (_, k) => k !== "then",
      get: (t, k) => {
        if (typeof k === "symbol" || k === "then") return undefined;
        return k in t ? t[k] : () => false;
      },
    });
  return { stub, spawnTownsfolk };
});

vi.mock("../src/orchestrators/orchestrator.spawning.economy", () =>
  stub({ hasEnergyGatherers: () => true, countHomeHaulers: () => 1, CONTROLLER_DOWNGRADE_SAFETY: 0 })
);
vi.mock("../src/orchestrators/orchestrator.spawning.remote", () => stub({}));
vi.mock("../src/orchestrators/orchestrator.spawning.military", () => stub({}));
vi.mock("../src/orchestrators/orchestrator.spawning.ops", () => stub({}));
vi.mock("../src/orchestrators/orchestrator.spawning.shared", () =>
  stub({ countByRoleInRoom: () => 1, getRoomPhase: () => "established" })
);
vi.mock("../src/orchestrators/orchestrator.spawning.town", () => ({ spawnTownsfolk }));
vi.mock("../src/services/services.combat", () =>
  stub({ getThreatInfo: () => ({ score: 0, hostiles: [] }), getThreatSeverity: () => "none" })
);
vi.mock("../src/services/services.creep", () => stub({}));

(globalThis as Record<string, unknown>).RESOURCE_ENERGY = "energy";

import { processRoomSpawning } from "../src/orchestrators/orchestrator.spawning";

describe("townsfolk in the spawn order", () => {
  it("raises townsfolk on the town's own storage gate, below the line where war and expansion stop", () => {
    // Above the town's 10k gate, below the 25k that stops war and expansion.
    const room = {
      name: "W1N1",
      controller: { my: true, level: 6, ticksToDowngrade: 100_000 },
      storage: { store: { energy: 15_000 } },
    } as unknown as Room;

    processRoomSpawning(room, {} as StructureSpawn);

    expect(spawnTownsfolk).toHaveBeenCalledTimes(1);
  });
});
