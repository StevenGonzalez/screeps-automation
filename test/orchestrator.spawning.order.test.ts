import { describe, it, expect, vi, beforeEach } from "vitest";

const { stub, spawnTownsfolk, spawnRemoteMiner, spawnRemoteHauler, spawnReserver, spawnRepairer, need } = vi.hoisted(() => {
  const spawnTownsfolk = vi.fn(() => true);
  const spawnRemoteMiner = vi.fn(() => true);
  const spawnRemoteHauler = vi.fn(() => true);
  const spawnReserver = vi.fn(() => true);
  const spawnRepairer = vi.fn(() => true);
  // Roles a test says are short; every other role is already satisfied.
  const need = { remoteMiner: false, remoteHauler: false, reserver: false, repairer: false };
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
  return { stub, spawnTownsfolk, spawnRemoteMiner, spawnRemoteHauler, spawnReserver, spawnRepairer, need };
});

vi.mock("../src/orchestrators/orchestrator.spawning.economy", () =>
  stub({
    hasEnergyGatherers: () => true,
    countHomeHaulers: () => 1,
    CONTROLLER_DOWNGRADE_SAFETY: 0,
    shouldSpawnRepairer: () => need.repairer,
    spawnRepairer,
  })
);
vi.mock("../src/orchestrators/orchestrator.spawning.remote", () =>
  stub({
    shouldSpawnRemoteMiner: () => need.remoteMiner,
    spawnRemoteMiner,
    shouldSpawnRemoteHauler: () => need.remoteHauler,
    spawnRemoteHauler,
    shouldSpawnReserver: () => need.reserver,
    spawnReserver,
  })
);
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

function castle(storedEnergy: number): Room {
  return {
    name: "W1N1",
    controller: { my: true, level: 6, ticksToDowngrade: 100_000 },
    storage: { store: { energy: storedEnergy } },
  } as unknown as Room;
}

beforeEach(() => {
  vi.clearAllMocks();
  need.remoteMiner = false;
  need.remoteHauler = false;
  need.reserver = false;
  need.repairer = false;
  spawnTownsfolk.mockImplementation(() => true);
});

describe("spawn order", () => {
  it("replaces a remote miner ahead of the castle's own repairers", () => {
    // The merchants on its road earn nothing while the miner's post stands empty.
    need.remoteMiner = true;
    need.repairer = true;

    processRoomSpawning(castle(30_000), {} as StructureSpawn);

    expect(spawnRemoteMiner).toHaveBeenCalledTimes(1);
    expect(spawnRepairer).not.toHaveBeenCalled();
  });

  it("raises townsfolk on the town's own storage gate, below the line where war and expansion stop", () => {
    // Above the town's 10k gate, below the 25k that stops war and expansion.
    processRoomSpawning(castle(15_000), {} as StructureSpawn);

    expect(spawnTownsfolk).toHaveBeenCalledTimes(1);
  });

  it("raises townsfolk ahead of the vendors, and the vendors once the town has all it wants", () => {
    // A busy spawn never reached a town at the end of the line.
    need.remoteHauler = true;
    processRoomSpawning(castle(30_000), {} as StructureSpawn);
    expect(spawnTownsfolk).toHaveBeenCalledTimes(1);
    expect(spawnRemoteHauler).not.toHaveBeenCalled();

    spawnTownsfolk.mockImplementation(() => false);
    (globalThis as Record<string, unknown>).Memory = {};
    processRoomSpawning(castle(30_000), {} as StructureSpawn);
    expect(spawnRemoteHauler).toHaveBeenCalledTimes(1);
  });

  it("raises an envoy ahead of the merchants", () => {
    // A late envoy lets its remote's reservation lapse.
    need.remoteHauler = true;
    need.reserver = true;
    spawnTownsfolk.mockImplementation(() => false);
    (globalThis as Record<string, unknown>).Memory = {};

    processRoomSpawning(castle(30_000), {} as StructureSpawn);

    expect(spawnReserver).toHaveBeenCalledTimes(1);
    expect(spawnRemoteHauler).not.toHaveBeenCalled();
  });
});
