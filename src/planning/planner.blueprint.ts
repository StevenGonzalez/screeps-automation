import { CASTLE_STAMP } from "./planner.stamp";
import { townFootprint } from "../services/services.town";

// The kingdom's blueprint: every structure and road the room will ever have
// at RCL 8, planned once against the real terrain and kept in memory. Each
// entry carries the RCL (its "age") at which it is built, so the castle grows
// the same way every time and nothing is placed that a later age has to tear
// down.
//
// The plan is laid out in this order, each step working around everything
// before it:
//
//   1. What already stands and matters: spawns, storage, terminal, towers,
//      labs, links and the other core buildings stay where they are.
//   2. The lab cluster, where it keeps the most labs already built.
//   3. The rest of the castle stamp around the first spawn. A stamp cell that
//      lands on a wall is not squeezed in nearby; it goes to the fill below.
//   4. Trunk roads from storage to each source, the controller, the mineral
//      and each exit, with the containers and links at their ends. Later
//      trunks reuse earlier ones.
//   5. Everything still unplaced - extensions last - on the nearest free
//      tiles of a diagonal lattice, so every building touches a walkway. A
//      building is only placed if every walkway, trunk and building placed
//      before it can still be reached from storage.
//   6. Roads: only the tiles on the cheapest walk from storage to each
//      building. Other walkway tiles stay bare ground. Roads here and in
//      step 4 pay for every bend, so they run straight and turn gently.

export const BLUEPRINT_VERSION = 2;

const SIZE = 50;
const idx = (x: number, y: number): number => y * SIZE + x;
const tx = (i: number): number => i % SIZE;
const ty = (i: number): number => (i - (i % SIZE)) / SIZE;
const cheb = (a: number, b: number): number =>
  Math.max(Math.abs(tx(a) - tx(b)), Math.abs(ty(a) - ty(b)));

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
];

// What a tile holds in the plan.
const FREE = 0;
// A building, wall, source, mineral or controller: nobody walks through it.
const SOLID = 1;
// A road the plan builds.
const ROAD = 2;
// Walkable ground that must stay unbuilt: walkways, harvest and upgrade
// spots, containers and the town's tiles.
const OPEN = 3;

const UNREACHED = 0x3fffffff;

// The eight directions in turning order, so two directions k apart turn by
// 45 degrees times k (the short way round).
const HEADINGS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
];
// What a road pays for bending, by how sharply it bends: a step on plain
// ground costs 8 here, so a road takes a short detour to run straight or
// bend gently, the way a cart road would, but never a long one.
const BEND_COST = [0, 1, 4, 12, 40];
const STEP_SCALE = 4;

export type ExitSide = "top" | "right" | "bottom" | "left";

export interface BlueprintEntry {
  type: BuildableStructureConstant;
  x: number;
  y: number;
  /** The RCL at which this entry is built. */
  rcl: number;
  /** What a container or link serves: "source:<id>", "controller", "mineral:<id>" or "storage". */
  tag?: string;
}

export interface Blueprint {
  anchor: { x: number; y: number };
  /** Storage, built or planned: where every road starts. */
  hub: { x: number; y: number };
  entries: BlueprintEntry[];
  /** A road from the trunks to each side of the room that has exits. */
  exits: Partial<Record<ExitSide, Array<{ x: number; y: number }>>>;
}

export interface BlueprintInput {
  /** Terrain mask at a tile, as Room.Terrain.get returns it. */
  terrain: (x: number, y: number) => number;
  controller: { x: number; y: number };
  sources: Array<{ id: string; x: number; y: number }>;
  mineral?: { id: string; x: number; y: number } | null;
  /** Structures standing in the room: our own, plus roads, containers and walls. */
  structures: Array<{ type: string; x: number; y: number }>;
  /** The first spawn, when the room has one. */
  anchor?: { x: number; y: number };
  /** Tiles to leave unbuilt, such as the town's. */
  avoid?: Iterable<string>;
}

interface Draft {
  type: BuildableStructureConstant;
  i: number;
  built: boolean;
  tag?: string;
  // Placement order; earlier entries get earlier ages.
  order: number;
  minRcl?: number;
}

function pinnedTypes(): Set<string> {
  return new Set<string>([
    STRUCTURE_SPAWN, STRUCTURE_STORAGE, STRUCTURE_TERMINAL, STRUCTURE_TOWER,
    STRUCTURE_LAB, STRUCTURE_LINK, STRUCTURE_FACTORY, STRUCTURE_POWER_SPAWN,
    STRUCTURE_NUKER, STRUCTURE_OBSERVER,
  ]);
}

// Ten labs on a 4x4 square with a road on one diagonal: every lab touches the
// road, and the two labs beside the middle of the road reach all the others.
const LAB_FLOWERS: ReadonlyArray<{ labs: Array<[number, number]>; roads: Array<[number, number]> }> = [
  {
    labs: [[1, 0], [2, 0], [0, 1], [2, 1], [3, 1], [0, 2], [1, 2], [3, 2], [1, 3], [2, 3]],
    roads: [[0, 0], [1, 1], [2, 2], [3, 3]],
  },
  {
    labs: [[1, 0], [2, 0], [0, 1], [1, 1], [3, 1], [0, 2], [2, 2], [3, 2], [1, 3], [2, 3]],
    roads: [[3, 0], [2, 1], [1, 2], [0, 3]],
  },
];

