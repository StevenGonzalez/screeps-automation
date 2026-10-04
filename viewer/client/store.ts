// The page's picture of the realm, kept from the server's events: castles,
// map views, the rooms streaming in full, the sky, and what happened this tick
// that is worth drawing or filming.

import type { Castle, Hello, Lore, Me, RealmInfo, RoomUpdate, Status } from "../shared/protocol";
import { foreignUsers, parseVisual, splitKey, stripScenery, type RoomObjects, type VisualItem } from "../shared/realm";
import { roomOrigin } from "./camera";

export interface Motion {
  fx: number;
  fy: number;
  tx: number;
  ty: number;
}

export type EffectKind =
  | "harvest"
  | "upgrade"
  | "build"
  | "repair"
  | "attack"
  | "ranged"
  | "mass"
  | "heal"
  | "claim"
  | "tower-attack"
  | "tower-heal"
  | "tower-repair"
  | "link"
  | "say";

// Something done this tick, from (x1, y1) to (x2, y2) in room tiles.
export interface Effect {
  kind: EffectKind;
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  text?: string;
}

export interface LiveRoom {
  key: string;
  // The room's top-left tile in world tiles.
  ox: number;
  oy: number;
  gameTime: number | null;
  objects: RoomObjects;
  users: Record<string, { username?: string }>;
  // When the latest tick arrived, by performance.now().
  tickAt: number;
  motion: Map<string, Motion>;
  effects: Effect[];
  visual: VisualItem[];
  prevVisual: VisualItem[];
  visualAt: number;
  // Ticks in a row that came with no overlays at all.
  blankVisuals: number;
  // The last tick the bot marked its scenery in the room's overlays, so the
  // viewer may draw its own; null while it never has.
  sceneryAt: number | null;
}

export type StoreEvent =
  | { type: "castle-won"; castle: Castle }
  | { type: "castle-lost"; castle: Castle }
  | { type: "chronicle"; text: string }
  | { type: "phase"; phase: string }
  | { type: "tick"; key: string };

// A room that comes with no overlays this long is taken to have none, rather
// than to have skipped them on a heavy tick.
const BLANK_VISUALS_KEPT = 5;
// A castle whose overlays came without scenery markers for this many ticks
// has a bot that draws its own sky and town, so the viewer draws none there.
const SCENERY_KEPT_TICKS = 20;
// A creep further than this from where it was has left by an exit or been
// placed, so it is not slid across the room.
const MAX_SLIDE = 1.6;

export class Store {
  status: Status = { connected: false, error: null };
  me: Me | null = null;
  castles: Castle[] = [];
  remotes: string[] = [];
  maps = new Map<string, Record<string, unknown>>();
  mapVisuals = new Map<string, VisualItem[]>();
  live = new Map<string, LiveRoom>();
  lore = new Map<string, Lore & { at: number }>();
  cpu: { cpu: number; memory: number } | null = null;
  // Each shard's castles and chronicle as the bot last summed them up.
  digests = new Map<string, RealmDigest>();
  // Rooms the server last refused to stream, by when.
  limited = new Map<string, number>();
  private known = false;
  private readonly blankMapVisuals = new Map<string, number>();
  private readonly listeners = new Set<(e: StoreEvent) => void>();

  on(fn: (e: StoreEvent) => void): void {
    this.listeners.add(fn);
  }

