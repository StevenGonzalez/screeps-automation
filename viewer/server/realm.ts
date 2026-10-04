// The viewer's one connection to the Screeps server. It holds the account's
// token, finds the realm's castles and keeps finding them as castles are won
// or lost, and streams what the page needs: every castle's map view, the
// realm's map overlay, full detail of the one or two rooms on screen, the
// console, and the town's sky worked out from the tick.
//
// The server streams full room detail (objects and RoomVisual overlays) for
// only two rooms per user per tick, across all of the user's connections, the
// game client included. Room detail is therefore only kept for the rooms the
// page asks for (`setFocus`); the map view, which has no such limit, covers
// every castle at once.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { castleName } from "../../src/services/services.chronicle";
import {
  townAurora,
  townClock,
  townDragon,
  townFallingStar,
  townFeast,
  townHowl,
  townSeason,
  townStorm,
} from "../../src/services/services.town";
import { applyDiff, mapVisualRooms, parseVisual, roomKey, splitKey, type RoomObjects } from "../shared/realm";
import type { Castle, Hello, Lore, Me, RealmInfo, RoomUpdate, Status, TownPlan } from "../shared/protocol";

export interface ScreepsConfig {
  token: string;
  protocol?: string;
  hostname?: string;
  port?: number;
  path?: string;
}

export type Listener = (event: string, data: unknown) => void;

interface LiveRoom {
  objects: RoomObjects;
  users: Record<string, { username?: string }>;
  gameTime: number | null;
}

// How often to look for castles won or lost, and how soon after a Chronicle
// entry (which is how the bot announces a castle rising or falling).
const DISCOVER_EVERY_MS = 60_000;
const DISCOVER_AFTER_CHRONICLE_MS = 5_000;
// Controller levels come from map-stats, which the server allows 60 times an hour.
const LEVELS_EVERY_MS = 10 * 60_000;
// Towns grow a cottage now and then; Memory may be read 1440 times a day.
const TOWNS_EVERY_MS = 30 * 60_000;
const MAX_FOCUS = 2;
const RECONNECT_MAX_MS = 30_000;

export class Realm {
  private readonly base: string;
  private ws: WebSocket | null = null;
  private stopped = false;
  private backoff = 1000;
  private timers: ReturnType<typeof setInterval>[] = [];
  private discoverSoon: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<Listener>();
  // Channels subscribed on the current connection.
  private readonly subs = new Set<string>();
  private readonly terrainCache = new Map<string, Promise<string>>();
  private readonly tickSeen = new Map<string, { gameTime: number; at: number; tickMs: number }>();

  private status: Status = { connected: false, error: null };
  private me: Me | null = null;
  private castles = new Map<string, Castle>();
  private remotes = new Set<string>();
  private readonly maps = new Map<string, Record<string, unknown>>();
  private readonly mapVisuals = new Map<string, string>();
  private readonly live = new Map<string, LiveRoom>();
  private readonly lore = new Map<string, Lore>();
  private cpu: { cpu: number; memory: number } | null = null;
  private readonly digests = new Map<string, RealmDigest>();
  private focus: string[] = [];
  // Each open page's rooms, most important first, in the order the pages
  // first asked.
  private readonly pageFocus = new Map<string, string[]>();

  constructor(private readonly cfg: ScreepsConfig, private readonly cacheDir: string, private readonly log: (msg: string) => void) {
    const protocol = cfg.protocol ?? "https";
    const hostname = cfg.hostname ?? "screeps.com";
    const port = cfg.port ?? (protocol === "https" ? 443 : 80);
    this.base = `${protocol}://${hostname}:${port}${(cfg.path ?? "/").replace(/\/+$/, "")}`;
  }