// Trunk roads come with the first extensions, except the mineral's, which
// waits for the extractor.
const TRUNK_RCL = 2;
const MINERAL_RCL = 6;

// The order unbuilt links are unlocked in: storage and the farthest source
// first, so energy flows as soon as links exist.
const LINK_ORDER = (tag: string | undefined, farSource: string | undefined): number => {
  if (tag === "storage") return 0;
  if (tag && tag === farSource) return 1;
  if (tag === "controller") return 2;
  return 3;
};

class Planner {
  private readonly terrain = new Uint8Array(SIZE * SIZE);
  private readonly occ = new Uint8Array(SIZE * SIZE);
  private readonly oldRoad = new Uint8Array(SIZE * SIZE);
  // The town's tiles: walkable, but never built on or paved.
  private readonly avoid = new Uint8Array(SIZE * SIZE);
  private readonly drafts: Draft[] = [];
  private readonly byTile = new Map<number, Draft>();
  private readonly oldExtensions: number[] = [];
  private readonly oldContainers: number[] = [];
  private readonly oldExtensionAt = new Uint8Array(SIZE * SIZE);
  private readonly trunkRcl = new Map<number, number>();
  private readonly exits: Blueprint["exits"] = {};
  private order = 0;
  private anchor = -1;
  private hub = -1;
  // Reachability from storage after the last accepted placement.
  private reach: Uint8Array | null = null;

