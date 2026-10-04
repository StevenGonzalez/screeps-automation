import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/services/services.combat", () => ({ getThreatInfo: () => ({ score: 0 }) }));

const g = globalThis as Record<string, unknown>;
g.OK = 0;
g.ERR_NOT_IN_RANGE = -9;
g.RESOURCE_ENERGY = "energy";
g.FIND_SOURCES_ACTIVE = 104;
g.FIND_DROPPED_RESOURCES = 106;
g.FIND_STRUCTURES = 107;
g.STRUCTURE_CONTAINER = "container";

const { runSettler } = await import("../src/roles/role.settler");

function settlerBeside(found: Record<number, unknown[]>) {
  return {
    room: { name: "W2N1", find: () => [] },
    pos: {
      findClosestByRange: vi.fn((type: number, opts?: { filter?: (o: unknown) => boolean }) => {
        const list = (found[type] ?? []).filter((o) => !opts?.filter || opts.filter(o));
        return list[0] ?? null;
      }),
    },
    store: { energy: 0, getFreeCapacity: () => 300 },
    memory: { role: "settler", homeRoom: "W1N1", targetRoom: "W2N1", working: false },
    withdraw: vi.fn(() => -9),
    pickup: vi.fn(() => -9),
    harvest: vi.fn(() => -9),
    moveTo: vi.fn(),
    suicide: vi.fn(),
  };
}

describe("settler", () => {
  beforeEach(() => {
    g.Memory = { rooms: {}, expansion: { roomName: "W2N1", homeRoom: "W1N1", phase: "bootstrapping", startedAt: 0 } };
    g.Game = { time: 100 };
  });

  it("empties a container the old remote miner left before harvesting by hand", () => {
    const container = { structureType: "container", store: { energy: 900 } };
    const source = { id: "s" };
    const c = settlerBeside({ 107: [container], 104: [source] });
    runSettler(c as unknown as Creep);
    expect(c.withdraw).toHaveBeenCalledWith(container, "energy");
    expect(c.moveTo).toHaveBeenCalledWith(container, expect.anything());
    expect(c.harvest).not.toHaveBeenCalled();
  });

  it("picks up dropped gold before harvesting", () => {
    const pile = { resourceType: "energy", amount: 400 };
    const c = settlerBeside({ 106: [pile], 104: [{ id: "s" }] });
    runSettler(c as unknown as Creep);
    expect(c.pickup).toHaveBeenCalledWith(pile);
    expect(c.harvest).not.toHaveBeenCalled();
  });

  it("harvests when no container or pile holds enough gold", () => {
    const container = { structureType: "container", store: { energy: 20 } };
    const pile = { resourceType: "energy", amount: 10 };
    const source = { id: "s" };
    const c = settlerBeside({ 107: [container], 106: [pile], 104: [source] });
    runSettler(c as unknown as Creep);
    expect(c.harvest).toHaveBeenCalledWith(source);
    expect(c.withdraw).not.toHaveBeenCalled();
  });
});
