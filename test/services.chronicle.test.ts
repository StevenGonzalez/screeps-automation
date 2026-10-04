import { describe, it, expect, beforeEach, vi } from "vitest";

const g = globalThis as Record<string, unknown>;

import { castleName, chronicle, chronicleDate, lordName, recentChronicle, tally, wildsName } from "../src/services/services.chronicle";

describe("chronicle", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    g.Memory = {};
    g.Game = { time: 5000 };
  });

  it("keeps only the latest entries", () => {
    for (let i = 0; i < 45; i++) chronicle(`entry ${i}`);
    const log = (g.Memory as Memory).chronicle!;
    expect(log).toHaveLength(40);
    expect(log[0].text).toBe("entry 5");
    expect(recentChronicle(2).map((e) => e.text)).toEqual(["entry 43", "entry 44"]);
  });

  it("starts a new tally once the old one has gone quiet", () => {
    const say = (n: number) => `${n} pixels`;
    tally("pixels", 1, say, 100);
    (g.Game as { time: number }).time = 5100;
    tally("pixels", 1, say, 100);
    (g.Game as { time: number }).time = 5201;
    tally("pixels", 1, say, 100);
    expect(recentChronicle(5).map((e) => e.text)).toEqual(["2 pixels", "1 pixels"]);
  });

  it("dates entries from the chronicle's first day", () => {
    chronicle("founded");
    expect(chronicleDate(5000)).toBe("Day 1, dawn");
    expect(chronicleDate(7650)).toBe("Day 3, dusk");
  });

  it("names a castle after its town, or by a name drawn from the room", () => {
    expect(castleName("W48S8")).toBe(castleName("W48S8"));
    expect(castleName("W48S7")).not.toBe(castleName("W47S8"));
    (g.Memory as Memory).rooms = { W48S8: { townName: "Ashford" } as RoomMemory };
    expect(castleName("W48S8")).toBe("Ashford");
  });

  it("gives each other player the same epithet every time", () => {
    expect(lordName("Rival")).toBe("Rival the Fair");
    expect(lordName("_oleksii")).toBe(lordName("_oleksii"));
  });

  it("names wild country by its room, and the next room over differently", () => {
    expect(wildsName("W2N1")).toBe("Shadow March");
    expect(wildsName("W2N1")).toBe(wildsName("W2N1"));
    expect(wildsName("W48S7")).not.toBe(wildsName("W47S8"));
    expect(wildsName("W48S7")).not.toBe(wildsName("W48S6"));
  });
});
