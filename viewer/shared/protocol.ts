// What the viewer's server streams to the page, one server-sent event each.

import type { RoomObjects } from "./realm";

export interface Castle {
  key: string;
  shard: string;
  room: string;
  name: string;
  // Controller level, 0 until known.
  level: number;
  // The town quarter as the bot planned it, null while it has none.
  town: TownPlan | null;
}

// A castle's town (room.memory.town): tiles as "x,y".
export interface TownPlan {
  posts: string[];
  square: string[];
  fountain?: string;
  cottages: Array<{ x: number; y: number; door: string; name: string }>;
}

export interface Me {
  id: string;
  username: string;
  // Raw control points; see gclLevel.
  gcl: number;
}

export interface RealmInfo {
  me: Me | null;
  castles: Castle[];
  // Rooms the realm map visual draws in that are not castles: remotes, keeps
  // being founded, rivals' holds.
  remotes: string[];
}

export interface RoomUpdate {
  key: string;
  // Null on the snapshot sent when a room is first watched.
  gameTime: number | null;
  objects: RoomObjects;
  users: Record<string, { username?: string }>;
  // The overlays drawn last tick, "" when none were (the bot skips them on a
  // heavy tick), null when this update carries none.
  visual: string | null;
}

// The town's sky and omens at a shard's latest tick, worked out from the
// tick by the bot's own lore code.
export interface Lore {
  shard: string;
  gameTime: number;
  // Real milliseconds per tick, measured.
  tickMs: number;
  phase: string;
  hour: number;
  season: string;
  feast: string | null;
  storm: boolean;
  aurora: boolean;
  dragon: { t: number; x: number; y: number; dir: number } | null;
  howl: { t: number; x: number; y: number } | null;
  star: { t: number; x: number; y: number } | null;
}

export interface Status {
  connected: boolean;
  error: string | null;
}

export interface Hello {
  // The page's name for itself when it says which rooms to watch.
  page: string;
  status: Status;
  realm: RealmInfo;
  maps: Record<string, Record<string, unknown>>;
  mapVisuals: Record<string, string>;
  rooms: RoomUpdate[];
  lore: Lore[];
  cpu: { cpu: number; memory: number } | null;
  // Each shard's castles and chronicle as the bot last summed them up
  // (Memory.digest; RealmDigest is the bot's, in src/types.d.ts).
  digests: Record<string, RealmDigest>;
}

export interface DigestUpdate {
  shard: string;
  digest: RealmDigest;
}
