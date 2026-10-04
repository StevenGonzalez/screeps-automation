import {
  TOWN_DAY_LENGTH,
  TOWN_DAYS_PER_SEASON,
  TOWN_DRAGON_FLIGHT,
  TOWN_DRAGON_ODDS,
  TOWN_FEASTS,
  TOWN_HOWL_EVERY,
  TOWN_HOWL_TICKS,
  TOWN_MOON_DAYS,
  TOWN_PHASES,
  TOWN_SEASONS,
  TOWN_STORM_ODDS,
  TownPhase,
  TownSeason,
} from "../config/config.town";

export interface TownClock {
  phase: TownPhase;
  // 0-23, for the HUD.
  hour: number;
}

export function townClock(time: number): TownClock {
  const t = time % TOWN_DAY_LENGTH;
  let phase: TownPhase = TOWN_PHASES[0].name;
  for (const p of TOWN_PHASES) if (t >= p.start) phase = p.name;
  return {
    phase,
    hour: Math.floor((t * 24) / TOWN_DAY_LENGTH),
  };
}

export function townSeason(time: number): TownSeason {
  const day = Math.floor(time / TOWN_DAY_LENGTH);
  return TOWN_SEASONS[Math.floor(day / TOWN_DAYS_PER_SEASON) % TOWN_SEASONS.length];
}

/** The feast held today, if today is the first day of a season. */
export function townFeast(time: number): string | undefined {
  const day = Math.floor(time / TOWN_DAY_LENGTH);
  return day % TOWN_DAYS_PER_SEASON === 0 ? TOWN_FEASTS[townSeason(time)] : undefined;
}

/**
 * Whether a storm blows over the realm today. Never on a feast day, nor in
 * winter, when it snows instead.
 */
export function townStorm(time: number): boolean {
  if (townFeast(time) || townSeason(time) === "winter") return false;
  const day = Math.floor(time / TOWN_DAY_LENGTH);
  return (Math.imul(day, 2654435761) >>> 16) % TOWN_STORM_ODDS === 0;
}

