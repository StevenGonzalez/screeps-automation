// The realm's people, each drawn as what its title says it is
// (figures-looks.ts): masons with hods, miners with lamps on their helmets,
// yeomen in green hoods with longbows, and the realm's enemies as raiders and
// trolls. They stand up out of the ground in the three-quarter view of art.ts,
// about three quarters of a tile tall, turned towards where they walk or what
// they work at. They stride as they slide from tile to tile, breathe as they
// stand, and swing their tools in time with the tick, and what the swings do
// is drawn with them (figures-deeds.ts). Figures move every frame, so they
// are painted afresh rather than stamped (figures-paint.ts).

import { TOWN_DAY_LENGTH } from "../../src/config/config.town";
import type { RoomObject } from "../shared/realm";
import { castRound, ellipse, hashString, PALETTE, resourceColour, rng, type Env, type Piece } from "./art";
import { planOf } from "./buildings";
import { tileOf } from "./buildings-plan";
import { BATTLEMENT_H, POST_DECK } from "./buildings-paint";
import { blowArm, BLOWS_PER_TICK, deedPieces, LOOSE, runeRing, strikeArm, thrust, type Actor } from "./figures-deeds";
import { ARMS, ARMS2, creepTitle, lookOf, SKIN, VARY, type Glow, type Look, type Tool } from "./figures-looks";
import { FAR_X, handAt, HEAD, NEAR_X, paintBird, paintMule, paintPerson, SHOULDER, toolReach, type Dress, type Pose } from "./figures-paint";
import { onScreen, type RoomView } from "./scene";
import { creepPosition, type Effect } from "./store";

// A figure's feet stand a little south of its tile's middle, so that the
// figure, rising from them, sits over the tile.
const FOOT = 0.12;
// How far one step carries a figure, in tiles.
const STEP = 0.22;
// A figure smaller than this many pixels a tile is a speck: no tools or faces.
const SPECK_PX = 14;
const FINE_PX = 30;
// Figures are drawn a little larger than life against the buildings, so
// they read at a glance.
const GROWN = 1.1;

/** How a figure has been walking, kept from frame to frame. */
interface Gait {
  x: number;
  y: number;
  face: 1 | -1;
  back: boolean;
  // Through the walk, in radians: each π is one step.
  phase: number;
  // 0 standing to 1 walking, eased so that a figure slows to a stand.
  stride: number;
  seen: number;
}

const gaits = new Map<string, Gait>();
let pruned = 0;

function walk(key: string, x: number, y: number, now: number, seed: number): Gait {
  let g = gaits.get(key);
  if (!g || now - g.seen > 3000 || Math.abs(x - g.x) + Math.abs(y - g.y) > 1.6) {
    g = { x, y, face: seed & 1 ? 1 : -1, back: false, phase: 0, stride: 0, seen: now };
    gaits.set(key, g);
    return g;
  }
  const dt = now - g.seen;
  if (dt <= 0) return g;
  const dx = x - g.x;
  const dy = y - g.y;
  const d = Math.hypot(dx, dy);
  const moving = d > 0.0005;
  if (moving) {
    if (Math.abs(dx) > 0.0005) g.face = dx > 0 ? 1 : -1;
    g.back = dy < 0 && -dy > Math.abs(dx);
    g.phase += (d / STEP) * Math.PI;
  } else {
    // Coming to a stand: the feet brought together.
    const rest = Math.round(g.phase / Math.PI) * Math.PI;
    g.phase += (rest - g.phase) * Math.min(1, dt / 180);
  }
  g.stride += ((moving ? 1 : 0) - g.stride) * Math.min(1, dt / 150);
  g.x = x;
  g.y = y;
  g.seen = now;
  return g;
}

// Skin and hair, chosen by a figure's name: the realm's folk are of every kind.
const SKINS = ["#f1cfaa", "#e2b48c", "#c99468", "#a8724a", "#7f5236", "#5c3a26"];
const HAIRS = ["#2a1d14", "#3e2a1a", "#5e3c22", "#8a5a2e", "#b8894a", "#7e3a1e", "#cfc6b8", "#1a1410"];

