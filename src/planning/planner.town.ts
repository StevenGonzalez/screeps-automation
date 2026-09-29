import { PLANNER_KEYS, STAMP_PLANNER } from "../config/config.structures";
import { TOWN, COTTAGE_FAMILIES } from "../config/config.town";
import { cottageLayout, parseTile, townBarrierTiles, townFootprint } from "../services/services.town";
import { CASTLE_STAMP, MERCHANT_RING_EXTENSION_OFFSETS } from "./planner.stamp";
import { readBlueprint } from "./planner.blueprint";

// The town quarter. Laid out once the perimeter mostly stands:
//
//   RCL 6  watch posts - rampart tiles just behind the ring, facing each side
//          the room has exits on - and a market square: a 3x3 plaza with a
//          one-wall fountain in the middle.
//   RCL 7+ cottages: a 5x5 ring of walls with a rampart door facing the
//          castle and a 3x3 floor of rampart beds.
//
// Nothing here may cost the castle a working tile. The town keeps off every
// planned structure and road, off the stamp's full RCL 8 footprint, clear of
// sources, mineral and controller, and a cottage is only placed where its walls
// leave every tile the castle could reach still reachable.

const SIZE = 50;
const idx = (x: number, y: number): number => y * SIZE + x;
const tileKey = (x: number, y: number): string => `${x},${y}`;
const cheb = (ax: number, ay: number, bx: number, by: number): number =>
  Math.max(Math.abs(ax - bx), Math.abs(ay - by));

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
];

const TOWN_KEYS = new Set<string>([PLANNER_KEYS.TOWN_WALL_KEY, PLANNER_KEYS.TOWN_RAMPART_KEY]);

const PASSABLE_TYPES = new Set<string>([STRUCTURE_ROAD, STRUCTURE_RAMPART, STRUCTURE_CONTAINER]);

function isRoadKey(key: string): boolean {
  return (
    key.startsWith(PLANNER_KEYS.ROAD_PREFIX) ||
    key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX) ||
    key === PLANNER_KEYS.STAMP_ROAD_KEY ||
    key.startsWith(PLANNER_KEYS.CARDINAL_ROAD_PREFIX) ||
    key.startsWith("cardinal_connector_")
  );
}

/** What the planner knows about the room, leaving the town itself out. */
export interface TownSite {
  anchor: { x: number; y: number };
  // Tiles holding (or promised to) anything: structures, sites, roads, the ring.
  occupied: Set<string>;
  // Tiles holding (or promised to) a structure a creep cannot stand next to
  // without blocking it: everything but roads.
  structures: Set<string>;
  // Tiles a creep can stand on once everything planned is built.
  walkable: Uint8Array;
  // Tiles inside the perimeter ring.
  interior: Uint8Array;
  // The stamp's full RCL 8 footprint, which later RCLs will build on.
  reserved: Set<string>;
  // Tiles a cottage must keep clear of: harvest, mineral and upgrade ground.
  clearOf: Array<{ x: number; y: number; range: number }>;
  ring: Set<string>;
  // Where haulers pick up and drop off; the square sits a short walk from it.
  storage: { x: number; y: number };
}