  async start(): Promise<void> {
    try {
      await this.discover();
      await this.updateLevels();
    } catch (e) {
      this.setStatus(this.status.connected, `could not reach ${this.base}: ${(e as Error).message}`);
    }
    this.connect();
    this.timers.push(setInterval(() => this.discover().catch((e) => this.log(`discover: ${e.message}`)), DISCOVER_EVERY_MS));
    this.timers.push(setInterval(() => this.updateLevels().catch((e) => this.log(`levels: ${e.message}`)), LEVELS_EVERY_MS));
    this.timers.push(setInterval(() => this.updateTowns().catch((e) => this.log(`towns: ${e.message}`)), TOWNS_EVERY_MS));
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    if (this.discoverSoon) clearTimeout(this.discoverSoon);
    this.ws?.close();
  }

  listen(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): Omit<Hello, "page"> {
    return {
      status: this.status,
      realm: this.realmInfo(),
      maps: Object.fromEntries(this.maps),
      mapVisuals: Object.fromEntries(this.mapVisuals),
      rooms: [...this.live].filter(([, r]) => Object.keys(r.objects).length > 0).map(([key, r]) => this.roomUpdate(key, r, null)),
      lore: [...this.lore.values()],
      cpu: this.cpu,
      digests: Object.fromEntries(this.digests),
    };
  }

  /** A page's rooms to stream in full, most important first; any room may be watched, not only castles. */
  setFocus(page: string, keys: string[]): void {
    const valid = keys.filter((k) => /^[A-Za-z0-9_-]+\/[WE]\d+[NS]\d+$/.test(k));
    this.pageFocus.set(page, [...new Set(valid)]);
    this.refocus();
  }

  dropPage(page: string): void {
    if (this.pageFocus.delete(page)) this.refocus();
  }

  // With several pages open, every page gets its first room before any gets a
  // second, the newest page first, so two pages share the server's two rooms
  // rather than taking them from each other in turn.
  private refocus(): void {
    const pages = [...this.pageFocus.values()].reverse();
    const focus: string[] = [];
    for (let rank = 0; rank < MAX_FOCUS; rank++) {
      for (const keys of pages) if (keys[rank] && !focus.includes(keys[rank])) focus.push(keys[rank]);
    }
    this.focus = focus.slice(0, MAX_FOCUS);
    this.sync();
    // A room already streaming is sent at once, so a page that switches to
    // it need not wait a tick.
    for (const key of this.focus) {
      const r = this.live.get(key);
      if (r && Object.keys(r.objects).length > 0) this.emit("room", this.roomUpdate(key, r, null));
    }
  }

  terrain(key: string): Promise<string> {
    let p = this.terrainCache.get(key);
    if (!p) {
      p = this.loadTerrain(key);
      this.terrainCache.set(key, p);
      p.catch(() => this.terrainCache.delete(key));
    }
    return p;
  }