function dressOf(look: Look, seed: number, v: RoomView): Dress {
  const r = rng(seed);
  const skin = look.skin === VARY ? SKINS[Math.floor(r() * SKINS.length)] : look.skin;
  const hairColour = HAIRS[Math.floor(r() * HAIRS.length)];
  const hair = look.hair === null ? null : look.hair === VARY ? hairColour : look.hair;
  const bearded = r() < look.beard;
  const colour = (c: string) => (c === SKIN ? skin : c === ARMS ? v.arms.field : c === ARMS2 ? v.arms.other : c === VARY ? hairColour : c);
  return {
    skin,
    hair,
    long: r() < 0.35 || look.hat === "wizard",
    beard: bearded ? (hair ?? hairColour) : null,
    longBeard: look.hat === "wizard" || look.hat === "crown" || r() < 0.15,
    shirt: colour(look.shirt),
    sleeves: colour(look.sleeves ?? look.shirt),
    legs: colour(look.legs),
    boots: colour(look.boots),
    hat: colour(look.hatColour),
    cape: look.cape ? colour(look.cape) : null,
    trim: look.trim ? colour(look.trim) : null,
    apron: look.apron ? colour(look.apron) : null,
    field: v.arms.field,
    other: v.arms.other,
  };
}

// Tools a figure takes up for work it does not carry its own tool for.
const PICKS = new Set<Tool>(["pickaxe"]);
const HAMMERS = new Set<Tool>(["hammer", "mallet"]);
const STAVES = new Set<Tool>(["staff", "orb-staff", "skull-staff"]);
const THRUSTS = new Set<Tool>(["lance", "trident", "dagger"]);
const HEAVY = new Set<Tool>(["pickaxe", "maul", "greataxe", "greatsword", "hammer", "mallet"]);

// How a figure stands when it is not working: what it carries and how.
function rest(p: Pose, w: number): void {
  switch (p.tool) {
    case "pickaxe":
    case "maul":
    case "greataxe":
    case "greatsword":
    case "club":
      // Carried on the shoulder.
      p.near = [0.35 + w * 0.1, 1.5];
      p.toolA = Math.PI + 0.95;
      break;
    case "staff":
    case "orb-staff":
    case "skull-staff":
    case "banner":
    case "trident":
      p.near = [0.45 + w * 0.12, 0.9];
      p.toolA = Math.PI - 0.08 + w * 0.12;
      break;
    case "lance":
      p.near = [0.4 + w * 0.1, 0.9];
      p.toolA = Math.PI - 0.35;
      break;
    case "sword":
      p.near = [0.25 + w * 0.3, 0.45];
      p.toolA = 0.8;
      break;
    case "longbow":
      p.near = [0.2 + w * 0.3, 0.25];
      p.toolA = Math.PI - 0.15;
      break;
    case "lute":
      p.near = [0.55, 0.75 + Math.sin(p.now / 110) * 0.12 * (1 - p.stride)];
      p.far = [1.15, 1.05];
      break;
    case "tankard":
    case "potion":
    case "scroll":
      p.near = [0.35 + w * 0.15, 1.25];
      break;
    case "censer":
      p.near = [0.3 + w * 0.2, 0.2];
      p.swing = Math.sin(p.now / 650 + p.seed) * 0.55;
      break;
    case "none":
      break;
    default:
      p.near = [0.15 + w * 0.45, 0.4];
      p.toolA = 0.95;
  }
  switch (p.off) {
    case "kite-shield":
    case "round-shield":
      p.far = [0.55, 0.95];
      break;
    case "buckler":
      p.far = [0.35 + w * 0.2, 0.7];
      break;
    case "lantern":
      p.far = [0.35 + w * 0.15, 0.25];
      break;
    case "torch":
      p.far = [0.55 + w * 0.1, 1.25];
      break;
    case "gold-sack":
      p.far = [0.08 + w * 0.25, 0.15];
      break;
    case "gems":
    case "potion":
    case "scroll":
      p.far = [0.4, 1.2];
      break;
  }
}