// A well-mixed hash of a day's number, so each kind of omen falls on days
// of its own.
function dayHash(day: number, salt: number): number {
  let h = Math.imul(day ^ salt, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

export interface DragonFlight {
  // Ticks since the dragon came into view.
  t: number;
  // Where it is over the room; it starts and ends off the room's edges.
  x: number;
  y: number;
  // 1 flying east, -1 flying west.
  dir: 1 | -1;
  // The day's number, for choosing words about it.
  day: number;
}

/**
 * The dragon over the realm at `time`, if one is flying. On about one day in
 * TOWN_DRAGON_ODDS, never a feast day, a dragon crosses every castle at once
 * from one side to the other, some time between morning and dusk.
 */
export function townDragon(time: number): DragonFlight | undefined {
  if (townFeast(time)) return undefined;
  const day = Math.floor(time / TOWN_DAY_LENGTH);
  const h = dayHash(day, 0x5bd1e995);
  if (h % TOWN_DRAGON_ODDS !== 0) return undefined;
  const start = 100 + ((h >>> 8) % 550);
  const t = (time % TOWN_DAY_LENGTH) - start;
  if (t < 0 || t >= TOWN_DRAGON_FLIGHT) return undefined;
  const dir = (h >>> 4) & 1 ? 1 : -1;
  const fromY = 8 + ((h >>> 18) % 34);
  const toY = 8 + ((h >>> 24) % 34);
  const f = t / (TOWN_DRAGON_FLIGHT - 1);
  return { t, x: dir === 1 ? -6 + 62 * f : 55 - 62 * f, y: fromY + (toY - fromY) * f, dir, day };
}

/** The moon's age tonight in days: 0 is the new moon, TOWN_MOON_DAYS / 2 the full. */
export function townMoon(time: number): number {
  return Math.floor(time / TOWN_DAY_LENGTH) % TOWN_MOON_DAYS;
}

export function isFullMoon(time: number): boolean {
  return townMoon(time) === TOWN_MOON_DAYS / 2;
}

export interface Howl {
  // Ticks since the howl began, and which of the night's howls it is.
  t: number;
  n: number;
  // Where in the dark beyond the walls it comes from.
  x: number;
  y: number;
}

const NIGHT_START = TOWN_PHASES.find((p) => p.name === "night")!.start;

/**
 * The wolves' howl at `time`, if one is sounding: on a full-moon night they
 * howl every TOWN_HOWL_EVERY ticks from somewhere along the west or east edge
 * of every castle.
 */
export function townHowl(time: number): Howl | undefined {
  if (!isFullMoon(time)) return undefined;
  const night = (time % TOWN_DAY_LENGTH) - NIGHT_START;
  if (night < 0) return undefined;
  const t = night % TOWN_HOWL_EVERY;
  if (t >= TOWN_HOWL_TICKS) return undefined;
  const n = Math.floor(night / TOWN_HOWL_EVERY);
  const h = dayHash(Math.floor(time / TOWN_DAY_LENGTH) * 16 + n, 0x27d4eb2f);
  // Below the HUD in the top-left corner and above the chronicle in the bottom-left.
  return { t, n, x: h & 1 ? 46.5 : 2.5, y: 14 + ((h >>> 4) % 28) };
}

export function isNightfall(phase: TownPhase): boolean {
  return phase === "dusk" || phase === "night";
}

export interface CottageLayout {
  walls: string[];
  door: string;
  beds: string[];
}

export function cottageLayout(c: TownCottage): CottageLayout {
  const walls: string[] = [];
  const beds: string[] = [];
  for (let dy = 0; dy < 5; dy++) {
    for (let dx = 0; dx < 5; dx++) {
      const k = `${c.x + dx},${c.y + dy}`;
      const edge = dx === 0 || dy === 0 || dx === 4 || dy === 4;
      if (!edge) beds.push(k);
      else if (k !== c.door) walls.push(k);
    }
  }
  return { walls, door: c.door, beds };
}

export function bedTiles(town: TownMemory | undefined): string[] {
  if (!town) return [];
  const beds: string[] = [];
  for (const c of town.cottages) beds.push(...cottageLayout(c).beds);
  return beds;
}

/** Every wall and rampart tile of the town, which the repair logic keeps low. */
export function townBarrierTiles(town: TownMemory | undefined): Set<string> {
  const out = new Set<string>();
  if (!town) return out;
  for (const c of town.cottages) {
    const l = cottageLayout(c);
    for (const k of l.walls) out.add(k);
    out.add(l.door);
    for (const k of l.beds) out.add(k);
  }
  for (const k of town.posts) out.add(k);
  if (town.fountain) out.add(town.fountain);
  return out;
}

/** Tiles the town stands on, which road planning keeps clear of. */
export function townFootprint(town: TownMemory | undefined): Set<string> {
  const out = townBarrierTiles(town);
  if (town) for (const k of town.square) out.add(k);
  return out;
}

export function parseTile(k: string): { x: number; y: number } {
  const comma = k.indexOf(",");
  return { x: +k.slice(0, comma), y: +k.slice(comma + 1) };
}

// Who holds which town tile this tick, keyed "room:x,y". Built from creep
// memory once a tick like the fill claims. A claim the creep did not use last
// tick or this one is stale, so a creep that went back to work frees its tile
// without having to say so.
let spotTick = -1;
const spotClaims = new Map<string, string>();

function claimKey(roomName: string, tile: string): string {
  return `${roomName}:${tile}`;
}

function spotIndex(): Map<string, string> {
  if (spotTick !== Game.time) {
    spotTick = Game.time;
    spotClaims.clear();
    for (const name in Game.creeps) {
      const c = Game.creeps[name];
      const spot = c.memory.townSpot;
      if (!spot || c.memory.townSpotTick === undefined) continue;
      if (Game.time - c.memory.townSpotTick > 1) continue;
      spotClaims.set(claimKey(c.room.name, spot), name);
    }
  }
  return spotClaims;
}

export function spotHolder(roomName: string, tile: string): string | undefined {
  return spotIndex().get(claimKey(roomName, tile));
}

/**
 * Claims the best free tile among `candidates` (the one it already holds if
 * that is still a candidate, else the closest to `near`, else to the creep)
 * and returns it, or null when every candidate is taken.
 */
export function claimSpot(
  creep: Creep,
  candidates: string[],
  near: RoomPosition = creep.pos
): string | null {
  const index = spotIndex();
  const room = creep.room.name;
  const held = creep.memory.townSpot;
  const holdsFresh =
    held !== undefined &&
    creep.memory.townSpotTick !== undefined &&
    Game.time - creep.memory.townSpotTick <= 1 &&
    index.get(claimKey(room, held)) === creep.name;
  if (holdsFresh && candidates.includes(held!)) {
    creep.memory.townSpotTick = Game.time;
    return held!;
  }

  // Closest to `near`, and of those the one the creep reaches first.
  let best: string | null = null;
  let bestRange = Infinity;
  let bestWalk = Infinity;
  for (const k of candidates) {
    const holder = index.get(claimKey(room, k));
    if (holder && holder !== creep.name) continue;
    const { x, y } = parseTile(k);
    const r = Math.max(Math.abs(x - near.x), Math.abs(y - near.y));
    const walk = Math.max(Math.abs(x - creep.pos.x), Math.abs(y - creep.pos.y));
    if (r < bestRange || (r === bestRange && walk < bestWalk)) {
      bestRange = r;
      bestWalk = walk;
      best = k;
    }
  }
  if (held && index.get(claimKey(room, held)) === creep.name) index.delete(claimKey(room, held));
  if (!best) {
    delete creep.memory.townSpot;
    delete creep.memory.townSpotTick;
    return null;
  }
  creep.memory.townSpot = best;
  creep.memory.townSpotTick = Game.time;
  index.set(claimKey(room, best), creep.name);
  return best;
}

/** Walks to a claimed tile; standing on it costs no intent at all. */
export function goToSpot(creep: Creep, tile: string): void {
  const { x, y } = parseTile(tile);
  if (creep.pos.x === x && creep.pos.y === y) return;
  creep.moveTo(new RoomPosition(x, y, creep.room.name), { reusePath: 20 });
}

/** Claims and walks to one of `candidates`. False when none is free. */
export function parkOn(creep: Creep, candidates: string[], near?: RoomPosition): boolean {
  if (candidates.length === 0) return false;
  const spot = claimSpot(creep, candidates, near);
  if (!spot) return false;
  goToSpot(creep, spot);
  return true;
}

/**
 * Where idle creeps wait in a room with a town: fighters on the watch posts
 * behind the walls, everyone else (and fighters once the posts are full) on the
 * market square. False when the room has no town or no free tile.
 */
export function parkIdle(creep: Creep, kind: "watch" | "square"): boolean {
  const town = creep.room.memory.town;
  if (!town || !creep.room.controller?.my) return false;
  if (kind === "watch" && parkOn(creep, town.posts)) return true;
  return parkOn(creep, town.square);
}
