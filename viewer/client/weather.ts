// The realm's weather and omens, drawn by the viewer from the bot's own lore
// (services.town) at a fractional tick, so they move smoothly between ticks.
//
// The weather falls over all the land on screen: blossom in spring, leaves in
// autumn, snow in winter, rain in a storm, mist over the marshes at dawn, and
// the dragon crossing the realm with its shadow sliding over the ground. It
// is drawn before the lighting pass, so the night darkens it like the rest.
//
// The omens give their own light and are drawn after the lighting pass: the
// moon, the northern lights and falling stars in the sky of the room the
// camera is over, where the bot puts them; the wolves' eyes at its edge; wisps
// over the marshes and fireflies on summer nights; and the lightning.
//
// Rooms where the bot still draws its own sky are left out (see Store.ownsScenery).

import { NIGHT_START, mistTiles, wispTiles } from "../../src/services/services.town";
import { TOWN_DRAGON_FLIGHT, TOWN_HOWL_TICKS, TOWN_MOON_DAYS, TOWN_STAR_TICKS } from "../../src/config/config.town";
import { hash2, rng, TAU } from "./art";
import { screenTransform, toScreen, worldTransform, type Frame } from "./camera";
import type { Sky } from "./sky";

/** A room on screen whose sky the viewer draws. */
export interface SkyRoom {
  key: string;
  ox: number;
  oy: number;
  terrain: string | undefined;
  fountain: { x: number; y: number } | null;
}

export interface Weather {
  rooms: SkyRoom[];
  // The room the camera is over: the moon, the northern lights, falling stars
  // and the wolves are drawn in its sky, as the bot draws them in each castle's.
  focus: SkyRoom | null;
  // World rectangles where the bot draws its own weather, left alone.
  unlit: Array<[number, number, number, number]>;
  // How much of it shows, fading in as the camera comes close.
  alpha: number;
}

// The wind, in tiles a second, and stronger in a storm.
const WIND = 0.35;
const STORM_WIND = 1.6;
// Falling things are scattered over cells of the world this many tiles across.
const CELL = 5;

interface Fall {
  // Per cell when the camera is close.
  count: number;
  // Seconds to fall from `height` tiles to the ground.
  period: number;
  height: number;
  colours: string[];
  // Tiles across.
  size: number;
}

