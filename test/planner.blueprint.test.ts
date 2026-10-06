import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const g = globalThis as any;
g.TERRAIN_MASK_WALL = 1;
g.TERRAIN_MASK_SWAMP = 2;
g.STRUCTURE_WALL = "constructedWall";
g.CONTROLLER_STRUCTURES = {
  spawn: { 0: 0, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 2, 8: 3 },
  extension: { 0: 0, 1: 0, 2: 5, 3: 10, 4: 20, 5: 30, 6: 40, 7: 50, 8: 60 },
  link: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 2, 6: 3, 7: 4, 8: 6 },
  road: { 0: 2500, 1: 2500, 2: 2500, 3: 2500, 4: 2500, 5: 2500, 6: 2500, 7: 2500, 8: 2500 },
  constructedWall: { 1: 0, 2: 2500, 3: 2500, 4: 2500, 5: 2500, 6: 2500, 7: 2500, 8: 2500 },
  rampart: { 1: 0, 2: 2500, 3: 2500, 4: 2500, 5: 2500, 6: 2500, 7: 2500, 8: 2500 },
  storage: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1 },
  tower: { 1: 0, 2: 0, 3: 1, 4: 1, 5: 2, 6: 2, 7: 3, 8: 6 },
  observer: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 1 },
  powerSpawn: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 1 },
  extractor: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 1, 7: 1, 8: 1 },
  terminal: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 1, 7: 1, 8: 1 },
  lab: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 3, 7: 6, 8: 10 },
  container: { 0: 5, 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5, 8: 5 },
  nuker: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 1 },
  factory: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 1, 8: 1 },
};

import {
  planBlueprint,
  encodeBlueprint,
  decodeBlueprint,
  BLUEPRINT_VERSION,
  Blueprint,
  BlueprintInput,
} from "../src/planning/planner.blueprint";

interface FixtureRoom {
  name: string;
  terrain: string;
  controller: [number, number];
  sources: Array<{ id: string; x: number; y: number }>;
  mineral: { id: string; x: number; y: number } | null;
  anchor?: { x: number; y: number };
  structures: Array<{ type: string; x: number; y: number }>;
  avoid?: string[];
}

const ROOMS: FixtureRoom[] = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "blueprint.rooms.json"), "utf8")
);

function inputFor(room: FixtureRoom): BlueprintInput {
  return {
    terrain: (x, y) => +room.terrain[y * 50 + x],
    controller: { x: room.controller[0], y: room.controller[1] },
    sources: room.sources,
    mineral: room.mineral,
    structures: room.structures,
    anchor: room.anchor,
    avoid: room.avoid,
  };
}

const RCL8: Record<string, number> = {
  spawn: 3, extension: 60, tower: 6, lab: 10, storage: 1, terminal: 1,
  factory: 1, observer: 1, powerSpawn: 1, nuker: 1, extractor: 1,
};

// Tiles a creep can stand on once the whole plan is built.
function walkable(room: FixtureRoom, bp: Blueprint): Uint8Array {
  const out = new Uint8Array(2500);
  const solid = new Set<number>();
  for (const e of bp.entries) {
    if (e.type !== "road" && e.type !== "container") solid.add(e.y * 50 + e.x);
  }
  const natural = [room.controller, ...room.sources.map((s) => [s.x, s.y]), ...(room.mineral ? [[room.mineral.x, room.mineral.y]] : [])];
  for (const [x, y] of natural as Array<[number, number]>) solid.add(y * 50 + x);
  for (const s of room.structures) if (s.type === "constructedWall") solid.add(s.y * 50 + s.x);
  for (let i = 0; i < 2500; i++) {
    const x = i % 50;
    const y = (i - x) / 50;
    if (x < 1 || y < 1 || x > 48 || y > 48) continue;
    if (+room.terrain[i] & 1) continue;
    if (!solid.has(i)) out[i] = 1;
  }
  return out;
}

function reachableFrom(start: { x: number; y: number }, walk: Uint8Array): Uint8Array {
  const seen = new Uint8Array(2500);
  const queue: number[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const i = (start.y + dy) * 50 + start.x + dx;
      if (walk[i] && !seen[i]) {
        seen[i] = 1;
        queue.push(i);
      }
    }
  }
  for (let h = 0; h < queue.length; h++) {
    const x = queue[h] % 50;
    const y = (queue[h] - x) / 50;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const i = (y + dy) * 50 + x + dx;
        if (walk[i] && !seen[i]) {
          seen[i] = 1;
          queue.push(i);
        }
      }
    }
  }
  return seen;
}