  constructor(private readonly input: BlueprintInput) {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const m = input.terrain(x, y);
        const i = idx(x, y);
        if (m & TERRAIN_MASK_WALL) {
          this.terrain[i] = 1;
          this.occ[i] = SOLID;
        } else if (m & TERRAIN_MASK_SWAMP) {
          this.terrain[i] = 2;
        }
      }
    }
    const natural = [input.controller, ...input.sources, ...(input.mineral ? [input.mineral] : [])];
    for (const n of natural) this.occ[idx(n.x, n.y)] = SOLID;

    const pinned = pinnedTypes();
    for (const s of input.structures) {
      const i = idx(s.x, s.y);
      if (s.type === STRUCTURE_ROAD) this.oldRoad[i] = 1;
      else if (s.type === STRUCTURE_RAMPART || s.type === STRUCTURE_EXTRACTOR) continue;
      else if (s.type === STRUCTURE_CONTAINER) this.oldContainers.push(i);
      else if (s.type === STRUCTURE_EXTENSION) {
        this.oldExtensions.push(i);
        this.oldExtensionAt[i] = 1;
      }
      else if (pinned.has(s.type)) this.add(s.type as BuildableStructureConstant, i, { built: true });
      else this.occ[i] = SOLID;
    }
    for (const k of input.avoid ?? []) {
      const comma = k.indexOf(",");
      const i = idx(+k.slice(0, comma), +k.slice(comma + 1));
      this.avoid[i] = 1;
      if (this.occ[i] === FREE) this.occ[i] = OPEN;
    }
  }

  run(): Blueprint | null {
    this.anchor = this.pickAnchor();
    if (this.anchor < 0) return null;
    this.hub = this.placeStorage();
    if (this.hub < 0) return null;
    this.placeLabs();
    this.placeStamp();
    this.placeTrunks();
    this.fillRemaining();
    return this.finish();
  }

  // ---- tiles ---------------------------------------------------------------

  private inner(i: number): boolean {
    const x = tx(i);
    const y = ty(i);
    return x >= 1 && x <= 48 && y >= 1 && y <= 48;
  }

  private passable(i: number): boolean {
    return this.inner(i) && this.occ[i] !== SOLID;
  }

  // Buildings keep a tile off the room edge; the engine refuses most of them
  // next to an exit.
  private buildable(i: number): boolean {
    const x = tx(i);
    const y = ty(i);
    return x >= 2 && x <= 47 && y >= 2 && y <= 47 && this.occ[i] === FREE;
  }

  private moveCost(i: number): number {
    if (this.avoid[i]) return 50;
    if (this.occ[i] === ROAD) return 1;
    // Roads go round a standing extension rather than through it.
    if (this.oldExtensionAt[i] && this.occ[i] === FREE) return 30;
    if (this.oldRoad[i]) return 1;
    return this.terrain[i] === 2 ? 10 : 2;
  }

  private at(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return -1;
    return idx(x, y);
  }

  private neighbours(i: number): number[] {
    const out: number[] = [];
    const x = tx(i);
    const y = ty(i);
    for (const [dx, dy] of NEIGHBOURS) {
      const n = this.at(x + dx, y + dy);
      if (n >= 0) out.push(n);
    }
    return out;
  }

  private add(
    type: BuildableStructureConstant,
    i: number,
    opts: { built?: boolean; tag?: string; minRcl?: number } = {}
  ): Draft {
    const d: Draft = { type, i, built: !!opts.built, tag: opts.tag, order: this.order++, minRcl: opts.minRcl };
    this.drafts.push(d);
    this.byTile.set(i, d);
    if (type !== STRUCTURE_CONTAINER && type !== STRUCTURE_EXTRACTOR) this.occ[i] = SOLID;
    else if (this.occ[i] === FREE) this.occ[i] = OPEN;
    return d;
  }

  private remove(d: Draft): void {
    this.drafts.splice(this.drafts.indexOf(d), 1);
    this.byTile.delete(d.i);
    this.occ[d.i] = FREE;
  }

  private count(type: string): number {
    let n = 0;
    for (const d of this.drafts) if (d.type === type) n++;
    return n;
  }

  private want(type: BuildableStructureConstant): number {
    return CONTROLLER_STRUCTURES[type][8];
  }

  // ---- paths ---------------------------------------------------------------

  private hubStarts(): number[] {
    return this.neighbours(this.hub).filter((n) => this.passable(n));
  }

  /** Cheapest walking cost from storage to every tile. */
  private dijkstra(): { dist: Int32Array } {
    const dist = new Int32Array(SIZE * SIZE).fill(UNREACHED);
    const heap = new MinHeap();
    for (const s of this.hubStarts()) {
      dist[s] = 0;
      heap.push(0, s);
    }
    while (heap.size > 0) {
      const [d, i] = heap.pop();
      if (d > dist[i]) continue;
      for (const n of this.neighbours(i)) {
        if (!this.passable(n)) continue;
        const nd = d + this.moveCost(n);
        if (nd < dist[n]) {
          dist[n] = nd;
          heap.push(nd, n);
        }
      }
    }
    return { dist };
  }

  /**
   * Like dijkstra, but a road pays for each bend, so roads run in long
   * straight lines and turn gently instead of zigzagging. Returns the
   * cheapest cost to each tile and the road from storage to any tile,
   * that tile first.
   */
  private roadDijkstra(): { dist: Int32Array; road: (to: number) => number[] } {
    const states = SIZE * SIZE * 8;
    const cost = new Int32Array(states).fill(UNREACHED);
    const parent = new Int32Array(states).fill(-1);
    const heap = new MinHeap();
    const hx = tx(this.hub);
    const hy = ty(this.hub);
    for (const s of this.hubStarts()) {
      // Leaving storage straight out costs nothing.
      const h = HEADINGS.findIndex(([dx, dy]) => dx === tx(s) - hx && dy === ty(s) - hy);
      cost[s * 8 + h] = 0;
      heap.push(0, s * 8 + h);
    }
    while (heap.size > 0) {
      const [d, st] = heap.pop();
      if (d > cost[st]) continue;
      const i = st >> 3;
      const h = st & 7;
      const x = tx(i);
      const y = ty(i);
      for (let nh = 0; nh < 8; nh++) {
        const n = this.at(x + HEADINGS[nh][0], y + HEADINGS[nh][1]);
        if (n < 0 || !this.passable(n)) continue;
        const turn = Math.abs(nh - h);
        const nd = d + this.moveCost(n) * STEP_SCALE + BEND_COST[Math.min(turn, 8 - turn)];
        const ns = n * 8 + nh;
        if (nd < cost[ns]) {
          cost[ns] = nd;
          parent[ns] = st;
          heap.push(nd, ns);
        }
      }
    }
    const dist = new Int32Array(SIZE * SIZE).fill(UNREACHED);
    const best = new Int32Array(SIZE * SIZE).fill(-1);
    for (let st = 0; st < states; st++) {
      const i = st >> 3;
      if (cost[st] < dist[i]) {
        dist[i] = cost[st];
        best[i] = st;
      }
    }
    const road = (to: number): number[] => {
      const out: number[] = [];
      for (let st = best[to]; st >= 0; st = parent[st]) out.push(st >> 3);
      return out;
    };
    return { dist, road };
  }

  /** Every tile reachable on foot from storage. */
  private flood(): Uint8Array {
    const seen = new Uint8Array(SIZE * SIZE);
    const queue = this.hubStarts();
    for (const s of queue) seen[s] = 1;
    for (let head = 0; head < queue.length; head++) {
      for (const n of this.neighbours(queue[head])) {
        if (seen[n] || !this.passable(n)) continue;
        seen[n] = 1;
        queue.push(n);
      }
    }
    return seen;
  }

  private hasAccess(i: number, seen: Uint8Array): boolean {
    return this.neighbours(i).some((n) => seen[n] === 1);
  }

  /**
   * Places a building at `i` only if every road, walkway and building that
   * could be reached before still can, and the new building can be too.
   */
  private placeChecked(type: BuildableStructureConstant, i: number, tag?: string): boolean {
    if (!this.reach) this.reach = this.flood();
    const before = this.reach;
    const d = this.add(type, i, { tag });
    const after = this.flood();
    let ok = this.hasAccess(i, after);
    for (let t = 0; ok && t < SIZE * SIZE; t++) {
      if (before[t] && !after[t] && (this.occ[t] === ROAD || this.occ[t] === OPEN)) ok = false;
    }
    for (const other of this.drafts) {
      if (!ok) break;
      if (other === d || other.type === STRUCTURE_CONTAINER || other.type === STRUCTURE_EXTRACTOR) continue;
      if (this.hasAccess(other.i, before) && !this.hasAccess(other.i, after)) ok = false;
    }
    if (!ok) {
      this.remove(d);
      return false;
    }
    this.reach = after;
    return true;
  }

  // ---- 1. anchor and storage ----------------------------------------------

  private pickAnchor(): number {
    if (this.input.anchor) return idx(this.input.anchor.x, this.input.anchor.y);
    const spawn = this.drafts.find((d) => d.type === STRUCTURE_SPAWN);
    if (spawn) return spawn.i;

    // A fresh room: the spot where most of the stamp lands on open ground,
    // not crowding the sources, and close to what it serves.
    const core = CASTLE_STAMP.filter((c) => c.type !== "road" && c.type !== "lab");
    const must = CASTLE_STAMP.filter((c) => c.type === "spawn" && c.minRcl === 1 || c.type === "storage");
    const pois = [...this.input.sources, this.input.controller];
    let best = -1;
    let bestScore = -Infinity;
    for (let y = 8; y <= 41; y++) {
      for (let x = 8; x <= 41; x++) {
        if (must.some((c) => !this.buildable(idx(x + c.dx, y + c.dy)))) continue;
        let score = 0;
        for (const c of core) if (this.buildable(idx(x + c.dx, y + c.dy))) score += 3;
        for (const c of CASTLE_STAMP) {
          if (c.type === "road" && this.occ[idx(x + c.dx, y + c.dy)] !== SOLID) score += 1;
        }
        for (const p of pois) {
          const r = Math.max(Math.abs(p.x - x), Math.abs(p.y - y));
          score -= r * 0.3;
          if (r < 8) score -= (8 - r) * 2;
        }
        if (score > bestScore) {
          bestScore = score;
          best = idx(x, y);
        }
      }
    }
    if (best >= 0) this.add(STRUCTURE_SPAWN, best);
    return best;
  }

  private placeStorage(): number {
    const built = this.drafts.find((d) => d.type === STRUCTURE_STORAGE);
    if (built) return built.i;
    const cell = CASTLE_STAMP.find((c) => c.type === "storage")!;
    const ax = tx(this.anchor);
    const ay = ty(this.anchor);
    const stamp = this.at(ax + cell.dx, ay + cell.dy);
    if (stamp >= 0 && this.buildable(stamp)) return this.add(STRUCTURE_STORAGE, stamp).i;
    // The nearest open tile to the spawn with room to walk around it.
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < SIZE * SIZE; i++) {
      if (!this.buildable(i)) continue;
      const open = this.neighbours(i).filter((n) => this.passable(n)).length;
      if (open < 4) continue;
      const d = cheb(i, this.anchor);
      if (d >= 2 && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best >= 0 ? this.add(STRUCTURE_STORAGE, best).i : -1;
  }

  // ---- 2. labs -------------------------------------------------------------

  private placeLabs(): void {
    const oldLabs = this.drafts.filter((d) => d.type === STRUCTURE_LAB);
    const oldLabTiles = new Set(oldLabs.map((d) => d.i));
    // Stamp cells kept for buildings that have nowhere else as good; towers
    // and labs can go elsewhere.
    const ax = tx(this.anchor);
    const ay = ty(this.anchor);
    const kept = new Set<number>();
    for (const c of CASTLE_STAMP) {
      if (c.type === "lab" || c.type === "tower") continue;
      const i = this.at(ax + c.dx, ay + c.dy);
      if (i >= 0) kept.add(i);
    }
    const oldExt = new Set(this.oldExtensions);
    const { dist } = this.dijkstra();

    let best: { labs: number[]; roads: number[]; score: number } | null = null;
    for (let y = 2; y <= 44; y++) {
      for (let x = 2; x <= 44; x++) {
        for (const flower of LAB_FLOWERS) {
          const labs = flower.labs.map(([dx, dy]) => idx(x + dx, y + dy));
          const roads = flower.roads.map(([dx, dy]) => idx(x + dx, y + dy));
          if (labs.some((i) => !oldLabTiles.has(i) && (!this.buildable(i) || kept.has(i)))) continue;
          if (roads.some((i) => !this.passable(i) || this.byTile.has(i))) continue;
          const reach = Math.min(...roads.map((i) => dist[i]));
          if (reach >= UNREACHED) continue;
          let score = -reach;
          for (const i of labs) {
            if (oldLabTiles.has(i)) score += 1000;
            if (oldExt.has(i)) score -= 3;
          }
          if (!best || score > best.score) best = { labs, roads, score };
        }
      }
    }
    // Labs outside the chosen cluster are not part of the plan; the builder
    // takes them down when their slot is needed.
    for (const d of oldLabs) if (!best || !best.labs.includes(d.i)) this.remove(d);
    if (!best) return;
    for (const i of best.labs) if (!this.byTile.has(i)) this.add(STRUCTURE_LAB, i);
    for (const i of best.roads) if (this.occ[i] === FREE) this.occ[i] = OPEN;
  }

  // ---- 3. castle stamp -----------------------------------------------------

  private placeStamp(): void {
    const ax = tx(this.anchor);
    const ay = ty(this.anchor);
    for (const c of CASTLE_STAMP) {
      const i = this.at(ax + c.dx, ay + c.dy);
      if (i < 0) continue;
      if (c.type === "road") {
        if (this.occ[i] === FREE) this.occ[i] = OPEN;
        continue;
      }
      if (c.type === "lab" || c.type === "storage") continue;
      if (c.type === "link") {
        if (this.storageLink() || !this.buildable(i) || cheb(i, this.hub) > 2) continue;
        this.add(STRUCTURE_LINK, i, { tag: "storage" });
        continue;
      }
      const type = (c.type === "power_spawn" ? STRUCTURE_POWER_SPAWN : c.type) as BuildableStructureConstant;
      if (this.byTile.get(i)?.type === type) continue;
      if (this.count(type) >= this.want(type)) continue;
      if (this.buildable(i)) this.add(type, i);
    }
  }

  private storageLink(): Draft | undefined {
    const tagged = this.drafts.find((d) => d.tag === "storage");
    if (tagged) return tagged;
    const near = this.drafts.find(
      (d) => d.type === STRUCTURE_LINK && !d.tag && cheb(d.i, this.hub) <= 2
    );
    if (near) near.tag = "storage";
    return near;
  }

  // ---- 4. trunks -----------------------------------------------------------

  private placeTrunks(): void {
    const { dist: start } = this.dijkstra();
    const sources = [...this.input.sources].sort(
      (a, b) => this.bestNear(start, idx(a.x, a.y), 1) - this.bestNear(start, idx(b.x, b.y), 1)
    );
    for (const s of sources) this.trunkTo(idx(s.x, s.y), 1, `source:${s.id}`, TRUNK_RCL);

    const c = this.input.controller;
    this.trunkTo(idx(c.x, c.y), 2, "controller", TRUNK_RCL);

    const m = this.input.mineral;
    if (m) {
      const end = this.trunkTo(idx(m.x, m.y), 1, `mineral:${m.id}`, MINERAL_RCL);
      if (end >= 0) this.add(STRUCTURE_EXTRACTOR, idx(m.x, m.y), { tag: `mineral:${m.id}`, minRcl: MINERAL_RCL });
    }

    for (const side of ["top", "right", "bottom", "left"] as ExitSide[]) this.trunkToExit(side);
  }

  private bestNear(dist: Int32Array, target: number, range: number): number {
    let best = UNREACHED;
    for (let i = 0; i < SIZE * SIZE; i++) {
      if (cheb(i, target) <= range && dist[i] < best) best = dist[i];
    }
    return best;
  }

  /**
   * A road from storage to within `range` of `target`, ending in a container
   * (reusing one already standing there), with a link beside the container
   * and the ground round the target kept clear for whoever works it.
   * Returns the container tile.
   */
  private trunkTo(target: number, range: number, tag: string, rcl: number): number {
    const { dist, road } = this.roadDijkstra();
    let end = this.oldContainers.find((i) => cheb(i, target) <= range && dist[i] < UNREACHED) ?? -1;
    // Off the trunks if possible; a container on a road still lets carts by.
    for (const onRoad of [false, true]) {
      if (end >= 0) break;
      let best = UNREACHED;
      for (let i = 0; i < SIZE * SIZE; i++) {
        if (cheb(i, target) > range || !this.passable(i) || (this.occ[i] === ROAD) !== onRoad) continue;
        if (this.byTile.has(i) || dist[i] >= best) continue;
        best = dist[i];
        end = i;
      }
    }
    if (end < 0) return -1;
    for (const i of road(end).slice(1)) this.markRoad(i, rcl);
    this.add(STRUCTURE_CONTAINER, end, {
      tag,
      minRcl: tag.startsWith("mineral:") ? MINERAL_RCL : undefined,
    });

    if (!tag.startsWith("mineral:")) this.placeEndLink(target, end, tag);

    // Harvest or upgrade ground: the tiles round the source or mineral, or
    // those beside the container within upgrade range.
    for (let i = 0; i < SIZE * SIZE; i++) {
      if (this.occ[i] !== FREE) continue;
      const nearTarget = tag === "controller"
        ? cheb(i, target) <= 3 && cheb(i, end) <= 1
        : cheb(i, target) <= 1;
      if (nearTarget) this.occ[i] = OPEN;
    }
    return end;
  }

  private placeEndLink(target: number, container: number, tag: string): void {
    const reach = tag === "controller" ? 3 : 2;
    const old = this.drafts.find(
      (d) => d.type === STRUCTURE_LINK && d.built && !d.tag && cheb(d.i, container) <= reach &&
        (tag !== "controller" || cheb(d.i, target) <= 3)
    );
    if (old) {
      old.tag = tag;
      return;
    }
    let best = -1;
    let bestScore = Infinity;
    for (const n of this.neighbours(container)) {
      if (!this.buildable(n)) continue;
      const r = cheb(n, target);
      if (tag === "controller" ? r > 3 : false) continue;
      // Off the harvest tiles if possible; near the controller if upgrading.
      const score = tag === "controller" ? r : r <= 1 ? 1 : 0;
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
    }
    if (best >= 0) this.add(STRUCTURE_LINK, best, { tag });
  }

  private trunkToExit(side: ExitSide): void {
    const edge: number[] = [];
    for (let k = 1; k < SIZE - 1; k++) {
      const [x, y] =
        side === "top" ? [k, 0] : side === "bottom" ? [k, SIZE - 1] : side === "left" ? [0, k] : [SIZE - 1, k];
      if (this.terrain[idx(x, y)] !== 1) edge.push(idx(x, y));
    }
    if (edge.length === 0) return;
    const { dist, road } = this.roadDijkstra();
    let end = -1;
    let best = UNREACHED;
    for (const e of edge) {
      for (const n of this.neighbours(e)) {
        if (dist[n] < best) {
          best = dist[n];
          end = n;
        }
      }
    }
    if (end < 0) return;
    const path = road(end);
    this.exits[side] = path.map((i) => ({ x: tx(i), y: ty(i) }));
    // Kept unbuilt so the road can be laid when a remote on that side is
    // worked, but not built until then.
    for (const i of path) if (this.occ[i] === FREE) this.occ[i] = OPEN;
  }

  private markRoad(i: number, rcl: number): void {
    if (this.avoid[i]) return;
    this.occ[i] = ROAD;
    this.trunkRcl.set(i, Math.min(this.trunkRcl.get(i) ?? 8, rcl));
  }

  // ---- 5. fill -------------------------------------------------------------

  private fillRemaining(): void {
    const { dist } = this.dijkstra();
    const access = (i: number): number => {
      let best = UNREACHED;
      for (const n of this.neighbours(i)) if (this.passable(n) && dist[n] < best) best = dist[n];
      return best;
    };
    const ax = tx(this.anchor);
    const ay = ty(this.anchor);
    // Walkway lines run on both diagonals through the first spawn, four tiles
    // apart: each block between them is a plus of five buildings, and every one
    // of them touches a walkway.
    const onLattice = (i: number): boolean =>
      (((tx(i) + ty(i) - ax - ay) % 4) + 4) % 4 === 0 || (((tx(i) - ty(i) - ax + ay) % 4) + 4) % 4 === 0;

    const lattice: Array<{ i: number; d: number }> = [];
    for (let i = 0; i < SIZE * SIZE; i++) {
      if (!this.buildable(i) || onLattice(i)) continue;
      const d = access(i);
      if (d < UNREACHED) lattice.push({ i, d });
    }
    lattice.sort((a, b) => a.d - b.d || a.i - b.i);

    if (!this.storageLink()) {
      const near = lattice
        .concat(this.openNear(this.hub, 2, access))
        .filter((c) => cheb(c.i, this.hub) <= 2)
        .sort((a, b) => a.d - b.d);
      for (const c of near) {
        if (this.buildable(c.i) && this.placeChecked(STRUCTURE_LINK, c.i, "storage")) break;
      }
    }

    const fill = (type: BuildableStructureConstant, candidates: Array<{ i: number; d: number }>): void => {
      for (const c of candidates) {
        if (this.count(type) >= this.want(type)) return;
        if (this.buildable(c.i)) this.placeChecked(type, c.i);
      }
    };
    // Extensions already standing keep their place where they still fit, before
    // anything else takes their tiles.
    const old = this.oldExtensions
      .map((i) => ({ i, d: access(i) }))
      .filter((c) => c.d < UNREACHED)
      .sort((a, b) => a.d - b.d);
    fill(STRUCTURE_EXTENSION, old);
    for (const type of [
      STRUCTURE_SPAWN, STRUCTURE_TOWER, STRUCTURE_TERMINAL, STRUCTURE_POWER_SPAWN,
      STRUCTURE_FACTORY, STRUCTURE_NUKER, STRUCTURE_OBSERVER,
    ] as BuildableStructureConstant[]) {
      fill(type, lattice);
    }
    fill(STRUCTURE_EXTENSION, lattice);
  }

  private openNear(
    center: number,
    range: number,
    access: (i: number) => number
  ): Array<{ i: number; d: number }> {
    const out: Array<{ i: number; d: number }> = [];
    for (let i = 0; i < SIZE * SIZE; i++) {
      if (cheb(i, center) > range || !this.buildable(i)) continue;
      const d = access(i);
      if (d < UNREACHED) out.push({ i, d });
    }
    return out;
  }

  // ---- 6. ages and roads ---------------------------------------------------

  private finish(): Blueprint {
    const entries: BlueprintEntry[] = [];
    const byType = new Map<string, Draft[]>();
    for (const d of this.drafts) {
      if (!byType.has(d.type)) byType.set(d.type, []);
      byType.get(d.type)!.push(d);
    }
    const farSource = this.farSourceTag();
    const rclOf = new Map<Draft, number>();
    for (const [type, list] of byType) {
      list.sort((a, b) =>
        Number(b.built) - Number(a.built) ||
        (type === STRUCTURE_LINK ? LINK_ORDER(a.tag, farSource) - LINK_ORDER(b.tag, farSource) : 0) ||
        a.order - b.order
      );
      const caps = CONTROLLER_STRUCTURES[type as BuildableStructureConstant];
      list.forEach((d, n) => {
        let rcl = 1;
        while (rcl <= 8 && caps[rcl] <= n) rcl++;
        if (rcl > 8) return;
        rcl = Math.max(rcl, d.minRcl ?? 1);
        rclOf.set(d, rcl);
        entries.push({ type: d.type, x: tx(d.i), y: ty(d.i), rcl, ...(d.tag ? { tag: d.tag } : {}) });
      });
    }

    // Roads: the walk from storage to each building, at the age of the
    // earliest building it serves, plus the trunks.
    const roadRcl = new Map(this.trunkRcl);
    const { dist, road } = this.roadDijkstra();
    for (const [d, rcl] of rclOf) {
      if (d.tag && d.tag !== "storage") continue;
      if (d.type === STRUCTURE_CONTAINER || d.type === STRUCTURE_EXTRACTOR) continue;
      let door = -1;
      for (const n of this.neighbours(d.i)) {
        if (this.passable(n) && (door < 0 || dist[n] < dist[door])) door = n;
      }
      if (door < 0 || dist[door] >= UNREACHED) continue;
      for (const i of road(door)) {
        roadRcl.set(i, Math.min(roadRcl.get(i) ?? 8, rcl));
      }
    }
    for (const [i, rcl] of roadRcl) {
      if (this.byTile.has(i) || this.avoid[i]) continue;
      entries.push({ type: STRUCTURE_ROAD, x: tx(i), y: ty(i), rcl });
    }

    return {
      anchor: { x: tx(this.anchor), y: ty(this.anchor) },
      hub: { x: tx(this.hub), y: ty(this.hub) },
      entries,
      exits: this.exits,
    };
  }

  private farSourceTag(): string | undefined {
    let best: string | undefined;
    let bestD = -1;
    for (const s of this.input.sources) {
      const d = cheb(idx(s.x, s.y), this.hub);
      if (d > bestD) {
        bestD = d;
        best = `source:${s.id}`;
      }
    }
    return best;
  }
}

