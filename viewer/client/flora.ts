// The woods on the rock. Natural walls are drawn as wooded highland: oaks
// and pines where the rock meets open ground, giving way to pine forest on
// the heights behind. Oaks and pines turn with the seasons: blossom in spring,
// full leaf in summer, red and gold in autumn, and bare boughs and snow in
// winter. Reeds and bulrushes stand round the marshes and in their
// shallows, green in spring and summer, straw in autumn and winter. Each
// is painted once per season and scale and stamped.

import type { TownSeason } from "../../src/config/config.town";
import { castRound, ellipse, hash2, mix, PALETTE, rng, shade, TAU, type Env, type Piece } from "./art";
import { onScreen, type Wild } from "./scene";

interface Tree {
  x: number;
  y: number;
  pine: boolean;
  // Which of the painted shapes it takes.
  variant: number;
  size: number;
}

const VARIANTS = 4;
// How likely a wall tile is to bear a tree, by how far it lies from open
// ground: the rock is wooded throughout, a little thinner on the heights.
const DENSITY = [0, 0.95, 0.9, 0.75, 0.6];
// How likely a tree is a pine, by the same distance: oaks keep to the edge.
const PINES = [0, 0.4, 0.55, 0.8, 0.95];

const forests = new Map<string, Tree[]>();
const reedbeds = new Map<string, Tree[]>();

// Every wall tile's distance to open ground, up to 4, counting diagonal steps
// as one. Off the room's edge counts as rock.
function wallDistance(terrain: string): Uint8Array {
  const d = new Uint8Array(2500).fill(255);
  let frontier: number[] = [];
  for (let i = 0; i < 2500; i++) {
    if ((terrain.charCodeAt(i) - 48) & 1) continue;
    d[i] = 0;
    frontier.push(i);
  }
  for (let step = 1; step <= 4 && frontier.length > 0; step++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % 50;
      const y = (i - x) / 50;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx > 49 || ny > 49) continue;
          const j = ny * 50 + nx;
          if (d[j] !== 255) continue;
          d[j] = step;
          next.push(j);
        }
      }
    }
    frontier = next;
  }
  return d;
}

function forestOf(terrain: string): Tree[] {
  let trees = forests.get(terrain);
  if (trees) return trees;
  trees = [];
  const dist = wallDistance(terrain);
  for (let i = 0; i < 2500; i++) {
    if (dist[i] === 0) continue;
    const x = i % 50;
    const y = (i - x) / 50;
    const band = Math.min(4, dist[i]);
    const r = rng(Math.floor(hash2(x * 7 + 1, y * 13 + 5) * 4294967296));
    if (r() > DENSITY[band]) continue;
    trees.push({
      x: x + (r() - 0.5) * 0.7,
      y: y + (r() - 0.5) * 0.6,
      pine: r() < PINES[band],
      variant: Math.floor(r() * VARIANTS),
      size: 0.8 + r() * 0.45,
    });
  }
  forests.set(terrain, trees);
  return trees;
}

// Reed clumps on the marshes: most where the water meets open ground, a few
// out in the middle.
function reedsOf(terrain: string): Tree[] {
  let reeds = reedbeds.get(terrain);
  if (reeds) return reeds;
  reeds = [];
  const at = (x: number, y: number) => (x < 0 || y < 0 || x > 49 || y > 49 ? 1 : terrain.charCodeAt(y * 50 + x) - 48);
  for (let i = 0; i < 2500; i++) {
    const x = i % 50;
    const y = (i - x) / 50;
    if (at(x, y) !== 2) continue;
    let shore = false;
    for (let dy = -1; dy <= 1 && !shore; dy++) for (let dx = -1; dx <= 1; dx++) if (at(x + dx, y + dy) === 0) shore = true;
    const r = rng(Math.floor(hash2(x * 11 + 3, y * 17 + 9) * 4294967296));
    if (r() > (shore ? 0.55 : 0.1)) continue;
    reeds.push({ x: x + (r() - 0.5) * 0.7, y: y + (r() - 0.5) * 0.6, pine: false, variant: Math.floor(r() * VARIANTS), size: 0.75 + r() * 0.4 });
  }
  reedbeds.set(terrain, reeds);
  return reeds;
}