function render(room: FixtureRoom, bp: Blueprint): string {
  const ch: Record<string, string> = {
    spawn: "S", extension: "e", tower: "T", lab: "L", storage: "O", terminal: "M",
    factory: "F", observer: "B", powerSpawn: "P", nuker: "N", link: "K", container: "C",
    extractor: "X", road: ".",
  };
  const grid: string[] = [];
  for (let i = 0; i < 2500; i++) {
    const t = +room.terrain[i];
    grid.push(t & 1 ? "#" : t & 2 ? "~" : " ");
  }
  for (const side of Object.values(bp.exits)) for (const p of side ?? []) grid[p.y * 50 + p.x] = ",";
  for (const e of bp.entries) grid[e.y * 50 + e.x] = ch[e.type] ?? "?";
  grid[room.controller[1] * 50 + room.controller[0]] = "@";
  for (const s of room.sources) grid[s.y * 50 + s.x] = "$";
  let out = `${room.name}\n`;
  for (let y = 0; y < 50; y++) out += grid.slice(y * 50, y * 50 + 50).join("") + "\n";
  return out;
}

const plans = new Map<string, Blueprint>();
function planFor(room: FixtureRoom): Blueprint {
  let bp = plans.get(room.name);
  if (!bp) {
    const got = planBlueprint(inputFor(room));
    if (!got) throw new Error(`no blueprint for ${room.name}`);
    bp = got;
    plans.set(room.name, bp);
    if (process.env.BLUEPRINT_DUMP) {
      writeFileSync(join(process.env.BLUEPRINT_DUMP, `${room.name}.txt`), render(room, bp));
    }
  }
  return bp;
}