  private async loadTerrain(key: string): Promise<string> {
    const { shard, room } = splitKey(key);
    const dir = join(this.cacheDir, "terrain");
    const file = join(dir, `${shard}.${room}`);
    if (existsSync(file)) return readFileSync(file, "utf8");
    const res = await this.api(`game/room-terrain?room=${room}&encoded=1&shard=${shard}`);
    const terrain: unknown = res.terrain?.[0]?.terrain;
    if (typeof terrain !== "string" || terrain.length !== 2500) throw new Error(`no terrain for ${key}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, terrain);
    return terrain;
  }

  private async api(path: string, body?: unknown): Promise<any> {
    const res = await fetch(`${this.base}/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "X-Token": this.cfg.token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  }

  private emit(event: string, data: unknown): void {
    for (const fn of this.listeners) fn(event, data);
  }

  private setStatus(connected: boolean, error: string | null): void {
    this.status = { connected, error };
    this.emit("status", this.status);
  }

  private realmInfo(): RealmInfo {
    return { me: this.me, castles: [...this.castles.values()], remotes: [...this.remotes] };
  }

  private roomUpdate(key: string, r: LiveRoom, visual: string | null): RoomUpdate {
    return { key, gameTime: r.gameTime, objects: r.objects, users: r.users, visual };
  }

  // The account's castles, by shard, as the server has them now.
  private async discover(): Promise<void> {
    const me = await this.api("auth/me");
    this.me = { id: String(me._id), username: String(me.username), gcl: Number(me.gcl) || 0 };
    const res = await this.api(`user/rooms?id=${this.me.id}`);
    const next = new Map<string, Castle>();
    for (const [shard, rooms] of Object.entries<string[]>(res.shards ?? {})) {
      for (const room of rooms ?? []) {
        const key = roomKey(shard, room);
        next.set(
          key,
          this.castles.get(key) ?? { key, shard, room, name: await this.nameOf(shard, room), level: 0, town: await this.townOf(shard, room) }
        );
      }
    }
    const changed = next.size !== this.castles.size || [...next.keys()].some((k) => !this.castles.has(k));
    this.castles = next;
    if (changed) {
      await this.updateLevels().catch((e) => this.log(`levels: ${e.message}`));
      this.sync();
    }
    this.emit("realm", this.realmInfo());
  }

  // A value from the bot's Memory, undefined when there is none.
  private async memory(shard: string, path: string): Promise<unknown> {
    const res = await this.api(`user/memory?path=${encodeURIComponent(path)}&shard=${shard}`);
    if (typeof res.data !== "string" || !res.data.startsWith("gz:")) return undefined;
    return JSON.parse(gunzipSync(Buffer.from(res.data.slice(3), "base64")).toString("utf8"));
  }

  // The castle's name as the bot gives it: its own name if one was set with
  // the console, else the one made from the room's name.
  private async nameOf(shard: string, room: string): Promise<string> {
    let townName: unknown;
    try {
      townName = await this.memory(shard, `rooms.${room}.townName`);
    } catch (e) {
      this.log(`name of ${room}: ${(e as Error).message}`);
    }
    const g = globalThis as { Memory?: unknown };
    const saved = g.Memory;
    g.Memory = { rooms: { [room]: typeof townName === "string" ? { townName } : {} } };
    try {
      return castleName(room);
    } finally {
      g.Memory = saved;
    }
  }

  private async townOf(shard: string, room: string): Promise<TownPlan | null> {
    try {
      return townPlan(await this.memory(shard, `rooms.${room}.town`));
    } catch (e) {
      this.log(`town of ${room}: ${(e as Error).message}`);
      return null;
    }
  }

  private async updateTowns(): Promise<void> {
    let changed = false;
    for (const c of this.castles.values()) {
      const town = await this.townOf(c.shard, c.room);
      if (JSON.stringify(town) === JSON.stringify(c.town)) continue;
      c.town = town;
      changed = true;
    }
    if (changed) this.emit("realm", this.realmInfo());
  }

  private async updateLevels(): Promise<void> {
    const byShard = new Map<string, string[]>();
    for (const c of this.castles.values()) byShard.set(c.shard, [...(byShard.get(c.shard) ?? []), c.room]);
    for (const [shard, rooms] of byShard) {
      const res = await this.api("game/map-stats", { rooms, statName: "owner0", shard });
      for (const room of rooms) {
        const level = res.stats?.[room]?.own?.level;
        const castle = this.castles.get(roomKey(shard, room));
        if (castle && typeof level === "number") castle.level = level;
      }
    }
  }

  private connect(): void {
    if (this.stopped) return;
    const ws = new WebSocket(`${this.base.replace(/^http/, "ws")}/socket/websocket`);
    this.ws = ws;
    ws.onopen = () => ws.send(`auth ${this.cfg.token}`);
    ws.onmessage = (e) => this.onMessage(String(e.data));
    ws.onerror = () => {};
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.subs.clear();
      if (this.stopped) return;
      this.setStatus(false, this.status.error);
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, RECONNECT_MAX_MS);
    };
  }

  private onMessage(data: string): void {
    if (data.startsWith("auth ok")) {
      this.backoff = 1000;
      this.setStatus(true, null);
      this.sync();
      return;
    }
    if (data.startsWith("auth failed")) {
      this.setStatus(false, "the server refused the token in screeps.json");
      this.backoff = RECONNECT_MAX_MS;
      this.ws?.close();
      return;
    }
    if (!data.startsWith("[")) return;
    let channel: string, payload: any;
    try {
      [channel, payload] = JSON.parse(data);
    } catch {
      return;
    }
    if (channel.startsWith("err@room:")) {
      this.emit("limited", { key: channel.slice("err@room:".length) });
    } else if (channel.startsWith("room:")) {
      this.onRoom(channel.slice("room:".length), payload);
    } else if (channel.startsWith("roomMap2:")) {
      const key = channel.slice("roomMap2:".length);
      this.maps.set(key, payload ?? {});
      this.emit("map", { key, view: payload ?? {} });
    } else if (channel.startsWith("mapVisual:")) {
      const shard = channel.slice(channel.lastIndexOf("/") + 1);
      this.onMapVisual(shard, typeof payload === "string" ? payload : "");
    } else if (channel.endsWith("/digest")) {
      this.onDigest(channel.split("/").at(-2) ?? "", payload);
    } else if (channel.endsWith("/cpu")) {
      this.cpu = { cpu: Number(payload?.cpu) || 0, memory: Number(payload?.memory) || 0 };
      this.emit("cpu", this.cpu);
    } else if (channel.endsWith("/console")) {
      const lines: unknown[] = payload?.messages?.log ?? [];
      if (lines.length === 0) return;
      this.emit("log", { shard: payload.shard ?? null, lines });
      if (lines.some((l) => typeof l === "string" && l.includes("[Chronicle]"))) this.scheduleDiscover();
    }
  }

  private onRoom(key: string, payload: any): void {
    const r = this.live.get(key);
    if (!r || !payload) return;
    if (payload.objects) applyDiff(r.objects, payload.objects);
    if (payload.users) Object.assign(r.users, payload.users);
    if (typeof payload.gameTime === "number") {
      r.gameTime = payload.gameTime;
      this.onTick(splitKey(key).shard, payload.gameTime);
    }
    const castle = this.castles.get(key);
    if (castle) {
      for (const id in r.objects) {
        const o = r.objects[id];
        if (o.type === "controller" && typeof o.level === "number") castle.level = o.level;
      }
    }
    this.emit("room", this.roomUpdate(key, r, typeof payload.visual === "string" ? payload.visual : null));
  }

  // The bot's summary of a shard's castles (Memory.digest), kept as JSON.
  private onDigest(shard: string, payload: unknown): void {
    if (typeof payload !== "string") return;
    let digest: RealmDigest;
    try {
      digest = JSON.parse(payload);
    } catch {
      return;
    }
    if (!digest || typeof digest.castles !== "object" || !Array.isArray(digest.chronicle)) return;
    this.digests.set(shard, digest);
    this.emit("digest", { shard, digest });
  }

  private onMapVisual(shard: string, text: string): void {
    this.emit("mapVisual", { shard, text });
    // No overlays at all is a heavy tick the bot skipped them on, not the realm shrinking.
    if (!text) return;
    this.mapVisuals.set(shard, text);
    const rooms = new Set<string>();
    for (const [s, t] of this.mapVisuals) {
      for (const room of mapVisualRooms(parseVisual(t))) {
        const key = roomKey(s, room);
        if (!this.castles.has(key)) rooms.add(key);
      }
    }
    const changed = rooms.size !== this.remotes.size || [...rooms].some((k) => !this.remotes.has(k));
    if (!changed) return;
    this.remotes = rooms;
    this.sync();
    this.emit("realm", this.realmInfo());
  }

  // Measures the tick and works out the sky for it, once per tick per shard.
  private onTick(shard: string, gameTime: number): void {
    const now = Date.now();
    const seen = this.tickSeen.get(shard);
    if (seen && gameTime <= seen.gameTime) return;
    let tickMs = seen?.tickMs ?? 3000;
    if (seen && gameTime - seen.gameTime <= 5) {
      const sample = (now - seen.at) / (gameTime - seen.gameTime);
      tickMs = Math.round(tickMs * 0.8 + Math.min(Math.max(sample, 200), 20_000) * 0.2);
    }
    this.tickSeen.set(shard, { gameTime, at: now, tickMs });
    const clock = townClock(gameTime);
    const dragon = townDragon(gameTime);
    const howl = townHowl(gameTime);
    const star = townFallingStar(gameTime);
    const lore: Lore = {
      shard,
      gameTime,
      tickMs,
      phase: clock.phase,
      hour: clock.hour,
      season: townSeason(gameTime),
      feast: townFeast(gameTime) ?? null,
      storm: townStorm(gameTime),
      aurora: townAurora(gameTime),
      dragon: dragon ? { t: dragon.t, x: dragon.x, y: dragon.y, dir: dragon.dir } : null,
      howl: howl ? { t: howl.t, x: howl.x, y: howl.y } : null,
      star: star ? { t: star.t, x: star.x, y: star.y } : null,
    };
    this.lore.set(shard, lore);
    this.emit("lore", lore);
  }

  private scheduleDiscover(): void {
    if (this.discoverSoon) return;
    this.discoverSoon = setTimeout(() => {
      this.discoverSoon = null;
      this.discover().catch((e) => this.log(`discover: ${e.message}`));
    }, DISCOVER_AFTER_CHRONICLE_MS);
  }

  // Brings the connection's subscriptions in line with what the realm needs.
  private sync(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.me || !this.status.connected) return;
    const id = this.me.id;
    const want = new Set<string>([`user:${id}/cpu`, `user:${id}/console`]);
    for (const c of this.castles.values()) {
      want.add(`mapVisual:${id}/${c.shard}`);
      want.add(`user:${id}/memory/${c.shard}/digest`);
      want.add(`roomMap2:${c.key}`);
    }
    for (const key of this.remotes) want.add(`roomMap2:${key}`);
    for (const key of this.focus) want.add(`room:${key}`);

    for (const ch of [...this.subs]) {
      if (want.has(ch)) continue;
      ws.send(`unsubscribe ${ch}`);
      this.subs.delete(ch);
      if (ch.startsWith("room:")) this.live.delete(ch.slice("room:".length));
    }
    for (const ch of want) {
      if (this.subs.has(ch)) continue;
      // A fresh subscription starts with the room whole, so the diffs that
      // follow apply to an empty room.
      if (ch.startsWith("room:")) this.live.set(ch.slice("room:".length), { objects: {}, users: {}, gameTime: null });
      ws.send(`subscribe ${ch}`);
      this.subs.add(ch);
    }
  }
}

const isTile = (v: unknown): v is string => typeof v === "string" && /^\d+,\d+$/.test(v);

/** The parts of a room's town memory the viewer draws, or null when it has no town. */
export function townPlan(raw: unknown): TownPlan | null {
  if (typeof raw !== "object" || raw === null) return null;
  const t = raw as Record<string, unknown>;
  const tiles = (v: unknown) => (Array.isArray(v) ? v.filter(isTile) : []);
  const cottages = (Array.isArray(t.cottages) ? t.cottages : [])
    .filter((c) => c && typeof c.x === "number" && typeof c.y === "number" && isTile(c.door))
    .map((c) => ({ x: c.x, y: c.y, door: c.door, name: String(c.name ?? "") }));
  return { posts: tiles(t.posts), square: tiles(t.square), fountain: isTile(t.fountain) ? t.fountain : undefined, cottages };
}
