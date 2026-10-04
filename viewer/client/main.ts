// The page: wires the server's stream into the store, lets the director run
// the camera, and draws each frame: terrain, the map view, the rooms streaming
// in full as scenes, the weather, the light of the hour and the omens, the
// bot's overlays over them, and the cinema's frame over all. The world is
// drawn on one canvas, and what lies over the light on another, on top of the
// page's layers (see index.html).

import { parseTile } from "../../src/services/services.town";
import type { DigestUpdate, Hello, Lore, RealmInfo, RoomUpdate, Status } from "../shared/protocol";
import { gclLevel, splitKey } from "../shared/realm";
import { Sprites, type Env, type Light, type Piece } from "./art";
import { clamp, roomOrigin, screenTransform, smoothstep, toWorld, visibleRect, worldTransform, type Frame } from "./camera";
import { Cinema, type Hud } from "./cinema";
import { describeCreep, Director } from "./director";
import { dossierOf, type Dossier } from "./dossier";
import { drawBorders, drawMapView, drawShroud, drawTerrain, realmLayout } from "./draw-realm";
import { drawMapVisual, drawRoomVisual } from "./draw-visual";
import { drawCreepLabels } from "./draw-world";
import { Grade } from "./grade";
import { Lighting } from "./lighting";
import { drawPieces, drawScene, roomView, wildPieces } from "./scene";
import { skyAt, type Sky } from "./sky";
import { creepPosition, Store, type LiveRoom } from "./store";
import { Terrain } from "./terrain";
import { drawOmens, drawWeather, type SkyRoom, type Weather } from "./weather";

const REALM_NAME = "Kingdom of Arca";
const VISUAL_FADE_MS = 350;
// How long after the server refuses a room to say why.
const LIMITED_WARNING_MS = 20_000;
// The sky runs on between ticks as the clock would, but no further than this
// many ticks past the last one heard, should the stream stall.
const SKY_AHEAD_TICKS = 3;
// Before the first tick is heard, a spring morning.
const SKY_BEFORE_LORE = 250;
// `?time=<tick>` shows the sky as it will be at that game tick, running on
// from there, to see the night or another season without waiting for it.
const SKY_TIME = Number(new URLSearchParams(location.search).get("time")) || null;
const pageStart = performance.now();
const MIN_SCALE = 0.05;
const MAX_SCALE = 90;
const HELP =
  "Space free camera  ·  1–9 keep to a castle, 0 tour  ·  ← → next castle  ·  M realm  ·  Click a creep for its dossier  ·  O overlays  ·  N names  ·  L letterbox  ·  H HUD  ·  F fullscreen";

const canvas = document.getElementById("realm") as HTMLCanvasElement;
const ctx = canvas.getContext("2d", { alpha: false })!;
const top = document.getElementById("top") as HTMLCanvasElement;
const topCtx = top.getContext("2d")!;
// Rooms are drawn here first while they fade in from the map view.
const layer = document.createElement("canvas");
const layerCtx = layer.getContext("2d")!;

const store = new Store();
const cinema = new Cinema(document.getElementById("grain")!);
const director = new Director(store, cinema);
const terrain = new Terrain();
const sprites = new Sprites();
const lighting = new Lighting(document.getElementById("light") as HTMLCanvasElement);
const grade = new Grade(canvas, document.getElementById("fog")!);

let overlays = true;
let names = true;
// The creep the viewer clicked on, whose dossier shows until another is chosen.
let selected: { key: string; id: string } | null = null;
let streamDown = false;
let w = 0;
let h = 0;
let dpr = 1;

// The stream.

