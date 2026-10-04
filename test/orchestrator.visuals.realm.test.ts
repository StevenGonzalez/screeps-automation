import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_MY_STRUCTURES = 108;
g.FIND_MY_CREEPS = 102;
g.FIND_MY_SPAWNS = 112;
g.FIND_MY_CONSTRUCTION_SITES = 114;
g.STRUCTURE_SPAWN = "spawn";
g.STRUCTURE_TOWER = "tower";
g.TERRAIN_MASK_WALL = 1;
g.RoomPosition = class {
  constructor(public x: number, public y: number, public roomName: string) {}
};

import {
  describeCensus,
  drawAurora,
  drawCamp,
  drawDragon,
  drawGraves,
  drawLandmarks,
  drawMoon,
  drawRealmMap,
  drawSeason,
  drawSky,
  drawTown,
} from "../src/orchestrators/orchestrator.visuals";
import { townDragon } from "../src/services/services.town";
import { armsColours } from "../src/services/services.heraldry";
import {
  ROLE_FILLER,
  ROLE_HAULER,
  ROLE_KNIGHT,
  ROLE_MINSTREL,
  ROLE_REMOTE_HAULER,
  ROLE_REMOTE_MINER,
  ROLE_TOWNSFOLK,
} from "../src/config/config.roles";

const HOME = "W1N1";

type Drawn = { kind: string; args: unknown[] };
let drawn: Drawn[];

function creep(role: string, roomName: string, targetRoom?: string): Creep {
  return {
    name: `${role}${Math.random()}`,
    room: { name: roomName },
    memory: { role, homeRoom: HOME, targetRoom },
  } as unknown as Creep;
}

function world(creeps: Creep[], remoteRooms: Partial<RemoteRoomData>[] = []): Room {
  const room = {
    name: HOME,
    controller: { my: true, level: 6 },
    memory: { remoteRooms },
  } as unknown as Room;
  const byName: Record<string, Creep> = {};
  for (const c of creeps) byName[c.name] = c;
  const record = (kind: string) => (...args: unknown[]) => {
    drawn.push({ kind, args });
  };
  g.Game = {
    time: 1000,
    creeps: byName,
    rooms: { [HOME]: room },
    map: { visual: { text: record("text"), line: record("line"), circle: record("circle"), poly: record("poly") } },
  };
  g.Memory = { rooms: { [HOME]: { townName: "Ravenhold" } } };
  return room;
}

beforeEach(() => {
  drawn = [];
});

describe("census", () => {
  it("counts the castle's people by title, home and abroad", () => {
    const room = world([
      creep(ROLE_HAULER, HOME),
      creep(ROLE_HAULER, HOME),
      creep(ROLE_FILLER, HOME),
      creep(ROLE_TOWNSFOLK, HOME),
      // A merchant bringing its load home still serves abroad.
      creep(ROLE_REMOTE_HAULER, HOME, "W2N1"),
      creep(ROLE_KNIGHT, "W2N1", "W2N1"),
    ]);

    expect(describeCensus(room)).toEqual(["2 Porters · 1 Barmaid", "1 Dragon Knight · 1 Merchant"]);
  });
});

