// What the realm's people did this tick, as the realm would see it: a pick
// striking sparks from the seam and gold flying to the miner, hammers ringing
// on stone, arrows and spells in flight, blessings settling on the wounded.
// Each deed keeps time with the figure doing it (figures.ts), so the sparks
// fly as the blow lands. Towers and links draw their own deeds (buildings.ts),
// and what is said is written over the picture (draw-world.ts).

import { ellipse, flame, rgba, TAU, type Env, type Piece } from "./art";
import type { Effect } from "./store";

// Deeds in the air are drawn over everything; marks on the ground under it.
const IN_THE_AIR = 1e5;
const ON_THE_GROUND = -1e5;

/** Where a figure doing a deed stands and what it does it with, in world tiles. */
export interface Actor {
  // The tile it stands on.
  x: number;
  y: number;
  // Its hand, or its staff's head: where what it looses leaves from.
  hx: number;
  hy: number;
  missile: "arrow" | "bolt" | "fire" | "flask" | "stone";
  // The colour its spells and blessings take.
  magic: string;
  // Its castle's colours, for an envoy's claim.
  field: string;
  other: string;
}

// The rhythm of work: a blow raised slowly, brought down fast and held a
// moment, two blows to a tick. `k` runs through one blow.
export const BLOWS_PER_TICK = 2;
export const BLOW_LANDS = 0.62;

/** The working arm's angle through a blow (see Pose.near). */
export function blowArm(k: number): number {
  if (k < 0.5) {
    const u = k / 0.5;
    return 0.5 + 2.5 * u * u * (3 - 2 * u);
  }
  if (k < BLOW_LANDS) return 3.0 - 2.7 * ((k - 0.5) / (BLOW_LANDS - 0.5)) ** 2;
  return 0.3 + 0.2 * ((k - BLOW_LANDS) / (1 - BLOW_LANDS));
}

// The rhythm of a fight: one blow a tick, landing at STRIKE_LANDS.
export const STRIKE_LANDS = 0.36;

/** The fighting arm's angle through the tick. */
export function strikeArm(t: number): number {
  if (t < 0.28) {
    const u = t / 0.28;
    return 0.6 + 2.3 * u * u * (3 - 2 * u);
  }
  if (t < STRIKE_LANDS) return 2.9 - 2.4 * ((t - 0.28) / (STRIKE_LANDS - 0.28)) ** 2;
  return 0.5 + 0.1 * ((t - STRIKE_LANDS) / (1 - STRIKE_LANDS));
}

/** How far a thrust reaches through the tick, 0 to 1. */
export function thrust(t: number): number {
  if (t < 0.25) return -0.4 * (t / 0.25);
  if (t < STRIKE_LANDS) return -0.4 + 1.4 * ((t - 0.25) / (STRIKE_LANDS - 0.25));
  return Math.max(0, 1 - (t - STRIKE_LANDS) / 0.4);
}

// Arrows and spells leave at LOOSE and land at HIT.
export const LOOSE = 0.1;
export const HIT = 0.45;

