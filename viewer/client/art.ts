// The look of a room up close: an RPG three-quarter view. The ground is seen
// from straight above, but walls, trees and people stand up out of it with
// their fronts to the viewer, a tile of height reaching a tile up the screen.
// Everything is drawn in world tiles under the camera's transform, from the
// back of the room (north, the top of the screen) to the front, so what
// stands nearer covers what stands behind it.
//
// Pictures that do not move are painted once at about the camera's scale and
// stamped from then on (see Sprites). Fire, smoke, water and people move, so
// they are drawn afresh every frame. Night is not painted into anything: the
// lighting pass darkens the whole picture afterwards and lets the lights
// through, so every piece is drawn as it looks by day.

import type { TownSeason } from "../../src/config/config.town";
import type { Sky } from "./sky";

export const TAU = Math.PI * 2;
// Round things (tower tops, cauldrons, a fountain's basin) are squashed this
// much top to bottom, as a circle on the ground looks from a slant.
export const SQUASH = 0.62;

/** A thing standing in a room. */
export interface Piece {
  // How far south it meets the ground at its front, in world tiles: pieces
  // are drawn in order of depth, so one further south covers one behind it.
  depth: number;
  draw(ctx: CanvasRenderingContext2D): void;
  // Adds its shadow to the path every shadow on screen is filled with at
  // once. Shapes go in clockwise (see `hull`), so overlaps join rather than cancel.
  shadow?(path: Path2D, cast: Cast): void;
}

/** A light against the dark, in world tiles. */
export interface Light {
  x: number;
  y: number;
  // How far it reaches, in tiles.
  r: number;
  colour: string;
  // 0 to 1.
  power: number;
}

/** Where shadows fall: tiles along the ground per tile of height. */
export interface Cast {
  dx: number;
  dy: number;
}

/** What everything in a room is drawn under this frame. */
export interface Env {
  sky: Sky;
  season: TownSeason;
  // Whether snow lies on the ground and the roofs.
  snow: boolean;
  // performance.now(), for flicker and sway that need not keep to the tick.
  now: number;
  // How far through the current tick, 0 to 1.
  tickT: number;
  // Screen pixels per tile, for leaving out detail too small to see.
  px: number;
  sprites: Sprites;
  // Lights found while drawing, for the lighting pass.
  lights: Light[];
}

// The finest a sprite is painted, in pixels per tile.
const MAX_SPRITE_PX = 192;

/**
 * Pictures painted once at about the camera's scale and stamped from then on.
 * The scale is kept in steps of a half octave, so zooming repaints them only
 * now and then, and they are never blurred by more than that step.
 */
export class Sprites {
  private bucket = 0;
  private readonly cache = new Map<string, HTMLCanvasElement | null>();

  /** Sets this frame's scale, in screen pixels per tile. */
  scale(px: number): void {
    const bucket = Math.min(MAX_SPRITE_PX, Math.pow(2, Math.ceil(Math.log2(Math.max(4, px)) * 2) / 2));
    if (bucket === this.bucket) return;
    this.bucket = bucket;
    this.cache.clear();
  }

  /**
   * Stamps the sprite `key` with its anchor at (x, y), painting it first if
   * it is new at this scale. `box` is its extent about the anchor in tiles,
   * [left, top, right, bottom], and `paint` draws it about (0, 0) in tiles.
   * The key must name everything that changes the picture. `k` stamps it
   * larger or smaller about its anchor, for things of one shape but many sizes.
   */
  stamp(
    ctx: CanvasRenderingContext2D,
    key: string,
    x: number,
    y: number,
    box: readonly [number, number, number, number],
    paint: (g: CanvasRenderingContext2D) => void,
    k = 1,
  ): void {
    let c = this.cache.get(key);
    if (c === undefined) {
      c = this.paint(box, paint);
      this.cache.set(key, c);
    }
    if (c) ctx.drawImage(c, x + box[0] * k, y + box[1] * k, (box[2] - box[0]) * k, (box[3] - box[1]) * k);
  }

