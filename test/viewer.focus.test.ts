import { describe, expect, it } from "vitest";
import { Realm, townPlan } from "../viewer/server/realm";

// The rooms the server streams in full, by the pages' wishes.
function focusOf(realm: Realm): string[] {
  return (realm as unknown as { focus: string[] }).focus;
}

describe("viewer focus", () => {
  const realm = () => new Realm({ token: "unused" } as never, "/nonexistent", () => undefined);

  it("streams one page's room and the room it goes to next", () => {
    const r = realm();
    r.setFocus("1", ["shard1/W48S8", "shard1/W48S7", "shard1/W47S8"]);
    expect(focusOf(r)).toEqual(["shard1/W48S8", "shard1/W48S7"]);
  });

  it("gives two pages a room each, the newest page first, before either gets a second", () => {
    const r = realm();
    r.setFocus("1", ["shard1/W48S8", "shard1/W48S7"]);
    r.setFocus("2", ["shard1/W47S8", "shard1/W46S8"]);
    expect(focusOf(r)).toEqual(["shard1/W47S8", "shard1/W48S8"]);
    r.dropPage("2");
    expect(focusOf(r)).toEqual(["shard1/W48S8", "shard1/W48S7"]);
  });

  it("streams a room two pages share once", () => {
    const r = realm();
    r.setFocus("1", ["shard1/W48S8", "shard1/W48S7"]);
    r.setFocus("2", ["shard1/W48S8"]);
    expect(focusOf(r)).toEqual(["shard1/W48S8", "shard1/W48S7"]);
  });

  it("ignores what is not a room", () => {
    const r = realm();
    r.setFocus("1", ["W48S8", "shard1/../x", "shard1/W48S8"]);
    expect(focusOf(r)).toEqual(["shard1/W48S8"]);
  });
});

describe("viewer town plans", () => {
  it("keeps what the viewer draws of a town's memory and drops what it cannot read", () => {
    const plan = townPlan({
      posts: ["41,3", "bad"],
      square: ["16,26"],
      fountain: "17,27",
      cottages: [{ x: 32, y: 14, door: "32,16", name: "Aldermere", outside: true }, { x: 1 }],
      perimeterAt: 74113924,
    });
    expect(plan).toEqual({
      posts: ["41,3"],
      square: ["16,26"],
      fountain: "17,27",
      cottages: [{ x: 32, y: 14, door: "32,16", name: "Aldermere" }],
    });
    expect(townPlan(undefined)).toBeNull();
  });
});

describe("viewer digest", () => {
  it("keeps the bot's digest of a shard from its Memory and passes it on", () => {
    const r = new Realm({ token: "unused" } as never, "/nonexistent", () => undefined);
    const heard: unknown[] = [];
    r.listen((event, data) => event === "digest" && heard.push(data));
    const onMessage = (channel: string, payload: unknown) =>
      (r as unknown as { onMessage(data: string): void }).onMessage(JSON.stringify([channel, payload]));
    const digest = { time: 7, castles: {}, chronicle: [{ when: "Day 1, dawn", text: "The bells ring" }] };
    onMessage("user:me/memory/shard3/digest", JSON.stringify(digest));
    // What the server sends for a value it cannot stream, and what is not a digest, are let be.
    onMessage("user:me/memory/shard3/digest", "[object Object]");
    onMessage("user:me/memory/shard3/digest", JSON.stringify({ time: 8 }));
    expect(heard).toEqual([{ shard: "shard3", digest }]);
    expect(r.snapshot().digests).toEqual({ shard3: digest });
  });
});
