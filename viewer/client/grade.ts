// The realm's dark-fantasy grade. Under the sky's light, the drawn world has
// its colour drained by half, its shadows deepened, its shade cooled, and fog
// drifting over it; the lamps and fires lit afterwards then burn warm against
// it. The page's vignette darkens the edges (see index.html).
//
// The colour work is an SVG filter the browser applies to the world's canvas
// as it shows it: a colour matrix drains it, and a table for each channel
// deepens, cools and warms it at once. The fog is a sheet tiled over the page
// above it. Drawn into the canvas, either would cost a pass over every pixel
// each frame, and the filter would take the canvas off the GPU.

import type { Frame } from "./camera";
import type { Sky } from "./sky";

// How much colour the world keeps, and how far its shadows are pressed down.
// The night is dark enough already: by night the shadows and the cool shade
// keep only NIGHT_TONE of their weight.
const SATURATION = 0.62;
const SHADOW = 0.6;
const NIGHT_TONE = 0.4;
// The shade's cool cast, and the warmth the lit surfaces keep, laid over them
// soft-light at WARM_ALPHA.
const COOL = [184, 198, 222];
const WARM = [255, 206, 150];
const WARM_ALPHA = 0.22;
// Entries in each channel's table, and the steps the shadows' weight is held
// to, so the filter is rebuilt only as night falls or lifts.
const TABLE = 64;
const WEIGHT_STEPS = 64;
const FILTER_ID = "realm-grade";
// Fog: its colour, the tiles one sheet of it spans, and its drift in tiles per second.
const FOG = [158, 168, 179];
const FOG_SPAN = 90;
const FOG_DRIFT = [0.35, 0.12];
const FOG_PX = 128;

export class Grade {
  private tables: SVGElement[] | null = null;
  private weight = -1;

  /** `world` is the canvas the world is drawn on, `fog` the element over it the fog is tiled on. */
  constructor(
    private readonly world: HTMLCanvasElement,
    private readonly fog: HTMLElement,
  ) {}

  /** Grades the world as the sky has it this frame, and moves its fog with the camera. */
  tone(f: Frame, sky: Sky): void {
    this.setWeight(Math.round((1 - (1 - NIGHT_TONE) * sky.glow) * WEIGHT_STEPS) / WEIGHT_STEPS);
    this.moveFog(f);
  }

  private setWeight(weight: number): void {
    if (!this.tables) {
      this.tables = gradeFilter();
      this.world.style.filter = `url(#${FILTER_ID})`;
    }
    if (weight === this.weight) return;
    this.weight = weight;
    for (const [c, table] of this.tables.entries()) {
      const values = Array.from({ length: TABLE }, (_, i) => tone(i / (TABLE - 1), weight, c).toFixed(4));
      table.setAttribute("tableValues", values.join(" "));
    }
  }

  private moveFog(f: Frame): void {
    const { style } = this.fog;
    if (!style.backgroundImage) style.backgroundImage = `url(${fogSheet().toDataURL()})`;
    const t = f.now / 1000;
    // One sheet spans FOG_SPAN tiles of the world and drifts across it.
    const size = FOG_SPAN * f.cam.scale;
    const x = f.w / 2 + (FOG_DRIFT[0] * t - f.cam.x) * f.cam.scale;
    const y = f.h / 2 + (FOG_DRIFT[1] * t - f.cam.y) * f.cam.scale;
    const wrap = (v: number) => ((v % size) + size) % size;
    style.backgroundSize = `${size}px ${size}px`;
    style.backgroundPosition = `${wrap(x)}px ${wrap(y)}px`;
  }
}

// The grade's filter, added to the page: the colour matrix and the three
// channels' tables, whose values setWeight fills in.
function gradeFilter(): SVGElement[] {
  const NS = "http://www.w3.org/2000/svg";
  const make = (name: string, attrs: Record<string, string>, parent?: Element) => {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    parent?.appendChild(e);
    return e;
  };
  const svg = make("svg", { width: "0", height: "0", style: "position:absolute" });
  // Canvas blends in sRGB, and so must the filter to match it.
  const filter = make("filter", { id: FILTER_ID, "color-interpolation-filters": "sRGB", x: "0", y: "0", width: "1", height: "1" }, svg);
  // Drained: each channel moved toward the pixel's luminosity, as a grey laid
  // over by its saturation alone would move it.
  const a = 1 - SATURATION;
  const lum = [0.3, 0.59, 0.11];
  const rows = [0, 1, 2].map((r) => [...lum.map((l, c) => (r === c ? 1 - a : 0) + a * l), 0, 0].join(" "));
  make("feColorMatrix", { type: "matrix", values: [...rows, "0 0 0 1 0"].join(" ") }, filter);
  const transfer = make("feComponentTransfer", {}, filter);
  const tables = ["feFuncR", "feFuncG", "feFuncB"].map((name) => make(name, { type: "table" }, transfer));
  document.body.appendChild(svg);
  return tables;
}

// One channel's tone after the drain, from 0 to 1: the shadows deepened by
// multiplying the picture by itself in part, the shade cooled, and the warmth
// laid over soft-light.
function tone(x: number, weight: number, channel: number): number {
  const deep = SHADOW * weight;
  let y = x * (1 - deep + deep * x);
  y *= 1 - weight + (weight * COOL[channel]) / 255;
  return (1 - WARM_ALPHA) * y + WARM_ALPHA * softLight(y, WARM[channel] / 255);
}

// The soft-light blend of a source channel over a backdrop channel, as canvas has it.
function softLight(b: number, s: number): number {
  if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  return b + (2 * s - 1) * (d - b);
}

// A tiling sheet of fog: smooth value noise, thick where it rises above the middle.
function fogSheet(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = FOG_PX;
  const g = c.getContext("2d")!;
  const img = g.createImageData(FOG_PX, FOG_PX);
  const octaves = [4, 8, 16, 32].map((cells, i) => ({ cells, amp: 0.5 ** i, grid: Array.from({ length: cells * cells }, () => Math.random()) }));
  const total = octaves.reduce((s, o) => s + o.amp, 0);
  const ease = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < FOG_PX; y++) {
    for (let x = 0; x < FOG_PX; x++) {
      let n = 0;
      for (const o of octaves) {
        const fx = (x / FOG_PX) * o.cells;
        const fy = (y / FOG_PX) * o.cells;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const at = (i: number, j: number) => o.grid[(j % o.cells) * o.cells + (i % o.cells)];
        const u = ease(fx - x0);
        const v = ease(fy - y0);
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * u;
        const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * u;
        n += (top + (bottom - top) * v) * o.amp;
      }
      const i = (y * FOG_PX + x) * 4;
      img.data[i] = FOG[0];
      img.data[i + 1] = FOG[1];
      img.data[i + 2] = FOG[2];
      img.data[i + 3] = Math.round(Math.min(0.34, Math.max(0, (n / total - 0.45) * 1.1)) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