const FALLS: Record<string, Fall> = {
  spring: { count: 2, period: 11, height: 3, colours: ["#ffc4d2", "#ffe3ea", "#fff6f2"], size: 0.09 },
  autumn: { count: 2, period: 9, height: 3.5, colours: ["#d9822b", "#b5502a", "#c9a227", "#8f3c16"], size: 0.14 },
  winter: { count: 9, period: 8, height: 4, colours: ["#ffffff", "#eef4ff"], size: 0.06 },
  rain: { count: 24, period: 0.75, height: 5, colours: ["#c8d8ec"], size: 0.6 },
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Clips to the picture less the rooms the bot draws its own weather in.
function clipOut(f: Frame, unlit: Array<[number, number, number, number]>): void {
  const { ctx } = f;
  if (unlit.length === 0) return;
  const s = f.cam.scale;
  const path = new Path2D();
  const hw = f.w / 2 / s;
  const hh = f.h / 2 / s;
  path.rect(f.cam.x - hw - 10, f.cam.y - hh - 10, hw * 2 + 20, hh * 2 + 20);
  for (const [x0, y0, x1, y1] of unlit) path.rect(x0, y0, x1 - x0, y1 - y0);
  ctx.clip(path, "evenodd");
}

/** The weather, drawn before the lighting pass. */
export function drawWeather(f: Frame, sky: Sky, w: Weather): void {
  if (w.alpha < 0.01) return;
  const { ctx } = f;
  ctx.save();
  worldTransform(f);
  clipOut(f, w.unlit);
  ctx.globalAlpha = 1;

  if (sky.mist > 0.01) for (const r of w.rooms) drawMist(ctx, sky, r, w.alpha);
  if (sky.dragon) drawDragon(ctx, f, sky, w);

  const fall = sky.storm ? FALLS.rain : FALLS[sky.season];
  if (fall) drawFall(ctx, f, fall, sky, w.alpha);
  ctx.restore();
}

/** The omens, drawn after the lighting pass. */
export function drawOmens(f: Frame, sky: Sky, w: Weather): void {
  if (w.alpha < 0.01) return;
  const { ctx } = f;
  ctx.save();
  worldTransform(f);
  clipOut(f, w.unlit);

  const r = w.focus;
  const nightfall = sky.lit;
  if (r && sky.aurora > 0.01) drawAurora(ctx, sky, r, w.alpha);
  if (r && nightfall > 0.01 && !sky.storm) drawMoon(ctx, sky, r, w.alpha * nightfall, f.now);
  if (r && sky.star) drawStar(ctx, sky, r, w.alpha);
  if (sky.wisps) for (const room of w.rooms) drawWisps(ctx, sky, room, w.alpha, f.now);
  if (sky.season === "summer" && !sky.storm && nightfall > 0.01) {
    for (const room of w.rooms) if (room.fountain) drawFireflies(ctx, sky, room, w.alpha * nightfall, f.now);
  }
  if (r && sky.lightning > 0.01) drawLightning(ctx, f, sky, r, w.alpha);
  if (r && sky.howl) drawHowl(f, sky, r, w.alpha);
  ctx.restore();
}

// Blossom, leaves, snow or rain, scattered over the cells on screen, each
// mote falling from its own place at its own time, so none are kept between
// frames. A mote is drawn at least a pixel or so across, however far out the
// camera is.
function drawFall(ctx: CanvasRenderingContext2D, f: Frame, fall: Fall, sky: Sky, alpha: number): void {
  const s = f.cam.scale;
  if (s < 4) return;
  // Fewer motes far out, where there are many more cells on screen.
  const count = Math.max(1, Math.round(fall.count * clamp01(s / 18)));
  const rain = fall === FALLS.rain;
  const wind = sky.storm ? STORM_WIND : WIND;
  const secs = f.now / 1000;
  const hw = f.w / 2 / s;
  const hh = f.h / 2 / s;
  const x0 = Math.floor((f.cam.x - hw - wind * fall.period) / CELL);
  const x1 = Math.floor((f.cam.x + hw) / CELL);
  const y0 = Math.floor((f.cam.y - hh) / CELL);
  const y1 = Math.floor((f.cam.y + hh + fall.height) / CELL);
  const px = 1 / s;
  const size = Math.max(fall.size, 1.6 * px);
  ctx.globalAlpha = alpha * (rain ? 0.6 : 0.85);
  ctx.lineCap = "round";
  if (rain) {
    ctx.strokeStyle = fall.colours[0];
    ctx.lineWidth = Math.max(0.025, 0.9 * px);
    ctx.beginPath();
  }
  const splashes: Array<[number, number, number]> = [];
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      for (let i = 0; i < count; i++) {
        const h1 = hash2(cx * 16 + i, cy * 7 + 3);
        const h2 = hash2(cx * 5 - 11, cy * 16 + i);
        const h3 = hash2(cx + i * 31, cy - 77);
        const p = (secs / fall.period + h1) % 1;
        let gx = (cx + h2) * CELL + wind * p * fall.period;
        const gy = (cy + h3) * CELL;
        if (rain) {
          // Down, then a splash where it lands.
          if (p < 0.85) {
            const z = fall.height * (1 - p / 0.85);
            const lean = wind * 0.12;
            ctx.moveTo(gx, gy - z);
            ctx.lineTo(gx - lean, gy - z - fall.size);
          } else {
            splashes.push([gx, gy, (p - 0.85) / 0.15]);
          }
          continue;
        }
        const z = fall.height * (1 - p);
        // Light things sway on the way down.
        gx += Math.sin(secs * 1.3 + h3 * TAU) * 0.35;
        const y = gy - z;
        ctx.fillStyle = fall.colours[i % fall.colours.length];
        if (sky.season === "winter") {
          ctx.fillRect(gx - size / 2, y - size / 2, size, size);
        } else {
          // A petal or a leaf, tumbling: turning, and flipping edge-on.
          const turn = secs * (1.5 + h1 * 2) + h2 * TAU;
          const flip = Math.abs(Math.cos(secs * (2 + h3 * 2) + h1 * TAU));
          ctx.beginPath();
          ctx.ellipse(gx, y, size, Math.max(px, size * 0.5 * flip), turn, 0, TAU);
          ctx.fill();
        }
      }
    }
  }
  if (rain) {
    ctx.stroke();
    ctx.lineWidth = Math.max(0.02, 0.8 * px);
    ctx.beginPath();
    for (const [x, y, k] of splashes) {
      ctx.moveTo(x + 0.06 + 0.16 * k, y);
      ctx.ellipse(x, y, 0.06 + 0.16 * k, (0.06 + 0.16 * k) * 0.45, 0, 0, TAU);
    }
    ctx.globalAlpha = alpha * 0.35;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// The marsh tiles of a room, by the bot's draw for the day.
const marshes = new Map<string, Array<[number, number]>>();
function marshTiles(kind: "mist" | "wisps", sky: Sky, r: SkyRoom): Array<[number, number]> {
  if (!r.terrain) return [];
  const day = Math.floor(sky.time / 1000);
  const key = `${kind}:${r.key}:${day}`;
  let tiles = marshes.get(key);
  if (!tiles) {
    if (marshes.size > 64) marshes.clear();
    const t = r.terrain;
    const isMarsh = (x: number, y: number) => t.charCodeAt(y * 50 + x) - 48 === 2;
    tiles = kind === "mist" ? mistTiles(sky.time, isMarsh) : wispTiles(sky.time, isMarsh);
    marshes.set(key, tiles);
  }
  return tiles;
}

let puff: HTMLCanvasElement | null = null;
function puffSprite(): HTMLCanvasElement {
  if (puff) return puff;
  puff = document.createElement("canvas");
  puff.width = puff.height = 64;
  const g = puff.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(226,232,238,1)");
  grad.addColorStop(0.5, "rgba(226,232,238,0.55)");
  grad.addColorStop(1, "rgba(226,232,238,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return puff;
}

// Banks of mist over the marshes at dawn, drifting slowly east, each a few
// soft puffs that swell and thin out of step.
function drawMist(ctx: CanvasRenderingContext2D, sky: Sky, r: SkyRoom, alpha: number): void {
  const sprite = puffSprite();
  marshTiles("mist", sky, r).forEach(([x, y], i) => {
    const mx = r.ox + x + sky.t * 0.03 + Math.sin(sky.time * 0.05 + i * 2.1) * 0.4;
    const my = r.oy + y;
    const next = rng(i * 977 + 13);
    for (let k = 0; k < 7; k++) {
      const dx = (next() - 0.5) * 4.5;
      const dy = (next() - 0.5) * 1.6;
      const size = 1.4 + next() * 1.6 + 0.25 * Math.sin(sky.time * 0.07 + k);
      ctx.globalAlpha = alpha * sky.mist * (0.28 + 0.12 * next());
      ctx.drawImage(sprite, mx + dx - size * 1.3, my + dy - size * 0.7, size * 2.6, size * 1.4);
    }
  });
  ctx.globalAlpha = 1;
}

// The dragon, flying high over the realm. It is drawn where the bot draws it,
// so it crosses the same part of the castle, and stands this high over the
// ground, where its shadow falls.
const DRAGON_ALTITUDE = 4;

function drawDragon(ctx: CanvasRenderingContext2D, f: Frame, sky: Sky, w: Weather): void {
  const d = sky.dragon!;
  const cast = sky.shadow;
  const secs = f.now / 1000;
  // Wings beat, slow and heavy, and the tail swings.
  const beat = Math.sin(secs * 2.6);
  const wag = Math.sin(secs * 1.1) * 0.4;
  // Seen far out, it crosses every room on screen; close, only the one the camera is over.
  const rooms = w.focus ? [w.focus] : w.rooms;
  // It comes in from beyond the room's edge and leaves past the other, fading as it goes.
  const fade = clamp01(Math.min(d.t, TOWN_DRAGON_FLIGHT - 1 - d.t) / 3);
  for (const r of rooms) {
    const x = r.ox + d.x;
    const y = r.oy + d.y;
    if (cast.alpha > 0.01) {
      const sx = x + cast.dx * DRAGON_ALTITUDE;
      const sy = y + DRAGON_ALTITUDE + cast.dy * DRAGON_ALTITUDE;
      ctx.globalAlpha = cast.alpha * 0.8 * fade;
      ctx.fillStyle = "rgb(8,10,24)";
      dragonPath(ctx, sx, sy, d.dir, beat, wag, true);
      ctx.fill();
    }
    ctx.globalAlpha = fade;
    drawDragonBody(ctx, x, y, d.dir, beat, wag);
  }
  ctx.globalAlpha = 1;
}

// The dragon's outline seen from above and a little behind, nose towards
// `dir`: the wings spread or raised by `beat`, the tail swung by `wag`.
function dragonPath(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number, beat: number, wag: number, all: boolean): void {
  const span = 3.6 + 1.4 * beat;
  const lift = -0.9 * beat;
  const p = (fx: number, sy: number): [number, number] => [x + fx * dir, y + sy];
  ctx.beginPath();
  if (all) {
    for (const side of [-1, 1]) wingPath(ctx, p, side, span, lift);
  }
  // Body, neck and head.
  const body: Array<[number, number]> = [
    [3.4, 0], [2.9, -0.2], [2.6, -0.45], [2.45, -0.2], [1.9, -0.2], [1, -0.4], [0.1, -0.55], [-0.9, -0.45],
    [-1.7, -0.22 + wag * 0.2], [-2.7, -0.14 + wag * 0.5], [-3.7, -0.1 + wag], [-4.3, -0.38 + wag * 1.2], [-4.9, wag * 1.2],
    [-4.3, 0.38 + wag * 1.2], [-3.7, 0.1 + wag], [-2.7, 0.14 + wag * 0.5], [-1.7, 0.22 + wag * 0.2], [-0.9, 0.45],
    [0.1, 0.55], [1, 0.4], [1.9, 0.2], [2.45, 0.2], [2.6, 0.45], [2.9, 0.2],
  ];
  const [bx, by] = p(body[0][0], body[0][1]);
  ctx.moveTo(bx, by);
  for (let i = 1; i < body.length; i++) {
    const [qx, qy] = p(body[i][0], body[i][1]);
    ctx.lineTo(qx, qy);
  }
  ctx.closePath();
}

function wingPath(ctx: CanvasRenderingContext2D, p: (fx: number, sy: number) => [number, number], side: number, span: number, lift: number): void {
  // Shoulder, the wing's leading edge out to its tip, and the ragged trailing
  // edge scalloped between the finger bones back to the flank.
  const pts: Array<[number, number]> = [
    [0.9, 0.3 * side],
    [1.3, (span * 0.5 + lift * 0.3) * side],
    [0.4, (span + lift) * side],
    [-0.3, (span * 0.72 + lift * 0.6) * side],
    [-0.75, (span * 0.86 + lift * 0.7) * side],
    [-1.15, (span * 0.55 + lift * 0.4) * side],
    [-1.6, (span * 0.62 + lift * 0.4) * side],
    [-1.3, 0.4 * side],
  ];
  const [sx, sy] = p(pts[0][0], pts[0][1]);
  ctx.moveTo(sx, sy);
  for (let i = 1; i < pts.length; i++) {
    const [qx, qy] = p(pts[i][0], pts[i][1]);
    if (i >= 3) {
      // The trailing edge sags between the bones.
      const [px0, py0] = p(pts[i - 1][0], pts[i - 1][1]);
      ctx.quadraticCurveTo((px0 + qx) / 2 + 0.15, (py0 + qy) / 2 - 0.25 * side, qx, qy);
    } else {
      ctx.lineTo(qx, qy);
    }
  }
  ctx.closePath();
}

function drawDragonBody(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number, beat: number, wag: number): void {
  const span = 3.6 + 1.4 * beat;
  const lift = -0.9 * beat;
  const p = (fx: number, sy: number): [number, number] => [x + fx * dir, y + sy];
  // The far wing first, darker, then the body, then the near wing.
  for (const side of [-1, 1]) {
    ctx.beginPath();
    wingPath(ctx, p, side, span, lift);
    ctx.fillStyle = side < 0 ? "#3a0f10" : "#5a1416";
    ctx.fill();
    ctx.strokeStyle = "#1a0606";
    ctx.lineWidth = 0.08;
    ctx.stroke();
    // Finger bones fanning from the shoulder.
    const [sx, sy] = p(1.1, 0.35 * side);
    ctx.beginPath();
    for (const [fx, k] of [[0.4, 1], [-0.3, 0.72], [-0.75, 0.86], [-1.15, 0.55]] as Array<[number, number]>) {
      const [qx, qy] = p(fx, (span * k + lift * (k > 0.8 ? 0.7 : 0.5)) * side);
      ctx.moveTo(sx, sy);
      ctx.lineTo(qx, qy);
    }
    ctx.strokeStyle = "#240909";
    ctx.lineWidth = 0.07;
    ctx.stroke();
    if (side < 0) {
      dragonPath(ctx, x, y, dir, beat, wag, false);
      const g = ctx.createLinearGradient(x, y - 0.6, x, y + 0.6);
      g.addColorStop(0, "#4a1a14");
      g.addColorStop(0.5, "#2a0c0c");
      g.addColorStop(1, "#170606");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = "#7a1414";
      ctx.lineWidth = 0.06;
      ctx.stroke();
      // Spines down its back.
      ctx.fillStyle = "#8a2a1a";
      for (let fx = 2.2; fx > -4; fx -= 0.55) {
        const sway = fx < -1.7 ? wag * clamp01((-fx - 1.7) / 2.6) : 0;
        const [qx, qy] = p(fx, sway);
        ctx.beginPath();
        ctx.moveTo(qx - 0.12 * dir, qy);
        ctx.lineTo(qx + 0.1 * dir, qy - 0.12);
        ctx.lineTo(qx + 0.12 * dir, qy + 0.05);
        ctx.fill();
      }
      // Horns, and eyes like embers.
      ctx.strokeStyle = "#c8b89a";
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      for (const s of [-1, 1]) {
        const [hx, hy] = p(2.7, 0.22 * s);
        const [tx, ty] = p(2.25, 0.55 * s);
        ctx.moveTo(hx, hy);
        ctx.lineTo(tx, ty);
      }
      ctx.stroke();
      ctx.fillStyle = "#ff6a22";
      for (const s of [-1, 1]) {
        const [ex, ey] = p(2.95, 0.12 * s);
        ctx.beginPath();
        ctx.arc(ex, ey, 0.07, 0, TAU);
        ctx.fill();
      }
    }
  }
}

let glowSprites = new Map<string, HTMLCanvasElement>();
function glow(colour: string): HTMLCanvasElement {
  let c = glowSprites.get(colour);
  if (c) return c;
  if (glowSprites.size > 32) glowSprites = new Map();
  c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, colour);
  grad.addColorStop(0.3, colour + "88");
  grad.addColorStop(1, colour + "00");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowSprites.set(colour, c);
  return c;
}

function glowAt(ctx: CanvasRenderingContext2D, colour: string, x: number, y: number, r: number, a: number): void {
  ctx.globalAlpha = clamp01(a);
  ctx.drawImage(glow(colour), x - r, y - r, r * 2, r * 2);
}

// Curtains of light over the top of the sky, three ribbons as the bot draws
// them, each hung with rays that brighten and dim along it.
const AURORA_COLOURS = ["#3ee08f", "#5fd3c6", "#9b6bff"];
let curtains = new Map<string, HTMLCanvasElement>();
function curtain(colour: string): HTMLCanvasElement {
  let c = curtains.get(colour);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = 16;
  c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 64, 0, 0);
  grad.addColorStop(0, colour + "00");
  grad.addColorStop(0.08, colour);
  grad.addColorStop(0.3, colour + "aa");
  grad.addColorStop(1, colour + "00");
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 64);
  // Soft at the sides, so neighbouring rays run together.
  g.globalCompositeOperation = "destination-in";
  const side = g.createLinearGradient(0, 0, 16, 0);
  side.addColorStop(0, "rgba(0,0,0,0)");
  side.addColorStop(0.5, "rgba(0,0,0,1)");
  side.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = side;
  g.fillRect(0, 0, 16, 64);
  curtains.set(colour, c);
  return c;
}

