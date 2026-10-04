import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_MY_CREEPS = 102;
g.FIND_MY_STRUCTURES = 108;
g.MOVE = "move";
g.OK = 0;

class FakePos {
  constructor(public x: number, public y: number, public roomName: string) {}
}
g.RoomPosition = FakePos;

const { trackedSpawn } = vi.hoisted(() => ({ trackedSpawn: vi.fn(() => 0) }));
vi.mock("../src/orchestrators/orchestrator.spawning.shared", () => ({ trackedSpawn }));
vi.mock("../src/orchestrators/orchestrator.spawning.remote", () => ({ getPickedRemoteRoomNames: () => new Set() }));
vi.mock("../src/services/services.creep", () => ({ isEnergyEmergency: () => false }));

import { ballad, runMinstrel } from "../src/roles/role.minstrel";
import { spawnTownsfolk, wantsMinstrel } from "../src/orchestrators/orchestrator.spawning.town";
import { castleName, wildsName } from "../src/services/services.chronicle";
import { ROLE_MINSTREL, ROLE_TOWNSFOLK } from "../src/config/config.roles";
import { TOWN_DAY_LENGTH } from "../src/config/config.town";

// Day 0 of each season is its feast; day 1 is an ordinary day.
const FEAST_DAY = 200;
const FEAST_NIGHT = 800;
const ORDINARY_DAY = TOWN_DAY_LENGTH + 200;

// A square of eight tiles round a fountain at 25,25.
const SQUARE = ["24,24", "25,24", "26,24", "24,25", "26,25", "24,26", "25,26", "26,26"];

let room: Record<string, unknown>;

function makeRoom(name = "W1N1") {
  return {
    name,
    controller: { my: true, level: 4 },
    storage: { store: { energy: 100_000 } },
    memory: { town: { posts: [], square: [...SQUARE], fountain: "25,25", cottages: [] } },
    find: () => [],
  };
}

function minstrel(x = 25, y = 24) {
  const c = {
    name: "Minstrel Aldric",
    room,
    pos: { x, y, roomName: "W1N1" },
    memory: { role: ROLE_MINSTREL, homeRoom: "W1N1" } as CreepMemory,
    moveTo: vi.fn(),
    say: vi.fn(),
    suicide: vi.fn(),
  };
  (g.Game as { creeps: Record<string, unknown> }).creeps[c.name] = c;
  return c;
}

beforeEach(() => {
  room = makeRoom();
  g.Game = { time: FEAST_DAY, creeps: {}, rooms: { W1N1: room } };
  g.Memory = { creeps: {}, rooms: {} };
  trackedSpawn.mockClear();
});

describe("ballad", () => {
  it("sings of the castle, the feast, the other castles and the season's annals", () => {
    g.Game = { time: FEAST_DAY, creeps: {}, rooms: { W1N1: room, W2N1: makeRoom("W2N1") } };
    g.Memory = { creeps: {}, rooms: {}, annals: { since: 0, gold: 12_000, slain: 3, fallen: 1, recruits: 40 } };
    const lines = ballad(room as unknown as Room, FEAST_DAY).map((v) => v.join(" "));
    expect(lines[0]).toBe(`Sing of ${castleName("W1N1")}, its walls of stone, that bow to none but the Crown alone!`);
    expect(lines).toContain("Sow the barley, sow the rye, the Sowing Feast drinks the cellars dry!");
    expect(lines.some((l) => l.includes(`the banners of ${castleName("W2N1")} stand row on row!`))).toBe(true);
    expect(lines).toContain("3 raiders came to steal our gold; now they lie in the earth so cold!");
    expect(lines).toContain("12.0K gold the mines have brought, and not a coin of it for naught!");
    expect(lines).toContain("40 recruits marched out the barracks door, to serve the Crown as those before!");
    expect(lines).toContain("Pour one out for the one we lost, who held the line and paid the cost.");
    expect(lines[lines.length - 1]).toBe("Raise a cup to the Crown so high, whose banners over 2 castles fly!");
  });

  it("sings of the realm's greatest slayer and richest merchant once it has them", () => {
    const sung = () => ballad(room as unknown as Room, FEAST_DAY).map((v) => v.join(" "));
    expect(sung().some((l) => l.startsWith("Of "))).toBe(false);

    g.Memory = {
      creeps: {},
      rooms: {},
      greatestSlayer: { name: "Dragon Knight Edric", kills: 4 },
      richestHaul: 40_500,
      richestHauler: "Merchant Ada",
    };
    expect(sung()).toContain("Of Dragon Knight Edric let the minstrels sing, who slew 4 foes for Crown and King!");
    expect(sung()).toContain(
      "Of Merchant Ada, who walked the vendors' road and brought home 40.5K gold, the richest load!"
    );
  });

  it("sings of the last warband broken and of this castle's richest road", () => {
    g.Memory = {
      creeps: {},
      rooms: {},
      lastRout: { band: "Grask One-Eye", room: "W2N1", slayer: "Dragon Knight Edric" },
      roadGold: { "W1N1>W2N1": 12_000, "W1N1>W3N1": 64_200, "W5N5>W4N1": 900_000 },
    };
    const sung = () => ballad(room as unknown as Room, ORDINARY_DAY).map((v) => v.join(" "));
    expect(sung()).toContain("Grask One-Eye came for our gold and grain; Dragon Knight Edric left the warband slain!");
    expect(sung()).toContain(`Down the road from the ${wildsName("W3N1")} wild, 64.2K gold our merchants piled!`);

    (g.Memory as Memory).lastRout = { band: "Grask One-Eye", room: "W2N1" };
    expect(sung()).toContain(`Grask One-Eye came for our gold and grain; in the ${wildsName("W2N1")} the band lies slain!`);
  });

  it("sings of the quiet when no raider came and leaves out what the scribes have not counted", () => {
    const lines = ballad(room as unknown as Room, ORDINARY_DAY).map((v) => v.join(" "));
    expect(lines).toContain("No raider came to our gates this spring; they fear our archers, and with reason!");
    expect(lines.some((l) => l.includes("gold the mines"))).toBe(false);
    expect(lines.some((l) => l.includes("Pour one out"))).toBe(false);
    expect(lines.some((l) => l.includes("barracks door"))).toBe(false);
    expect(lines.some((l) => l.includes("Sowing Feast"))).toBe(false);
    expect(lines[lines.length - 1]).toBe("Raise a cup to the Crown so high, whose banners over 1 castle fly!");
  });
});

