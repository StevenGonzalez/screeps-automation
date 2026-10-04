import { describe, expect, it } from "vitest";
import { roomInterest } from "../viewer/client/director";
import { dossierOf } from "../viewer/client/dossier";
import type { LiveRoom, Motion } from "../viewer/client/store";

function room(objects: Record<string, any>, motion: Record<string, Motion> = {}, effects: LiveRoom["effects"] = []): LiveRoom {
  return {
    key: "shard1/W48S8",
    ox: 0,
    oy: 0,
    gameTime: 100,
    objects,
    users: {},
    tickAt: 0,
    motion: new Map(Object.entries(motion)),
    effects,
    visual: [],
    prevVisual: [],
    visualAt: 0,
    blankVisuals: 0,
    sceneryAt: null,
  };
}

const creep = (name: string, extra: Record<string, any> = {}) => ({ type: "creep", name, x: 10, y: 10, user: "me", store: {}, ...extra });
const walking: Motion = { fx: 9, fy: 10, tx: 10, ty: 10 };

describe("director's interest", () => {
  it("weighs a fight over a stranger over gold carried home, and a creep standing about next to nothing", () => {
    const r = room(
      {
        guard: creep("Yeoman Fulk"),
        foe: creep("Raider", { user: "them" }),
        rich: creep("Merchant Walter", { store: { energy: 900 } }),
        poor: creep("Porter Agnes", { store: { energy: 50 } }),
        idle: creep("Villager Drogo"),
      },
      { rich: walking, poor: walking },
      [{ kind: "attack", id: "guard", x1: 10, y1: 10, x2: 11, y2: 10 }],
    );
    const weight = Object.fromEntries(roomInterest(r, "me", 0, 3000).map((p) => [p.id, p.weight]));
    expect(weight.guard).toBeGreaterThan(weight.foe);
    expect(weight.foe).toBeGreaterThan(weight.rich);
    expect(weight.rich).toBeGreaterThan(weight.poor);
    expect(weight.idle).toBeLessThan(1);
  });

  it("follows a creep on the move and watches one at work", () => {
    const r = room({ porter: creep("Porter Agnes", { store: { energy: 50 } }), miner: creep("Miner Adela") }, { porter: walking }, [
      { kind: "harvest", id: "miner", x1: 10, y1: 10, x2: 11, y2: 11 },
    ]);
    const picks = Object.fromEntries(roomInterest(r, "me", 0, 3000).map((p) => [p.id, p]));
    expect(picks.porter).toMatchObject({ kind: "haul", follow: true, creep: true });
    expect(picks.miner).toMatchObject({ kind: "harvest", follow: false, detail: "mining gold" });
  });

  it("watches a barracks most when its recruit is about to step out", () => {
    const spawn = (spawnTime: number) => ({ type: "spawn", name: "Spawn1", x: 20, y: 20, spawning: { name: "Porter Alys", needTime: 30, spawnTime } });
    const [soon] = roomInterest(room({ s: spawn(102) }), "me", 0, 3000);
    const [late] = roomInterest(room({ s: spawn(125) }), "me", 0, 3000);
    expect(soon.weight).toBeGreaterThan(late.weight * 5);
    expect(soon.detail).toBe("about to step out of Spawn1");
  });
});

describe("dossier", () => {
  it("reads a creep's cargo, health, years and body", () => {
    const d = dossierOf(
      "m",
      {
        name: "Merchant Edmund",
        store: { energy: 300, H: 20 },
        storeCapacity: 400,
        hits: 900,
        hitsMax: 1200,
        ageTime: 1334,
        body: [
          { type: "carry", hits: 100 },
          { type: "move", hits: 0 },
          { type: "carry", hits: 100, boost: "KH" },
          { type: "ranged_attack", hits: 100 },
          { type: "move", hits: 100 },
          { type: "carry", hits: 100 },
        ],
      },
      100,
      "carrying gold home",
      false,
    );
    expect(d).toMatchObject({ name: "Merchant Edmund", cargo: { amount: 300, capacity: 400, what: "gold" }, hits: 900, hitsMax: 1200, life: { left: 1234, span: 1500 } });
    expect(d.body).toEqual([
      { part: "carry", count: 3, broken: 0, boosted: 1 },
      { part: "move", count: 2, broken: 1, boosted: 0 },
      { part: "ranged", count: 1, broken: 0, boosted: 0 },
    ]);
  });

  it("has no cargo for a creep that cannot carry", () => {
    expect(dossierOf("g", { name: "Yeoman Fulk", store: {}, storeCapacity: 0, body: [{ type: "attack", hits: 100 }] }, null, "", false)).toMatchObject({ cargo: null, life: null });
  });
});