export function buildTownSite(room: Room): TownSite | null {
  const anchor = room.memory.castleAnchor;
  const ringTiles = room.memory.perimeterTiles;
  if (!anchor || !ringTiles || ringTiles.length === 0) return null;
  const terrain = room.getTerrain();
  const ownTiles = townFootprint(room.memory.town);

  const ring = new Set(ringTiles);
  const occupied = new Set<string>(ring);
  const structures = new Set<string>();
  const blocked = new Set<string>();

  const mem = (room.memory.plannedStructures ?? {}) as Record<string, string[]>;
  for (const key of Object.keys(mem)) {
    if (TOWN_KEYS.has(key)) continue;
    const road = isRoadKey(key);
    const passable = road || key === PLANNER_KEYS.RAMPARTS_KEY || key === PLANNER_KEYS.STAMP_RAMPART_KEY ||
      key.startsWith(PLANNER_KEYS.CONTAINER_PREFIX);
    for (const p of mem[key]) {
      occupied.add(p);
      if (!road) structures.add(p);
      if (!passable) blocked.add(p);
    }
  }
  // The castle's later ages are as good as built: a cottage must not take
  // their ground.
  const bp = readBlueprint(room);
  for (const e of bp?.entries ?? []) {
    const k = tileKey(e.x, e.y);
    occupied.add(k);
    if (e.type !== STRUCTURE_ROAD) structures.add(k);
    if (!PASSABLE_TYPES.has(e.type)) blocked.add(k);
  }
  for (const s of room.find(FIND_STRUCTURES)) {
    const k = tileKey(s.pos.x, s.pos.y);
    if (ownTiles.has(k)) continue;
    if (s.structureType === STRUCTURE_CONTROLLER) {
      occupied.add(k);
      blocked.add(k);
      continue;
    }
    // A stray rampart (an old ring, a hand-placed one) is only in the way when
    // it covers something.
    if (s.structureType === STRUCTURE_RAMPART) continue;
    occupied.add(k);
    if (s.structureType !== STRUCTURE_ROAD) structures.add(k);
    if (!PASSABLE_TYPES.has(s.structureType)) blocked.add(k);
  }
  for (const s of room.find(FIND_CONSTRUCTION_SITES)) {
    const k = tileKey(s.pos.x, s.pos.y);
    if (ownTiles.has(k)) continue;
    occupied.add(k);
    if (s.structureType !== STRUCTURE_ROAD) structures.add(k);
    if (!PASSABLE_TYPES.has(s.structureType)) blocked.add(k);
  }

  const clearOf: TownSite["clearOf"] = [];
  for (const s of room.find(FIND_SOURCES)) {
    clearOf.push({ x: s.pos.x, y: s.pos.y, range: TOWN.cottageResourceClearance });
    blocked.add(tileKey(s.pos.x, s.pos.y));
  }
  for (const m of room.find(FIND_MINERALS)) {
    clearOf.push({ x: m.pos.x, y: m.pos.y, range: TOWN.cottageResourceClearance });
    blocked.add(tileKey(m.pos.x, m.pos.y));
  }
  if (room.controller) {
    const c = room.controller.pos;
    clearOf.push({ x: c.x, y: c.y, range: TOWN.cottageControllerClearance });
  }

  const walkable = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      if (blocked.has(tileKey(x, y))) continue;
      walkable[idx(x, y)] = 1;
    }
  }

  const reserved = new Set<string>();
  for (const o of [...CASTLE_STAMP, ...MERCHANT_RING_EXTENSION_OFFSETS]) {
    reserved.add(tileKey(anchor.x + o.dx, anchor.y + o.dy));
  }
  for (let dy = -STAMP_PLANNER.halfSize; dy <= STAMP_PLANNER.halfSize; dy++) {
    for (let dx = -STAMP_PLANNER.halfSize; dx <= STAMP_PLANNER.halfSize; dx++) {
      reserved.add(tileKey(anchor.x + dx, anchor.y + dy));
    }
  }

  const interior = floodInterior(terrain, ring, anchor);
  if (!interior) return null;

  const storagePos = room.storage?.pos;
  const plannedStorage = mem[PLANNER_KEYS.STAMP_STORAGE_KEY]?.[0];
  const storage = storagePos
    ? { x: storagePos.x, y: storagePos.y }
    : bp
      ? bp.hub
      : plannedStorage
        ? parseTile(plannedStorage)
        : { x: anchor.x, y: anchor.y + 2 };

  return { anchor, occupied, structures, walkable, interior, reserved, clearOf, ring, storage };
}