// Leaves by season, darkest to lightest; autumn has three moods of its own.
const LEAVES: Record<TownSeason, string[][]> = {
  spring: [["#4a7f30", "#68a23f", "#93c95c"]],
  summer: [["#24532a", "#337034", "#4f9442"]],
  autumn: [
    ["#8f3c16", "#c4622a", "#ec9a3c"],
    ["#7e2418", "#ab3b25", "#d7653a"],
    ["#8c6a1c", "#bf972b", "#e9c955"],
  ],
  winter: [],
};
const NEEDLES = ["#173a26", "#22513a", "#346b4a"];
const BARK = "#4b3524";

const BOX: [number, number, number, number] = [-0.8, -2.15, 0.8, 0.2];

function paintOak(g: CanvasRenderingContext2D, variant: number, season: TownSeason, snow: boolean): void {
  const r = rng(variant * 7919 + 17);
  // The trunk, a little bent, with roots spread at its foot.
  g.strokeStyle = BARK;
  g.lineWidth = 0.11;
  g.beginPath();
  g.moveTo(0, 0);
  g.quadraticCurveTo(0.05 - r() * 0.1, -0.35, (r() - 0.5) * 0.1, -0.7);
  g.stroke();
  g.lineWidth = 0.05;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(0, -0.08);
    g.lineTo(s * 0.13, 0.02);
    g.stroke();
  }
  if (season === "winter") {
    // Bare boughs reaching up and out, snow along their tops.
    const boughs: Array<[number, number, number, number]> = [];
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i / 6 - 0.5) * 2.2 + (r() - 0.5) * 0.3;
      const from = -0.45 - r() * 0.3;
      const len = 0.35 + r() * 0.35;
      boughs.push([0, from, Math.cos(a) * len, from + Math.sin(a) * len]);
    }
    g.strokeStyle = BARK;
    g.lineWidth = 0.045;
    for (const [x0, y0, x1, y1] of boughs) {
      g.beginPath();
      g.moveTo(x0, y0);
      g.quadraticCurveTo((x0 + x1) / 2 + 0.06, (y0 + y1) / 2, x1, y1);
      g.stroke();
      // Twigs.
      g.lineWidth = 0.02;
      g.beginPath();
      g.moveTo((x0 + x1 * 2) / 3, (y0 + y1 * 2) / 3);
      g.lineTo(x1 * 0.9 + 0.12, y1 - 0.12);
      g.stroke();
      g.lineWidth = 0.045;
    }
    if (snow) {
      g.strokeStyle = PALETTE.snow;
      g.lineWidth = 0.025;
      for (const [x0, y0, x1, y1] of boughs) {
        g.beginPath();
        g.moveTo(x0 + (x1 - x0) * 0.3, y0 + (y1 - y0) * 0.3 - 0.02);
        g.lineTo(x1, y1 - 0.02);
        g.stroke();
      }
    }
    return;
  }
  const moods = LEAVES[season];
  const [dark, mid, light] = moods[variant % moods.length];
  // A crown of overlapping clumps: a dark mass, lit clumps over it, and the
  // lightest towards the sun in the south-west.
  const clumps: Array<[number, number, number]> = [];
  const n = 6 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.5;
    const d = 0.22 + r() * 0.12;
    clumps.push([Math.cos(a) * d, -0.95 + Math.sin(a) * d * 0.75, 0.24 + r() * 0.1]);
  }
  clumps.push([0, -1.0, 0.34]);
  g.fillStyle = shade(dark, 0.8);
  for (const [x, y, rr] of clumps) {
    ellipse(g, x, y + 0.05, rr, rr * 0.92);
    g.fill();
  }
  g.fillStyle = mid;
  for (const [x, y, rr] of clumps) {
    ellipse(g, x - 0.02, y - 0.02, rr * 0.86, rr * 0.8);
    g.fill();
  }
  g.fillStyle = light;
  for (const [x, y, rr] of clumps) {
    if (y > -0.85 && x > 0) continue;
    ellipse(g, x - 0.06, y - 0.07, rr * 0.5, rr * 0.42);
    g.fill();
  }
  if (season === "spring") {
    // Blossom.
    for (let i = 0; i < 22; i++) {
      const [cx, cy, rr] = clumps[Math.floor(r() * clumps.length)];
      g.fillStyle = r() < 0.5 ? "#f6c9d6" : "#fff2f4";
      ellipse(g, cx + (r() - 0.5) * rr * 1.4, cy + (r() - 0.5) * rr * 1.2, 0.035, 0.035);
      g.fill();
    }
  }
}