const events = new EventSource("/realm/events");
function on<T>(name: string, fn: (data: T) => void): void {
  events.addEventListener(name, (ev) => fn(JSON.parse((ev as MessageEvent).data)));
}
on<Hello>("hello", (data) => {
  page = data.page;
  store.hello(data, performance.now());
  streamDown = false;
  // A new stream, perhaps a restarted server, knows nothing of what is filmed.
  posted = null;
});
on<RealmInfo>("realm", (data) => store.setRealm(data));
on<{ key: string; view: Record<string, unknown> }>("map", (data) => store.maps.set(data.key, data.view));
on<{ shard: string; text: string }>("mapVisual", (data) => store.setMapVisual(data.shard, data.text));
on<RoomUpdate>("room", (data) => store.updateRoom(data, performance.now()));
on<{ key: string }>("limited", (data) => store.limited.set(data.key, performance.now()));
on<Lore>("lore", (data) => store.setLore(data, performance.now()));
on<{ cpu: number; memory: number }>("cpu", (data) => (store.cpu = data));
on<DigestUpdate>("digest", (data) => store.digests.set(data.shard, data.digest));
on<{ lines: unknown[] }>("log", (data) => store.log(data.lines));
on<Status>("status", (data) => (store.status = data));
events.onerror = () => (streamDown = true);

// Tells the server which rooms to stream in full whenever the director's choice changes.
let page: string | null = null;
let posted: string | null = null;
let postedAt = 0;
function syncFocus(now: number): void {
  if (!page) return;
  const keys = director.focus(now);
  const sig = keys.join(",");
  if (sig === posted || now - postedAt < 400) return;
  posted = sig;
  postedAt = now;
  fetch("/realm/focus", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ page, keys }) }).catch(() => {
    posted = null;
  });
}

// Drawing.

function resize(): void {
  dpr = window.devicePixelRatio || 1;
  w = window.innerWidth;
  h = window.innerHeight;
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = layer.width = top.width = pw;
    canvas.height = layer.height = top.height = ph;
  }
}

function onScreen(rect: [number, number, number, number], r: LiveRoom): boolean {
  return r.ox + 49.5 >= rect[0] && r.ox - 0.5 <= rect[2] && r.oy + 49.5 >= rect[1] && r.oy - 0.5 <= rect[3];
}

// The sky over the shard being filmed, at the fractional tick between the
// last one heard and the next; undefined until a tick is heard.
function skyNow(now: number): Sky | undefined {
  const shard = director.describe(now).shard;
  const lore = (shard ? store.lore.get(shard) : undefined) ?? store.lore.values().next().value;
  if (!lore) return undefined;
  if (SKY_TIME) return skyAt(SKY_TIME + (now - pageStart) / lore.tickMs);
  return skyAt(lore.gameTime + clamp((now - lore.at) / lore.tickMs, 0, SKY_AHEAD_TICKS));
}

/**
 * The cinema's HUD. `close` is how far in the camera is: the ledger of the
 * castle under the camera shows only close in.
 */
function hud(now: number, view: { x: number; y: number }, close: number): Hud {
  const said = director.describe(now);
  const lore = said.shard ? store.lore.get(said.shard) : undefined;
  let clock = "";
  if (lore) {
    const parts = [`Tick ${lore.gameTime.toLocaleString()}`, `${title(lore.phase)}, ${String(lore.hour).padStart(2, "0")}:00`, title(lore.season)];
    if (lore.feast) parts.push(lore.feast);
    clock = parts.join("  ·  ");
  }
  const stats: string[] = [];
  if (store.me) stats.push(`GCL ${gclLevel(store.me.gcl)}`);
  if (store.cpu) stats.push(`CPU ${Math.round(store.cpu.cpu)}`);
  let warning: string | null = null;
  if (streamDown) warning = "Lost the viewer's server; reconnecting";
  else if (!store.status.connected) warning = store.status.error ? `Screeps: ${store.status.error}` : "Connecting to Screeps…";
  else if ([...store.limited.values()].some((at) => now - at < LIMITED_WARNING_MS))
    warning = "Screeps streams two rooms at once per player; an open game client uses them too";
  const here = store.castles.find((c) => {
    const o = roomOrigin(c.key);
    return o && Math.abs(view.x - o.x - 24.5) <= 25 && Math.abs(view.y - o.y - 24.5) <= 25;
  });
  return {
    realm: REALM_NAME,
    place: said.place,
    clock,
    castles: store.castles.map((c) => {
      const r = store.live.get(c.key);
      return {
        name: c.name,
        level: c.level,
        current: c.key === said.castle,
        raided: store.foreigners(c.key).length > 0,
        live: !!r && store.isFresh(r, now),
      };
    }),
    mode: said.mode,
    stats: stats.join("  ·  "),
    warning,
    dossier: dossier(now),
    ledger: here ? (store.ledger(here.key) ?? null) : null,
    ledgerAlpha: close,
    chronicle: (said.shard ? store.digests.get(said.shard) : store.digests.values().next().value)?.chronicle ?? [],
  };
}

