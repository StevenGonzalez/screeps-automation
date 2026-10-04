import { describe, it, expect, beforeEach } from "vitest";
import { keepSignature, remoteSignature } from "../src/config/signatures";
import { castleName, wildsName } from "../src/services/services.chronicle";
import { blazon } from "../src/services/services.heraldry";

const g = globalThis as Record<string, unknown>;

beforeEach(() => {
  g.Memory = { rooms: {} };
});

describe("controller signs", () => {
  it("names a keep and blazons its arms", () => {
    const text = keepSignature("W48S8");
    expect(text.startsWith(`${castleName("W48S8")}. Arms: ${blazon("W48S8")}.`)).toBe(true);
  });

  it("names a remote's wilds and the castle that holds them", () => {
    const text = remoteSignature("W47S8", "W48S8");
    expect(text.startsWith(`The ${wildsName("W47S8")}, held by ${castleName("W48S8")}.`)).toBe(true);
  });

  it("keeps the proclamation a room was given when there is room for it", () => {
    const first = remoteSignature("W1N1", "W1N2");
    expect(first.length).toBeGreaterThan(`The ${wildsName("W1N1")}, held by ${castleName("W1N2")}.`.length);
    expect(remoteSignature("W1N1", "W1N2")).toBe(first);
  });

  it("never runs past the 100 characters a sign holds", () => {
    for (let x = 0; x < 30; x++) {
      for (let y = 0; y < 30; y++) {
        const room = `W${x}N${y}`;
        expect(keepSignature(room).length).toBeLessThanOrEqual(100);
        expect(remoteSignature(room, "W1N1").length).toBeLessThanOrEqual(100);
      }
    }
    (g.Memory as Memory).rooms.W1N1 = { townName: "A".repeat(120) } as RoomMemory;
    expect(keepSignature("W1N1").length).toBeLessThanOrEqual(100);
  });
});