describe("realm map", () => {
  it("names the castle and draws a road to each remote its peddlers work", () => {
    world(
      [creep(ROLE_REMOTE_MINER, "W2N1", "W2N1")],
      [
        { roomName: "W2N1", hostile: false, sources: [] },
        { roomName: "W1N2", hostile: false, sources: [] },
      ]
    );

    drawRealmMap();

    const texts = drawn.filter((d) => d.kind === "text").map((d) => d.args[0]);
    expect(texts).toContain("Ravenhold");
    expect(texts).toContain("vendors");
    const lines = drawn.filter((d) => d.kind === "line");
    expect(lines).toHaveLength(1);
    expect((lines[0].args[1] as RoomPosition).roomName).toBe("W2N1");
  });

  it("names the rival who holds a remote the vendors keep away from", () => {
    world(
      [creep(ROLE_REMOTE_MINER, "W2N1", "W2N1")],
      [
        { roomName: "W2N1", hostile: true, hostileUntil: 2000, rival: "Oleksii", sources: [] },
        // Held once, but the hold has lapsed.
        { roomName: "W1N2", hostile: true, hostileUntil: 900, rival: "Mordred", sources: [] },
        { roomName: "W0N1", hostile: true, hostileUntil: 2000, sources: [] },
      ]
    );

    drawRealmMap();

    const texts = drawn.filter((d) => d.kind === "text").map((d) => d.args[0]);
    expect(texts).toContain("held by Oleksii");
    expect(texts).toContain("held by strangers");
    expect(texts.some((t) => String(t).includes("Mordred"))).toBe(false);
    // The road is drawn only to the remote a peddler still works.
    expect(drawn.filter((d) => d.kind === "line")).toHaveLength(1);
  });

  it("shows each castle's level and the gold in its treasury", () => {
    const room = world([]);
    drawRealmMap();
    expect(drawn.map((d) => d.args[0])).toContain("RCL 6");

    drawn = [];
    (room as unknown as { storage: unknown }).storage = { store: { energy: 34_670 } };
    drawRealmMap();
    expect(drawn.map((d) => d.args[0])).toContain("RCL 6 · 34.7K gold");
  });

  it("marks a raided remote and the keep being saved for", () => {
    world(
      [creep(ROLE_REMOTE_MINER, "W2N1", "W2N1")],
      [{ roomName: "W2N1", hostile: false, invaderUntil: 1500, sources: [] }]
    );
    (g.Memory as Memory).expansionSavings = { room: HOME, target: "W1N2" };

    drawRealmMap();

    const texts = drawn.filter((d) => d.kind === "text").map((d) => d.args[0]);
    expect(texts).toContain("raided");
    expect(texts).toContain("Shadow March");
    expect(texts).toContain("keep planned");
    expect(drawn.filter((d) => d.kind === "circle")).toHaveLength(1);
  });

  it("stops drawing a remote as a vendors' road once it is claimed as a keep", () => {
    world(
      [creep(ROLE_REMOTE_MINER, "W2N1", "W2N1")],
      [{ roomName: "W2N1", hostile: false, sources: [] }]
    );
    (g.Game as { rooms: Record<string, unknown> }).rooms.W2N1 = {
      name: "W2N1",
      controller: { my: true, level: 1 },
      memory: {},
    };

    drawRealmMap();

    const texts = drawn.filter((d) => d.kind === "text").map((d) => d.args[0]);
    expect(texts).not.toContain("vendors");
    expect(texts).toContain("RCL 1");
    expect(drawn.filter((d) => d.kind === "line")).toHaveLength(0);
  });

  it("shows how far the keep being founded has come", () => {
    world([]);
    let spawns: unknown[] = [];
    const sites = [{ structureType: "spawn", progress: 5_250, progressTotal: 15_000 }];
    const keep = { name: "W2N1", controller: { my: true, level: 1 }, memory: {}, find: (type: number) => (type === g.FIND_MY_SPAWNS ? spawns : sites) };
    (g.Game as { rooms: Record<string, unknown> }).rooms.W2N1 = keep;
    (g.Memory as Memory).expansion = { roomName: "W2N1", homeRoom: HOME, phase: "bootstrapping", startedAt: 0 } as Memory["expansion"];
    const label = () => {
      drawn = [];
      drawRealmMap();
      return drawn.filter((d) => d.kind === "text").map((d) => d.args[0] as string).find((t) => t.startsWith("keep"));
    };
    expect(label()).toBe("keep: barracks 35%");
    spawns = [{}];
    keep.controller.level = 2;
    expect(label()).toBe("keep: growing, RCL 2");
  });
});

