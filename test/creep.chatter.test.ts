import { describe, it, expect, vi } from "vitest";

// The creep orchestrator pulls in every role, and some extend game classes
// as they load.
const g = vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  for (const name of ["Creep", "PowerCreep", "Room", "RoomPosition", "Structure"]) g[name] = class {};
  g.FIND_MY_CREEPS = 102;
  g.CREEP_LIFE_TIME = 1500;
  return g;
});

import { chatterLine } from "../src/orchestrators/orchestrator.creep";
import { ROLE_APOTHECARY, ROLE_MINER } from "../src/config/config.roles";
import { TOWN_DAY_LENGTH } from "../src/config/config.town";

// Every line a creep says over a stretch of ticks in the same season.
function linesFrom(
  start: number,
  gossip?: Memory["gossip"],
  ticksToLive?: number,
  alongside: string[] = []
): string[] {
  const miner = {
    name: "Miner Bran",
    memory: { role: ROLE_MINER },
    ticksToLive,
    pos: { findInRange: () => ["Miner Bran", ...alongside].map((name) => ({ name })) },
  } as unknown as Creep;
  const lines: string[] = [];
  g.Memory = { gossip };
  for (let t = start; t < start + 3_000; t++) {
    g.Game = { time: t };
    const line = chatterLine(miner);
    if (line) lines.push(line);
  }
  return lines;
}