class MinHeap {
  private readonly keys: number[] = [];
  private readonly vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }

  pop(): [number, number] {
    const k = this.keys;
    const v = this.vals;
    const top: [number, number] = [k[0], v[0]];
    const lastK = k.pop()!;
    const lastV = v.pop()!;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && k[r] < k[l] ? r : l;
        if (k[c] >= lastK) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return top;
  }
}

/** Plans the room's full RCL 8 layout. Null when no spot fits the castle. */
export function planBlueprint(input: BlueprintInput): Blueprint | null {
  return new Planner(input).run();
}

// ---- memory ----------------------------------------------------------------

// Types are stored by a letter to keep the plan small in memory.
const TYPE_CODES: Record<string, string> = {
  spawn: "S", extension: "E", tower: "T", lab: "L", storage: "O", terminal: "M",
  factory: "F", observer: "B", powerSpawn: "P", nuker: "N", link: "K", container: "C",
  extractor: "X", road: "R",
};
const CODE_TYPES: Record<string, BuildableStructureConstant> = {};
for (const t in TYPE_CODES) CODE_TYPES[TYPE_CODES[t]] = t as BuildableStructureConstant;

/** One entry per structure: type letter, x, y and age, with a tag for containers and links. */
export function encodeBlueprint(bp: Blueprint, time: number): BlueprintMemory {
  const exits: Partial<Record<ExitSide, string>> = {};
  for (const side in bp.exits) {
    exits[side as ExitSide] = bp.exits[side as ExitSide]!.map((p) => `${p.x},${p.y}`).join(";");
  }
  return {
    v: BLUEPRINT_VERSION,
    at: time,
    anchor: bp.anchor,
    hub: bp.hub,
    s: bp.entries
      .map((e) => `${TYPE_CODES[e.type]}${e.x},${e.y},${e.rcl}${e.tag ? `,${e.tag}` : ""}`)
      .join(";"),
    exits,
  };
}

