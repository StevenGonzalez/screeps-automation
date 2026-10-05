import { describe, it, expect, vi } from "vitest";

const g = globalThis as Record<string, unknown>;

g.ERR_NOT_IN_RANGE = -9;
g.OK = 0;
g.RESOURCE_POWER = "power";

let threat = { hostiles: [{}], score: 0 };
const tower = { id: "tower", store: { energy: 980, getFreeCapacity: () => 20 } };
const spawn = { id: "spawn", store: { energy: 200, getFreeCapacity: () => 100 } };

vi.mock("../src/services/services.creep", () => ({
  findEmptiestTower: () => tower,
  findCoreFillTarget: () => spawn,
  getRoomStructures: () => [],
}));
vi.mock("../src/services/services.combat", () => ({
  getThreatInfo: () => threat,
}));
vi.mock("../src/orchestrators/orchestrator.links", () => ({
  findRelayLink: () => null,
}));

import { runFiller } from "../src/roles/role.filler";

function fillerWithLoad() {
  const calls: string[] = [];
  const creep = {
    room: { name: "W48S8", memory: {} },
    memory: {},
    pos: { isNearTo: () => true, findClosestByRange: () => null },
    store: { energy: 400 },
    transfer: (t: { id: string }) => {
      calls.push(`transfer:${t.id}`);
      return g.OK;
    },
    moveTo: () => g.OK,
  } as unknown as Creep;
  g.Game = { time: 1, getObjectById: () => null };
  return { creep, calls };
}

describe("filler under threat", () => {
  it("keeps to the core while only a scout is in the room", () => {
    threat = { hostiles: [{}], score: 0 };
    const { creep, calls } = fillerWithLoad();
    runFiller(creep);
    expect(calls).toEqual(["transfer:spawn"]);
  });

  it("feeds the towers first when a hostile can do harm", () => {
    threat = { hostiles: [{}], score: 40 };
    const { creep, calls } = fillerWithLoad();
    runFiller(creep);
    expect(calls).toEqual(["transfer:tower"]);
  });
});
