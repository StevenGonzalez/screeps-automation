import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.EVENT_ATTACK = 1;
g.EVENT_OBJECT_DESTROYED = 2;
class FakeCreep {
  my = true;
  memory: CreepMemory = { role: "x" } as CreepMemory;
  constructor(public name: string, public room: { name: string }) {}
}
g.Creep = FakeCreep;

import { cryFor, cryFlight, heraldRooms, settleFlight } from "../src/services/services.herald";

const ROOM = "W1N1";
let tick = 100;

function roomWith(events: unknown[], controller?: unknown) {
  return {
    name: ROOM,
    controller,
    memory: {} as RoomMemory,
    getEventLog: () => JSON.stringify(events),
  };
}

function setup(room: ReturnType<typeof roomWith>, objects: Record<string, unknown>) {
  tick++;
  g.Game = {
    time: tick,
    rooms: { [ROOM]: room },
    getObjectById: (id: string) => objects[id] ?? null,
  };
}

function killed(victim: string, by: string[]) {
  return [
    ...by.map((id) => ({ event: 1, objectId: id, data: { targetId: victim } })),
    { event: 2, objectId: victim, data: { type: "creep" } },
  ];
}

describe("herald", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    g.Memory = {};
  });

  it("has the creep that struck a raider down shout a kill cry", () => {
    const knight = new FakeCreep("Dragon Knight Edric", { name: ROOM });
    const bystander = new FakeCreep("Mason Aldric", { name: ROOM });
    setup(roomWith(killed("raider", ["knight"])), { knight });
    heraldRooms();
    expect(cryFor(knight as unknown as Creep)).toBeTruthy();
    expect(cryFor(bystander as unknown as Creep)).toBeUndefined();
  });

  it("has the whole room cheer a kill made by towers alone", () => {
    const tower = { my: true };
    const mason = new FakeCreep("Mason Aldric", { name: ROOM });
    setup(roomWith(killed("raider", ["tower"])), { tower });
    heraldRooms();
    expect(cryFor(mason as unknown as Creep)).toBe("Huzzah!");
  });

  it("stays quiet when one of ours dies", () => {
    const mason = new FakeCreep("Mason Aldric", { name: ROOM });
    const raider = { my: false };
    setup(roomWith(killed("mason", ["raider"])), { raider });
    heraldRooms();
    expect(cryFor(mason as unknown as Creep)).toBeUndefined();
  });

  it("proclaims a new controller level once, not on the first look", () => {
    const mason = new FakeCreep("Mason Aldric", { name: ROOM });
    const room = roomWith([], { my: true, level: 6 });
    setup(room, {});
    heraldRooms();
    expect(cryFor(mason as unknown as Creep)).toBeUndefined();

    room.controller = { my: true, level: 7 };
    setup(room, {});
    heraldRooms();
    expect(cryFor(mason as unknown as Creep)).toBe("Long live!");

    setup(room, {});
    heraldRooms();
    expect(cryFor(mason as unknown as Creep)).toBeUndefined();

    const log = (g.Memory as Memory).chronicle!;
    expect(log).toHaveLength(1);
    expect(log[0].text).toContain("rises to level 7");
  });

  it("gathers a fight's kills into one chronicle line", () => {
    const tower = { my: true };
    setup(roomWith(killed("raider1", ["tower"])), { tower });
    heraldRooms();
    setup(roomWith(killed("raider2", ["tower"])), { tower });
    heraldRooms();

    const log = (g.Memory as Memory).chronicle!;
    expect(log).toHaveLength(1);
    expect(log[0].text).toBe("2 raiders fell in the wilds of W1N1");
  });

  it("has a fleeing vendor cry out once, and again only after it settles", () => {
    const peddler = new FakeCreep("Peddler Osric", { name: "W1N2" });
    setup(roomWith([]), {});
    heraldRooms();
    cryFlight(peddler as unknown as Creep);
    expect(cryFor(peddler as unknown as Creep)).toBe("Bandits!");

    setup(roomWith([]), {});
    heraldRooms();
    cryFlight(peddler as unknown as Creep);
    expect(cryFor(peddler as unknown as Creep)).toBeUndefined();

    settleFlight(peddler as unknown as Creep);
    cryFlight(peddler as unknown as Creep);
    expect(cryFor(peddler as unknown as Creep)).toBe("Bandits!");
  });
});