export function decodeBlueprint(mem: BlueprintMemory): Blueprint {
  const entries: BlueprintEntry[] = [];
  for (const part of mem.s ? mem.s.split(";") : []) {
    const [x, y, rcl, ...tag] = part.slice(1).split(",");
    const e: BlueprintEntry = { type: CODE_TYPES[part[0]], x: +x, y: +y, rcl: +rcl };
    if (tag.length > 0) e.tag = tag.join(",");
    entries.push(e);
  }
  const exits: Blueprint["exits"] = {};
  for (const side in mem.exits) {
    exits[side as ExitSide] = mem.exits[side as ExitSide]!.split(";").map((k) => {
      const [x, y] = k.split(",");
      return { x: +x, y: +y };
    });
  }
  return { anchor: mem.anchor, hub: mem.hub, entries, exits };
}

// Decoded plans, kept across ticks until the stored plan changes.
const decoded: Record<string, { at: number; bp: Blueprint; roads?: Set<string>; lanes?: string }> = {};

/** The room's stored blueprint, or null when it has none yet. */
export function readBlueprint(room: Room): Blueprint | null {
  const mem = room.memory.blueprint;
  if (!mem) return null;
  const hit = decoded[room.name];
  if (hit && hit.at === mem.at) return hit.bp;
  const bp = decodeBlueprint(mem);
  decoded[room.name] = { at: mem.at, bp };
  return bp;
}