// Tiles reachable from the anchor without crossing the ring. Null when the
// ring leaks to an exit, since then "inside" means nothing.
function floodInterior(
  terrain: RoomTerrain,
  ring: Set<string>,
  anchor: { x: number; y: number }
): Uint8Array | null {
  const inside = new Uint8Array(SIZE * SIZE);
  const queue: number[] = [idx(anchor.x, anchor.y)];
  inside[queue[0]] = 1;
  for (let head = 0; head < queue.length; head++) {
    const t = queue[head];
    const x = t % SIZE;
    const y = (t - x) / SIZE;
    if (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1) return null;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
      const n = idx(nx, ny);
      if (inside[n]) continue;
      if (terrain.get(nx, ny) === TERRAIN_MASK_WALL) continue;
      if (ring.has(tileKey(nx, ny))) continue;
      inside[n] = 1;
      queue.push(n);
    }
  }
  return inside;
}

/** Tiles reachable from the anchor across walkable ground, less `extraBlocked`. */
export function reachable(site: TownSite, extraBlocked: Set<number> = new Set()): Uint8Array {
  const seen = new Uint8Array(SIZE * SIZE);
  const start = idx(site.anchor.x, site.anchor.y);
  const queue: number[] = [start];
  seen[start] = 1;
  for (let head = 0; head < queue.length; head++) {
    const t = queue[head];
    const x = t % SIZE;
    const y = (t - x) / SIZE;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
      const n = idx(nx, ny);
      if (seen[n] || !site.walkable[n] || extraBlocked.has(n)) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return seen;
}

type Side = "top" | "right" | "bottom" | "left";

function exitCentroids(terrain: RoomTerrain): Array<{ side: Side; x: number; y: number }> {
  const out: Array<{ side: Side; x: number; y: number }> = [];
  const sides: Array<{ side: Side; at: (i: number) => [number, number] }> = [
    { side: "top", at: (i) => [i, 0] },
    { side: "right", at: (i) => [SIZE - 1, i] },
    { side: "bottom", at: (i) => [i, SIZE - 1] },
    { side: "left", at: (i) => [0, i] },
  ];
  for (const { side, at } of sides) {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let i = 1; i < SIZE - 1; i++) {
      const [x, y] = at(i);
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      sx += x;
      sy += y;
      n++;
    }
    if (n > 0) out.push({ side, x: sx / n, y: sy / n });
  }
  return out;
}

/**
 * For each side the room has exits on, the ring tile closest to those exits,
 * and up to `postsPerSide` open tiles right behind it for the watch to stand on.
 */
export function planWatchPosts(room: Room, site: TownSite, avoid: Set<string>): string[] {
  const posts: string[] = [];
  const taken = new Set<string>();
  const ringTiles = [...site.ring].map(parseTile);
  for (const exit of exitCentroids(room.getTerrain())) {
    let gate: { x: number; y: number } | null = null;
    let best = Infinity;
    for (const t of ringTiles) {
      const d = Math.hypot(t.x - exit.x, t.y - exit.y);
      if (d < best) {
        best = d;
        gate = t;
      }
    }
    if (!gate) continue;
    const candidates: Array<{ k: string; d: number }> = [];
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const x = gate.x + dx;
        const y = gate.y + dy;
        if (x < 1 || y < 1 || x > SIZE - 2 || y > SIZE - 2) continue;
        const k = tileKey(x, y);
        if (taken.has(k) || avoid.has(k) || site.occupied.has(k)) continue;
        if (!site.interior[idx(x, y)] || !site.walkable[idx(x, y)]) continue;
        if (!NEIGHBOURS.some(([ax, ay]) => site.ring.has(tileKey(x + ax, y + ay)))) continue;
        candidates.push({ k, d: Math.hypot(dx, dy) });
      }
    }
    candidates.sort((a, b) => a.d - b.d || (a.k < b.k ? -1 : 1));
    for (const c of candidates.slice(0, TOWN.postsPerSide)) {
      posts.push(c.k);
      taken.add(c.k);
    }
  }
  return posts;
}

// A tile a creep may park on without walling anything in: open, inside, off
// every road and structure, and not beside a structure someone has to reach.
function parkable(site: TownSite, x: number, y: number, avoid: Set<string>): boolean {
  if (x < 2 || y < 2 || x > SIZE - 3 || y > SIZE - 3) return false;
  const k = tileKey(x, y);
  if (avoid.has(k) || site.occupied.has(k) || site.reserved.has(k)) return false;
  if (!site.interior[idx(x, y)] || !site.walkable[idx(x, y)]) return false;
  for (const [dx, dy] of NEIGHBOURS) {
    if (site.structures.has(tileKey(x + dx, y + dy))) return false;
  }
  return true;
}