// How a figure stands while it does what it did this tick, `t` through the tick.
function act(p: Pose, e: Effect, t: number): void {
  switch (e.kind) {
    case "harvest":
    case "build":
    case "repair": {
      if (e.kind === "harvest" ? !PICKS.has(p.tool) : !HAMMERS.has(p.tool)) p.tool = e.kind === "harvest" ? "pickaxe" : "hammer";
      const k = (t * BLOWS_PER_TICK) % 1;
      const a = blowArm(k);
      p.near = [a, 0.15];
      p.toolA = a + 1.25;
      p.lean += k > 0.5 && k < 0.85 ? 0.14 : 0.04;
      if (p.off === "none") p.far = [a - 0.15, 0.35];
      break;
    }
    case "attack":
      if (THRUSTS.has(p.tool)) {
        const th = thrust(t);
        p.near = [1.35 + 0.25 * th, 0.9 * (1 - Math.max(0, th))];
        p.toolA = Math.PI / 2 - 0.05;
        p.lean += 0.14 * Math.max(0, th);
      } else {
        const a = strikeArm(t);
        p.near = [a, 0.2];
        p.toolA = a + 1.15;
        p.lean += a < 1 ? 0.12 : 0;
        if (HEAVY.has(p.tool) && p.off === "none") p.far = [a - 0.15, 0.35];
      }
      break;
    case "ranged":
      if (p.tool === "longbow") {
        p.drawn = t < LOOSE ? t / LOOSE : t > 0.55 ? Math.min(1, (t - 0.55) / 0.35) : 0;
        p.near = [Math.PI / 2 - 0.05, 0.05];
        p.toolA = Math.PI - 0.08;
        p.far = [Math.PI / 2 - 0.1, 0.25 + 2.8 * p.drawn];
      } else if (STAVES.has(p.tool)) {
        const jab = t > LOOSE - 0.05 && t < LOOSE + 0.1 ? 0.25 : 0;
        p.near = [1.85 + jab, 0.3];
        p.toolA = 2.35 - jab;
        p.lean += jab * 0.4;
      } else {
        // Thrown overhand.
        const a = t < LOOSE ? 2.8 : Math.max(0.6, 2.8 - (t - LOOSE) * 12);
        p.near = [a, 0.3];
      }
      break;
    case "mass":
      p.near = [2.8, 0.2];
      p.far = [2.7, 0.3];
      p.toolA = Math.PI;
      break;
    case "heal":
    case "upgrade": {
      // Hands or staff lifted towards the one blessed, or the throne.
      const a = (e.kind === "upgrade" ? 2.05 : 1.6) + Math.sin(p.now / 220 + p.seed) * 0.05;
      p.near = [a, 0.3];
      p.toolA = a + 0.6;
      if (p.tool === "censer") p.swing = Math.sin(p.now / 260 + p.seed) * 0.9;
      if (p.off === "none" || !STAVES.has(p.tool)) p.far = [a - 0.2, 0.45];
      break;
    }
    case "claim":
      // The banner raised high over the claimed throne.
      p.near = [2.5, 0.3];
      p.toolA = Math.PI - 0.1;
      if (p.tool !== "banner") p.far = [2.4, 0.3];
      break;
    default:
      break;
  }
}

function posture(look: Look, g: Gait, deed: Effect | undefined, env: Env, seed: number, detail: number): Pose {
  const s = g.stride;
  const ph = g.phase;
  const w = Math.sin(ph) * s;
  const now = env.now;
  const breath = Math.sin(now / 900 + seed) * 0.004 * (1 - s);
  const p: Pose = {
    face: g.face,
    back: g.back,
    bob: Math.abs(Math.sin(ph)) * 0.016 * s + breath,
    lean: (look.stoop ?? 0) + 0.05 * s,
    nearFoot: [-Math.sin(ph) * 0.07 * s, Math.max(0, -Math.cos(ph)) * 0.035 * s],
    farFoot: [Math.sin(ph) * 0.07 * s, Math.max(0, Math.cos(ph)) * 0.035 * s],
    near: [0.12 + w * 0.45, 0.3],
    far: [0.12 - w * 0.45, 0.3],
    tool: look.hand,
    toolA: 0.9,
    off: look.off,
    drawn: 0,
    stride: s,
    sway: Math.sin(ph) * 0.02 * s,
    swing: 0,
    hover: look.hover ? 0.12 + Math.sin(now / 700 + seed) * 0.025 : 0,
    struck: false,
    lit: true,
    fill: 0,
    goods: PALETTE.gold,
    now,
    seed,
    detail,
  };
  rest(p, w);
  if (deed) act(p, deed, env.tickT);
  return p;
}