describe("town at night", () => {
  it("lights a torch on every watch post and a brazier on every tower after dark, and none by day", () => {
    const record = (kind: string) => (...args: unknown[]) => drawn.push({ kind, args });
    const tower = { structureType: "tower", pos: { x: 20, y: 20 } };
    const room = {
      name: HOME,
      visual: { text: record("text"), rect: record("rect"), circle: record("circle"), poly: record("poly"), line: record("line") },
      memory: { town: { posts: ["10,10", "12,10", "14,10"], square: [], cottages: [] } },
      find: () => [tower],
    } as unknown as Room;
    const torches = (time: number) => {
      drawn = [];
      g.Game = { time, creeps: {}, rooms: {} };
      drawSky(room);
      drawTown(room);
      // The moon hangs in the north-east corner, well clear of the posts.
      return drawn.filter((d) => d.kind === "circle" && (d.args[0] as number) < 40).length;
    };
    expect(torches(3_300)).toBe(0);
    // Two circles to a torch, and two to the brazier.
    expect(torches(3_800)).toBe(8);

    // Every post flies the castle's colours; nobody stands there, so the
    // pennants are furled. The moon is a poly too, off in the corner.
    const pennants = drawn
      .filter((d) => d.kind === "poly" && (d.args[0] as Array<[number, number]>)[0][0] < 40)
      .map((d) => d.args[1] as PolyStyle);
    expect(pennants).toHaveLength(3);
    for (const p of pennants) expect(p).toMatchObject({ stroke: armsColours(HOME).other, fill: "transparent" });
  });

  it("darkens a young keep with no town yet, and lights its tower, under the same sky", () => {
    const record = (kind: string) => (...args: unknown[]) => drawn.push({ kind, args });
    const tower = { structureType: "tower", pos: { x: 20, y: 20 } };
    const room = {
      name: HOME,
      visual: { text: record("text"), rect: record("rect"), circle: record("circle"), poly: record("poly"), line: record("line") },
      memory: {},
      find: () => [tower],
    } as unknown as Room;
    g.Game = { time: 3_800, creeps: {}, rooms: {} };
    drawSky(room);
    drawTown(room);
    expect(drawn.filter((d) => d.kind === "rect")).toHaveLength(1);
    expect(drawn.filter((d) => d.kind === "circle" && (d.args[0] as number) < 40)).toHaveLength(2);
  });

  it("pitches a pilgrims' camp round a young keep's barracks, its fire lit after dark", () => {
    const record = (kind: string) => (...args: unknown[]) => drawn.push({ kind, args });
    const spawn = { pos: { x: 20, y: 20 } };
    const room = {
      name: HOME,
      visual: { text: record("text"), rect: record("rect"), circle: record("circle"), poly: record("poly"), line: record("line") },
      memory: {},
      // The tile two south of the barracks is rock, so the fire moves along.
      getTerrain: () => ({ get: (x: number, y: number) => (x === 20 && y === 22 ? 1 : 0) }),
      find: (type: number) => (type === g.FIND_MY_SPAWNS ? [spawn] : []),
    } as unknown as Room;
    const camp = (time: number) => {
      drawn = [];
      g.Game = { time, creeps: {}, rooms: {} };
      drawCamp(room);
      return drawn;
    };
    const night = camp(3_800);
    expect(night.filter((d) => d.kind === "poly")).toHaveLength(3);
    const fire = night.filter((d) => d.kind === "circle");
    expect(fire).toHaveLength(2);
    expect(fire[0].args.slice(0, 2)).toEqual([18, 22]);
    expect(night.some((d) => d.kind === "text" && d.args[0] === "Pilgrims' Camp")).toBe(true);
    expect(camp(3_300).filter((d) => d.kind === "circle")).toHaveLength(1);

    // A keep with a town has no camp.
    (room.memory as RoomMemory).town = { posts: [], square: [], cottages: [] };
    expect(camp(3_800)).toHaveLength(0);
  });

  it("hangs the moon in the sky after dark, lit as it is tonight", () => {
    const record = (kind: string) => (...args: unknown[]) => drawn.push({ kind, args });
    const v = { circle: record("circle"), poly: record("poly") } as unknown as RoomVisual;
    drawMoon(v, 0);
    expect(drawn.map((d) => d.kind)).toEqual(["circle"]);
    drawn = [];
    drawMoon(v, 2);
    expect(drawn.map((d) => d.kind)).toEqual(["circle", "poly"]);
    drawn = [];
    // The full moon glows.
    drawMoon(v, 4);
    expect(drawn.map((d) => d.kind)).toEqual(["circle", "poly", "circle"]);
  });

  it("draws the northern lights as three ribbons, faint at nightfall and bright later", () => {
    const record = (kind: string) => (...args: unknown[]) => drawn.push({ kind, args });
    const v = { poly: record("poly") } as unknown as RoomVisual;
    const opacities = (time: number) => {
      drawn = [];
      drawAurora(v, time);
      return drawn.map((d) => (d.args[1] as PolyStyle).opacity);
    };
    expect(opacities(21_701)).toHaveLength(3);
    expect(opacities(21_701)[0]).toBeLessThan(0.01);
    expect(opacities(21_850)[0]).toBeCloseTo(0.16);
  });

  it("has a wolf howl out of the dark on a full-moon night", () => {
    const record = (kind: string) => (...args: unknown[]) => drawn.push({ kind, args });
    const room = {
      name: HOME,
      visual: { text: record("text"), rect: record("rect"), circle: record("circle"), poly: record("poly"), line: record("line") },
      memory: {},
      find: () => [],
    } as unknown as Room;
    const howls = (time: number) => {
      drawn = [];
      g.Game = { time, creeps: {}, rooms: {} };
      drawSky(room);
      return drawn.filter((d) => d.kind === "text" && d.args[0] === "Awoo-oo!").length;
    };
    expect(howls(4_702)).toBe(1);
    expect(howls(4_720)).toBe(0);
    expect(howls(3_702)).toBe(0);
  });
});