describe.each(ROOMS.map((r) => [r.name, r] as const))("blueprint for %s", (_name, room) => {
  it("plans every RCL 8 building", () => {
    const bp = planFor(room);
    for (const [type, n] of Object.entries(RCL8)) {
      if (type === "extractor" && !room.mineral) continue;
      expect(bp.entries.filter((e) => e.type === type).length, type).toBe(n);
    }
    const tagged = (tag: string) => bp.entries.filter((e) => e.tag === tag).map((e) => e.type).sort();
    for (const s of room.sources) expect(tagged(`source:${s.id}`)).toEqual(["container", "link"]);
    expect(tagged("controller")).toEqual(["container", "link"]);
    expect(tagged("storage")).toEqual(["link"]);
  });

  it("puts nothing on walls, the room edge or another entry", () => {
    const bp = planFor(room);
    const seen = new Set<string>();
    for (const e of bp.entries) {
      const k = `${e.x},${e.y}`;
      expect(seen.has(k), `${e.type} at ${k} doubles up`).toBe(false);
      seen.add(k);
      if (e.type !== "extractor") expect(+room.terrain[e.y * 50 + e.x] & 1, `${e.type} at ${k}`).toBe(0);
      const margin = e.type === "road" || e.type === "container" ? 1 : 2;
      expect(Math.min(e.x, e.y, 49 - e.x, 49 - e.y), `${e.type} at ${k}`).toBeGreaterThanOrEqual(margin);
    }
  });

  it("leaves every building reachable from storage", () => {
    const bp = planFor(room);
    const seen = reachableFrom(bp.hub, walkable(room, bp));
    for (const e of bp.entries) {
      if (e.type === "extractor") continue;
      let ok = false;
      for (let dx = -1; dx <= 1 && !ok; dx++) {
        for (let dy = -1; dy <= 1 && !ok; dy++) {
          if (seen[(e.y + dy) * 50 + e.x + dx]) ok = true;
        }
      }
      expect(ok, `${e.type} at ${e.x},${e.y} is walled in`).toBe(true);
    }
  });

  it("gives two labs reach of all the others", () => {
    const labs = planFor(room).entries.filter((e) => e.type === "lab");
    const reachesAll = labs.filter((a) =>
      labs.every((b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 2)
    );
    expect(reachesAll.length).toBeGreaterThanOrEqual(2);
  });

  it("never unlocks more of a type than the RCL allows", () => {
    const bp = planFor(room);
    for (let rcl = 1; rcl <= 8; rcl++) {
      const counts = new Map<string, number>();
      for (const e of bp.entries) if (e.rcl <= rcl) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
      for (const [type, n] of counts) {
        expect(n, `${type} at RCL ${rcl}`).toBeLessThanOrEqual(g.CONTROLLER_STRUCTURES[type][rcl]);
      }
    }
  });

  it("builds a road only where it serves something", () => {
    const bp = planFor(room);
    const roads = bp.entries.filter((e) => e.type === "road").length;
    expect(roads).toBeLessThan(200);
  });

  it("runs exit roads straight instead of zigzagging", () => {
    for (const [side, path] of Object.entries(planFor(room).exits)) {
      let bends = 0;
      for (let k = 2; k < path!.length; k++) {
        const [a, b, c] = [path![k - 2], path![k - 1], path![k]];
        if (b.x - a.x !== c.x - b.x || b.y - a.y !== c.y - b.y) bends++;
      }
      expect(bends * 3, `${side} road bends ${bends} times in ${path!.length} tiles`).toBeLessThanOrEqual(path!.length);
    }
  });
});

describe("blueprint memory", () => {
  it("comes back from memory exactly as planned", () => {
    const bp = planFor(ROOMS[0]);
    const mem = encodeBlueprint(bp, 123);
    expect(mem.v).toBe(BLUEPRINT_VERSION);
    expect(decodeBlueprint(JSON.parse(JSON.stringify(mem)))).toEqual(bp);
  });
});

describe("blueprint for the live castle", () => {
  const room = ROOMS.find((r) => r.name === "W48S8")!;

  it("keeps the core where it stands", () => {
    const bp = planFor(room);
    const at = new Map(bp.entries.map((e) => [`${e.x},${e.y}`, e.type]));
    for (const s of room.structures) {
      if (!["spawn", "storage", "terminal", "tower", "link"].includes(s.type)) continue;
      expect(at.get(`${s.x},${s.y}`), `${s.type} at ${s.x},${s.y}`).toBe(s.type);
    }
    expect(bp.anchor).toEqual({ x: 25, y: 25 });
    expect(bp.hub).toEqual({ x: 25, y: 27 });
  });

  it("keeps the labs and the extensions already built", () => {
    const bp = planFor(room);
    const at = new Map(bp.entries.map((e) => [`${e.x},${e.y}`, e.type]));
    for (const s of room.structures.filter((s) => s.type === "lab")) {
      expect(at.get(`${s.x},${s.y}`)).toBe("lab");
    }
    for (const s of room.structures.filter((s) => s.type === "extension")) {
      expect(at.get(`${s.x},${s.y}`), `extension at ${s.x},${s.y}`).toBe("extension");
    }
  });

  it("stays off the town's tiles", () => {
    const bp = planFor(room);
    const avoid = new Set(room.avoid);
    for (const e of bp.entries) expect(avoid.has(`${e.x},${e.y}`), `${e.type} at ${e.x},${e.y}`).toBe(false);
  });
});

describe("blueprint for open ground", () => {
  const bp = planBlueprint({
    terrain: () => 0,
    controller: { x: 10, y: 10 },
    sources: [{ id: "a", x: 40, y: 8 }, { id: "b", x: 8, y: 42 }],
    mineral: { id: "m", x: 42, y: 42 },
    structures: [],
  })!;
  const { x: ax, y: ay } = bp.anchor;
  const inKeep = (e: { x: number; y: number }) => Math.max(Math.abs(e.x - ax), Math.abs(e.y - ay)) <= 6;
  const at = new Map(bp.entries.map((e) => [`${e.x},${e.y}`, e.type]));

  it("lays the keep out the same on both sides", () => {
    for (const e of bp.entries) {
      if (e.type === "road" || !inKeep(e)) continue;
      const twin = at.get(`${2 * ax - e.x},${e.y}`);
      expect(twin !== undefined && twin !== "road", `${e.type} at ${e.x},${e.y}`).toBe(true);
      if (["spawn", "extension", "tower", "lab"].includes(e.type)) {
        expect(twin, `${e.type} at ${e.x},${e.y}`).toBe(e.type);
      }
    }
  });

  it("fits every building in the keep", () => {
    for (const e of bp.entries) {
      if (e.type === "road" || e.type === "container" || e.tag) continue;
      expect(inKeep(e), `${e.type} at ${e.x},${e.y}`).toBe(true);
    }
  });

  it("stands the labs in the keep's two rows below storage", () => {
    const labs = bp.entries.filter((e) => e.type === "lab");
    expect(labs).toHaveLength(10);
    for (const l of labs) {
      expect([ay + 4, ay + 6], `lab at ${l.x},${l.y}`).toContain(l.y);
      expect(Math.abs(l.x - ax), `lab at ${l.x},${l.y}`).toBeLessThanOrEqual(2);
    }
  });
});
