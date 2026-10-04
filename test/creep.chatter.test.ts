import { describe, it, expect, vi } from "vitest";

// The creep orchestrator pulls in every role, and some extend game classes
// as they load.
const g = vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  for (const name of ["Creep", "PowerCreep", "Room", "RoomPosition", "Structure"]) g[name] = class {};
  return g;
});

import { chatterLine } from "../src/orchestrators/orchestrator.creep";
import { ROLE_MINER } from "../src/config/config.roles";
import { TOWN_DAY_LENGTH } from "../src/config/config.town";

// Every line a creep says over a stretch of ticks in the same season.
function linesFrom(start: number): string[] {
  const miner = { name: "Miner Bran", memory: { role: ROLE_MINER } } as unknown as Creep;
  const lines: string[] = [];
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

  it("talks of the feast on a feast day", () => {
    const feast = linesFrom(21 * TOWN_DAY_LENGTH).slice(0, 30);
    const winter = linesFrom(23 * TOWN_DAY_LENGTH);
    expect(feast.some((l) => !winter.includes(l))).toBe(true);
  });
});
