import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.EVENT_ATTACK = 1;
g.EVENT_BUILD = 4;
g.EVENT_HARVEST = 5;
g.EVENT_HEAL = 6;
g.EVENT_REPAIR = 7;
g.EVENT_UPGRADE_CONTROLLER = 9;
g.FIND_SOURCES = 105;
g.TOWER_ENERGY_COST = 10;

import { loop, recordSpend, describeBooks, totalIn, totalOut } from "../src/services/services.exchequer";

const HOME = "W1N1";
const REMOTE = "W1N2";

let events: Record<string, unknown[]>;
let objects: Record<string, unknown>;
let storageEnergy: number;

function room(name: string, my: boolean) {
  return {
    name,
    controller: { my },
    memory: my
      ? ({ towerIds: ["tower"], remoteRooms: [{ roomName: REMOTE, sources: [] }] } as unknown as RoomMemory)
      : ({} as RoomMemory),
    get storage() {
      return my ? { store: { energy: storageEnergy } } : undefined;
    },
    terminal: undefined,
    getEventLog: () => events[name] ?? [],
    find: () => (name === HOME ? [{ id: "src1" }] : [{ id: "src2" }]),
  };
}

function runTo(tick: number) {
  (g.Game as { time: number }).time = tick;
  loop();
}

describe("exchequer", () => {
  beforeEach(() => {
    events = {};
    objects = { peddler: { my: true }, stranger: { my: false } };
    storageEnergy = 10_000;
    g.Memory = {};
    g.Game = {
      time: 1000,
      rooms: { [HOME]: room(HOME, true), [REMOTE]: room(REMOTE, false) },
      getObjectById: (id: string) => objects[id] ?? null,
    };
  });

  it("closes the books with per-tick income and spending by category", () => {
    events[HOME] = [
      { event: 5, objectId: "miner", data: { targetId: "src1", amount: 10 } },
      { event: 5, objectId: "jeweler", data: { targetId: "mineral", amount: 5 } },
      { event: 9, objectId: "enchanter", data: { amount: 15, energySpent: 15 } },
      { event: 7, objectId: "tower", data: { targetId: "rampart", amount: 800, energySpent: 10 } },
      { event: 1, objectId: "tower", data: { targetId: "raider", damage: 600 } },
    ];
    events[REMOTE] = [
      { event: 5, objectId: "peddler", data: { targetId: "src2", amount: 10 } },
      { event: 5, objectId: "stranger", data: { targetId: "src2", amount: 10 } },
      { event: 4, objectId: "peddler", data: { targetId: "road", amount: 5, energySpent: 1 } },
    ];
    for (let t = 1000; t <= 1100; t++) {
      if (t === 1050) recordSpend(HOME, "recruits", 1950);
      if (t === 1100) storageEnergy = 10_500;
      runTo(t);
    }

    const books = (g.Memory as Memory).exchequer![HOME];
    expect(books.at).toBe(1100);
    // Mineral harvest is not gold, and a stranger's harvest is not ours.
    expect(books.in.mines).toBe(10);
    expect(books.in.vendors).toBe(10);
    expect(books.out.enchant).toBe(15);
    expect(books.out.smithy).toBe(10);
    expect(books.out.towers).toBe(10);
    expect(books.out.masonry).toBe(1);
    expect(books.out.recruits).toBe(19.5);
    expect(books.trend).toBe(5);
    expect(totalIn(books)).toBe(20);
    expect(totalOut(books)).toBeCloseTo(55.5);
  });

  it("does not close a window cut short by a reset, and blends later windows", () => {
    events[HOME] = [{ event: 5, objectId: "miner", data: { targetId: "src1", amount: 10 } }];
    for (let t = 1080; t <= 1100; t++) runTo(t);
    expect((g.Memory as Memory).exchequer).toBeUndefined();

    for (let t = 1101; t <= 1200; t++) runTo(t);
    expect((g.Memory as Memory).exchequer![HOME].in.mines).toBe(10);

    events[HOME] = [{ event: 5, objectId: "miner", data: { targetId: "src1", amount: 20 } }];
    for (let t = 1201; t <= 1300; t++) runTo(t);
    // 70% of the old rate, 30% of the new one.
    expect((g.Memory as Memory).exchequer![HOME].in.mines).toBe(13);
  });

  it("describes the books in short lines", () => {
    const lines = describeBooks({ at: 1, in: { mines: 20, vendors: 9.5 }, out: { recruits: 18, enchant: 15 } });
    expect(lines[0]).toBe("Exchequer -3.5/t  (in 29.5, out 33.0)");
    expect(lines[1]).toContain("mines 20.0  vendors 9.5");
    expect(lines[2]).toContain("recruits 18.0  enchant 15.0");
  });
});
