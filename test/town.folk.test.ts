import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_MY_CREEPS = 102;
g.FIND_MY_STRUCTURES = 108;
g.FIND_STRUCTURES = 107;
g.FIND_HOSTILE_CREEPS = 103;
g.STRUCTURE_RAMPART = "rampart";
g.OK = 0;
g.TOP = 1;
g.RIGHT = 3;
g.BOTTOM = 5;
g.LEFT = 7;
g.TERRAIN_MASK_WALL = 1;

class FakePos {
  constructor(public x: number, public y: number, public roomName: string) {}
}
g.RoomPosition = FakePos;

let hostiles: unknown[] = [];
vi.mock("../src/services/services.combat", () => ({
  getThreatInfo: () => ({ hostiles, score: hostiles.length }),
  isSourceKeeperRoom: (name: string) => name === "W5N5",
}));

import { runTownsfolk, lookoutTargets } from "../src/roles/role.townsfolk";
import {
  claimSpot,
  isFullMoon,
  townAurora,
  townClock,
  townDragon,
  townFallingStar,
  townFeast,
  townHowl,
  townMoon,
  townSeason,
  townStorm,
} from "../src/services/services.town";
import { nextTownJob } from "../src/orchestrators/orchestrator.spawning.town";
import { ROLE_TOWNSFOLK } from "../src/config/config.roles";
import { TOWN, TOWN_DAY_LENGTH, TOWN_DRAGON_FLIGHT } from "../src/config/config.town";

// Night falls 700 ticks into each 1000-tick day.
const DAY = 3 * TOWN_DAY_LENGTH + 200;
const NIGHT = 3 * TOWN_DAY_LENGTH + 800;

function pos(x: number, y: number) {
  return {
    x,
    y,
    roomName: "W1N1",
    inRangeTo: (p: { x: number; y: number } | { pos: { x: number; y: number } }, r: number) => {
      const q = "pos" in p ? p.pos : p;
      return Math.max(Math.abs(q.x - x), Math.abs(q.y - y)) <= r;
    },
    isEqualTo: (p: { x: number; y: number }) => p.x === x && p.y === y,
    findClosestByRange: (list: Array<{ pos: { x: number; y: number } }>) => list[0] ?? null,
  };
}

// One cottage at 30,30 (beds 31-33 x 31-33), two watch posts and a square.
const TOWN_MEM: TownMemory = {
  posts: ["20,12", "21,12"],
  square: ["24,34", "25,34"],
  fountain: "25,35",
  cottages: [{ x: 30, y: 30, door: "30,32", name: "Hanzo" }],
};

let ramparts: Array<{ structureType: string; pos: { x: number; y: number } }> = [];
let room: Record<string, unknown>;

function makeRoom() {
  room = {
    name: "W1N1",
    controller: { my: true, level: 7, owner: { username: "me" } },
    storage: { store: { energy: 200_000 } },
    memory: { town: JSON.parse(JSON.stringify(TOWN_MEM)), perimeterTiles: ["20,11", "21,11", "22,11"] },
    find: (type: number) => {
      if (type === g.FIND_MY_STRUCTURES) return ramparts;
      if (type === g.FIND_MY_CREEPS) return Object.values((g.Game as { creeps: object }).creeps);
      return [];
    },
  };
  return room;
}

function folk(name: string, x: number, y: number, memory: Partial<CreepMemory> = {}) {
  const c = {
    name,
    room,
    pos: pos(x, y),
    memory: { role: ROLE_TOWNSFOLK, job: "militia", homeRoom: "W1N1", ...memory },
    body: [],
    moveTo: vi.fn(),
    rangedAttack: vi.fn(),
    say: vi.fn(),
  };
  (g.Game as { creeps: Record<string, unknown> }).creeps[name] = c;
  return c;
}

function movedTo(c: { moveTo: ReturnType<typeof vi.fn> }): string | null {
  const call = c.moveTo.mock.calls[0];
  if (!call) return null;
  const p = call[0] as { x: number; y: number };
  return `${p.x},${p.y}`;
}