export function blueprintInput(room: Room): BlueprintInput {
  const terrain = room.getTerrain();
  const structures: BlueprintInput["structures"] = [];
  for (const s of room.find(FIND_STRUCTURES)) {
    const t = s.structureType;
    if (t === STRUCTURE_CONTROLLER) continue;
    // A previous owner's buildings are in the way, not part of the castle.
    const theirs = (s as OwnedStructure).my === false;
    structures.push({ type: theirs ? "obstacle" : t, x: s.pos.x, y: s.pos.y });
  }
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  const cached = room.memory.castleAnchor;
  const anchorSpawn = cached && room.find(FIND_MY_SPAWNS).some((s) => s.pos.x === cached.x && s.pos.y === cached.y)
    ? cached
    : spawn
      ? { x: spawn.pos.x, y: spawn.pos.y }
      : undefined;
  const mineral = room.find(FIND_MINERALS)[0];
  // The town's cottages, posts and square stay as they are.
  const avoid = townFootprint(room.memory.town);
  return {
    terrain: (x, y) => terrain.get(x, y),
    controller: { x: room.controller!.pos.x, y: room.controller!.pos.y },
    sources: room.find(FIND_SOURCES).map((s) => ({ id: s.id, x: s.pos.x, y: s.pos.y })),
    mineral: mineral ? { id: mineral.id, x: mineral.pos.x, y: mineral.pos.y } : null,
    structures,
    anchor: anchorSpawn,
    avoid,
  };
}