function drawAurora(ctx: CanvasRenderingContext2D, sky: Sky, r: SkyRoom, alpha: number): void {
  const time = sky.time;
  ctx.globalCompositeOperation = "lighter";
  AURORA_COLOURS.forEach((colour, i) => {
    const sprite = curtain(colour);
    for (let x = -0.5; x <= 49.5; x += 0.4) {
      const wave = Math.sin(x * 0.18 + time * 0.05 + i * 2.1) + 0.5 * Math.sin(x * 0.07 - time * 0.03 + i);
      const base = 3 + i * 2.2 + 1.4 * wave + 1.6;
      const tall = 3 + 1.2 * Math.sin(x * 0.11 + time * 0.04 + i * 1.3);
      const ray = 0.55 + 0.45 * Math.sin(x * 1.7 + time * 0.3 + i * 5) * Math.sin(x * 0.53 - time * 0.11);
      ctx.globalAlpha = clamp01(alpha * sky.aurora * 0.26 * ray);
      ctx.drawImage(sprite, r.ox + x - 0.6, r.oy + base - tall, 1.2, tall + 0.4);
    }
  });
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
}

// The moon where the bot hangs it, in the north-east of the castle's sky:
// lit as it is tonight, with its seas showing, and a halo when full.
const MOON = { x: 46, y: 3, r: 1.1 };