/**
 * The market square: the 3x3 plaza nearest storage (one wall in the middle as
 * the fountain, the ring of eight around it to park on), else the closest open
 * tiles when no plaza fits.
 */
export function planSquare(site: TownSite, avoid: Set<string>): { square: string[]; fountain?: string } {
  const { storage } = site;
  const centres: Array<{ x: number; y: number; d: number }> = [];
  for (let y = 3; y < SIZE - 3; y++) {
    for (let x = 3; x < SIZE - 3; x++) {
      const d = cheb(x, y, storage.x, storage.y);
      if (d < TOWN.squareMinRange + 1 || d > TOWN.squareMaxRange) continue;
      centres.push({ x, y, d });
    }
  }
  centres.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  for (const c of centres) {
    let ok = true;
    for (let dy = -1; dy <= 1 && ok; dy++) {
      for (let dx = -1; dx <= 1 && ok; dx++) {
        if (!parkable(site, c.x + dx, c.y + dy, avoid)) ok = false;
      }
    }
    if (!ok) continue;
    const square: string[] = [];
    for (const [dx, dy] of NEIGHBOURS) square.push(tileKey(c.x + dx, c.y + dy));
    return { square, fountain: tileKey(c.x, c.y) };
  }

  const loose: Array<{ k: string; d: number }> = [];
  for (let y = 2; y < SIZE - 2; y++) {
    for (let x = 2; x < SIZE - 2; x++) {
      const d = cheb(x, y, storage.x, storage.y);
      if (d < TOWN.squareMinRange || d > TOWN.squareMaxRange) continue;
      if (parkable(site, x, y, avoid)) loose.push({ k: tileKey(x, y), d });
    }
  }
  loose.sort((a, b) => a.d - b.d || (a.k < b.k ? -1 : 1));
  return { square: loose.slice(0, TOWN.squareFallbackTiles).map((l) => l.k) };
}

function doorFor(x: number, y: number, anchor: { x: number; y: number }): { door: string; outside: [number, number] } {
  const dx = anchor.x - (x + 2);
  const dy = anchor.y - (y + 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0
      ? { door: tileKey(x + 4, y + 2), outside: [x + 5, y + 2] }
      : { door: tileKey(x, y + 2), outside: [x - 1, y + 2] };
  }
  return dy > 0
    ? { door: tileKey(x + 2, y + 4), outside: [x + 2, y + 5] }
    : { door: tileKey(x + 2, y), outside: [x + 2, y - 1] };
}

/**
 * The best spot for a new cottage: inside the ring if one fits, else close
 * outside it (flagged, so the ring is re-planned to take it in). Candidates are
 * tried nearest the castle first, and the first whose walls cut nothing off
 * wins.
 */
