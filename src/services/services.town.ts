import { TOWN_DAY_LENGTH, TOWN_PHASES, TownPhase } from "../config/config.town";

export interface TownClock {
  day: number;
  phase: TownPhase;
  // 0-23, for the HUD.
  hour: number;
}

export function townClock(time: number): TownClock {
  const t = time % TOWN_DAY_LENGTH;
  let phase: TownPhase = TOWN_PHASES[0].name;
  for (const p of TOWN_PHASES) if (t >= p.start) phase = p.name;
  return {
    day: Math.floor(time / TOWN_DAY_LENGTH) + 1,
    phase,
    hour: Math.floor((t * 24) / TOWN_DAY_LENGTH),
  };
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
