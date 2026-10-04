// Pure helpers shared by the viewer's server and browser halves: room names,
// the server's object diffs, and the overlay and map formats it streams.

import { SCENERY_BEGIN, SCENERY_END } from "../../src/config/config.town";

export type RoomObject = Record<string, any>;
export type RoomObjects = Record<string, RoomObject>;

// "shard1/W48S8": rooms are keyed by shard as well, since a realm may span
// several.
export function roomKey(shard: string, room: string): string {
  return `${shard}/${room}`;
}

export function splitKey(key: string): { shard: string; room: string } {
  const slash = key.indexOf("/");
  return { shard: key.slice(0, slash), room: key.slice(slash + 1) };
}

// World room coordinates: W0 is x -1 and E0 is x 0, N0 is y -1 and S0 is
// y 0, so rooms tile the plane with no gap at the meridians.
export function roomCoords(name: string): { x: number; y: number } | undefined {
  const m = /^([WE])(\d+)([NS])(\d+)$/.exec(name);
  if (!m) return undefined;
  const x = m[1] === "W" ? -Number(m[2]) - 1 : Number(m[2]);
  const y = m[3] === "N" ? -Number(m[4]) - 1 : Number(m[4]);
  return { x, y };
}

export function roomFromCoords(x: number, y: number): string {
  const we = x < 0 ? `W${-x - 1}` : `E${x}`;
  const ns = y < 0 ? `N${-y - 1}` : `S${y}`;
  return we + ns;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Applies one of the server's room diffs in place. A diff holds, per object
 * id, the object whole when it is new, null when it is gone, or just the
 * fields that changed; nested objects change the same way, and a null field
 * is a field removed. Arrays always arrive whole.
 */
export function applyDiff(target: Record<string, any>, diff: Record<string, any>): void {
  for (const key in diff) {
    const value = diff[key];
    if (value === null) {
      delete target[key];
    } else if (isPlainObject(value) && isPlainObject(target[key])) {
      applyDiff(target[key], value);
    } else {
      target[key] = isPlainObject(value) || Array.isArray(value) ? structuredClone(value) : value;
    }
  }
}

// One RoomVisual or MapVisual primitive as the server streams it: one JSON
// object per line.
export interface VisualItem {
  t: "l" | "c" | "r" | "p" | "t";
  [field: string]: any;
}

export function parseVisual(text: string | undefined | null): VisualItem[] {
  if (!text) return [];
  const out: VisualItem[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // A torn line is dropped; the next tick redraws it.
    }
  }
  return out;
}

/**
 * A room's overlays without the scenery the viewer draws for itself: the
 * shapes the bot drew between its scenery markers (see config.town) are left
 * out, and the text among them, the bot's labels, is kept. `marked` says
 * whether the bot marked any.
 */
export function stripScenery(items: VisualItem[]): { items: VisualItem[]; marked: boolean } {
  const out: VisualItem[] = [];
  let marked = false;
  let inside = false;
  for (const v of items) {
    if (v.t === "t" && v.text === SCENERY_BEGIN) {
      inside = marked = true;
    } else if (v.t === "t" && v.text === SCENERY_END) {
      inside = false;
    } else if (!inside || v.t === "t") {
      out.push(v);
    }
  }
  return { items: out, marked };
}

// Every room a map visual draws in, so the realm map knows which rooms to
// show.
export function mapVisualRooms(items: VisualItem[]): Set<string> {
  const rooms = new Set<string>();
  for (const v of items) {
    if (v.n) rooms.add(v.n);
    if (v.n1) rooms.add(v.n1);
    if (v.n2) rooms.add(v.n2);
    if (Array.isArray(v.points)) for (const p of v.points) if (p && p.n) rooms.add(p.n);
  }
  return rooms;
}

// The fixed keys of a roomMap2 view; every other key is a user id holding
// that user's creeps and structures.
const MAP_FEATURES = new Set(["w", "r", "pb", "p", "s", "c", "m", "k"]);
// The server's own users: Invader is "2", Source Keeper "3".
export const INVADER = "2";
export const SOURCE_KEEPER = "3";

/** The users other than us with anything in a room, Source Keepers aside. */
export function foreignUsers(view: Record<string, unknown> | undefined, me: string): string[] {
  if (!view) return [];
  const out: string[] = [];
  for (const key in view) {
    if (MAP_FEATURES.has(key) || key === me || key === SOURCE_KEEPER) continue;
    const list = view[key];
    if (Array.isArray(list) && list.length > 0) out.push(key);
  }
  return out;
}

// GCL from the account's raw control points, as the game reckons it.
export function gclLevel(points: number): number {
  return Math.floor(Math.pow(points / 1000000, 1 / 2.4)) + 1;
}