export function findCottage(site: TownSite, avoid: Set<string>, name: string): TownCottage | null {
  const { anchor } = site;
  const minRange = STAMP_PLANNER.halfSize + 3;
  const candidates: Array<{ x: number; y: number; d: number; inside: boolean }> = [];
  for (let y = 2; y <= SIZE - 7; y++) {
    for (let x = 2; x <= SIZE - 7; x++) {
      const d = cheb(x + 2, y + 2, anchor.x, anchor.y);
      if (d < minRange) continue;
      let ok = true;
      let inside = true;
      // The 5x5 footprint plus a one-tile margin kept free of structures, so
      // no wall ends up against something a creep has to reach.
      for (let dy = -1; dy <= 5 && ok; dy++) {
        for (let dx = -1; dx <= 5 && ok; dx++) {
          const tx = x + dx;
          const ty = y + dy;
          const k = tileKey(tx, ty);
          const inFootprint = dx >= 0 && dy >= 0 && dx <= 4 && dy <= 4;
          if (avoid.has(k)) ok = false;
          else if (site.structures.has(k)) ok = false;
          else if (inFootprint) {
            if (!site.walkable[idx(tx, ty)] || site.occupied.has(k) || site.reserved.has(k)) ok = false;
            else if (!site.interior[idx(tx, ty)]) inside = false;
          }
        }
      }
      if (!ok) continue;
      if (site.clearOf.some((c) => cheb(c.x, c.y, x + 2, y + 2) <= c.range + 2)) continue;
      // Outside the ring the cottage has to stay clear of the exits the new
      // ring will need room to close off.
      if (!inside && (x < 4 || y < 4 || x + 4 > SIZE - 5 || y + 4 > SIZE - 5)) continue;
      if (!inside && d > TOWN.cottageMaxRange) continue;
      candidates.push({ x, y, d, inside });
    }
  }
  candidates.sort(
    (a, b) => Number(b.inside) - Number(a.inside) || a.d - b.d || a.y - b.y || a.x - b.x
  );

  const before = reachable(site);
  let tries = 0;
  for (const c of candidates) {
    if (tries++ >= 40) break;
    const { door, outside } = doorFor(c.x, c.y, anchor);
    if (!before[idx(outside[0], outside[1])]) continue;
    const cottage: TownCottage = { x: c.x, y: c.y, door, name, ...(c.inside ? {} : { outside: true }) };
    const walls = new Set<number>();
    for (const w of cottageLayout(cottage).walls) {
      const t = parseTile(w);
      walls.add(idx(t.x, t.y));
    }
    const after = reachable(site, walls);
    let cuts = false;
    for (let t = 0; t < SIZE * SIZE && !cuts; t++) {
      if (before[t] && !after[t] && !walls.has(t)) cuts = true;
    }
    if (cuts) continue;
    return cottage;
  }
  return null;
}

function perimeterMostlyBuilt(room: Room, ring: string[]): boolean {
  const built = new Set<string>();
  for (const s of room.find(FIND_STRUCTURES)) {
    if (s.structureType === STRUCTURE_RAMPART) built.add(tileKey(s.pos.x, s.pos.y));
  }
  let n = 0;
  for (const k of ring) if (built.has(k)) n++;
  return n >= ring.length * TOWN.perimeterBuiltRatio;
}

export function wantedCottages(room: Room): number {
  const rcl = room.controller?.level ?? 0;
  const gate = TOWN.storageGateByRcl[rcl];
  if (gate === undefined) return 0;
  if ((room.storage?.store[RESOURCE_ENERGY] ?? 0) < gate) return 0;
  return TOWN.cottagesByRcl[rcl] ?? 0;
}

// Parking tiles lose their point once something is built on or beside them.
function squareStillClear(room: Room, town: TownMemory): boolean {
  if (town.square.length === 0) return true;
  const busy = new Set<string>();
  for (const s of room.find(FIND_STRUCTURES)) {
    if (s.structureType === STRUCTURE_ROAD || s.structureType === STRUCTURE_RAMPART) continue;
    busy.add(tileKey(s.pos.x, s.pos.y));
  }
  for (const s of room.find(FIND_CONSTRUCTION_SITES)) busy.add(tileKey(s.pos.x, s.pos.y));
  const mem = (room.memory.plannedStructures ?? {}) as Record<string, string[]>;
  for (const key of Object.keys(mem)) {
    if (TOWN_KEYS.has(key) || isRoadKey(key)) continue;
    for (const p of mem[key]) busy.add(p);
  }
  for (const e of readBlueprint(room)?.entries ?? []) {
    if (e.type !== STRUCTURE_ROAD) busy.add(tileKey(e.x, e.y));
  }
  return town.square.every((k) => !busy.has(k));
}