// What a creep carries: how full it is and the colour of the most of it.
function cargo(o: RoomObject): [number, string] {
  const store = o.store ?? {};
  let total = 0;
  let main: string | undefined;
  for (const k in store) {
    const n = Number(store[k]) || 0;
    total += n;
    if (!main || n > (Number(store[main]) || 0)) main = k;
  }
  const cap = Number(o.storeCapacity) || 0;
  return [cap > 0 ? Math.min(1, total / cap) : 0, resourceColour(main)];
}

// Each night one yeoman keeps the watch with a lantern while the rest sleep
// (role.townsfolk's nightWatchman): the first of them by name, turn about by
// the night. Only those in the room are known here, which is near enough.
function watchmanOf(v: RoomView, env: Env): string | null {
  if (!(env.sky.lit > 0) || !v.scenery || v.r.gameTime === null) return null;
  const names: string[] = [];
  for (const id in v.r.objects) {
    const o = v.r.objects[id];
    if (o.type === "creep" && o.user === v.me && !o.spawning && creepTitle(String(o.name ?? "")) === "Yeoman") names.push(String(o.name));
  }
  if (names.length < 2) return null;
  names.sort();
  return names[Math.floor(v.r.gameTime / TOWN_DAY_LENGTH) % names.length];
}

const WATCH_LANTERN: Glow = { at: "off", colour: "#ffc46b", r: 2.6, power: 0.85, dark: true };