beforeEach(() => {
  hostiles = [];
  ramparts = [];
  g.Game = { time: DAY, creeps: {}, rooms: {} };
  g.Memory = { creeps: {} };
  makeRoom();
});

describe("townClock", () => {
  it("runs dawn, day, dusk and night through each thousand-tick day", () => {
    expect(townClock(0)).toEqual({ phase: "dawn", hour: 0 });
    expect(townClock(1250).phase).toBe("day");
    expect(townClock(2650).phase).toBe("dusk");
    expect(townClock(3999)).toEqual({ phase: "night", hour: 23 });
  });
});

describe("townSeason", () => {
  it("turns spring, summer, autumn and winter every seven days, then the year again", () => {
    expect(townSeason(0)).toBe("spring");
    expect(townSeason(6_999)).toBe("spring");
    expect(townSeason(7_000)).toBe("summer");
    expect(townSeason(14_000)).toBe("autumn");
    expect(townSeason(27_999)).toBe("winter");
    expect(townSeason(28_000)).toBe("spring");
  });
});

describe("the town's calls", () => {
  it("greets the day with talk of the season", () => {
    const said = (time: number) => {
      (g.Game as { time: number }).time = time;
      const c = folk(`Yeoman ${time}`, 40, 40);
      runTownsfolk(c as unknown as Creep);
      return c.say.mock.calls[0]?.[0] as string | undefined;
    };
    // Day breaks 100 ticks into each town day; day 3 is spring, day 24 winter.
    const spring = said(3 * TOWN_DAY_LENGTH + 100);
    const winter = said(24 * TOWN_DAY_LENGTH + 100);
    expect(spring).toBeTruthy();
    expect(winter).toBeTruthy();
    expect(spring).not.toBe(winter);
    expect(said(24 * TOWN_DAY_LENGTH + 101)).toBeUndefined();
  });

  it("greets a storm day with talk of the storm", () => {
    (g.Game as { time: number }).time = 2 * TOWN_DAY_LENGTH + 100;
    const c = folk("Yeoman Storm", 40, 40);
    runTownsfolk(c as unknown as Creep);
    expect(["storm!", "bar doors", "rain again"]).toContain(c.say.mock.calls[0]?.[0]);
  });
});

describe("townStorm", () => {
  it("blows on about one ordinary day in five, never on a feast day or in winter", () => {
    // Day 2 is a storm day; day 3 is not.
    expect(townStorm(2_500)).toBe(true);
    expect(townStorm(3_500)).toBe(false);
    let storms = 0;
    let days = 0;
    for (let day = 0; day < 28_000; day++) {
      const t = day * TOWN_DAY_LENGTH;
      if (townFeast(t) || townSeason(t) === "winter") {
        expect(townStorm(t)).toBe(false);
        continue;
      }
      days++;
      if (townStorm(t)) storms++;
    }
    expect(storms / days).toBeGreaterThan(0.15);
    expect(storms / days).toBeLessThan(0.25);
  });
});

describe("townDragon", () => {
  // The ticks of the day a dragon is overhead, for days 0 to n-1.
  function flights(n: number): number[][] {
    const out: number[][] = [];
    for (let day = 0; day < n; day++) {
      const ticks: number[] = [];
      for (let t = 0; t < TOWN_DAY_LENGTH; t++) if (townDragon(day * TOWN_DAY_LENGTH + t)) ticks.push(t);
      out.push(ticks);
    }
    return out;
  }

  it("flies over on about one ordinary day in six, never on a feast day", () => {
    const days = flights(2_800);
    let seen = 0;
    days.forEach((ticks, day) => {
      if (townFeast(day * TOWN_DAY_LENGTH)) expect(ticks).toEqual([]);
      else if (ticks.length > 0) seen++;
    });
    expect(seen / 2_400).toBeGreaterThan(0.12);
    expect(seen / 2_400).toBeLessThan(0.22);
  });

  it("crosses in one unbroken flight between morning and dusk, from one edge of the room to the other", () => {
    const days = flights(200);
    const day = days.findIndex((ticks) => ticks.length > 0);
    const ticks = days[day];
    expect(ticks).toHaveLength(TOWN_DRAGON_FLIGHT);
    expect(ticks[ticks.length - 1] - ticks[0]).toBe(TOWN_DRAGON_FLIGHT - 1);
    expect(ticks[0]).toBeGreaterThanOrEqual(100);
    expect(ticks[ticks.length - 1]).toBeLessThan(700);

    const first = townDragon(day * TOWN_DAY_LENGTH + ticks[0])!;
    const last = townDragon(day * TOWN_DAY_LENGTH + ticks[ticks.length - 1])!;
    expect(first.t).toBe(0);
    const [from, to] = first.dir === 1 ? [first.x, last.x] : [last.x, first.x];
    expect(from).toBeLessThan(0);
    expect(to).toBeGreaterThan(49);
  });
});