/**
 * Whether the stored plan still fits the room: it exists, was made by this
 * version of the planner, and sits on a spawn we own (a room lost and
 * claimed again starts over).
 */
export function blueprintIsCurrent(room: Room): boolean {
  const mem = room.memory.blueprint;
  if (!mem || mem.v !== BLUEPRINT_VERSION) return false;
  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return true;
  return spawns.some((s) => s.pos.x === mem.anchor.x && s.pos.y === mem.anchor.y);
}

/** Plans and stores the room's blueprint. Returns it, or null when nothing fits. */
export function planRoomBlueprint(room: Room): Blueprint | null {
  const bp = planBlueprint(blueprintInput(room));
  if (!bp) return null;
  room.memory.blueprint = encodeBlueprint(bp, Game.time);
  room.memory.castleAnchor = bp.anchor;
  return bp;
}

/** Road tiles the room keeps up: the blueprint's roads and the exit roads in use. */
export function keptRoadTiles(room: Room): Set<string> | null {
  const bp = readBlueprint(room);
  if (!bp) return null;
  // Repair asks every tick, so the set is kept until the plan or lanes change.
  const lanes = room.memory.blueprint?.lanes ?? [];
  const hit = decoded[room.name];
  const key = lanes.join();
  if (hit.roads && hit.lanes === key) return hit.roads;
  const out = new Set<string>();
  for (const e of bp.entries) if (e.type === STRUCTURE_ROAD) out.add(`${e.x},${e.y}`);
  for (const side of lanes) {
    for (const p of bp.exits[side] ?? []) out.add(`${p.x},${p.y}`);
  }
  hit.roads = out;
  hit.lanes = key;
  return out;
}

