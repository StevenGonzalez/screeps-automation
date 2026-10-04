// Paints a room's terrain off the main thread, so the camera never stutters
// while a room it is flying towards is being painted.
//
// Walls and swamps are drawn from a blurred, noise-roughened copy of the
// 50x50 terrain, so rock has rounded, broken edges instead of squares, lit
// from the upper left by the slope of that field. Noise is taken in world
// tiles, so it runs on across room borders.
//
// The land is painted as it looks by day in the season: green meadows with
// flowers in spring, deep grass in summer, ochre and fallen leaves in autumn,
// snow and frozen marsh in winter. Night is the lighting pass's business.

import type { TownSeason } from "../../src/config/config.town";

export interface BakeRequest {
  id: number;
  terrain: string;
  px: number;
  ox: number;
  oy: number;
  season: TownSeason;
}

type Rgb = [number, number, number];

interface Palette {
  // Grass in two tones, mixed by noise, and bare earth where it wears through.
  grass: [Rgb, Rgb];
  earth: Rgb;
  // Specks on the meadow: flowers, fallen leaves, or grass through the snow.
  specks: Rgb[];
  speckOdds: number;
  // Marsh water deep and shallow, the sky's sheen on it, and lily pads on
  // it in the warm months.
  marsh: [Rgb, Rgb];
  sheen: Rgb;
  pads: Rgb | null;
  frozen: boolean;
  // The forest floor on the wooded rim of the rock, and the bare rock above.
  moss: Rgb;
  rock: Rgb;
  // How much snow lies on the rock's faces that look up.
  snow: number;
}

const PALETTES: Record<TownSeason, Palette> = {
  spring: {
    grass: [[74, 118, 50], [106, 150, 64]],
    earth: [112, 92, 62],
    specks: [[248, 246, 236], [245, 214, 84], [214, 150, 206], [236, 182, 196]],
    speckOdds: 0.025,
    marsh: [[44, 74, 70], [78, 110, 78]],
    sheen: [150, 186, 196],
    pads: [86, 140, 58],
    frozen: false,
    moss: [58, 94, 46],
    rock: [120, 114, 102],
    snow: 0,
  },
  summer: {
    grass: [[60, 102, 40], [92, 136, 52]],
    earth: [120, 98, 62],
    specks: [[245, 214, 84], [250, 248, 238], [196, 84, 64]],
    speckOdds: 0.01,
    marsh: [[40, 68, 62], [70, 102, 64]],
    sheen: [140, 180, 192],
    pads: [70, 124, 48],
    frozen: false,
    moss: [44, 78, 38],
    rock: [122, 114, 100],
    snow: 0,
  },
  autumn: {
    grass: [[118, 108, 56], [152, 130, 66]],
    earth: [114, 86, 54],
    specks: [[198, 94, 40], [224, 152, 62], [162, 62, 36], [214, 184, 74]],
    speckOdds: 0.045,
    marsh: [[50, 62, 56], [92, 98, 66]],
    sheen: [150, 160, 166],
    pads: null,
    frozen: false,
    moss: [104, 88, 50],
    rock: [116, 108, 96],
    snow: 0,
  },
  winter: {
    grass: [[214, 224, 234], [242, 245, 249]],
    earth: [200, 208, 218],
    specks: [[98, 104, 82], [120, 112, 92]],
    speckOdds: 0.015,
    marsh: [[150, 178, 196], [196, 214, 226]],
    sheen: [232, 240, 248],
    pads: null,
    frozen: true,
    moss: [206, 216, 228],
    rock: [118, 118, 126],
    snow: 0.9,
  },
};

// The realm map is painted a little darker, so the bot's map overlay reads
// clearly over it.
const THUMB_SHADE = 0.82;
// Specks are only painted where a tile has this many pixels to show them.
const SPECK_PX = 10;
// Specks fall at most one to a cell this fraction of a tile across.
const SPECK_CELLS = 5;

function hash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number): number {
  return noise(x, y) * 0.55 + noise(x * 2.03, y * 2.03) * 0.3 + noise(x * 4.11, y * 4.11) * 0.15;
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
  return t * t * (3 - 2 * t);
};

