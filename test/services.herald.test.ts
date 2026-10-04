import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.EVENT_ATTACK = 1;
g.EVENT_OBJECT_DESTROYED = 2;
g.FIND_HOSTILE_CREEPS = 103;
g.ATTACK = "attack";
g.RANGED_ATTACK = "ranged_attack";
g.WORK = "work";
class FakeCreep {
  my = true;
  memory: CreepMemory = { role: "x" } as CreepMemory;
  constructor(public name: string, public room: { name: string }) {}
}
g.Creep = FakeCreep;

import { cryFor, cryFlight, heraldRooms, settleFlight } from "../src/services/services.herald";

const ROOM = "W1N1";
let tick = 100;

function roomWith(events: unknown[], controller?: unknown, hostiles: unknown[] = []) {
  return {
    name: ROOM,
    controller,
    memory: {} as RoomMemory,
    getEventLog: () => JSON.stringify(events),
    find: () => hostiles,
  };
}

function setup(room: ReturnType<typeof roomWith>, objects: Record<string, unknown>) {
  tick++;
  g.Game = {
    time: tick,
    gcl: { level: 1 },
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

  it("mourns one of ours who fell wounded, naming the foe still in the room", () => {
    const wilds = { name: "W2N1", find: () => [{ owner: { username: "Invader" } }], getEventLog: () => "[]" };
    const merchant = { pos: { roomName: "W2N1" }, hits: 300, hitsMax: 1000, ticksToLive: 900 };
    tick++;
    g.Game = { time: tick, gcl: { level: 1 }, rooms: {}, creeps: { "Merchant Leofric": merchant } };
    heraldRooms();
    tick++;
    g.Game = { time: tick, gcl: { level: 1 }, rooms: { W2N1: wilds }, creeps: {} };
    heraldRooms();

    expect((g.Memory as Memory).chronicle?.map((l) => l.text)).toEqual([
      "Merchant Leofric fell to raiders in the wilds of W2N1.",
    ]);
  });

  it("does not mourn a creep that died of age or unhurt", () => {
    const old = { pos: { roomName: ROOM }, hits: 300, hitsMax: 1000, ticksToLive: 1 };
    const recycled = { pos: { roomName: ROOM }, hits: 1000, hitsMax: 1000, ticksToLive: 600 };
    tick++;
    g.Game = { time: tick, gcl: { level: 1 }, rooms: {}, creeps: { "Porter Ada": old, "Reeve Bran": recycled } };
    heraldRooms();
    tick++;
    g.Game = { time: tick, gcl: { level: 1 }, rooms: {}, creeps: {} };
    heraldRooms();

    expect((g.Memory as Memory).chronicle).toBeUndefined();
  });

  it("proclaims a new GCL once, not on the first look", () => {
    setup(roomWith([]), {});
    heraldRooms();
    (g.Game as { gcl: { level: number } }).gcl.level = 2;
    heraldRooms();
    heraldRooms();

    expect((g.Memory as Memory).chronicle?.map((l) => l.text)).toEqual([
      "The Crown's renown grows. The realm may now hold 2 castles.",
    ]);
  });

  it("writes one line a visit for a player's spies, and another when they come armed", () => {
    const castle = { my: true, level: 6 };
    const spy = { owner: { username: "Rival" }, body: [{ type: "move" }] };
    const raider = { owner: { username: "Rival" }, body: [{ type: "attack" }, { type: "move" }] };
    setup(roomWith([], castle, [spy]), {});
    heraldRooms();
    setup(roomWith([], castle, [spy]), {});
    heraldRooms();
    setup(roomWith([], castle, [spy, raider]), {});
    heraldRooms();

    const lines = (g.Memory as Memory).chronicle?.map((l) => l.text) ?? [];
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Spies of Rival crept about /);
    expect(lines[1]).toMatch(/^A war party of Rival came in arms to the walls of /);
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