describe("the moon and the wolves", () => {
  // Day 4 is the first full moon.
  const FULL = 4 * TOWN_DAY_LENGTH;

  it("waxes and wanes over eight days", () => {
    expect(townMoon(0)).toBe(0);
    expect(townMoon(FULL + 999)).toBe(4);
    expect(townMoon(8 * TOWN_DAY_LENGTH)).toBe(0);
    expect(isFullMoon(FULL)).toBe(true);
    expect(isFullMoon(FULL + TOWN_DAY_LENGTH)).toBe(false);
    expect(isFullMoon(12 * TOWN_DAY_LENGTH + 500)).toBe(true);
  });

  it("has the wolves howl every fifty ticks of a full-moon night and at no other time", () => {
    const howling: number[] = [];
    for (let t = 0; t < 2 * TOWN_DAY_LENGTH; t++) if (townHowl(FULL - TOWN_DAY_LENGTH + t)?.t === 0) howling.push(t);
    // Six howls, all in the full moon's night: 700 to 999 of the second day.
    expect(howling).toEqual([1700, 1750, 1800, 1850, 1900, 1950]);

    expect(townHowl(FULL + 700)).toMatchObject({ t: 0, n: 0 });
    expect(townHowl(FULL + 705)).toMatchObject({ t: 5, n: 0 });
    expect(townHowl(FULL + 706)).toBeUndefined();
    const { x, y } = townHowl(FULL + 750)!;
    expect([2.5, 46.5]).toContain(x);
    expect(y).toBeGreaterThanOrEqual(14);
    expect(y).toBeLessThan(42);
  });
});

describe("night skies", () => {
  it("raises the northern lights on about one winter night in three, and only by night", () => {
    // Winter is days 21 to 27 of each 28-day year.
    let nights = 0;
    let lit = 0;
    for (let day = 0; day < 2_800; day++) {
      const winter = day % 28 >= 21;
      expect(townAurora(day * TOWN_DAY_LENGTH + 300)).toBe(false);
      const aurora = townAurora(day * TOWN_DAY_LENGTH + 800);
      if (!winter) expect(aurora).toBe(false);
      else {
        nights++;
        if (aurora) lit++;
      }
    }
    expect(lit / nights).toBeGreaterThan(0.25);
    expect(lit / nights).toBeLessThan(0.42);
  });

  it("lets a star fall now and then on a clear night, never by day or in a storm", () => {
    let falling = 0;
    for (let t = 0; t < 1_000 * TOWN_DAY_LENGTH; t += 37) {
      const star = townFallingStar(t);
      if (!star) continue;
      falling++;
      expect(townClock(t).phase).toBe("night");
      expect(townStorm(t)).toBe(false);
      expect(star.y).toBeLessThan(12);
    }
    expect(falling).toBeGreaterThan(0);
  });
});

describe("townFeast", () => {
  it("holds a feast on the first day of each season, and no other", () => {
    expect(townFeast(0)).toBe("Sowing Feast");
    expect(townFeast(999)).toBe("Sowing Feast");
    expect(townFeast(1_000)).toBeUndefined();
    expect(townFeast(7_500)).toBe("Midsummer Fair");
    expect(townFeast(14_000)).toBe("Harvest Home");
    expect(townFeast(21_000)).toBe("Yule Feast");
    expect(townFeast(27_999)).toBeUndefined();
  });
});