// The terrain as a 52x52 field with a tile of edge padding, blurred with a
// binomial kernel.
function field(terrain: string, pick: (v: number) => boolean): Float32Array {
  const raw = new Float32Array(52 * 52);
  for (let gy = 0; gy < 52; gy++) {
    for (let gx = 0; gx < 52; gx++) {
      const tx = Math.min(49, Math.max(0, gx - 1));
      const ty = Math.min(49, Math.max(0, gy - 1));
      raw[gy * 52 + gx] = pick(terrain.charCodeAt(ty * 50 + tx) - 48) ? 1 : 0;
    }
  }
  const out = new Float32Array(52 * 52);
  const k = [1, 2, 1];
  for (let gy = 0; gy < 52; gy++) {
    for (let gx = 0; gx < 52; gx++) {
      let sum = 0;
      let wsum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = gx + dx;
          const y = gy + dy;
          if (x < 0 || y < 0 || x > 51 || y > 51) continue;
          const w = k[dx + 1] * k[dy + 1];
          sum += raw[y * 52 + x] * w;
          wsum += w;
        }
      }
      out[gy * 52 + gx] = sum / wsum;
    }
  }
  return out;
}

// The field at room tile coordinates (u, v), where tile i spans [i, i + 1).
function sample(f: Float32Array, u: number, v: number): number {
  const gx = Math.min(50.999, Math.max(0, u + 0.5));
  const gy = Math.min(50.999, Math.max(0, v + 0.5));
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = gx - ix;
  const fy = gy - iy;
  const a = f[iy * 52 + ix];
  const b = f[iy * 52 + ix + 1];
  const c = f[(iy + 1) * 52 + ix];
  const d = f[(iy + 1) * 52 + ix + 1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function scale(c: Rgb, k: number): Rgb {
  return [c[0] * k, c[1] * k, c[2] * k];
}

// A speck near world point (wx, wy), if one lies there: one in some cells of
// a fine grid, a dot of `r` tiles at a place in the cell drawn from its hash.
// Returns its index into the palette's specks, or -1.
function speck(wx: number, wy: number, odds: number, r: number, count: number): number {
  const cx = Math.floor(wx * SPECK_CELLS);
  const cy = Math.floor(wy * SPECK_CELLS);
  const h = hash(cx, cy);
  if (h >= odds) return -1;
  const px = (cx + 0.2 + 0.6 * hash(cx + 7, cy)) / SPECK_CELLS;
  const py = (cy + 0.2 + 0.6 * hash(cx, cy + 7)) / SPECK_CELLS;
  if (Math.hypot(wx - px, wy - py) > r) return -1;
  return Math.floor((h / odds) * count);
}

// A lily pad over world point (wx, wy), if one floats there: one in some
// cells of a third of a tile, round but squashed as the ground is seen, with
// a notch cut out and now and then a flower at its heart. Returns the pad's
// shade (lit on its near side), 2 for the flower, or 0 for open water.
function pad(wx: number, wy: number): number {
  const cx = Math.floor(wx * 3);
  const cy = Math.floor(wy * 3);
  if (hash(cx + 101, cy + 59) > 0.2) return 0;
  const r = 0.07 + 0.05 * hash(cx, cy + 3);
  const dx = wx - (cx + 0.3 + 0.4 * hash(cx + 3, cy)) / 3;
  const dy = (wy - (cy + 0.3 + 0.4 * hash(cx, cy + 5)) / 3) / 0.62;
  const d = Math.hypot(dx, dy);
  if (d > r) return 0;
  const notch = Math.atan2(dy, dx) - hash(cx + 9, cy + 9) * Math.PI * 2;
  if (Math.abs(Math.atan2(Math.sin(notch), Math.cos(notch))) < 0.3) return 0;
  if (d < r * 0.35 && hash(cx + 17, cy + 23) < 0.25) return 2;
  return 0.8 + 0.3 * (dy / r + 1) / 2;
}

export function bake(terrain: string, px: number, ox: number, oy: number, season: TownSeason): Uint8ClampedArray {
  const pal = PALETTES[season];
  const size = 50 * px;
  const out = new Uint8ClampedArray(size * size * 4);
  const wall = field(terrain, (v) => (v & 1) === 1);
  const swamp = field(terrain, (v) => (v & 2) === 2 && (v & 1) === 0);
  const detailed = px >= SPECK_PX;
  const finish = detailed ? 1 : THUMB_SHADE;
  const e = 0.35;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / px;
    const wy = oy + v;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / px;
      const wx = ox + u;
      const n = fbm(wx * 0.45, wy * 0.45);
      const n2 = fbm(wx * 1.7 + 31.7, wy * 1.7 + 11.3);
      const wRaw = sample(wall, u, v);
      const wf = wRaw + (n - 0.5) * 0.45;
      const wc = smoothstep(0.44, 0.56, wf);
      // The marsh's edge wanders more gently than the rock's, so its mud
      // ring reads as one bank rather than broken specks.
      const sRaw = sample(swamp, u, v) + (noise(wx * 1.1 + 7.3, wy * 1.1 - 3.1) - 0.5) * 0.45;
      const sc = smoothstep(0.42, 0.58, sRaw);

      // The meadow: two greens by noise, earth wearing through in patches,
      // and shaded where the rock rises over it.
      const ao = 1 - 0.38 * smoothstep(0.05, 0.5, wRaw);
      let c = mix(pal.grass[0], pal.grass[1], 0.75 * smoothstep(0.25, 0.75, n) + 0.25 * n2);
      c = mix(c, pal.earth, 0.4 * smoothstep(0.64, 0.8, fbm(wx * 0.3 + 91, wy * 0.3 - 47)));
      c = scale(c, (0.95 + 0.1 * n2) * ao);
      if (detailed && wc < 0.05 && sRaw < 0.35) {
        const i = speck(wx, wy, pal.speckOdds, 0.035, pal.specks.length);
        if (i >= 0) c = pal.specks[i];
      }

      if (sRaw > 0.22) {
        // The marsh: still, peaty water, lighter where it shallows and where
        // the sky shows in it, ringed with dark wet mud; lily pads on it in
        // the warm months, and grey ice with cracks in winter. Reeds stand
        // up out of it as pieces of the scene (see flora).
        const depth = smoothstep(0.5, 0.95, sRaw);
        let water = mix(pal.marsh[1], pal.marsh[0], depth);
        water = mix(water, pal.sheen, 0.3 * smoothstep(0.5, 0.8, fbm(wx * 0.9 - 13, wy * 0.4 + 5)));
        if (pal.frozen) {
          const crack = Math.abs(fbm(wx * 2.3, wy * 2.3) - 0.5);
          if (crack < 0.5 / px + 0.004) water = scale(water, 0.8);
        } else if (detailed && pal.pads && depth > 0.2) {
          const p = pad(wx, wy);
          if (p > 0) water = p === 2 ? [246, 228, 234] : scale(pal.pads, p);
        }
        const shore = smoothstep(0.22, 0.44, sRaw) * (1 - sc);
        // Wet mud, or in winter only a faint dip in the snow.
        c = pal.frozen ? mix(c, scale(pal.grass[0], 0.9), shore) : mix(c, scale(pal.earth, 0.6), 0.65 * shore);
        c = mix(c, water, sc);
      }

      if (wc > 0) {
        // Rock lit by the slope of the wall field, darker deep inside, under
        // a forest floor where the trees stand on its rim and snow on its
        // upward faces in winter.
        const gx = sample(wall, u + e, v) - sample(wall, u - e, v);
        const gy = sample(wall, u, v + e) - sample(wall, u, v - e);
        const light = Math.max(-0.42, Math.min(0.5, -(gx + gy) * 1.3));
        const shade = 0.78 + light;
        const deep = 1 - 0.18 * smoothstep(0.7, 1.15, wf);
        const grain = 0.84 + 0.32 * n2;
        let rock = scale(pal.rock, shade * deep * grain);
        const floor = (1 - smoothstep(0.62, 0.95, wf)) * 0.7 + 0.25 * smoothstep(0.45, 0.7, n2);
        rock = mix(rock, scale(pal.moss, 0.85 + 0.3 * n), Math.min(1, floor));
        if (pal.snow > 0) rock = mix(rock, scale(pal.grass[1], 0.9 + 0.1 * shade), pal.snow * smoothstep(-0.4, 0.25, light + (n - 0.5) * 0.4));
        c = mix(c, rock, wc);
      }

      const i = (y * size + x) * 4;
      out[i] = c[0] * finish;
      out[i + 1] = c[1] * finish;
      out[i + 2] = c[2] * finish;
      out[i + 3] = 255;
    }
  }
  return out;
}

self.onmessage = (ev: MessageEvent<BakeRequest>) => {
  const { id, terrain, px, ox, oy, season } = ev.data;
  const pixels = bake(terrain, px, ox, oy, season);
  (self as unknown as Worker).postMessage({ id, size: 50 * px, pixels }, [pixels.buffer]);
};