// The dossier of the creep the viewer chose, or else of the one the director
// films. A choice lapses once its creep is gone or its room no longer streams.
function dossier(now: number): Dossier | null {
  const pick = selected ?? director.featured();
  if (!pick) return null;
  const r = store.live.get(pick.key);
  const o = r?.objects[pick.id];
  if (!r || !o || o.type !== "creep" || !store.isFresh(r, now)) {
    if (pick === selected) selected = null;
    return null;
  }
  const foe = !!store.me && o.user !== store.me.id;
  let detail = describeCreep(o, r.effects.filter((e) => e.id === pick.id).map((e) => e.kind), r);
  const owner = foe ? r.users[o.user]?.username : undefined;
  if (owner) detail = `of ${owner}, ${detail}`;
  return dossierOf(pick.id, o, r.gameTime, detail, foe);
}

// A ring at the feet of the creep the viewer chose.
function drawSelection(f: Frame): void {
  if (!selected) return;
  const r = store.live.get(selected.key);
  if (!r || !r.objects[selected.id]) return;
  const p = creepPosition(r, selected.id, f.now, store.tickMs(splitKey(r.key).shard));
  worldTransform(f);
  const { ctx } = f;
  ctx.globalAlpha = 0.75 + 0.25 * Math.sin(f.now / 300);
  ctx.strokeStyle = "#f2c14e";
  ctx.lineWidth = 2 / f.cam.scale;
  ctx.beginPath();
  // About its feet, a little south of its tile's middle (see figures).
  ctx.ellipse(r.ox + p.x, r.oy + p.y + 0.12, 0.45, 0.18, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// The creep under a point on screen, if any stands there.
function creepAt(sx: number, sy: number, now: number): { key: string; id: string } | null {
  const [wx, wy] = toWorld({ w, h, cam: director.camera }, sx, sy);
  let best: { key: string; id: string } | null = null;
  let bestD = 0.7;
  for (const r of store.live.values()) {
    if (!store.isFresh(r, now)) continue;
    const tickMs = store.tickMs(splitKey(r.key).shard);
    for (const id in r.objects) {
      if (r.objects[id].type !== "creep" || r.objects[id].spawning) continue;
      const p = creepPosition(r, id, now, tickMs);
      // A figure stands about a tile tall over its tile (see figures).
      const d = Math.hypot(wx - r.ox - p.x, (wy - r.oy - p.y + 0.35) * 0.6);
      if (d < bestD) {
        bestD = d;
        best = { key: r.key, id };
      }
    }
  }
  return best;
}

function title(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

let last = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = clamp(now - last, 0, 100);
  last = now;
  resize();
  const bar = cinema.barHeight(w, h, dt);
  const { view, fade } = director.update(now, { w, h, bar }, dt);
  syncFocus(now);
  const f: Frame = { ctx, dpr, w, h, bar, cam: view, now };
  const me = store.me?.id;

  screenTransform(f);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#070809";
  ctx.fillRect(0, 0, w, h);

  const known = skyNow(now);
  if (known) terrain.setSeason(known.season);
  const sky = known ?? skyAt(SKY_BEFORE_LORE);
  const layout = realmLayout(store);
  drawTerrain(f, layout, terrain);

  const s = view.scale;
  const detail = smoothstep(3.5, 6, s);
  const mapAlpha = 1 - smoothstep(4, 9, s);
  const rect = visibleRect(f);
  const shown: LiveRoom[] = [];
  if (detail > 0.01) for (const r of store.live.values()) if (store.isFresh(r, now) && onScreen(rect, r)) shown.push(r);
  const detailed = new Set(shown.map((r) => r.key));
  const unseen = new Set(layout.rooms.filter((key) => !store.sees(key, now)));

  // The map view where no room streams, fading out where one fades in.
  worldTransform(f);
  for (const key of layout.rooms) drawMapView(f, store, key, detailed.has(key) ? 1 - detail : 1);

  // Rooms seen only on the map get their woods, so the land runs on unbroken
  // up to the fog of war.
  const wild: Array<{ ox: number; oy: number; terrain: string }> = [];
  if (detail > 0.01) {
    for (const key of layout.rooms) {
      const o = roomOrigin(key);
      const t = terrain.terrain(key);
      if (!o || !t || detailed.has(key) || unseen.has(key) || o.x + 49.5 < rect[0] || o.x - 0.5 > rect[2] || o.y + 49.5 < rect[1] || o.y - 0.5 > rect[3]) continue;
      wild.push({ ox: o.x, oy: o.y, terrain: t });
    }
  }

  const lights: Light[] = [];
  if (shown.length + wild.length > 0) {
    const fading = detail < 0.99;
    const target = fading ? layerCtx : ctx;
    if (fading) {
      layerCtx.setTransform(1, 0, 0, 1, 0, 0);
      layerCtx.clearRect(0, 0, layer.width, layer.height);
    }
    const lf: Frame = { ...f, ctx: target };
    sprites.scale(s * dpr);
    // Each room's ground, then what stands in them all together.
    const pieces: Piece[] = [];
    for (const o of wild) {
      const env: Env = { sky, season: sky.season, snow: sky.season === "winter", now, tickT: 0, px: s, sprites, lights };
      wildPieces({ r: { ox: o.ox, oy: o.oy, objects: {} }, terrain: o.terrain, rect }, env, pieces);
    }
    for (const r of shown) {
      const tickMs = store.tickMs(splitKey(r.key).shard);
      const env: Env = { sky, season: sky.season, snow: sky.season === "winter", now, tickT: clamp((now - r.tickAt) / tickMs, 0, 1), px: s, sprites, lights };
      const v = roomView(r, store.castleOf(r.key)?.town ?? null, me, tickMs, terrain.terrain(r.key), rect, store.ownsScenery(r));
      drawScene(lf, v, env, pieces);
    }
    drawPieces(lf, pieces, sky);
    if (fading) {
      screenTransform(f);
      ctx.globalAlpha = detail;
      ctx.drawImage(layer, 0, 0, w, h);
      ctx.globalAlpha = 1;
    }
  }
  drawShroud(f, layout, unseen);

  // The weather and the sky over the castles on screen whose sky the viewer
  // draws; where the bot still draws its own, it is left to the bot.
  const weather: Weather = { rooms: [], focus: null, unlit: [], alpha: detail };
  for (const r of shown) {
    const castle = store.castleOf(r.key);
    if (!castle) continue;
    if (!store.ownsScenery(r)) {
      weather.unlit.push([r.ox - 0.5, r.oy - 0.5, r.ox + 49.5, r.oy + 49.5]);
      continue;
    }
    const room: SkyRoom = { key: r.key, ox: r.ox, oy: r.oy, terrain: terrain.terrain(r.key), fountain: castle.town?.fountain ? parseTile(castle.town.fountain) : null };
    weather.rooms.push(room);
    if (Math.abs(view.x - r.ox - 24.5) <= 25 && Math.abs(view.y - r.oy - 24.5) <= 25) weather.focus = room;
  }
  // The weather is drawn with the world, and so graded with it.
  grade.tone(f, sky);
  drawWeather(f, sky, weather);
  lighting.draw(f, sky, lights, weather.unlit);

  // Over the light.
  const tf: Frame = { ...f, ctx: topCtx };
  topCtx.setTransform(1, 0, 0, 1, 0, 0);
  topCtx.clearRect(0, 0, top.width, top.height);
  drawOmens(tf, sky, weather);
  drawSelection(tf);

  drawBorders(tf, store, layout, mapAlpha);

  // The bot's overlays, the last tick's fading into this one's.
  const visualAlpha = overlays ? smoothstep(5, 9, s) : 0;
  for (const r of shown) {
    const k = clamp((now - r.visualAt) / VISUAL_FADE_MS, 0, 1);
    if (k < 1) drawRoomVisual(tf, r.prevVisual, r.ox, r.oy, visualAlpha * (1 - k));
    drawRoomVisual(tf, r.visual, r.ox, r.oy, visualAlpha * k);
  }

  if (detail > 0.99 && s >= 10) {
    const nameAlpha = names ? smoothstep(28, 40, s) : 0;
    for (const r of shown) drawCreepLabels(tf, r, store.tickMs(splitKey(r.key).shard), me, nameAlpha);
  }

  if (overlays) for (const [shard, items] of store.mapVisuals) drawMapVisual(tf, items, shard, mapAlpha);

  cinema.draw(tf, fade, hud(now, view, 1 - mapAlpha));
}

// Taking the camera.

let drag: { x: number; y: number } | null = null;
// Where a press began, until it moves far enough to be a drag rather than a click.
let press: { x: number; y: number } | null = null;
let idleTimer = 0;

function showCursor(): void {
  canvas.style.cursor = drag ? "grabbing" : "grab";
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => (canvas.style.cursor = "none"), 3000);
}

canvas.addEventListener("pointerdown", (e) => {
  drag = { x: e.clientX, y: e.clientY };
  press = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
  showCursor();
});
canvas.addEventListener("pointermove", (e) => {
  showCursor();
  if (!drag) return;
  if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 4) return;
  press = null;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (dx === 0 && dy === 0) return;
  director.takeOver(performance.now());
  director.camera.x -= dx / director.camera.scale;
  director.camera.y -= dy / director.camera.scale;
  drag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener("pointerup", (e) => {
  if (press) selected = creepAt(e.clientX, e.clientY, performance.now());
  press = null;
  drag = null;
  showCursor();
});
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    showCursor();
    director.takeOver(performance.now());
    const cam = director.camera;
    const [wx, wy] = toWorld({ w, h, cam }, e.clientX, e.clientY);
    cam.scale = clamp(cam.scale * Math.exp(-e.deltaY * 0.0015), MIN_SCALE, MAX_SCALE);
    // The point under the cursor stays under it.
    cam.x = wx - (e.clientX - w / 2) / cam.scale;
    cam.y = wy - (e.clientY - h / 2) / cam.scale;
  },
  { passive: false },
);

window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const now = performance.now();
  if (/^[1-9]$/.test(e.key)) {
    const c = store.castles[Number(e.key) - 1];
    if (c) director.pin(c.key, now);
  } else if (e.key === "0") {
    director.pin(null, now);
  } else if (e.key === " ") {
    e.preventDefault();
    director.toggle(now);
  } else if (e.key === "ArrowRight") {
    director.step(1, now);
  } else if (e.key === "ArrowLeft") {
    director.step(-1, now);
  } else if (e.key === "m" || e.key === "M") {
    director.showRealm(now);
  } else if (e.key === "o" || e.key === "O") {
    overlays = !overlays;
  } else if (e.key === "n" || e.key === "N") {
    names = !names;
  } else if (e.key === "l" || e.key === "L") {
    cinema.letterbox = !cinema.letterbox;
  } else if (e.key === "h" || e.key === "H") {
    cinema.hudShown = !cinema.hudShown;
  } else if (e.key === "f" || e.key === "F") {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  } else if (e.key === "Escape") {
    selected = null;
  } else if (e.key === "?") {
    cinema.caption(HELP, "quiet", now);
  }
});

resize();
cinema.caption(HELP, "quiet", performance.now());
showCursor();
requestAnimationFrame(frame);