describe("claimSpot", () => {
  it("gives each tile to one creep and frees a tile its holder stopped using", () => {
    const a = folk("a", 10, 10);
    const b = folk("b", 10, 10);
    expect(claimSpot(a as unknown as Creep, ["5,5"])).toBe("5,5");
    expect(claimSpot(b as unknown as Creep, ["5,5"])).toBeNull();

    // Two ticks on without a's claim being used, it has lapsed.
    (g.Game as { time: number }).time += 2;
    expect(claimSpot(b as unknown as Creep, ["5,5"])).toBe("5,5");
  });
});

describe("militia", () => {
  it("stands the watch by day and goes to bed at night", () => {
    const m = folk("m", 25, 25);
    runTownsfolk(m as unknown as Creep);
    expect(TOWN_MEM.posts).toContain(movedTo(m));

    (g.Game as { time: number }).time = NIGHT;
    m.moveTo.mockClear();
    runTownsfolk(m as unknown as Creep);
    const bed = movedTo(m)!;
    const [x, y] = bed.split(",").map(Number);
    expect(x).toBeGreaterThanOrEqual(31);
    expect(x).toBeLessThanOrEqual(33);
    expect(y).toBeGreaterThanOrEqual(31);
    expect(y).toBeLessThanOrEqual(33);
  });

  it("leaves the watch for the square on a feast day, and still runs to the walls for raiders", () => {
    (g.Game as { time: number }).time = 7 * TOWN_DAY_LENGTH + 200;
    const m = folk("m", 25, 25);
    runTownsfolk(m as unknown as Creep);
    expect(TOWN_MEM.square).toContain(movedTo(m));

    ramparts = [{ structureType: "rampart", pos: { x: 20, y: 11 } }];
    hostiles = [{ pos: { x: 22, y: 9 }, hits: 500 }];
    m.moveTo.mockClear();
    runTownsfolk(m as unknown as Creep);
    expect(movedTo(m)).toBe("20,11");
  });

  it("runs to the rampart nearest the raiders and shoots anything in reach", () => {
    ramparts = ["20,11", "21,11", "22,11", "20,12"].map((k) => {
      const [x, y] = k.split(",").map(Number);
      return { structureType: "rampart", pos: { x, y } };
    });
    const raider = { pos: { x: 24, y: 10 }, hits: 500 };
    hostiles = [raider];
    const m = folk("m", 22, 13);
    runTownsfolk(m as unknown as Creep);

    expect(m.rangedAttack).toHaveBeenCalledWith(raider);
    expect(movedTo(m)).toBe("22,11");
    expect(m.say).toHaveBeenCalledWith("To arms!", true);
  });

  // A walled ring around 10..30 x 10..30, with the castle at 20,20.
  function walledRoom() {
    const ring: string[] = [];
    for (let i = 10; i <= 30; i++) ring.push(`${i},10`, `${i},30`);
    for (let i = 11; i < 30; i++) ring.push(`10,${i}`, `30,${i}`);
    Object.assign(room.memory as object, { perimeterTiles: ring, castleAnchor: { x: 20, y: 20 } });
    room.getTerrain = () => ({ get: () => 0 });
  }

  it("shoots over the wall from inside it when no rampart is in bow range", () => {
    walledRoom();
    ramparts = [{ structureType: "rampart", pos: { x: 30, y: 20 } }];
    const raider = { pos: { x: 20, y: 9 }, hits: 500 };
    hostiles = [raider];
    const m = folk("m", 20, 15);
    runTownsfolk(m as unknown as Creep);

    const [x, y] = movedTo(m)!.split(",").map(Number);
    expect(y).toBe(11);
    expect(Math.max(Math.abs(x - 20), Math.abs(y - 9))).toBeLessThanOrEqual(3);
  });

  it("still takes a door in bow range over open ground", () => {
    walledRoom();
    ramparts = [{ structureType: "rampart", pos: { x: 22, y: 10 } }];
    hostiles = [{ pos: { x: 20, y: 9 }, hits: 500 }];
    const m = folk("m", 20, 15);
    runTownsfolk(m as unknown as Creep);

    expect(movedTo(m)).toBe("22,10");
  });

  it("bars itself in a bed when every rampart is taken", () => {
    hostiles = [{ pos: { x: 22, y: 5 }, hits: 500 }];
    const m = folk("m", 30, 25);
    runTownsfolk(m as unknown as Creep);
    const [x, y] = movedTo(m)!.split(",").map(Number);
    expect(x).toBeGreaterThanOrEqual(31);
    expect(y).toBeGreaterThanOrEqual(31);
  });
});