/** Plans (and keeps planned) the town quarter. Cheap when nothing changed. */
export function planTown(room: Room): void {
  const rcl = room.controller?.level ?? 0;
  if (rcl < TOWN.watchRcl) return;
  const ring = room.memory.perimeterTiles;
  if (!room.memory.castleAnchor || !ring || ring.length === 0) return;

  let town = room.memory.town;
  if (!town) {
    if (!perimeterMostlyBuilt(room, ring)) return;
    town = { posts: [], square: [], cottages: [] };
  }

  const perimeterAt = room.memory.plannedStructuresMeta?.[PLANNER_KEYS.STAMP_RAMPART_KEY]?.createdAt;
  const replanWatch = town.perimeterAt !== perimeterAt || !squareStillClear(room, town);
  const wantMore =
    town.cottages.length < wantedCottages(room) &&
    (town.failedAt === undefined || Game.time - town.failedAt >= TOWN.retryInterval);

  if (replanWatch || wantMore) {
    const site = buildTownSite(room);
    if (!site) return;
    room.memory.town = town;

    if (wantMore) {
      const avoid = new Set<string>([...town.posts, ...town.square]);
      if (town.fountain) avoid.add(town.fountain);
      for (const c of town.cottages) {
        for (let dy = -1; dy <= 5; dy++) {
          for (let dx = -1; dx <= 5; dx++) avoid.add(tileKey(c.x + dx, c.y + dy));
        }
      }
      const name = COTTAGE_FAMILIES[town.cottages.length % COTTAGE_FAMILIES.length];
      const cottage = findCottage(site, avoid, name);
      if (cottage) {
        town.cottages.push(cottage);
        delete town.failedAt;
        console.log(
          `[Town] ${room.name}: the House of ${cottage.name} is raised at ${cottage.x},${cottage.y}` +
            (cottage.outside ? " (beyond the walls; the ring will be redrawn)" : "")
        );
        if (cottage.outside && room.memory.plannedStructuresMeta) {
          // A missing timestamp makes the next structure pass re-plan the ring,
          // which now protects the cottage too.
          delete room.memory.plannedStructuresMeta[PLANNER_KEYS.STAMP_RAMPART_KEY];
        }
      } else {
        town.failedAt = Game.time;
      }
    }

    if (replanWatch) {
      const avoid = new Set<string>();
      for (const c of town.cottages) {
        for (let dy = -1; dy <= 5; dy++) {
          for (let dx = -1; dx <= 5; dx++) avoid.add(tileKey(c.x + dx, c.y + dy));
        }
      }
      town.posts = planWatchPosts(room, site, avoid);
      for (const p of town.posts) avoid.add(p);
      const { square, fountain } = planSquare(site, avoid);
      town.square = square;
      if (fountain) town.fountain = fountain;
      else delete town.fountain;
      town.perimeterAt = perimeterAt;
    }
  }

  room.memory.town = town;
  syncTownPlan(room, town);
}

// Keeps every unbuilt town wall and rampart in the planned lists, so a lost
// wall is rebuilt, and drops tiles the town no longer uses.
function syncTownPlan(room: Room, town: TownMemory): void {
  const walls = new Set<string>();
  const ramparts = new Set<string>();
  for (const c of town.cottages) {
    const l = cottageLayout(c);
    for (const w of l.walls) walls.add(w);
    ramparts.add(l.door);
    for (const b of l.beds) ramparts.add(b);
  }
  if (town.fountain) walls.add(town.fountain);
  for (const p of town.posts) ramparts.add(p);

  const built = new Set<string>();
  for (const s of room.find(FIND_STRUCTURES)) {
    if (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) {
      built.add(`${s.structureType}:${s.pos.x},${s.pos.y}`);
    }
  }
  if (!room.memory.plannedStructures) room.memory.plannedStructures = {};
  if (!room.memory.plannedStructuresMeta) room.memory.plannedStructuresMeta = {};
  const mem = room.memory.plannedStructures;
  const meta = room.memory.plannedStructuresMeta;
  const put = (key: string, type: string, tiles: Set<string>): void => {
    const todo = [...tiles].filter((k) => !built.has(`${type}:${k}`));
    if (todo.length === 0) {
      delete mem[key];
      delete meta[key];
      return;
    }
    mem[key] = todo;
    if (!meta[key]) meta[key] = { createdAt: Game.time };
  };
  put(PLANNER_KEYS.TOWN_WALL_KEY, STRUCTURE_WALL, walls);
  put(PLANNER_KEYS.TOWN_RAMPART_KEY, STRUCTURE_RAMPART, ramparts);
}