function paintPine(g: CanvasRenderingContext2D, variant: number, season: TownSeason, snow: boolean): void {
  const r = rng(variant * 104729 + 3);
  g.fillStyle = BARK;
  g.fillRect(-0.05, -0.3, 0.1, 0.32);
  const tiers = 4;
  const lean = (r() - 0.5) * 0.08;
  const greens = season === "winter" ? NEEDLES.map((c) => mix(c, "#2f4a52", 0.25)) : NEEDLES;
  for (let i = 0; i < tiers; i++) {
    const k = i / tiers;
    const base = -0.22 - k * 0.42;
    const half = 0.5 * (1 - k * 0.62) * (0.92 + r() * 0.16);
    const top = base - 0.62 + k * 0.08;
    const tip = lean * (i + 1);
    g.beginPath();
    g.moveTo(-half, base);
    g.quadraticCurveTo(-half * 0.4, base - 0.08, tip, top);
    g.quadraticCurveTo(half * 0.4, base - 0.08, half, base);
    g.quadraticCurveTo(0, base + 0.09, -half, base);
    g.fillStyle = greens[0];
    g.fill();
    // The sunward side lit.
    g.beginPath();
    g.moveTo(-half * 0.85, base - 0.01);
    g.quadraticCurveTo(-half * 0.35, base - 0.08, tip, top);
    g.lineTo(tip + half * 0.08, base - 0.04);
    g.closePath();
    g.fillStyle = greens[1];
    g.fill();
    g.strokeStyle = greens[2];
    g.lineWidth = 0.02;
    g.beginPath();
    g.moveTo(-half * 0.7, base - 0.02);
    g.lineTo(-half * 0.2, base - 0.04);
    g.stroke();
    if (snow) {
      g.beginPath();
      g.moveTo(-half * 0.8, base - 0.03);
      g.quadraticCurveTo(-half * 0.3, base - 0.12, tip, top + 0.02);
      g.quadraticCurveTo(half * 0.3, base - 0.12, half * 0.8, base - 0.03);
      g.quadraticCurveTo(0, base - 0.1, -half * 0.8, base - 0.03);
      g.fillStyle = PALETTE.snow;
      g.fill();
    }
  }
}

// Reed blades by season, dark and light, and the bulrushes' brown heads.
const REEDS: Record<TownSeason, [string, string, string | null]> = {
  spring: ["#4f8a34", "#7cb24c", null],
  summer: ["#3a6e2c", "#5c9a3e", "#6b4226"],
  autumn: ["#9c7e3e", "#c8a858", "#5a3820"],
  winter: ["#a08a64", "#c8b690", "#4a3020"],
};
const REED_BOX: [number, number, number, number] = [-0.45, -0.95, 0.45, 0.1];