describe("dragon", () => {
  it("draws a dragon and its shadow while one is overhead, and nothing otherwise", () => {
    let start = 0;
    while (townDragon(start)?.t !== 0) start++;
    const record = (kind: string) => (...args: unknown[]) => drawn.push({ kind, args });
    const room = {
      name: HOME,
      visual: { circle: record("circle"), poly: record("poly"), line: record("line") },
    } as unknown as Room;
    drawDragon(room, start + 20);
    // Two wings and a body, the same again for the shadow, and two eyes.
    expect(drawn.filter((d) => d.kind === "poly")).toHaveLength(6);
    expect(drawn.filter((d) => d.kind === "circle")).toHaveLength(2);
    drawn = [];
    drawDragon(room, start - 1);
    expect(drawn).toEqual([]);
  });
});

describe("minstrel's song", () => {
  it("hangs the couplet being sung over the square while the minstrel is there", () => {
    const record = (kind: string) => (...args: unknown[]) => drawn.push({ kind, args });
    const minstrel = { pos: { x: 25, y: 24 }, memory: { role: ROLE_MINSTREL } };
    let folk: unknown[] = [minstrel];
    const room = {
      name: HOME,
      controller: { my: true },
      visual: { text: record("text"), rect: record("rect"), circle: record("circle"), poly: record("poly"), line: record("line") },
      memory: { town: { posts: [], square: ["25,24"], fountain: "25,25", cottages: [] } },
      find: () => folk,
    } as unknown as Room;
    // Ticks 0-999 are the Sowing Feast; tick 1225 is an ordinary day.
    const sung = (time: number) => {
      drawn = [];
      g.Game = { time, creeps: {}, rooms: { [HOME]: room } };
      g.Memory = { rooms: { [HOME]: { townName: "Ravenhold" } } };
      drawTown(room);
      return drawn.filter((d) => d.kind === "text").map((d) => d.args[0] as string);
    };
    // The ballad has four couplets here: the castle, the feast, the raiders
    // and the Crown. Tick 225 is the tenth couplet sung, so the feast's.
    expect(sung(225)).toEqual(expect.arrayContaining([
      "Sow the barley, sow the rye,",
      "the Sowing Feast drinks the cellars dry!",
      "♪",
    ]));
    expect(sung(1225)).not.toContain("♪");
    folk = [];
    expect(sung(225)).not.toContain("♪");
  });
});

describe("landmarks", () => {
  it("labels the castle's works by their names in the realm, the labs once for all", () => {
    const at = (structureType: string, x: number, y: number, extra = {}) => ({ structureType, pos: { x, y }, ...extra });
    const structures = [
      at("storage", 20, 20, { store: { energy: 31_400 } }),
      at("tower", 18, 22),
      at("tower", 22, 22),
      at("lab", 30, 30),
      at("lab", 31, 30),
      at("lab", 32, 31),
      at("extension", 10, 10),
      at("road", 11, 10),
    ];
    const visual = {
      text: (...args: unknown[]) => drawn.push({ kind: "text", args }),
      poly: (...args: unknown[]) => drawn.push({ kind: "poly", args }),
    };
    const room = {
      name: HOME,
      visual,
      controller: { pos: { x: 5, y: 5 } },
      find: (type: number) => (type === g.FIND_MY_STRUCTURES ? structures : []),
    } as unknown as Room;

    drawLandmarks(room);

    // The castle's arms hang over the throne.
    const arms = drawn.filter((d) => d.kind === "poly").map((d) => d.args[0] as Array<[number, number]>);
    expect(arms.length).toBeGreaterThanOrEqual(2);
    for (const pts of arms) for (const [x, y] of pts) expect(Math.hypot(x - 5, y - 3.25)).toBeLessThan(1);
    const texts = drawn.filter((d) => d.kind === "text").map((d) => d.args[0]);
    expect(texts).toContain("Treasury · 31.4K gold");
    expect(texts.filter((t) => t === "Watchtower")).toHaveLength(2);
    expect(texts.filter((t) => t === "Alchemy Labs")).toHaveLength(1);
    expect(texts).toContain("Throne");
    expect(texts).toHaveLength(5);
  });

  it("draws a work still being built in scaffolding with how far it has come", () => {
    const sites = [
      { structureType: "spawn", pos: { x: 22, y: 24 }, progress: 1650, progressTotal: 15_000 },
      { structureType: "road", pos: { x: 21, y: 25 }, progress: 5, progressTotal: 300 },
    ];
    const record = (kind: string) => (...args: unknown[]) => drawn.push({ kind, args });
    const room = {
      name: HOME,
      visual: { text: record("text"), rect: record("rect"), line: record("line") },
      find: (type: number) => (type === g.FIND_MY_CONSTRUCTION_SITES ? sites : []),
    } as unknown as Room;

    drawLandmarks(room);

    expect(drawn.filter((d) => d.kind === "text").map((d) => d.args[0])).toEqual(["Barracks rising · 11%"]);
    expect(drawn.filter((d) => d.kind === "rect")).toHaveLength(2);
    expect(drawn.filter((d) => d.kind === "line")).toHaveLength(2);
  });
});