/** Every creep in the room as a piece of the scene, with what it did this tick. */
export function creepPieces(v: RoomView, env: Env, out: Piece[]): void {
  const r = v.r;
  const now = env.now;
  const deeds = new Map<string, Effect>();
  for (const e of r.effects) if (e.kind !== "say" && !deeds.has(e.id)) deeds.set(e.id, e);
  const actors = new Map<string, Actor>();
  const watchman = watchmanOf(v, env);
  const lamps = env.sky.lit > 0.3;
  const detail = env.px < SPECK_PX ? 0 : env.px < FINE_PX ? 1 : 2;

  for (const id in r.objects) {
    const o = r.objects[id];
    if ((o.type !== "creep" && o.type !== "powerCreep") || o.spawning) continue;
    const pos = creepPosition(r, id, now, v.tickMs);
    if (!onScreen(v, pos.x, pos.y)) continue;
    const mine = v.me !== undefined && o.user === v.me;
    let look = lookOf(o, mine);
    if (watchman !== null && o.name === watchman) look = { ...look, off: "lantern", glow: WATCH_LANTERN };
    const seed = hashString(String(o.name ?? id));
    const S = GROWN * look.size * (0.96 + 0.08 * ((seed % 1000) / 1000));
    const x = r.ox + pos.x;
    const y = r.oy + pos.y;
    const g = walk(`${r.key}/${id}`, x, y, now, seed);
    const deed = deeds.get(id);
    if (deed && g.stride < 0.5) {
      // Turned towards the work, the mark or the one blessed.
      const tx = deed.kind === "harvest" ? deed.x1 : deed.x2;
      const ty = deed.kind === "harvest" ? deed.y1 : deed.y2;
      if (tx !== o.x) g.face = tx > o.x ? 1 : -1;
      if (tx !== o.x || ty !== o.y) g.back = ty < o.y && tx === o.x;
    }
    const p = posture(look, g, deed, env, seed, detail);
    [p.fill, p.goods] = cargo(o);
    p.lit = lamps || !look.glow?.dark;
    const log = o.actionLog ?? {};
    const hurt = log.attacked && env.tickT < 0.35 ? 1 - env.tickT / 0.35 : 0;
    p.struck = hurt > 0;
    const fx = x - g.face * hurt * 0.05;
    // Up on the deck of a watch post or the walk of a battlement.
    const under = planOf(v).ramparts.get(tileOf(Math.round(pos.x), Math.round(pos.y)));
    const fy = y + FOOT - (under === "post" ? POST_DECK : under === "battlement" ? BATTLEMENT_H : 0);
    const d = dressOf(look, seed, v);
    const flying = look.kind === "bird" && g.stride > 0.05;

    // Where its hand is, and the head of its staff, in the world.
    const world = (lx: number, ly: number): [number, number] => [fx + g.face * S * lx, fy + S * (ly - p.hover)];
    const [, , nhx, nhy] = handAt(NEAR_X, SHOULDER + p.bob, p.near);
    const reach = toolReach(p.tool);
    const [hx, hy] = world(nhx + Math.sin(p.toolA) * reach, nhy + Math.cos(p.toolA) * reach);
    if (deed) {
      actors.set(id, {
        x,
        y,
        hx,
        hy,
        missile: look.missile ?? (p.tool === "longbow" ? "arrow" : STAVES.has(p.tool) ? "bolt" : p.tool === "potion" ? "flask" : "stone"),
        magic: look.glow?.colour ?? (mine ? "#ffe9a8" : "#b0ff8a"),
        field: mine ? v.arms.field : "#3a1830",
        other: mine ? v.arms.other : "#8a2a4a",
      });
    }

    // Its lights: a lamp, a lantern, a glowing orb, eyes in the dark.
    const glow = look.glow;
    if (glow && p.lit && look.kind === "person") {
      let at: [number, number];
      if (glow.at === "head") at = world(0.07, HEAD - 0.06);
      else if (glow.at === "tool") at = [hx, hy];
      else if (glow.at === "off") {
        const [, , ox, oy] = handAt(FAR_X, SHOULDER + p.bob, p.far);
        at = world(ox, oy + (p.off === "lantern" ? 0.08 : p.off === "torch" ? -0.17 : 0));
      } else at = world(0, -0.4);
      env.lights.push({ x: at[0], y: at[1], r: glow.r, colour: glow.colour, power: glow.power * (glow.dark ? Math.min(1, env.sky.lit) : 1) });
    }
    if (look.eyes) {
      const [ex, ey] = world(0.06, HEAD);
      env.lights.push({ x: ex, y: ey, r: 0.7, colour: look.eyes, power: 0.5 });
    }

    const hits = Number(o.hits);
    const hitsMax = Number(o.hitsMax);
    const wounded = hitsMax > 0 && hits < hitsMax ? Math.max(0, hits / hitsMax) : -1;
    const tall = (look.kind === "mule" ? 0.55 : look.kind === "bird" ? (flying ? 0.6 : 0.2) : 0.82) * S + p.hover;

    out.push({
      depth: y + 0.25,
      draw(ctx) {
        // Where it stands, shaded.
        ellipse(ctx, fx, fy, (look.kind === "mule" ? 0.24 : look.kind === "bird" ? 0.07 : 0.13) * S, 0.045 * S);
        ctx.fillStyle = flying ? "rgba(12,10,8,0.14)" : "rgba(12,10,8,0.28)";
        ctx.fill();
        if (look.hover) runeRing(ctx, fx, fy, 0.3 * S, glow?.colour ?? "#9fc4ff", 0.6, now);
        ctx.save();
        ctx.translate(fx, fy);
        ctx.scale(S * g.face, S);
        if (look.kind === "mule") paintMule(ctx, d, p);
        else if (look.kind === "bird") paintBird(ctx, look, p, flying);
        else paintPerson(ctx, look, d, p);
        ctx.restore();
        if (wounded >= 0 && detail > 0) health(ctx, fx, fy - tall - 0.06, wounded);
      },
      shadow(path, cast) {
        if (flying) castRound(path, fx + cast.dx * 0.4, fy + cast.dy * 0.4, 0.06, 0.03, 0.05, cast);
        else if (look.kind === "mule") castRound(path, fx, fy, 0.2 * S, 0.06 * S, 0.45 * S, cast, 0.16 * S);
        else if (look.kind === "bird") castRound(path, fx, fy, 0.06, 0.03, 0.12, cast);
        else castRound(path, fx, fy - p.hover * 0.5, 0.1 * S, 0.045 * S, 0.72 * S, cast, 0.09 * S);
      },
    });
  }

  deedPieces(env, r.ox, r.oy, r.effects, actors, out);

  if (now - pruned > 5000) {
    pruned = now;
    for (const [key, g] of gaits) if (now - g.seen > 10000) gaits.delete(key);
  }
}

// A thin bar over the wounded, red draining from green.
function health(ctx: CanvasRenderingContext2D, x: number, y: number, k: number): void {
  const w = 0.42;
  ctx.fillStyle = "rgba(14,10,8,0.8)";
  ctx.fillRect(x - w / 2 - 0.015, y - 0.015, w + 0.03, 0.06);
  ctx.fillStyle = k > 0.5 ? "#6fbf4a" : k > 0.25 ? "#e0b44a" : "#d8402e";
  ctx.fillRect(x - w / 2, y, w * k, 0.03);
}