/** Every creep's deed this tick as pieces of the scene, adding its lights. */
export function deedPieces(env: Env, ox: number, oy: number, effects: Effect[], actors: Map<string, Actor>, out: Piece[]): void {
  const t = env.tickT;
  for (const e of effects) {
    const a = actors.get(e.id);
    if (!a) continue;
    const x1 = ox + e.x1;
    const y1 = oy + e.y1;
    const x2 = ox + e.x2;
    const y2 = oy + e.y2;
    switch (e.kind) {
      case "harvest":
        work(env, out, x1, y1, a, "#ffe08a", "#f2c14e", true);
        break;
      case "build":
        work(env, out, x2, y2, a, "#ffcf6a", "#cbbd9e", false);
        break;
      case "repair":
        work(env, out, x2, y2, a, "#ffb050", "#b9b3a6", false);
        break;
      case "upgrade":
        out.push({ depth: IN_THE_AIR + y2, draw: (ctx) => motes(ctx, a.hx, a.hy, x2, y2 - 0.7, t, env.now, ["#ffe08a", "#f2c14e"], 7, 0.35) });
        break;
      case "claim":
        out.push({ depth: IN_THE_AIR + y2, draw: (ctx) => motes(ctx, a.hx, a.hy, x2, y2 - 0.6, t, env.now, [a.field, a.other], 6, 0.25) });
        out.push({ depth: ON_THE_GROUND, draw: (ctx) => runeRing(ctx, x2, y2, 0.7 + 0.1 * Math.sin(env.now / 300), a.field, 0.5, env.now) });
        break;
      case "attack":
        if (t >= STRIKE_LANDS && t < STRIKE_LANDS + 0.3) {
          const k = (t - STRIKE_LANDS) / 0.3;
          out.push({ depth: y2 + 0.6, draw: (ctx) => slash(ctx, x2, y2 - 0.35, k, x2 >= a.x ? 1 : -1, e.x1 * 31 + e.y2) });
        }
        break;
      case "ranged":
        missile(env, out, a, x2, y2, e.x2 * 17 + e.y2);
        break;
      case "mass": {
        const k = t / 0.6;
        if (k < 1) {
          out.push({ depth: ON_THE_GROUND, draw: (ctx) => runeRing(ctx, a.x, a.y, 0.4 + 2.6 * k, a.magic, 1 - k, env.now) });
          env.lights.push({ x: a.x, y: a.y, r: 3.2, colour: a.magic, power: 0.9 * (1 - k) });
        }
        break;
      }
      case "heal": {
        const self = e.x1 === e.x2 && e.y1 === e.y2;
        out.push({
          depth: IN_THE_AIR + y2,
          draw: (ctx) => {
            if (!self) motes(ctx, a.hx, a.hy, x2, y2 - 0.35, t, env.now, [a.magic, "#ffffff"], 5, 0.12);
            blessing(ctx, x2, y2, t, env.now, a.magic, e.x2 * 7 + e.y2);
          },
        });
        env.lights.push({ x: x2, y: y2 - 0.3, r: 1.4, colour: a.magic, power: 0.6 * (1 - t * 0.6) });
        break;
      }
    }
  }
}

// A blow landing on stone, wood or the seam: sparks bursting from where it
// struck, dust after them, and for a miner the gold flying to its belt.
function work(env: Env, out: Piece[], tx: number, ty: number, a: Actor, spark: string, dust: string, gold: boolean): void {
  const k = (env.tickT * BLOWS_PER_TICK) % 1;
  // Where the tool meets the work: the face of it towards the worker.
  const dx = a.x - tx;
  const dy = a.y - ty;
  const len = Math.hypot(dx, dy) || 1;
  const px = tx + (dx / len) * 0.35;
  const py = ty + (dy / len) * 0.3 - 0.2;
  const seed = Math.floor(env.tickT * BLOWS_PER_TICK) + Math.round(tx * 13 + ty * 7);
  const since = k - BLOW_LANDS;
  if (since >= 0 && since < 0.3) {
    const u = since / 0.3;
    out.push({ depth: Math.max(ty, a.y) + 0.3, draw: (ctx) => sparks(ctx, px, py, u, spark, dust, dx / len, seed) });
    if (u < 0.4) env.lights.push({ x: px, y: py, r: 0.9, colour: spark, power: 0.5 * (1 - u / 0.4) });
  }
  if (gold) out.push({ depth: IN_THE_AIR + a.y, draw: (ctx) => motes(ctx, px, py, a.x, a.y - 0.3, env.tickT, env.now, ["#ffe08a", "#f2c14e"], 4, 0.2) });
}

function sparks(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, colour: string, dust: string, towards: number, seed: number): void {
  // Dust first, puffing out and settling.
  ctx.globalAlpha = 0.5 * (1 - u);
  for (let i = 0; i < 3; i++) {
    const a = seed * 1.7 + i * 2.1;
    ellipse(ctx, x + Math.cos(a) * 0.12 * u, y + 0.08 + Math.sin(a) * 0.04 * u - 0.05 * u, 0.04 + 0.06 * u, 0.03 + 0.04 * u);
    ctx.fillStyle = dust;
    ctx.fill();
  }
  // Sparks thrown out towards the worker and up, falling as they go.
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = colour;
  ctx.lineWidth = 0.018;
  ctx.globalAlpha = 1 - u;
  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + (i / 6 - 0.5) * 2.4 + Math.sin(seed * 3.1 + i) * 0.3 + towards * 0.5;
    const r = (0.12 + 0.2 * Math.abs(Math.sin(seed + i * 1.3))) * (0.3 + u);
    const sx = x + Math.cos(a) * r;
    const sy = y + Math.sin(a) * r + 0.3 * u * u;
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx - Math.cos(a) * 0.05, sy - Math.sin(a) * 0.05);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

