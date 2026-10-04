import { describe, expect, it } from "vitest";
import type { Castle, RealmInfo, RoomUpdate } from "../viewer/shared/protocol";
import { creepPosition, effectsOf, Store, type StoreEvent } from "../viewer/client/store";

const KEY = "shard1/W48S8";

function castle(room: string): Castle {
  return { key: `shard1/${room}`, shard: "shard1", room, name: room, level: 1, town: null };
}

function realm(...rooms: string[]): RealmInfo {
  return { me: { id: "me", username: "me", gcl: 0 }, castles: rooms.map(castle), remotes: [] };
}

function update(gameTime: number | null, objects: Record<string, any>, visual: string | null): RoomUpdate {
  return { key: KEY, gameTime, objects, users: {}, visual };
}

describe("viewer store", () => {
  it("tells of castles won and lost only once the realm is known, with the new realm in place", () => {
    const store = new Store();
    const seen: Array<{ type: string; castles: number }> = [];
    store.on((e: StoreEvent) => seen.push({ type: e.type, castles: store.castles.length }));
    store.setRealm(realm("W48S8"));
    expect(seen).toEqual([]);
    store.setRealm(realm("W48S8", "W47S8"));
    store.setRealm(realm("W47S8"));
    expect(seen).toEqual([
      { type: "castle-won", castles: 2 },
      { type: "castle-lost", castles: 1 },
    ]);
  });

  it("keeps a room's overlays through a few ticks without any", () => {
    const store = new Store();
    store.updateRoom(update(1, {}, '{"t":"c","x":1,"y":1}'), 0);
    for (let t = 2; t <= 6; t++) store.updateRoom(update(t, {}, ""), t * 1000);
    expect(store.live.get(KEY)!.visual).toHaveLength(1);
    store.updateRoom(update(7, {}, ""), 7000);
    expect(store.live.get(KEY)!.visual).toHaveLength(0);
  });

  it("keeps the realm map's overlays through a few ticks without any", () => {
    const store = new Store();
    store.setMapVisual("shard1", '{"t":"c","n":"W48S8","x":1,"y":1}');
    for (let i = 0; i < 5; i++) store.setMapVisual("shard1", "");
    expect(store.mapVisuals.get("shard1")).toHaveLength(1);
    store.setMapVisual("shard1", "");
    expect(store.mapVisuals.get("shard1")).toHaveLength(0);
  });

  it("leaves out the bot's marked scenery but keeps its labels, and draws the sky only where the bot leaves it", () => {
    const store = new Store();
    store.setRealm(realm("W48S8"));
    const plain = '{"t":"c","x":1,"y":1}\n{"t":"t","text":"Throne","x":9,"y":6}';
    store.updateRoom(update(1, {}, plain), 0);
    const r = store.live.get(KEY)!;
    expect(r.visual).toHaveLength(2);
    // An old bot draws its own sky in its castle; a room it does not own is the viewer's.
    expect(store.ownsScenery(r)).toBe(false);

    const marked = [
      '{"t":"t","text":"scenery:begin","x":0,"y":0,"s":{"opacity":0}}',
      '{"t":"r","x":-0.5,"y":-0.5,"w":50,"h":50}',
      '{"t":"t","text":"House of Wren","x":34,"y":13}',
      '{"t":"t","text":"scenery:end","x":0,"y":0,"s":{"opacity":0}}',
      '{"t":"t","text":"Throne","x":9,"y":6}',
    ].join("\n");
    store.updateRoom(update(2, {}, marked), 3000);
    expect(r.visual.map((v) => v.text)).toEqual(["House of Wren", "Throne"]);
    expect(store.ownsScenery(r)).toBe(true);
    // Through heavy ticks without overlays it stays the viewer's.
    for (let t = 3; t < 22; t++) store.updateRoom(update(t, {}, null), t * 3000);
    expect(store.ownsScenery(r)).toBe(true);
    store.updateRoom(update(22, {}, plain), 66000);
    expect(store.ownsScenery(r)).toBe(false);
  });

  it("finds the bot's ledger of a castle in its shard's digest", () => {
    const store = new Store();
    const ledger = { name: "Embercrag" } as CastleDigest;
    store.hello(
      {
        page: "1",
        status: { connected: true, error: null },
        realm: realm("W48S8"),
        maps: {},
        mapVisuals: {},
        rooms: [],
        lore: [],
        cpu: null,
        digests: { shard1: { time: 7, castles: { W48S8: ledger }, chronicle: [] } },
      },
      0,
    );
    expect(store.ledger(KEY)).toBe(ledger);
    expect(store.ledger("shard1/W47S8")).toBeUndefined();
    expect(store.ledger("shard2/W48S8")).toBeUndefined();
  });

  it("sees its castles and remotes, and a room only while one of its own stands in it", () => {
    const store = new Store();
    store.setRealm({ ...realm("W48S8"), remotes: ["shard1/W47S8"] });
    const near = "shard1/W49S8";
    const stream = (objects: Record<string, any>, at: number) => store.updateRoom({ key: near, gameTime: 1, objects, users: {}, visual: null }, at);
    expect(store.sees(KEY, 0)).toBe(true);
    expect(store.sees("shard1/W47S8", 0)).toBe(true);
    expect(store.sees(near, 0)).toBe(false);
    stream({ c: { type: "creep", x: 10, y: 10, user: "rival" } }, 0);
    expect(store.sees(near, 0)).toBe(false);
    stream({ m: { type: "creep", x: 11, y: 10, user: "me" } }, 1000);
    expect(store.sees(near, 1000)).toBe(true);
    // Once the room stops streaming, the fog closes over it again.
    expect(store.sees(near, 60000)).toBe(false);
  });

  it("slides a creep a step over the tick but not across the room", () => {
    const store = new Store();
    store.updateRoom(update(1, { c: { type: "creep", x: 10, y: 10 } }, null), 0);
    store.updateRoom(update(2, { c: { type: "creep", x: 11, y: 10 } }, null), 3000);
    const r = store.live.get(KEY)!;
    expect(creepPosition(r, "c", 3000 + 1350, 3000).x).toBeCloseTo(10.5);
    expect(creepPosition(r, "c", 9000, 3000).x).toBe(11);
    store.updateRoom(update(3, { c: { type: "creep", x: 1, y: 10 } }, null), 6000);
    expect(creepPosition(store.live.get(KEY)!, "c", 6001, 3000).x).toBe(1);
  });

  it("finds the Chronicle in the console", () => {
    const store = new Store();
    const told: string[] = [];
    store.on((e) => e.type === "chronicle" && told.push(e.text));
    store.log(['<span style="color:gold">[Chronicle] The bells ring in W48S8</span>', "[CPU] High usage", 42]);
    expect(told).toEqual(["The bells ring in W48S8"]);
  });

  it("reads what creeps and towers did from their action logs", () => {
    const effects = effectsOf({
      h: { type: "creep", x: 5, y: 5, actionLog: { harvest: { x: 6, y: 6 }, say: { message: "Gold!" } } },
      t: { type: "tower", x: 20, y: 20, actionLog: { attack: { x: 25, y: 25 } } },
      idle: { type: "creep", x: 1, y: 1, actionLog: { harvest: null } },
    });
    expect(effects).toEqual([
      { kind: "harvest", id: "h", x1: 6, y1: 6, x2: 5, y2: 5, text: undefined },
      { kind: "say", id: "h", x1: 5, y1: 5, x2: 5, y2: 5, text: "Gold!" },
      { kind: "tower-attack", id: "t", x1: 20, y1: 20, x2: 25, y2: 25, text: undefined },
    ]);
  });
});
