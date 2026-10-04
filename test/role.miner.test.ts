import { describe, it, expect, vi } from "vitest";

const sourcePos = { x: 20, y: 16 };
const containerPos = { x: 21, y: 15 };

vi.mock("../src/services/services.creep", () => ({
  getSafeSources: () => [],
  harvestFromSource: vi.fn(),
  findUnclaimedMinerAssignment: () => null,
  isSourceSafe: () => true,
}));
vi.mock("../src/orchestrators/orchestrator.links", () => ({ sourceLinksHaveOutlet: () => false }));

const g = globalThis as Record<string, unknown>;
g.OK = 0;

const { runMiner } = await import("../src/roles/role.miner");

// A miner beside the source at 21,16, with another already on the container tile.
function coMiner(carried: number) {
  const calls: string[] = [];
  const source = { id: "src", pos: sourcePos };
  const container = { id: "box", pos: containerPos };
  g.Game = { getObjectById: (id: string) => ({ src: source, box: container })[id] ?? null };
  const creep = {
    room: { name: "W1N1" },
    memory: { role: "miner", assignedSourceId: "src", assignedContainerId: "box" },
    pos: {
      isEqualTo: () => false,
      isNearTo: (t: unknown) => t === source || t === container,
    },
    store: { energy: carried, getFreeCapacity: () => 50 - carried },
    getActiveBodyparts: () => 2,
    moveTo: () => 0,
    harvest: () => { calls.push("harvest"); return 0; },
    transfer: (t: { id: string }) => { calls.push(`transfer ${t.id}`); return 0; },
  };
  return { creep: creep as unknown as Creep, calls };
}

describe("a second miner at a post", () => {
  it("hands its gold in to the container before the next dig would spill it", () => {
    const { creep, calls } = coMiner(48);
    runMiner(creep);
    expect(calls).toEqual(["transfer box", "harvest"]);
  });

  it("only digs while the next dig still fits", () => {
    const { creep, calls } = coMiner(46);
    runMiner(creep);
    expect(calls).toEqual(["harvest"]);
  });
});