function drawMoon(ctx: CanvasRenderingContext2D, sky: Sky, r: SkyRoom, alpha: number, now: number): void {
  const x = r.ox + MOON.x;
  const y = r.oy + MOON.y;
  const age = Math.floor(sky.moon);
  ctx.globalCompositeOperation = "lighter";
  const full = 1 - Math.abs(age - TOWN_MOON_DAYS / 2) / (TOWN_MOON_DAYS / 2);
  glowAt(ctx, "#cfd8ff", x, y, MOON.r * (3.2 + 0.1 * Math.sin(now / 2000)), alpha * (0.12 + 0.3 * full));
  ctx.globalCompositeOperation = "source-over";
  // The dark of the disc, faintly seen.
  ctx.globalAlpha = alpha * 0.55;
  ctx.fillStyle = "#1c2240";
  ctx.beginPath();
  ctx.arc(x, y, MOON.r, 0, TAU);
  ctx.fill();
  if (age === 0) {
    ctx.globalAlpha = 1;
    return;
  }
  // The lit part: the limb on one side and the terminator's half-ellipse.
  const angle = (TAU * age) / TOWN_MOON_DAYS;
  const waxing = angle <= Math.PI;
  const side = waxing ? 1 : -1;
  const reach = Math.cos(waxing ? angle : TAU - angle);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y, MOON.r, MOON.r, 0, -Math.PI / 2, Math.PI / 2, side < 0);
  ctx.ellipse(x, y, Math.abs(reach) * MOON.r, MOON.r, 0, Math.PI / 2, -Math.PI / 2, reach > 0 === (side > 0));
  ctx.closePath();
  ctx.clip();
  ctx.globalAlpha = alpha;
  const g = ctx.createRadialGradient(x - 0.3, y - 0.3, 0.1, x, y, MOON.r);
  g.addColorStop(0, "#fffbe6");
  g.addColorStop(1, "#d8d2b0");
  ctx.fillStyle = g;
  ctx.fillRect(x - MOON.r, y - MOON.r, MOON.r * 2, MOON.r * 2);
  // Its seas.
  ctx.fillStyle = "rgba(150,146,124,0.45)";
  for (const [dx, dy, rr] of [[-0.3, -0.25, 0.32], [0.25, 0.1, 0.24], [-0.1, 0.42, 0.18], [0.45, -0.4, 0.13]]) {
    ctx.beginPath();
    ctx.arc(x + dx, y + dy, rr, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

// A star falling across the night, its trail fading behind it.
function drawStar(ctx: CanvasRenderingContext2D, sky: Sky, r: SkyRoom, alpha: number): void {
  const star = sky.star!;
  const x = r.ox + star.x - 1.6 * star.t;
  const y = r.oy + star.y + 0.9 * star.t;
  const fade = alpha * clamp01(1 - star.t / TOWN_STAR_TICKS) * clamp01(star.t * 4);
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createLinearGradient(x + 3.2, y - 1.8, x, y);
  g.addColorStop(0, "rgba(255,251,232,0)");
  g.addColorStop(1, "rgba(255,251,232,0.9)");
  ctx.strokeStyle = g;
  ctx.lineWidth = 0.07;
  ctx.globalAlpha = fade;
  ctx.beginPath();
  ctx.moveTo(x + 3.2, y - 1.8);
  ctx.lineTo(x, y);
  ctx.stroke();
  glowAt(ctx, "#fff4d0", x, y, 0.6, fade);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
}

// Pale green lights over the marshes on a new-moon night, each drifting
// about its own tile and flickering out of step with the rest.
function drawWisps(ctx: CanvasRenderingContext2D, sky: Sky, r: SkyRoom, alpha: number, now: number): void {
  const fade = alpha * clamp01((sky.t - NIGHT_START) / 20);
  ctx.globalCompositeOperation = "lighter";
  marshTiles("wisps", sky, r).forEach(([x, y], i) => {
    const wx = r.ox + x + 0.7 * Math.sin(sky.time * 0.09 + i * 1.7);
    const bob = 0.15 * Math.sin(now / 700 + i);
    const wy = r.oy + y + 0.5 * Math.cos(sky.time * 0.07 + i * 2.3) - 0.5 + bob;
    const flicker = 0.5 + 0.5 * Math.sin(now / 260 + i * 3.1) * Math.sin(now / 610 + i);
    glowAt(ctx, "#6fe8c8", wx, wy, 1.4, fade * (0.35 + 0.25 * flicker));
    glowAt(ctx, "#d8fff4", wx, wy, 0.22 + 0.06 * flicker, fade * (0.7 + 0.3 * flicker));
  });
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
}

// Fireflies round the fountain on a summer night, as the bot has them,
// winking on and off.
const FIREFLIES = 14;
function drawFireflies(ctx: CanvasRenderingContext2D, sky: Sky, r: SkyRoom, alpha: number, now: number): void {
  const { x, y } = r.fountain!;
  const secs = now / 1000;
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < FIREFLIES; i++) {
    const angle = (i * TAU) / FIREFLIES + sky.time / 40 + 0.3 * Math.sin(secs * 0.7 + i);
    const reach = 2 + (i % 4) + Math.sin(secs * 0.4 + i * 7) * 0.6;
    const wink = Math.max(0, Math.sin(secs * (1.1 + (i % 3) * 0.3) + i * 5));
    const fx = r.ox + x + Math.cos(angle) * reach;
    const fy = r.oy + y + Math.sin(angle) * reach * 0.8 - 0.5 - 0.3 * Math.sin(secs * 1.7 + i);
    glowAt(ctx, "#d4ff66", fx, fy, 0.5, alpha * wink * 0.6);
    glowAt(ctx, "#f4ffc8", fx, fy, 0.09, alpha * wink);
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
}

// A bolt of lightning from the top of the sky to the ground, forking, on the
// tick it strikes, where the bot strikes it.
function drawLightning(ctx: CanvasRenderingContext2D, f: Frame, sky: Sky, r: SkyRoom, alpha: number): void {
  const next = rng(sky.boltTick * 2654435761);
  const gx = r.ox + 5 + ((sky.boltTick * 7) % 40);
  const gy = r.oy + 20;
  const top = f.cam.y - f.h / 2 / f.cam.scale - 1;
  const main: Array<[number, number]> = [[gx, gy]];
  let x = gx;
  for (let y = gy - 1.2; y > top; y -= 0.8 + next() * 1.2) {
    x += (next() - 0.5) * 1.6;
    main.push([x, y]);
  }
  const forks: Array<Array<[number, number]>> = [];
  for (let k = 0; k < 3; k++) {
    const from = main[1 + Math.floor(next() * Math.max(1, main.length - 2))];
    if (!from) continue;
    const fork: Array<[number, number]> = [from];
    let fx = from[0];
    let fy = from[1];
    const lean = next() < 0.5 ? -1 : 1;
    for (let i = 0; i < 4; i++) {
      fx += lean * (0.4 + next() * 0.8);
      fy += 0.5 + next() * 0.8;
      fork.push([fx, fy]);
    }
    forks.push(fork);
  }
  const a = alpha * sky.lightning;
  ctx.globalCompositeOperation = "lighter";
  ctx.lineJoin = "round";
  const stroke = (pts: Array<[number, number]>, width: number, colour: string, k: number) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const [px, py] of pts.slice(1)) ctx.lineTo(px, py);
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.globalAlpha = clamp01(a * k);
    ctx.stroke();
  };
  for (const pts of [main, ...forks]) {
    const thin = pts === main ? 1 : 0.55;
    stroke(pts, 0.7 * thin, "#7f9cff", 0.25);
    stroke(pts, 0.22 * thin, "#cfe0ff", 0.6);
    stroke(pts, 0.07 * thin, "#ffffff", 1);
  }
  glowAt(ctx, "#cfe0ff", gx, gy, 3, a * 0.6);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
}