// Motes drifting from one place to another along a gentle arc, one after
// another through the tick, glowing.
function motes(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  t: number,
  now: number,
  colours: string[],
  n: number,
  arc: number,
): void {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = -(y2 - y1) / len;
  const ny = (x2 - x1) / len;
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < n; i++) {
    const p = (t * 1.1 + i / n) % 1;
    const wob = Math.sin(p * Math.PI) * (arc + 0.08 * Math.sin(i * 2.1 + now / 300));
    const x = x1 + (x2 - x1) * p + nx * wob;
    const y = y1 + (y2 - y1) * p + ny * wob - Math.sin(p * Math.PI) * arc;
    const a = Math.sin(p * Math.PI);
    ctx.globalAlpha = 0.22 * a;
    ellipse(ctx, x, y, 0.065, 0.065);
    ctx.fillStyle = colours[i % colours.length];
    ctx.fill();
    ctx.globalAlpha = 0.95 * a;
    ellipse(ctx, x, y, 0.024, 0.024);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

// A blade's bright arc across the one struck, and a spray of sparks.
function slash(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, dir: number, seed: number): void {
  const a0 = -2.2 + Math.sin(seed) * 0.4;
  ctx.globalAlpha = 1 - k;
  ctx.strokeStyle = "#fff6e0";
  ctx.lineWidth = 0.07 * (1 - k);
  ctx.beginPath();
  if (dir > 0) ctx.arc(x - 0.1, y, 0.32, a0 + k * 0.6, a0 + 1.7 + k * 0.6);
  else ctx.arc(x + 0.1, y, 0.32, Math.PI - a0 - 1.7 - k * 0.6, Math.PI - a0 - k * 0.6);
  ctx.stroke();
  ctx.strokeStyle = "#ff7a4a";
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = seed * 2.3 + i * 1.25;
    const r = 0.1 + 0.25 * k;
    ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    ctx.lineTo(x + Math.cos(a) * (r + 0.06), y + Math.sin(a) * (r + 0.06));
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// What a figure looses at range, from its hand to the mark: an arrow on a
// shallow arc, a spell straight and fast, a thrown flask tumbling.
function missile(env: Env, out: Piece[], a: Actor, tx: number, ty: number, seed: number): void {
  const t = env.tickT;
  const u = (t - LOOSE) / (HIT - LOOSE);
  if (u < 0) return;
  const ex = tx;
  const ey = ty - 0.35;
  const magic = a.missile === "bolt" || a.missile === "fire";
  if (u > 1) {
    // Landing: a spell bursts where it lands.
    const k = (u - 1) / 0.6;
    if (!magic || k >= 1) return;
    const colour = a.missile === "fire" ? "#ff8a3a" : a.magic;
    env.lights.push({ x: ex, y: ey, r: 2, colour, power: 0.9 * (1 - k) });
    out.push({
      depth: ty + 0.6,
      draw: (ctx) => {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 1 - k;
        ellipse(ctx, ex, ey, 0.15 + 0.35 * k, 0.15 + 0.35 * k);
        ctx.fillStyle = rgba(colour, 0.5);
        ctx.fill();
        ctx.strokeStyle = colour;
        ctx.lineWidth = 0.04;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      },
    });
    return;
  }
  const dist = Math.hypot(ex - a.hx, ey - a.hy);
  const loft = magic ? 0 : dist * 0.18;
  const at = (v: number): [number, number] => [a.hx + (ex - a.hx) * v, a.hy + (ey - a.hy) * v - loft * 4 * v * (1 - v)];
  const [x, y] = at(u);
  const [bx, by] = at(Math.max(0, u - 0.06));
  const ang = Math.atan2(y - by, x - bx);
  if (magic) {
    const colour = a.missile === "fire" ? "#ff8a3a" : a.magic;
    env.lights.push({ x, y, r: 1.6, colour, power: 0.8 });
  }
  out.push({
    depth: IN_THE_AIR + ty,
    draw: (ctx) => {
      switch (a.missile) {
        case "arrow": {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(ang);
          ctx.strokeStyle = "#c9b08a";
          ctx.lineWidth = 0.014;
          ctx.beginPath();
          ctx.moveTo(-0.22, 0);
          ctx.lineTo(0.02, 0);
          ctx.stroke();
          ctx.fillStyle = "#c0c6cc";
          ctx.beginPath();
          ctx.moveTo(0.06, 0);
          ctx.lineTo(0.01, -0.02);
          ctx.lineTo(0.01, 0.02);
          ctx.fill();
          ctx.fillStyle = "#e8e0d0";
          ctx.beginPath();
          ctx.moveTo(-0.16, 0);
          ctx.lineTo(-0.23, -0.03);
          ctx.lineTo(-0.21, 0);
          ctx.lineTo(-0.23, 0.03);
          ctx.fill();
          ctx.restore();
          break;
        }
        case "bolt":
        case "fire": {
          const colour = a.missile === "fire" ? "#ff8a3a" : a.magic;
          ctx.globalCompositeOperation = "lighter";
          for (let i = 0; i < 6; i++) {
            const [tx2, ty2] = at(Math.max(0, u - i * 0.03));
            ctx.globalAlpha = 0.5 * (1 - i / 6);
            ellipse(ctx, tx2, ty2, 0.09 - i * 0.01, 0.09 - i * 0.01);
            ctx.fillStyle = colour;
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          ellipse(ctx, x, y, 0.045, 0.045);
          ctx.fillStyle = "#ffffff";
          ctx.fill();
          ctx.globalCompositeOperation = "source-over";
          if (a.missile === "fire") flame(ctx, x, y + 0.05, 0.22, env.now, seed);
          break;
        }
        case "flask": {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(u * 9);
          ellipse(ctx, 0, 0, 0.035, 0.035);
          ctx.fillStyle = "#8cff6b";
          ctx.fill();
          ctx.fillStyle = "#cfd8d4";
          ctx.fillRect(-0.01, -0.06, 0.02, 0.03);
          ctx.restore();
          break;
        }
        case "stone":
          ellipse(ctx, x, y, 0.03, 0.025);
          ctx.fillStyle = "#8a8378";
          ctx.fill();
          break;
      }
    },
  });
}

// A ring of runes on the ground, turning: a spell's reach, or an envoy's claim.
export function runeRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string, alpha: number, now: number): void {
  const ry = r * 0.62;
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.7 * alpha;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 0.04;
  ellipse(ctx, x, y, r, ry);
  ctx.stroke();
  ctx.lineWidth = 0.02;
  ellipse(ctx, x, y, r * 0.85, ry * 0.85);
  ctx.stroke();
  const n = Math.max(6, Math.round(r * 8));
  const turn = now / 2400;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + turn;
    const cx = x + Math.cos(a) * r * 0.925;
    const cy = y + Math.sin(a) * ry * 0.925;
    // Each rune a different little mark.
    const s = 0.035;
    if (i % 3 === 0) {
      ctx.moveTo(cx - s, cy);
      ctx.lineTo(cx + s, cy);
      ctx.moveTo(cx, cy - s * 0.6);
      ctx.lineTo(cx, cy + s * 0.6);
    } else if (i % 3 === 1) {
      ctx.moveTo(cx - s, cy + s * 0.5);
      ctx.lineTo(cx, cy - s * 0.5);
      ctx.lineTo(cx + s, cy + s * 0.5);
    } else {
      ctx.moveTo(cx - s, cy - s * 0.4);
      ctx.lineTo(cx + s, cy + s * 0.4);
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

// A blessing settling on the one healed: motes of light rising about it.
function blessing(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, now: number, colour: string, seed: number): void {
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 7; i++) {
    const p = (t * 1.4 + i / 7) % 1;
    const a = seed + i * 2.4;
    const px = x + Math.cos(a + now / 700) * 0.2;
    const py = y - 0.05 - p * 0.75;
    const tw = Math.sin(p * Math.PI) * (0.7 + 0.3 * Math.sin(now / 90 + i));
    ctx.globalAlpha = tw;
    ctx.fillStyle = colour;
    ctx.beginPath();
    // A four-pointed glint.
    const s = 0.045;
    ctx.moveTo(px, py - s);
    ctx.lineTo(px + s * 0.25, py - s * 0.25);
    ctx.lineTo(px + s, py);
    ctx.lineTo(px + s * 0.25, py + s * 0.25);
    ctx.lineTo(px, py + s);
    ctx.lineTo(px - s * 0.25, py + s * 0.25);
    ctx.lineTo(px - s, py);
    ctx.lineTo(px - s * 0.25, py - s * 0.25);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}