/** Rects the perimeter must enclose for cottages built beyond the old ring. */
export function townProtectedRects(room: Room): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  const town = room.memory.town;
  if (!town) return [];
  return town.cottages
    .filter((c) => c.outside)
    .map((c) => ({
      x1: Math.max(1, c.x - 1),
      y1: Math.max(1, c.y - 1),
      x2: Math.min(48, c.x + 5),
      y2: Math.min(48, c.y + 5),
    }));
}

/** Lines for Game.arca.town(): the quarter's layout, folk and the hour. */
export function describeTown(room: Room): string[] {
  const town = room.memory.town;
  const name = room.memory.townName ?? room.name;
  if (!town) {
    const rcl = room.controller?.level ?? 0;
    return [
      rcl < TOWN.watchRcl
        ? `[Town] ${name}: no quarter yet - the watch is raised at RCL ${TOWN.watchRcl}`
        : `[Town] ${name}: no quarter yet - waiting on the perimeter (${Math.round(TOWN.perimeterBuiltRatio * 100)}% built)`,
    ];
  }
  const builtAt = new Set<string>();
  for (const s of room.find(FIND_STRUCTURES)) {
    if (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) {
      builtAt.add(`${s.structureType}:${s.pos.x},${s.pos.y}`);
    }
  }
  const lines = [`[Town] ${name} (${room.name})`];
  const postsUp = town.posts.filter((p) => builtAt.has(`${STRUCTURE_RAMPART}:${p}`)).length;
  lines.push(`  Watch posts: ${postsUp}/${town.posts.length} built`);
  lines.push(
    town.fountain
      ? `  Square: plaza of ${town.square.length} round the fountain at ${town.fountain}` +
          (builtAt.has(`${STRUCTURE_WALL}:${town.fountain}`) ? "" : " (fountain not yet built)")
      : `  Square: ${town.square.length} loose tiles`
  );
  for (const c of town.cottages) {
    const l = cottageLayout(c);
    const walls = l.walls.filter((w) => builtAt.has(`${STRUCTURE_WALL}:${w}`)).length;
    const beds = l.beds.filter((b) => builtAt.has(`${STRUCTURE_RAMPART}:${b}`)).length;
    lines.push(
      `  House of ${c.name} at ${c.x},${c.y}: walls ${walls}/${l.walls.length}, beds ${beds}/${l.beds.length}` +
        (c.outside ? " (beyond the old ring)" : "")
    );
  }
  const want = wantedCottages(room);
  if (town.cottages.length < want) {
    lines.push(
      town.failedAt !== undefined
        ? `  No room found for cottage ${town.cottages.length + 1}; looking again in ${TOWN.retryInterval - (Game.time - town.failedAt)} ticks`
        : `  Cottage ${town.cottages.length + 1} is planned next`
    );
  }
  return lines;
}

/**
 * Tears the quarter down so it is planned afresh: its walls and ramparts are
 * destroyed (a stray town wall would otherwise be repaired to perimeter
 * strength) and its sites and plans dropped.
 */
export function razeTown(room: Room): number {
  const tiles = townBarrierTiles(room.memory.town);
  let razed = 0;
  for (const s of room.find(FIND_STRUCTURES)) {
    if (s.structureType !== STRUCTURE_WALL && s.structureType !== STRUCTURE_RAMPART) continue;
    if (!tiles.has(tileKey(s.pos.x, s.pos.y))) continue;
    if (s.destroy() === OK) razed++;
  }
  for (const s of room.find(FIND_MY_CONSTRUCTION_SITES)) {
    if (s.structureType !== STRUCTURE_WALL && s.structureType !== STRUCTURE_RAMPART) continue;
    if (tiles.has(tileKey(s.pos.x, s.pos.y))) s.remove();
  }
  const mem = room.memory.plannedStructures;
  const meta = room.memory.plannedStructuresMeta;
  for (const key of TOWN_KEYS) {
    if (mem) delete mem[key];
    if (meta) delete meta[key];
  }
  delete room.memory.town;
  return razed;
}