function paintReeds(g: CanvasRenderingContext2D, variant: number, season: TownSeason, snow: boolean): void {
  const r = rng(variant * 6151 + 29);
  const [dark, light, head] = REEDS[season];
  g.lineCap = "round";
  const blades = 9 + Math.floor(r() * 4);
  const tips: Array<[number, number]> = [];
  for (let i = 0; i < blades; i++) {
    const foot = (r() - 0.5) * 0.36;
    const tall = 0.45 + r() * 0.35;
    const lean = foot * 0.8 + (r() - 0.5) * 0.25;
    g.strokeStyle = i % 3 === 0 ? dark : light;
    g.lineWidth = 0.028;
    g.beginPath();
    g.moveTo(foot, 0);
    g.quadraticCurveTo(foot + lean * 0.3, -tall * 0.6, foot + lean, -tall);
    g.stroke();
    tips.push([foot + lean, -tall]);
  }
  if (head) {
    // Bulrushes on taller stalks among the blades.
    for (let i = 0; i < 2 + Math.floor(r() * 2); i++) {
      const x = (r() - 0.5) * 0.24;
      const top = -0.7 - r() * 0.2;
      g.strokeStyle = dark;
      g.lineWidth = 0.02;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + 0.02, top - 0.08);
      g.stroke();
      g.fillStyle = head;
      g.beginPath();
      g.ellipse(x + 0.015, top + 0.06, 0.035, 0.1, 0, 0, TAU);
      g.fill();
    }
  }
  if (snow) {
    g.fillStyle = PALETTE.snow;
    for (const [x, y] of tips) {
      if (r() < 0.5) continue;
      g.beginPath();
      g.ellipse(x, y + 0.03, 0.025, 0.018, 0, 0, TAU);
      g.fill();
    }
  }
}

/** The room's trees and reeds as pieces of the scene. */
export function forestPieces(v: Wild, env: Env, out: Piece[]): void {
  if (!v.terrain) return;
  const { season, snow, sprites } = env;
  const taken = new Set<number>();
  for (const id in v.r.objects) {
    const o = v.r.objects[id];
    // Roads through the rock run through clearings.
    if (o.type !== "creep") taken.add(Math.round(o.y) * 50 + Math.round(o.x));
  }
  for (const t of forestOf(v.terrain)) {
    if (taken.has(Math.round(t.y) * 50 + Math.round(t.x)) || !onScreen(v, t.x, t.y)) continue;
    const x = v.r.ox + t.x;
    const y = v.r.oy + t.y;
    const key = `${t.pine ? "pine" : "oak"}:${t.variant}:${season}:${snow}`;
    out.push({
      depth: y,
      draw(ctx) {
        sprites.stamp(ctx, key, x, y, BOX, (g) => (t.pine ? paintPine(g, t.variant, season, snow) : paintOak(g, t.variant, season, snow)), t.size);
      },
      shadow(path, cast) {
        if (t.pine) castRound(path, x, y, 0.1, 0.05, 1.3 * t.size, cast, 0.28 * t.size);
        // Bare boughs let most of the winter sun through.
        else castRound(path, x, y, 0.1, 0.05, 1.0 * t.size, cast, (season === "winter" ? 0.2 : 0.42) * t.size);
      },
    });
  }
  for (const t of reedsOf(v.terrain)) {
    if (taken.has(Math.round(t.y) * 50 + Math.round(t.x)) || !onScreen(v, t.x, t.y)) continue;
    const x = v.r.ox + t.x;
    const y = v.r.oy + t.y;
    const key = `reeds:${t.variant}:${season}:${snow}`;
    out.push({
      depth: y,
      draw(ctx) {
        sprites.stamp(ctx, key, x, y, REED_BOX, (g) => paintReeds(g, t.variant, season, snow), t.size);
      },
      shadow(path, cast) {
        castRound(path, x, y, 0.18, 0.06, 0.6 * t.size, cast, 0.16 * t.size);
      },
    });
  }
}