describe("nextTownJob", () => {
  function buildBeds(n: number) {
    const beds = ["31,31", "32,31", "33,31", "31,32", "32,32", "33,32", "31,33", "32,33", "33,33"];
    ramparts = beds.slice(0, n).map((k) => {
      const [x, y] = k.split(",").map(Number);
      return { structureType: "rampart", pos: { x, y } };
    });
  }

  it("raises one militiaman per built bed, up to the RCL cap", () => {
    buildBeds(2);
    expect(nextTownJob(room as unknown as Room)).toEqual({ job: "militia" });
    folk("a", 31, 31);
    folk("b", 32, 31);
    expect(nextTownJob(room as unknown as Room)).toBeNull();

    buildBeds(9);
    for (const n of ["c", "d", "e", "f", "g", "h"]) folk(n, 31, 32);
    expect(TOWN.militiaByRcl[7]).toBe(8);
    expect(nextTownJob(room as unknown as Room)).toBeNull();
  });

  it("raises nobody while storage is under the gate or the empire is recovering", () => {
    buildBeds(9);
    (room.storage as { store: { energy: number } }).store.energy = TOWN.storageGate - 1;
    expect(nextTownJob(room as unknown as Room)).toBeNull();

    (room.storage as { store: { energy: number } }).store.energy = 500_000;
    g.Memory = { creeps: {}, empire: { posture: "RECOVER", updatedAt: 0 } };
    expect(nextTownJob(room as unknown as Room)).toBeNull();
  });
});

describe("lookoutTargets", () => {
  it("skips our own rooms, other players' rooms, keeper rooms and worked remotes", () => {
    g.Game = {
      time: DAY,
      creeps: {},
      rooms: { W2N1: { controller: { my: true } } },
      map: {
        describeExits: () => ({ 1: "W1N2", 3: "W2N1", 5: "W5N5", 7: "W0N1" }),
      },
    };
    g.Memory = { creeps: {}, intel: { W0N1: { owner: "rival" } } };
    expect(lookoutTargets(room as unknown as Room, new Set())).toEqual(["W1N2"]);
    expect(lookoutTargets(room as unknown as Room, new Set(["W1N2"]))).toEqual([]);
  });
});

describe("lookout", () => {
  function lookoutIn(controller: object | undefined) {
    const target = { name: "W1N2", controller, find: () => [] };
    const c = folk("l", 25, 45, { job: "lookout", targetRoom: "W1N2", lookoutPos: "25,46" });
    (c as { room: unknown }).room = target;
    return c;
  }

  it("keeps its post in an empty neighbour", () => {
    const l = lookoutIn(undefined);
    runTownsfolk(l as unknown as Creep);
    expect(l.memory.retreatUntil).toBeUndefined();
    expect(movedTo(l)).toBe("25,46");
  });

  it("runs home from a room another player has claimed", () => {
    const l = lookoutIn({ my: false, owner: { username: "rival" } });
    runTownsfolk(l as unknown as Creep);
    expect(l.memory.retreatUntil).toBe(DAY + 300);
    expect(l.say).toHaveBeenCalledWith("Raiders!", true);
    const home = l.moveTo.mock.calls[0][0] as { roomName: string };
    expect(home.roomName).toBe("W1N1");
  });
});