// What each age brings, for the console.
export const AGE_NAMES: Record<number, string> = {
  1: "Founding",
  2: "Palisade",
  3: "Watchtower",
  4: "Keep",
  5: "Linked Halls",
  6: "Alchemy",
  7: "Kingdom",
  8: "Empire",
};

/** The plan age by age: what each brings and how much of it stands. */
export function describeBlueprint(room: Room): string[] {
  const bp = readBlueprint(room);
  if (!bp) return [`[Blueprint] ${room.name}: no plan yet`];
  const rcl = room.controller?.level ?? 0;
  const standing = new Set<string>();
  for (const s of room.find(FIND_STRUCTURES)) standing.add(`${s.pos.x},${s.pos.y}:${s.structureType}`);

  const lines = [`[Blueprint] ${room.name}: anchor ${bp.anchor.x},${bp.anchor.y}, storage ${bp.hub.x},${bp.hub.y}, now RCL ${rcl}`];
  for (let age = 1; age <= 8; age++) {
    const counts = new Map<string, number>();
    let built = 0;
    let total = 0;
    for (const e of bp.entries) {
      if (e.rcl !== age) continue;
      total++;
      if (standing.has(`${e.x},${e.y}:${e.type}`)) built++;
      counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    }
    if (total === 0) continue;
    const what = [...counts].map(([t, n]) => `${n} ${t}`).join(", ");
    const mark = age <= rcl ? `${built}/${total} built` : "to come";
    lines.push(`  Age ${age} ${AGE_NAMES[age]}: ${what} (${mark})`);
  }
  const kept = keptRoadTiles(room)!;
  let roads = 0;
  let stray = 0;
  for (const s of room.find(FIND_STRUCTURES)) {
    if (s.structureType !== STRUCTURE_ROAD) continue;
    roads++;
    if (!kept.has(`${s.pos.x},${s.pos.y}`)) stray++;
  }
  const lanes = room.memory.blueprint?.lanes ?? [];
  lines.push(`  Roads: ${roads} standing, ${stray} off the plan and left to decay; exit roads in use: ${lanes.join(", ") || "none"}`);
  return lines;
}
