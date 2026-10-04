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
g.FIND_CONSTRUCTION_SITES = 111;
g.FIND_MY_CONSTRUCTION_SITES = 114;
g.FIND_MY_SPAWNS = 112;
g.FIND_MY_STRUCTURES = 108;
g.STRUCTURE_SPAWN = "spawn";
g.STRUCTURE_EXTENSION = "extension";
g.ERR_NO_PATH = -2;
g.ERR_INVALID_ARGS = -10;
g.RoomPosition = class {
  constructor(public x: number, public y: number, public roomName: string) {}
};

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

  it("builds with what it carries when every source is dry", () => {
    const c = settlerBeside({});
    c.store.energy = 150;
    runSettler(c as unknown as Creep);
    expect(c.memory.working).toBe(true);
    expect(c.moveTo).not.toHaveBeenCalled();
  });
});

describe("settler at work", () => {
  beforeEach(() => {
    g.Memory = { rooms: {}, expansion: { roomName: "W2N1", homeRoom: "W1N1", phase: "bootstrapping", startedAt: 0 } };
    g.Game = { time: 100 };
  });

  function laden(level: number) {
    const site = { structureType: "container" };
    const ctrl = { my: true, level };
    const c = {
      ...settlerBeside({ 111: [site] }),
      store: { energy: 300, getFreeCapacity: () => 0 },
      build: vi.fn(() => 0),
      upgradeController: vi.fn(() => 0),
    };
    c.memory.working = true;
    // Already signed, so the pilgrim goes straight to upgrading.
    Object.assign(c.room, { controller: ctrl, memory: { lastSigned: 1 } });
    return { c, site, ctrl };
  }

  it("raises a level-1 throne to level 2 before building anything else", () => {
    const { c, ctrl } = laden(1);
    runSettler(c as unknown as Creep);
    expect(c.upgradeController).toHaveBeenCalledWith(ctrl);
    expect(c.build).not.toHaveBeenCalled();
  });

  it("fills the extensions as well as the barracks once nothing is left to build", () => {
    const extension = { structureType: "extension", store: { getFreeCapacity: () => 50 } };
    const full = { structureType: "spawn", store: { getFreeCapacity: () => 0 } };
    const c = {
      ...settlerBeside({ 108: [full, extension] }),
      store: { energy: 300, getFreeCapacity: () => 0 },
      transfer: vi.fn(() => 0),
      upgradeController: vi.fn(() => 0),
    };
    c.memory.working = true;
    Object.assign(c.room, { controller: { my: true, level: 2 }, memory: { lastSigned: 1 } });
    runSettler(c as unknown as Creep);
    expect(c.transfer).toHaveBeenCalledWith(extension, "energy");
    expect(c.upgradeController).not.toHaveBeenCalled();
  });

  it("builds ahead of upgrading once the throne is level 2", () => {
    const { c, site } = laden(2);
    runSettler(c as unknown as Creep);
    expect(c.build).toHaveBeenCalledWith(site);
    expect(c.upgradeController).not.toHaveBeenCalled();
  });
});

describe("pilgrim provisions", () => {
  beforeEach(() => {
    g.Memory = { rooms: {}, expansion: { roomName: "W2N1", homeRoom: "W1N1", phase: "bootstrapping", startedAt: 0 } };
    g.Game = { time: 100 };
  });

  function pilgrimAtHome(stored: number, free = 550) {
    const storage = { my: true, store: { energy: stored } };
    const c = settlerBeside({});
    Object.assign(c, {
      room: { name: "W1N1", storage, find: () => [], findExitTo: () => 1 },
      store: { energy: 550 - free, getFreeCapacity: () => free },
    });
    return { c, storage };
  }

  it("fills its packs from the treasury before setting out", () => {
    const { c, storage } = pilgrimAtHome(45_000);
    runSettler(c as unknown as Creep);
    expect(c.withdraw).toHaveBeenCalledWith(storage, "energy");
    expect(c.moveTo).toHaveBeenCalledWith(storage, expect.anything());
  });

  it("sets out once its packs are full, or when the treasury has little to spare", () => {
    for (const { c } of [pilgrimAtHome(45_000, 0), pilgrimAtHome(8_000)]) {
      runSettler(c as unknown as Creep);
      expect(c.withdraw).not.toHaveBeenCalled();
      expect(c.moveTo).toHaveBeenCalledWith(expect.objectContaining({ roomName: "W2N1" }), expect.anything());
    }
  });
});