describe("runMinstrel", () => {
  it("walks round the fountain a step every ten ticks", () => {
    // Tick 200 is step 20 of the round, the fifth of eight tiles going clockwise
    // from the top left: the bottom right.
    const c = minstrel();
    runMinstrel(c as unknown as Creep);
    expect(c.memory.townSpot).toBe("26,26");
    expect(c.moveTo).toHaveBeenCalledWith(expect.objectContaining({ x: 26, y: 26 }), expect.anything());
  });

  it("passes a tile someone else is standing on", () => {
    // Who stands where is worked out once a tick, so this needs a tick of its
    // own; tick 280 is the same step of the round as tick 200.
    (g.Game as { time: number }).time = FEAST_DAY + 80;
    const yeoman = { name: "Yeoman Bertram", room, memory: { role: ROLE_TOWNSFOLK, townSpot: "26,26", townSpotTick: FEAST_DAY + 80 } };
    (g.Game as { creeps: Record<string, unknown> }).creeps[yeoman.name] = yeoman;
    const c = minstrel();
    runMinstrel(c as unknown as Creep);
    expect(c.memory.townSpot).toBe("25,26");
  });

  it("hums every few ticks for anyone passing", () => {
    const c = minstrel();
    runMinstrel(c as unknown as Creep);
    expect(c.say).toHaveBeenCalledWith(expect.stringContaining("♪"), true);
  });

  it("leaves once the feast is over", () => {
    (g.Game as { time: number }).time = ORDINARY_DAY;
    const c = minstrel();
    runMinstrel(c as unknown as Creep);
    expect(c.suicide).toHaveBeenCalled();
    expect(c.moveTo).not.toHaveBeenCalled();
  });
});

describe("wantsMinstrel", () => {
  it("calls one minstrel to a castle with a square on a feast day, by daylight", () => {
    expect(wantsMinstrel(room as unknown as Room)).toBe(true);
    minstrel();
    expect(wantsMinstrel(room as unknown as Room)).toBe(false);
  });

  it("calls none at night, on an ordinary day, or to a castle with no square", () => {
    (g.Game as { time: number }).time = FEAST_NIGHT;
    expect(wantsMinstrel(room as unknown as Room)).toBe(false);
    (g.Game as { time: number }).time = ORDINARY_DAY;
    expect(wantsMinstrel(room as unknown as Room)).toBe(false);
    (g.Game as { time: number }).time = FEAST_DAY;
    delete (room.memory as { town?: unknown }).town;
    expect(wantsMinstrel(room as unknown as Room)).toBe(false);
  });

  it("is raised once the townsfolk are at strength, and the chronicle tells of it", () => {
    expect(spawnTownsfolk(room as unknown as Room, {} as StructureSpawn)).toBe(true);
    expect(trackedSpawn).toHaveBeenCalledWith(room, {}, ["move"], { memory: { role: ROLE_MINSTREL, homeRoom: "W1N1" } });
    const lines = ((g.Memory as { chronicle?: Array<{ text: string }> }).chronicle ?? []).map((l) => l.text);
    expect(lines).toEqual([`A minstrel comes to ${castleName("W1N1")} Square for the Sowing Feast.`]);
  });
});