// A wolf's eyes in the dark at the castle's edge on a full-moon night, and
// its howl rising and fading over them.
function drawHowl(f: Frame, sky: Sky, r: SkyRoom, alpha: number): void {
  const { ctx } = f;
  const howl = sky.howl!;
  const fade = alpha * clamp01(1 - howl.t / TOWN_HOWL_TICKS) * clamp01(howl.t * 3);
  const x = r.ox + howl.x;
  const y = r.oy + howl.y;
  ctx.globalCompositeOperation = "lighter";
  for (const s of [-0.15, 0.15]) {
    glowAt(ctx, "#ffdd55", x + s, y, 0.3, fade * 0.6);
    glowAt(ctx, "#fff2b0", x + s, y, 0.07, fade);
  }
  ctx.globalCompositeOperation = "source-over";
  screenTransform(f);
  const [sx, sy] = toScreen(f, x, y - 0.8 - howl.t * 0.15);
  const px = Math.max(11, 0.5 * f.cam.scale);
  ctx.font = `italic ${px}px "IM Fell English", Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.globalAlpha = clamp01(fade * 0.9);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.strokeText("Awoo-oo!", sx, sy);
  ctx.fillStyle = "#a8b8d8";
  ctx.fillText("Awoo-oo!", sx, sy);
  ctx.globalAlpha = 1;
  worldTransform(f);
}