describe("chatter", () => {
  it("talks of the weather now and then, and of its own work the rest of the time", () => {
    // Day 23 to 25: winter, no feast.
    const winter = linesFrom(23 * TOWN_DAY_LENGTH);
    const summer = linesFrom(9 * TOWN_DAY_LENGTH);
    expect(winter).toContain("dig dig");
    expect(winter.some((l) => !summer.includes(l))).toBe(true);
    expect(summer.some((l) => !winter.includes(l))).toBe(true);
    for (const l of [...winter, ...summer]) expect(l.length).toBeLessThanOrEqual(10);
  });

  it("talks of the storm on a storm day", () => {
    // Day 19 is a storm day in autumn; its first 33 lines fall on it.
    const storm = linesFrom(19 * TOWN_DAY_LENGTH).slice(0, 33);
    expect(storm.some((l) => ["rain!", "soaked!", "thunder!"].includes(l))).toBe(true);
  });

  it("talks of the realm's news while it is fresh, and of its work still", () => {
    const start = 23 * TOWN_DAY_LENGTH;
    const lines = linesFrom(start, { line: "† Wulfric", until: start + 1_500 });
    const fresh = lines.slice(0, 45);
    const stale = lines.slice(55);
    expect(fresh).toContain("† Wulfric");
    expect(fresh).toContain("dig dig");
    expect(stale).not.toContain("† Wulfric");
    expect((g.Memory as Memory).gossip).toBeUndefined();
  });

  it("talks of the night after dark", () => {
    const day = 23 * TOWN_DAY_LENGTH;
    const night = ["yawn...", "torches!", "so dark", "owls hoot"];
    // Ten lines a night, and the first sixteen of a day fall before dusk.
    expect(linesFrom(day + 700).slice(0, 10).some((l) => night.includes(l))).toBe(true);
    expect(linesFrom(day + 100).slice(0, 16).some((l) => night.includes(l))).toBe(false);
  });

  it("talks of its end in its last ticks, and no more of its work", () => {
    const start = 23 * TOWN_DAY_LENGTH;
    const elder = linesFrom(start, undefined, 100);
    // Every line of the four, the first among them.
    for (const l of ["old bones", "last days", "farewell", "rest soon"]) expect(elder).toContain(l);
    expect(elder).not.toContain("dig dig");
    expect(linesFrom(start, undefined, 1_000)).not.toContain("farewell");
  });

  it("talks of its wounds while badly hurt, and no more of its work", () => {
    const linesAt = (hits: number) => {
      const miner = {
        name: "Miner Emma",
        memory: { role: ROLE_MINER },
        hits,
        hitsMax: 800,
        pos: { findInRange: () => [] },
      } as unknown as Creep;
      g.Memory = {};
      const lines: string[] = [];
      for (let t = 23 * TOWN_DAY_LENGTH; t < 23 * TOWN_DAY_LENGTH + 3_000; t++) {
        g.Game = { time: t };
        const line = chatterLine(miner);
        if (line) lines.push(line);
      }
      return lines;
    };
    const wounded = linesAt(50);
    for (const l of ["my wounds", "ow...", "bleeding!", "a healer?"]) expect(wounded).toContain(l);
    expect(wounded).not.toContain("dig dig");
    for (const l of wounded) expect(l.length).toBeLessThanOrEqual(10);
    expect(linesAt(700)).not.toContain("my wounds");
  });

  it("speaks its first words as it leaves the spawn, and only then", () => {
    const at = (ticksToLive: number) => {
      const mason = { name: "Mason Odo", memory: { role: ROLE_MINER }, ticksToLive, pos: { findInRange: () => [] } } as unknown as Creep;
      g.Memory = {};
      const lines: (string | undefined)[] = [];
      for (let t = 23 * TOWN_DAY_LENGTH; t < 23 * TOWN_DAY_LENGTH + 30; t++) {
        g.Game = { time: t };
        lines.push(chatterLine(mason));
      }
      return lines;
    };
    for (const ttl of [1500, 1499]) {
      const lines = at(ttl);
      expect(new Set(lines).size).toBe(1);
      expect(["reporting!", "ready!", "first day!", "hail all!", "I live!"]).toContain(lines[0]);
    }
    expect(at(1498).filter(Boolean)).toHaveLength(1);
    expect(at(1498)).not.toContain(at(1500)[0]);
  });

  it("hails a creep alongside by its given name, when that fits", () => {
    const start = 23 * TOWN_DAY_LENGTH;
    const lines = linesFrom(start, undefined, undefined, ["Pilgrim Edith"]);
    expect(lines).toContain("hail Edith");
    expect(lines).toContain("dig dig");
    expect(linesFrom(start).some((l) => l.includes("Edith"))).toBe(false);
    const long = linesFrom(start, undefined, undefined, ["Porter Wilhelmina"]);
    expect(long.some((l) => l.includes("Wilhelmina"))).toBe(false);
    for (const l of [...lines, ...long]) expect(l.length).toBeLessThanOrEqual(10);
  });

  it("is answered on the next tick by the creep it hails, and only then", () => {
    const bran = {
      name: "Miner Bran",
      memory: { role: ROLE_MINER },
      pos: { findInRange: () => [{ name: "Miner Bran" }, { name: "Pilgrim Edith" }] },
    } as unknown as Creep;
    const edith = { name: "Pilgrim Edith", memory: { role: ROLE_MINER }, pos: { findInRange: () => [] } } as unknown as Creep;
    g.Memory = {};
    const answers: string[] = [];
    for (let t = 23 * TOWN_DAY_LENGTH; answers.length < 6; t++) {
      g.Game = { time: t };
      if (!chatterLine(bran)?.includes("Edith")) continue;
      g.Game = { time: ++t };
      const answer = chatterLine(edith);
      answers.push(answer!);
      g.Game = { time: ++t };
      expect(chatterLine(edith)).not.toBe(answer);
    }
    expect(answers).toContain("aye Bran!");
    expect(answers).toContain("well met!");
  });

  it("gives the goblin of the labs talk of its own brews", () => {
    const goblin = { name: "Goblin Snik", memory: { role: ROLE_APOTHECARY }, pos: { findInRange: () => [] } } as unknown as Creep;
    g.Memory = {};
    const lines: string[] = [];
    for (let t = 23 * TOWN_DAY_LENGTH; t < 23 * TOWN_DAY_LENGTH + 3_000; t++) {
      g.Game = { time: t };
      const line = chatterLine(goblin);
      if (line) lines.push(line);
    }
    expect(lines).toContain("potions!");
    expect(lines).not.toContain("for Crown!");
  });

  it("talks of the feast on a feast day", () => {
    const feast = linesFrom(21 * TOWN_DAY_LENGTH).slice(0, 30);
    const winter = linesFrom(23 * TOWN_DAY_LENGTH);
    expect(feast.some((l) => !winter.includes(l))).toBe(true);
  });
});