describe("graves", () => {
  it("marks the tombstones of ours with their names, and no one else's", () => {
    const tombs = [
      { pos: { x: 10, y: 12 }, creep: { my: true, name: "Merchant Leofric" } },
      { pos: { x: 30, y: 30 }, creep: { my: false, name: "Invader123" } },
    ];
    const visual = {
      text: (...args: unknown[]) => drawn.push({ kind: "text", args }),
      line: (...args: unknown[]) => drawn.push({ kind: "line", args }),
    };
    const room = {
      name: "W2N1",
      visual,
      find: (_type: number, opts?: { filter: (t: unknown) => boolean }) => tombs.filter(opts?.filter ?? (() => true)),
    } as unknown as Room;

    drawGraves(room);

    expect(drawn.filter((d) => d.kind === "text").map((d) => d.args[0])).toEqual(["Merchant Leofric"]);
    expect(drawn.filter((d) => d.kind === "line")).toHaveLength(2);
  });
});

describe("seasons", () => {
  function townRoom(): Room {
    const visual = {
      text: (...args: unknown[]) => drawn.push({ kind: "text", args }),
      line: (...args: unknown[]) => drawn.push({ kind: "line", args }),
      rect: (...args: unknown[]) => drawn.push({ kind: "rect", args }),
      circle: (...args: unknown[]) => drawn.push({ kind: "circle", args }),
      poly: (...args: unknown[]) => drawn.push({ kind: "poly", args }),
    };
    return { name: HOME, visual, memory: { town: { fountain: "25,25" } } } as unknown as Room;
  }

  it("brings rain on a storm day in place of the season's drift, and lightning now and then", () => {
    // Day 2 is a storm day in spring; day 3 is a fair one.
    drawSeason(townRoom(), 3_500);
    expect(drawn.filter((d) => d.kind === "line")).toHaveLength(0);
    expect(drawn.filter((d) => d.kind === "circle").length).toBeGreaterThan(0);

    drawn = [];
    drawSeason(townRoom(), 2_500);
    const rain = drawn.filter((d) => d.kind === "line");
    expect(rain.length).toBeGreaterThan(20);
    for (const r of rain) {
      const [x, y] = r.args as number[];
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(50);
      expect(y).toBeGreaterThanOrEqual(-1);
      expect(y).toBeLessThan(51);
    }
    expect(drawn.filter((d) => d.kind === "circle")).toHaveLength(0);
    expect(drawn.filter((d) => d.kind === "poly")).toHaveLength(0);

    // Lightning strikes on some ticks of a storm day.
    let strikes = 0;
    for (let t = 2_000; t < 3_000; t++) {
      drawn = [];
      drawSeason(townRoom(), t);
      if (drawn.some((d) => d.kind === "poly")) strikes++;
    }
    expect(strikes).toBeGreaterThan(10);
    expect(strikes).toBeLessThan(60);
  });

  it("lets snow fall over the castle in winter, inside the room", () => {
    drawSeason(townRoom(), 21_500);
    const flakes = drawn.filter((d) => d.kind === "circle");
    expect(flakes.length).toBeGreaterThan(10);
    for (const f of flakes) {
      const [x, y] = f.args as number[];
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(50);
      expect(y).toBeGreaterThanOrEqual(-1);
      expect(y).toBeLessThan(51);
    }
  });

  it("brings out fireflies by the fountain on a summer night, and nothing on a summer day", () => {
    drawSeason(townRoom(), 8_300);
    expect(drawn).toHaveLength(0);
    drawSeason(townRoom(), 8_800);
    expect(drawn.filter((d) => d.kind === "circle").length).toBeGreaterThan(0);
  });

  it("hangs a garland of lanterns round the fountain on a feast day", () => {
    drawSeason(townRoom(), 7_300);
    const lanterns = drawn.filter((d) => d.kind === "circle");
    expect(lanterns.length).toBeGreaterThanOrEqual(8);
    for (const l of lanterns) {
      const [x, y] = l.args as number[];
      expect(Math.hypot(x - 25, y - 25)).toBeLessThan(4);
    }
    expect(drawn.some((d) => d.kind === "text" && d.args[0] === "Midsummer Fair")).toBe(true);
  });
});
