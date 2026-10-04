// Light over the picture. Everything is drawn as it looks by day; this layer
// then multiplies it by a light map: the sky's colour everywhere, the shadows
// of passing clouds by day, and every lamp, fire and spell added in where it
// burns. Lights are bloomed over the result as well, since a multiply can
// only darken and a fire should look brighter than the stone it stands on.
//
// The page blends the layer over the world hard-light (see index.html), which
// multiplies by twice a value up to a half and screens by what lies above
// it. So the layer holds half the light map, and the bloom added over that.

import { clamp, smoothstep, type Frame } from "./camera";
import { hash2, rgba, type Light } from "./art";
import type { Sky } from "./sky";

// The light map is drawn at this fraction of the canvas's size: light is soft
// and needs no more.
const RESOLUTION = 0.5;
const GLOW_PX = 64;
// Clouds drift across the realm in tiles per second, in cells this many tiles across.
const CLOUD_DRIFT = [0.55, 0.18];
const CLOUD_CELL = 26;
// How much of the sky's light still falls on the realm map, far out, against
// the full measure up close.
const MAP_LIGHT = 0.4;

export class Lighting {
  private readonly canvas = document.createElement("canvas");
  private readonly ctx = this.canvas.getContext("2d")!;
  private readonly out: CanvasRenderingContext2D;
  private readonly glows = new Map<string, HTMLCanvasElement>();

  /** `layer` is the canvas the page blends over the world. */
  constructor(private readonly layer: HTMLCanvasElement) {
    this.out = layer.getContext("2d", { alpha: false })!;
  }

  /**
   * Lights the frame. `unlit` are world rectangles left as they are, where
   * the bot draws its own sky. The light map follows the camera's transform.
   */
  draw(f: Frame, sky: Sky, all: Light[], unlit: Array<[number, number, number, number]>): void {
    const lights = all.filter((l) => !unlit.some(([x0, y0, x1, y1]) => l.x >= x0 && l.x <= x1 && l.y >= y0 && l.y <= y1));
    const full = f.ctx.canvas;
    const lw = Math.max(1, Math.round(full.width * RESOLUTION));
    const lh = Math.max(1, Math.round(full.height * RESOLUTION));
    if (this.canvas.width !== lw || this.canvas.height !== lh) {
      this.canvas.width = this.layer.width = lw;
      this.canvas.height = this.layer.height = lh;
    }
    const close = smoothstep(3, 9, f.cam.scale);
    const reach = MAP_LIGHT + (1 - MAP_LIGHT) * close;
    const ambient = sky.ambient.map((c) => 255 - (255 - c) * reach);
    const glow = sky.glow * reach;
    const clouds = sky.shadow.alpha > 0.02 && !sky.storm;
    const lit = !(ambient.every((c) => c > 254) && !clouds);
    this.layer.style.visibility = lit ? "visible" : "hidden";
    if (!lit) return;

    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.fillStyle = `rgb(${ambient.map(Math.round).join(",")})`;
    g.fillRect(0, 0, lw, lh);

    // The light map in world tiles, as the frame has it.
    const k = (lw / full.width) * f.dpr;
    const s = f.cam.scale * k;
    const ox = (f.w / 2 - f.cam.x * f.cam.scale) * k;
    const oy = (f.h / 2 - f.cam.y * f.cam.scale) * k;
    g.setTransform(s, 0, 0, s, ox, oy);

    if (clouds) this.clouds(g, f, sky.shadow.alpha * 0.55 * close);

    if (glow > 0.01 && lights.length > 0) {
      g.globalCompositeOperation = "lighter";
      for (const l of lights) {
        g.globalAlpha = clamp(l.power * glow, 0, 1);
        g.drawImage(this.glow(l.colour), l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
      }
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
    }

    g.fillStyle = "#ffffff";
    for (const [x0, y0, x1, y1] of unlit) g.fillRect(x0, y0, x1 - x0, y1 - y0);

    // Half the light map, over black.
    const out = this.out;
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.globalCompositeOperation = "source-over";
    out.globalAlpha = 1;
    out.fillStyle = "#000000";
    out.fillRect(0, 0, lw, lh);
    out.globalAlpha = 0.5;
    out.drawImage(this.canvas, 0, 0);

    // The bloom: each light's heart, at half as well, as the blend doubles it.
    if (glow > 0.01 && lights.length > 0) {
      out.setTransform(s, 0, 0, s, ox, oy);
      out.globalCompositeOperation = "lighter";
      for (const l of lights) {
        const r = l.r * 0.45;
        out.globalAlpha = clamp(0.11 * l.power * glow, 0, 1);
        out.drawImage(this.glow(l.colour), l.x - r, l.y - r, r * 2, r * 2);
      }
      out.globalCompositeOperation = "source-over";
    }
    out.globalAlpha = 1;
  }

  // The shadows of fair-weather clouds sliding over the ground, one soft blob
  // or none in each cell of the realm, drawn from the cell alone.
  private clouds(g: CanvasRenderingContext2D, f: Frame, alpha: number): void {
    if (alpha < 0.01) return;
    const t = f.now / 1000;
    const sx = CLOUD_DRIFT[0] * t;
    const sy = CLOUD_DRIFT[1] * t;
    const hw = f.w / 2 / f.cam.scale;
    const hh = f.h / 2 / f.cam.scale;
    const x0 = Math.floor((f.cam.x - hw - sx) / CLOUD_CELL) - 1;
    const x1 = Math.floor((f.cam.x + hw - sx) / CLOUD_CELL) + 1;
    const y0 = Math.floor((f.cam.y - hh - sy) / CLOUD_CELL) - 1;
    const y1 = Math.floor((f.cam.y + hh - sy) / CLOUD_CELL) + 1;
    // Far out the realm map would have thousands of cells; clouds are left
    // to the close view.
    if ((x1 - x0) * (y1 - y0) > 400) return;
    const shade = this.glow("#000000");
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const h = hash2(cx, cy);
        if (h > 0.45) continue;
        const h2 = hash2(cx + 977, cy - 331);
        const h3 = hash2(cx - 113, cy + 719);
        const x = (cx + h2) * CLOUD_CELL + sx;
        const y = (cy + h3) * CLOUD_CELL + sy;
        const r = 7 + 9 * h2;
        g.globalAlpha = alpha * (0.6 + 0.4 * h3);
        g.drawImage(shade, x - r * 1.4, y - r, r * 2.8, r * 2);
        g.drawImage(shade, x - r * 0.4, y - r * 1.2, r * 1.9, r * 1.6);
      }
    }
    g.globalAlpha = 1;
  }

  private glow(colour: string): HTMLCanvasElement {
    let c = this.glows.get(colour);
    if (c) return c;
    c = document.createElement("canvas");
    c.width = c.height = GLOW_PX;
    const g = c.getContext("2d")!;
    const r = GLOW_PX / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, colour);
    grad.addColorStop(0.35, rgba(colour, 0.55));
    grad.addColorStop(1, rgba(colour, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, GLOW_PX, GLOW_PX);
    this.glows.set(colour, c);
    return c;
  }
}