  private paint(box: readonly [number, number, number, number], paint: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement | null {
    const bw = box[2] - box[0];
    const bh = box[3] - box[1];
    const w = Math.ceil(bw * this.bucket);
    const h = Math.ceil(bh * this.bucket);
    if (w <= 0 || h <= 0 || w > 4096 || h > 4096) return null;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d")!;
    g.setTransform(w / bw, 0, 0, h / bh, (-box[0] * w) / bw, (-box[1] * h) / bh);
    g.lineJoin = "round";
    g.lineCap = "round";
    paint(g);
    return c;
  }
}

// Randomness that is the same every frame: drawn from a thing's id or tile.

/** A hash of a string, 32 bits. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A number in [0, 1) from two whole numbers, such as a tile. */
export function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A stream of numbers in [0, 1) from a seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Colours, as "#rrggbb".

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** `a` blended towards `b` by `t`. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** A colour darkened (k < 1) or lightened (k > 1). */
export function shade(hex: string, k: number): string {
  const [r, g, b] = channels(hex);
  return k <= 1 ? toHex(r * k, g * k, b * k) : toHex(r + (255 - r) * (k - 1), g + (255 - g) * (k - 1), b + (255 - b) * (k - 1));
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// The realm's palette.
export const PALETTE = {
  stoneTop: "#8f877a",
  stoneFront: "#5f584e",
  stoneDark: "#3b362f",
  mortar: "#2c2823",
  wood: "#6e4b2a",
  woodDark: "#4a311b",
  thatch: "#a8874f",
  thatchDark: "#7a5f34",
  slate: "#4b505c",
  iron: "#3d3f44",
  gold: "#f2c14e",
  goldLight: "#ffe08a",
  goldDark: "#a8792a",
  snow: "#e9eef4",
  snowShade: "#b9c6d6",
  fire: "#ff7a22",
  fireCore: "#ffd27a",
  ink: "#17130f",
};

// What each resource looks like: energy is the realm's gold, and minerals
// and their compounds take the colour the game gives them.
const RESOURCE_COLOURS: Record<string, string> = {
  energy: PALETTE.gold,
  power: "#f41f33",
  H: "#cccccc",
  O: "#cccccc",
  U: "#50d7f9",
  L: "#00f4a2",
  K: "#a071ff",
  Z: "#fdd388",
  X: "#ff7b7b",
  G: "#ffffff",
  ops: "#8a8a8a",
};

export function resourceColour(r: string | undefined): string {
  if (!r) return PALETTE.gold;
  if (RESOURCE_COLOURS[r]) return RESOURCE_COLOURS[r];
  // Compounds take the colour of the mineral they are built on.
  for (const base of ["U", "L", "K", "Z", "G"]) if (r.includes(base)) return RESOURCE_COLOURS[base];
  return "#cccccc";
}

// Shapes.

export function ellipse(ctx: CanvasRenderingContext2D | Path2D, x: number, y: number, rx: number, ry: number): void {
  if (!(ctx instanceof Path2D)) ctx.beginPath();
  ctx.moveTo(x + rx, y);
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
}

/**
 * A block standing on the ground over the footprint [x0, x1] × [y0, y1], `h`
 * tall: its top, lifted `h` up the screen, and its south face below it.
 */
export function block(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  h: number,
  top: string,
  front: string,
  edge?: string,
): void {
  ctx.fillStyle = front;
  ctx.fillRect(x0, y1 - h, x1 - x0, h);
  ctx.fillStyle = top;
  ctx.fillRect(x0, y0 - h, x1 - x0, y1 - y0);
  if (edge) {
    ctx.strokeStyle = edge;
    ctx.lineWidth = 0.025;
    ctx.strokeRect(x0, y0 - h, x1 - x0, y1 - y0 + h);
    ctx.beginPath();
    ctx.moveTo(x0, y1 - h);
    ctx.lineTo(x1, y1 - h);
    ctx.stroke();
  }
}

/** A round thing standing on the ground about (x, y), `r` wide either way and `h` tall. */
export function cylinder(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, h: number, top: string, side: string, edge?: string): void {
  const ry = r * SQUASH;
  ctx.beginPath();
  ctx.moveTo(x - r, y - h);
  ctx.lineTo(x - r, y);
  ctx.ellipse(x, y, r, ry, 0, Math.PI, 0, true);
  ctx.lineTo(x + r, y - h);
  ctx.closePath();
  ctx.fillStyle = side;
  ctx.fill();
  if (edge) {
    ctx.strokeStyle = edge;
    ctx.lineWidth = 0.025;
    ctx.stroke();
  }
  ellipse(ctx, x, y - h, r, ry);
  ctx.fillStyle = top;
  ctx.fill();
  if (edge) ctx.stroke();
}

/** Upright rounded light falling on a round side: darker at the edges, as if lit from the front. */
export function roundShading(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, h: number, alpha = 0.35): void {
  const g = ctx.createLinearGradient(x - r, 0, x + r, 0);
  g.addColorStop(0, `rgba(0,0,0,${alpha})`);
  g.addColorStop(0.35, "rgba(0,0,0,0)");
  g.addColorStop(0.65, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${alpha * 1.3})`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - r, y - h);
  ctx.lineTo(x - r, y);
  ctx.ellipse(x, y, r, r * SQUASH, 0, Math.PI, 0, true);
  ctx.lineTo(x + r, y - h);
  ctx.closePath();
  ctx.fill();
}

/**
 * Battlements standing on a wall's top along the line y on the ground, from
 * x0 to x1, the wall `h` tall: merlons `size` tall and as deep, with
 * crenels between them.
 */
export function merlons(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, h: number, size: number, top: string, front: string): void {
  const n = Math.max(1, Math.round((x1 - x0) / (size * 2)));
  const step = (x1 - x0) / n;
  const w = step * 0.56;
  for (let i = 0; i < n; i++) {
    const mx = x0 + i * step + step * 0.22;
    ctx.fillStyle = front;
    ctx.fillRect(mx, y - h - size, w, size);
    ctx.fillStyle = top;
    ctx.fillRect(mx, y - h - 2 * size, w, size);
  }
}

/** A flame rising from (x, y), `size` tiles tall, flickering on its own beat. */
export function flame(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, now: number, seed: number): void {
  const t = now / 1000;
  const f1 = Math.sin(t * 13.1 + seed * 7.3) * 0.5 + Math.sin(t * 7.7 + seed * 3.1) * 0.5;
  const f2 = Math.sin(t * 17.9 + seed * 1.7);
  const lean = 0.12 * size * f2;
  const tall = size * (0.85 + 0.15 * f1);
  const tongue = (w: number, hgt: number, colour: string) => {
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.quadraticCurveTo(x - w * 1.1, y - hgt * 0.45, x + lean, y - hgt);
    ctx.quadraticCurveTo(x + w * 1.1, y - hgt * 0.45, x + w, y);
    ctx.quadraticCurveTo(x, y + w * 0.5, x - w, y);
    ctx.fillStyle = colour;
    ctx.fill();
  };
  tongue(size * 0.32, tall, "#e2471b");
  tongue(size * 0.22, tall * 0.75, PALETTE.fire);
  tongue(size * 0.13, tall * 0.48, PALETTE.fireCore);
  tongue(size * 0.06, tall * 0.25, "#fff6d8");
}

/** Smoke rising from (x, y), a puff at a time, drifting with the wind. */
export function smoke(ctx: CanvasRenderingContext2D, x: number, y: number, now: number, seed: number, colour = "#8c8a86", size = 1): void {
  const PUFFS = 5;
  const PERIOD = 4200;
  for (let i = 0; i < PUFFS; i++) {
    const p = (now / PERIOD + i / PUFFS + seed * 0.37) % 1;
    const rise = p * 1.6 * size;
    const r = (0.08 + 0.22 * p) * size;
    const drift = (0.35 * p + 0.06 * Math.sin(p * 9 + seed)) * size;
    ctx.globalAlpha = 0.45 * Math.sin(Math.PI * p) * (1 - p * 0.5);
    ellipse(ctx, x + drift, y - rise, r, r * 0.85);
    ctx.fillStyle = colour;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** A swallow-tailed pennant flying from the top of a pole at (x, y), in a castle's colours. */
export function pennant(ctx: CanvasRenderingContext2D, x: number, y: number, length: number, field: string, other: string, now: number, seed: number): void {
  const t = now / 1000;
  const wave = (k: number) => Math.sin(t * 5 + seed * 2.3 - k * 4) * 0.06 * k * length;
  const h = length * 0.42;
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let k = 0; k <= 1.0001; k += 0.25) ctx.lineTo(x + k * length, y + wave(k) + h * 0.12 * k);
  ctx.lineTo(x + length * 0.78, y + h * 0.5 + wave(0.78));
  for (let k = 1; k >= -0.0001; k -= 0.25) ctx.lineTo(x + k * length, y + h - h * 0.12 * k + wave(k));
  ctx.closePath();
  ctx.fillStyle = field;
  ctx.fill();
  ctx.strokeStyle = other;
  ctx.lineWidth = length * 0.06;
  ctx.stroke();
}

// Shadows.

/**
 * Adds the convex hull of `pts` to `path`, wound clockwise on screen so that
 * every shape in a path of shadows joins the rest under the nonzero rule.
 */
export function hull(path: Path2D, pts: Array<[number, number]>): void {
  if (pts.length < 3) return;
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Array<[number, number]> = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  const h = lower.slice(0, -1).concat(upper.slice(0, -1));
  // Monotone chain winds counter-clockwise by y-up reckoning, which is
  // clockwise on a y-down screen, as arcs and rects are drawn.
  path.moveTo(h[0][0], h[0][1]);
  for (let i = 1; i < h.length; i++) path.lineTo(h[i][0], h[i][1]);
  path.closePath();
}

/** The shadow of a block over the footprint [x0, x1] × [y0, y1], `h` tall. */
export function castBlock(path: Path2D, x0: number, y0: number, x1: number, y1: number, h: number, cast: Cast): void {
  const dx = cast.dx * h;
  const dy = cast.dy * h;
  hull(path, [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0 + dx, y0 + dy],
    [x1 + dx, y0 + dy],
    [x1 + dx, y1 + dy],
    [x0 + dx, y1 + dy],
  ]);
}

/**
 * The shadow of something round: a footprint `rx` by `ry` about (x, y), and
 * its top `h` up, `topR` wide (a tree's crown is wider than its foot).
 */
export function castRound(path: Path2D, x: number, y: number, rx: number, ry: number, h: number, cast: Cast, topR = rx): void {
  const pts: Array<[number, number]> = [];
  const tx = x + cast.dx * h;
  const ty = y + cast.dy * h;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    pts.push([x + Math.cos(a) * rx, y + Math.sin(a) * ry]);
    pts.push([tx + Math.cos(a) * topR, ty + Math.sin(a) * topR * (ry / rx)]);
  }
  hull(path, pts);
}