  private emit(e: StoreEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  hello(h: Hello, now: number): void {
    this.status = h.status;
    this.maps = new Map(Object.entries(h.maps));
    this.mapVisuals = new Map(Object.entries(h.mapVisuals).map(([s, t]) => [s, parseVisual(t)]));
    for (const l of h.lore) this.setLore(l, now);
    this.cpu = h.cpu;
    this.digests = new Map(Object.entries(h.digests));
    this.setRealm(h.realm);
    for (const r of h.rooms) this.updateRoom(r, now);
  }

  setRealm(info: RealmInfo): void {
    const events: StoreEvent[] = [];
    if (this.known) {
      const before = new Map(this.castles.map((c) => [c.key, c]));
      for (const c of info.castles) if (!before.has(c.key)) events.push({ type: "castle-won", castle: c });
      const after = new Set(info.castles.map((c) => c.key));
      for (const c of before.values()) if (!after.has(c.key)) events.push({ type: "castle-lost", castle: c });
    }
    this.me = info.me;
    this.remotes = info.remotes;
    this.castles = info.castles;
    if (info.me) this.known = true;
    for (const e of events) this.emit(e);
  }

  // Like a room's, the realm map's overlays are kept through a few heavy ticks without them.
  setMapVisual(shard: string, text: string): void {
    const items = parseVisual(text);
    const blanks = items.length > 0 ? 0 : (this.blankMapVisuals.get(shard) ?? 0) + 1;
    this.blankMapVisuals.set(shard, blanks);
    if (items.length > 0 || blanks > BLANK_VISUALS_KEPT) this.mapVisuals.set(shard, items);
  }

  setLore(l: Lore, now: number): void {
    const before = this.lore.get(l.shard);
    this.lore.set(l.shard, { ...l, at: now });
    if (before && before.phase !== l.phase) this.emit({ type: "phase", phase: l.phase });
  }

  log(lines: unknown[]): void {
    for (const line of lines) {
      if (typeof line !== "string") continue;
      const m = /\[Chronicle\]\s*(.+)/.exec(line.replace(/<[^>]*>/g, ""));
      if (m) this.emit({ type: "chronicle", text: m[1].trim() });
    }
  }

  /** Real milliseconds per tick on a shard. */
  tickMs(shard: string): number {
    return this.lore.get(shard)?.tickMs ?? 3000;
  }

  /** Foreign users in a room by the map view: raiders, rivals, anyone not ours. */
  foreigners(key: string): string[] {
    return this.me ? foreignUsers(this.maps.get(key), this.me.id) : [];
  }

  /**
   * Whether the realm has sight of a room, as the game gives it: its castles
   * and remotes, and a room streaming in full that one of its own creeps or
   * works stands in. The rest lie under the fog of war.
   */
  sees(key: string, now: number): boolean {
    if (this.castleOf(key) || this.remotes.includes(key)) return true;
    const r = this.live.get(key);
    const me = this.me?.id;
    return !!r && !!me && this.isFresh(r, now) && Object.values(r.objects).some((o) => o.user === me);
  }

  castleOf(key: string): Castle | undefined {
    return this.castles.find((c) => c.key === key);
  }

  /** The bot's last summary of a castle's state. */
  ledger(key: string): CastleDigest | undefined {
    const { shard, room } = splitKey(key);
    return this.digests.get(shard)?.castles[room];
  }

  updateRoom(u: RoomUpdate, now: number): void {
    const origin = roomOrigin(u.key);
    if (!origin) return;
    let r = this.live.get(u.key);
    if (!r) {
      r = {
        key: u.key,
        ox: origin.x,
        oy: origin.y,
        gameTime: null,
        objects: {},
        users: {},
        tickAt: now,
        motion: new Map(),
        effects: [],
        visual: [],
        prevVisual: [],
        visualAt: 0,
        blankVisuals: 0,
        sceneryAt: null,
      };
      this.live.set(u.key, r);
    }
    const isTick = u.gameTime !== null && u.gameTime !== r.gameTime;
    const shard = splitKey(u.key).shard;

    const motion = new Map<string, Motion>();
    for (const id in u.objects) {
      const o = u.objects[id];
      if (o.type !== "creep" && o.type !== "powerCreep") continue;
      const at = r.motion.has(id) ? creepPosition(r, id, now, this.tickMs(shard)) : null;
      const from = at && Math.hypot(at.x - o.x, at.y - o.y) <= MAX_SLIDE ? at : { x: o.x, y: o.y };
      motion.set(id, { fx: from.x, fy: from.y, tx: o.x, ty: o.y });
    }
    r.motion = motion;
    r.tickAt = now;
    r.objects = u.objects;
    r.users = u.users;
    if (isTick) {
      r.gameTime = u.gameTime;
      r.effects = effectsOf(u.objects);
    }

    if (u.visual !== null) {
      const { items, marked } = stripScenery(parseVisual(u.visual));
      if (marked && r.gameTime !== null) r.sceneryAt = r.gameTime;
      if (items.length > 0) {
        r.prevVisual = r.visual;
        r.visual = items;
        r.visualAt = now;
        r.blankVisuals = 0;
      } else if (++r.blankVisuals > BLANK_VISUALS_KEPT && r.visual.length > 0) {
        r.prevVisual = r.visual;
        r.visual = [];
        r.visualAt = now;
      }
    }
    if (isTick) this.emit({ type: "tick", key: u.key });
  }

  /**
   * Whether the viewer draws the room's sky, weather and town: everywhere but
   * in a castle whose bot draws its own (one deployed before the scenery
   * markers), so nothing is drawn twice.
   */
  ownsScenery(r: LiveRoom): boolean {
    if (!this.castleOf(r.key) || r.visual.length === 0) return true;
    return r.sceneryAt !== null && r.gameTime !== null && r.gameTime - r.sceneryAt < SCENERY_KEPT_TICKS;
  }

  /** A streamed room still being updated; one left behind keeps its last state but is not drawn in detail. */
  isFresh(r: LiveRoom, now: number): boolean {
    return now - r.tickAt < 4 * this.tickMs(splitKey(r.key).shard) + 2000;
  }
}

/** Where a creep stands now, sliding from its last tile to its new one over the tick. */
export function creepPosition(r: LiveRoom, id: string, now: number, tickMs: number): { x: number; y: number } {
  const m = r.motion.get(id);
  if (!m) {
    const o = r.objects[id];
    return { x: o?.x ?? 0, y: o?.y ?? 0 };
  }
  const t = Math.min(1, Math.max(0, (now - r.tickAt) / (tickMs * 0.9)));
  return { x: m.fx + (m.tx - m.fx) * t, y: m.fy + (m.ty - m.fy) * t };
}

const CREEP_ACTIONS: Array<[string, EffectKind, boolean]> = [
  // [actionLog field, effect, whether it runs from the target to the creep]
  ["harvest", "harvest", true],
  ["upgradeController", "upgrade", false],
  ["build", "build", false],
  ["repair", "repair", false],
  ["attack", "attack", false],
  ["rangedAttack", "ranged", false],
  ["rangedMassAttack", "mass", false],
  ["heal", "heal", false],
  ["rangedHeal", "heal", false],
  ["reserveController", "claim", false],
  ["attackController", "claim", false],
];

/** What every creep, tower and link did this tick, by its action log. */
export function effectsOf(objects: RoomObjects): Effect[] {
  const out: Effect[] = [];
  for (const id in objects) {
    const o = objects[id];
    const log = o.actionLog;
    if (!log) continue;
    const add = (kind: EffectKind, to: { x: number; y: number } | null | undefined, reverse = false, text?: string) => {
      if (!to || typeof to.x !== "number") return;
      out.push(reverse ? { kind, id, x1: to.x, y1: to.y, x2: o.x, y2: o.y, text } : { kind, id, x1: o.x, y1: o.y, x2: to.x, y2: to.y, text });
    };
    if (o.type === "creep" || o.type === "powerCreep") {
      for (const [field, kind, reverse] of CREEP_ACTIONS) add(kind, log[field], reverse);
      if (log.say && typeof log.say.message === "string") add("say", { x: o.x, y: o.y }, false, log.say.message);
    } else if (o.type === "tower") {
      add("tower-attack", log.attack);
      add("tower-heal", log.heal);
      add("tower-repair", log.repair);
    } else if (o.type === "link") {
      add("link", log.transferEnergy);
    }
  }
  return out;
}
