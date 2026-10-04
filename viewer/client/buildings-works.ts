// The castle's works as the realm knows them: the barracks, watchtowers,
// treasury and coffers, the trading post, alchemy labs, the workshop, the
// jeweler's mine, the seeing-stone, the power shrine and the doom engine, the
// Throne, and what the land holds: gold veins, crystals, lairs and portals.
// Each is painted about its tile's centre on the ground, as it looks by day,
// once per look and stamped; what moves (fire, bubbles, a swirling orb) is
// drawn over the stamp each frame by buildings.ts.

import { armsColours } from "../../src/services/services.heraldry";
import { block, cylinder, ellipse, mix, PALETTE, rgba, rng, roundShading, shade, SQUASH, TAU } from "./art";
import { arms, casement, door, fillPoly, flagTop, gableHouse, line, planks, roofFace, snowOnRoof, stoneFace, timberFace, type G, type Pt } from "./buildings-paint";

const SNOW = PALETTE.snow;
const IRON = PALETTE.iron;

// Small things used throughout.

/** A heap of gold coins about (x, y) on the ground, `r` wide. */
export function goldHeap(g: G, x: number, y: number, r: number, seed: number): void {
  const rr = rng(seed);
  const h = r * 0.75;
  g.beginPath();
  g.moveTo(x - r, y);
  g.quadraticCurveTo(x - r * 0.4, y - h * 1.3, x, y - h);
  g.quadraticCurveTo(x + r * 0.4, y - h * 1.3, x + r, y);
  g.ellipse(x, y, r, r * SQUASH * 0.5, 0, 0, Math.PI);
  g.closePath();
  g.fillStyle = PALETTE.goldDark;
  g.fill();
  g.beginPath();
  g.moveTo(x - r * 0.85, y - h * 0.1);
  g.quadraticCurveTo(x - r * 0.35, y - h * 1.2, x + r * 0.1, y - h * 0.95);
  g.quadraticCurveTo(x - r * 0.1, y - h * 0.3, x - r * 0.85, y - h * 0.1);
  g.fillStyle = PALETTE.gold;
  g.fill();
  // Coins catching the light.
  const n = Math.max(4, Math.round(r * 40));
  for (let i = 0; i < n; i++) {
    const a = rr();
    const cx = x + (rr() - 0.5) * r * 1.6;
    const top = y - h * (1 - Math.pow((cx - x) / r, 2)) * 0.95;
    const cy = top + rr() * (y - top);
    ellipse(g, cx, cy, 0.03, 0.018);
    g.fillStyle = a < 0.3 ? PALETTE.goldLight : a < 0.7 ? PALETTE.gold : PALETTE.goldDark;
    g.fill();
  }
}

/** A few coins lying flat about (x, y). */
export function coins(g: G, x: number, y: number, n: number, seed: number): void {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const cx = x + (r() - 0.5) * 0.5;
    const cy = y + (r() - 0.5) * 0.3;
    ellipse(g, cx, cy + 0.008, 0.04, 0.024);
    g.fillStyle = PALETTE.goldDark;
    g.fill();
    ellipse(g, cx, cy, 0.04, 0.024);
    g.fillStyle = r() < 0.4 ? PALETTE.goldLight : PALETTE.gold;
    g.fill();
  }
}

/** A boulder on the ground about (x, y): a lit top and a face in shade. */
function boulder(g: G, x: number, y: number, w: number, h: number, seed: number, colour: string): Pt[] {
  const r = rng(seed);
  const jag = () => (r() - 0.5) * w * 0.25;
  const front: Pt[] = [
    [x - w, y + jag() * 0.3],
    [x - w * 0.9 + jag(), y - h * 0.55],
    [x - w * 0.3 + jag(), y - h + jag() * 0.4],
    [x + w * 0.35 + jag(), y - h * 0.95 + jag() * 0.4],
    [x + w * 0.95, y - h * 0.5 + jag()],
    [x + w, y],
  ];
  fillPoly(g, front, shade(colour, 0.78));
  const top: Pt[] = [front[1], front[2], front[3], front[4], [x + w * 0.4, y - h * 0.5], [x - w * 0.4, y - h * 0.45]];
  fillPoly(g, top, shade(colour, 1.08));
  line(g, front[0][0], front[0][1], front[5][0], front[5][1], "rgba(0,0,0,0.3)", 0.03);
  return front;
}

/** A hexagonal crystal standing from (x, y), leaning by `lean`, `h` tall and `w` across. */
function crystal(g: G, x: number, y: number, w: number, h: number, lean: number, colour: string): void {
  const tx = x + lean * h;
  const ty = y - h;
  const tip = h * 0.22;
  const left: Pt[] = [[x - w, y], [tx - w, ty + tip], [tx, ty - tip * 0.2], [x, y + w * 0.3]];
  const right: Pt[] = [[x, y + w * 0.3], [tx, ty - tip * 0.2], [tx + w, ty + tip], [x + w, y]];
  fillPoly(g, left, shade(colour, 1.12));
  fillPoly(g, right, shade(colour, 0.7));
  fillPoly(g, [[tx - w, ty + tip], [tx, ty - tip * 1.1], [tx + w, ty + tip], [tx, ty - tip * 0.2]], mix(colour, "#ffffff", 0.45));
  line(g, x - w * 0.5, y - h * 0.1, tx - w * 0.5, ty + tip * 1.3, "rgba(255,255,255,0.45)", w * 0.18);
}

/** A cluster of crystals on a bed of rock. */
function crystalCluster(g: G, colour: string, size: number, stumps: boolean, seed: number, snow: boolean): void {
  const r = rng(seed);
  boulder(g, -0.18, 0.2, 0.3, 0.22, seed + 1, PALETTE.stoneFront);
  boulder(g, 0.2, 0.24, 0.26, 0.18, seed + 2, PALETTE.stoneDark);
  const stones: Array<[number, number, number, number, number]> = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + r() * 0.6;
    const d = i === 0 ? 0 : 0.12 + r() * 0.2;
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d * 0.5 + 0.05;
    const h = (stumps ? 0.14 + r() * 0.12 : (i === 0 ? 0.85 : 0.35 + r() * 0.4)) * size;
    stones.push([x, y, 0.06 + r() * 0.04, h, x * 0.5 + (r() - 0.5) * 0.25]);
  }
  stones.sort((a, b) => a[1] - b[1]);
  for (const [x, y, w, h, lean] of stones) crystal(g, x, y, w * size, h, lean, colour);
  if (snow) {
    g.fillStyle = SNOW;
    ellipse(g, -0.24, 0.02, 0.14, 0.04);
    g.fill();
    ellipse(g, 0.24, 0.1, 0.12, 0.035);
    g.fill();
  }
}

// The barracks.

export const BARRACKS_BOX = [-0.62, -1.95, 0.62, 0.48] as const;
export const BARRACKS_DOOR: Pt = [0, 0.36];
export const BARRACKS_CHIMNEY: Pt = [0.24, -1.82];

/** The barracks: a stone hall gable-end on, its arms over the door. */
export function paintBarracks(g: G, room: string, snow: boolean, seed: number): void {
  // The chimney behind the ridge.
  stoneFace(g, 0.15, -1.8, 0.33, -1.15, seed + 20, PALETTE.stoneFront, 0.1);
  g.fillStyle = "#14110d";
  g.fillRect(0.17, -1.83, 0.14, 0.05);
  // A step before the door.
  block(g, -0.26, 0.34, 0.26, 0.46, 0.05, PALETTE.stoneTop, PALETTE.stoneFront);
  gableHouse(
    g,
    { x0: -0.44, y0: -0.42, x1: 0.44, y1: 0.36, h: 0.74, rise: 0.48, ridge: "ns", wall: "stone", roof: "slate", overhang: 0.07, snow, seed },
    (g) => {
      door(g, BARRACKS_DOOR[0], BARRACKS_DOOR[1], 0.28, 0.5, seed + 3);
      // Lamps either side of the door.
      for (const s of [-1, 1]) {
        line(g, s * 0.25, 0.0, s * 0.25, -0.08, IRON, 0.02);
        g.fillStyle = "#3a2f22";
        g.fillRect(s * 0.25 - 0.035, -0.16, 0.07, 0.08);
      }
      arms(g, room, 0, -0.62, 0.24);
      casement(g, -0.3, -0.38, 0.08, 0.14);
      casement(g, 0.3, -0.38, 0.08, 0.14);
    },
  );
}

// The watchtower.

export const TOWER_R = 0.32;
export const TOWER_H = 1.7;
export const TOWER_BOX = [-0.5, -2.05, 0.5, 0.32] as const;

/** A round watchtower of coursed stone with a crenellated top and a brazier in it. */
export function paintWatchtower(g: G, snow: boolean, seed: number): void {
  const r = TOWER_R;
  const h = TOWER_H;
  // A battered foot.
  cylinder(g, 0, 0, r + 0.06, 0.16, PALETTE.stoneTop, PALETTE.stoneFront);
  // The shaft, coursed.
  g.save();
  g.beginPath();
  g.moveTo(-r, -h);
  g.lineTo(-r, 0);
  g.ellipse(0, 0, r, r * SQUASH, 0, Math.PI, 0, true);
  g.lineTo(r, -h);
  g.closePath();
  g.clip();
  stoneFace(g, -r, -h - 0.1, r, r * SQUASH, seed, PALETTE.stoneFront, 0.13);
  g.restore();
  roundShading(g, 0, 0, r, h, 0.4);
  // Arrow slits and a door.
  for (const [sx, sy] of [[0, -0.75], [-0.14, -1.2], [0.12, -0.45]] as Pt[]) {
    g.fillStyle = "#14110d";
    g.fillRect(sx - 0.018, sy - 0.1, 0.036, 0.2);
  }
  door(g, 0, r * SQUASH - 0.02, 0.16, 0.3, seed + 1);
  // The corbelled walk round the top.
  cylinder(g, 0, -h + 0.12, r + 0.06, 0.12, PALETTE.stoneTop, shade(PALETTE.stoneFront, 1.1));
  for (let k = -3; k <= 3; k++) {
    const a = Math.PI / 2 + (k / 8) * Math.PI;
    const cx = Math.cos(a) * (r + 0.03);
    g.fillStyle = shade(PALETTE.stoneFront, 0.8);
    g.fillRect(cx - 0.025, -h + 0.12 + Math.sin(a) * (r + 0.03) * SQUASH, 0.05, 0.06);
  }
  // Inside the top, and the merlons round it: those behind first.
  const R = r + 0.06;
  ellipse(g, 0, -h, R, R * SQUASH);
  g.fillStyle = snow ? SNOW : PALETTE.stoneTop;
  g.fill();
  ellipse(g, 0, -h, R - 0.07, (R - 0.07) * SQUASH);
  g.fillStyle = snow ? PALETTE.snowShade : shade(PALETTE.stoneTop, 0.75);
  g.fill();
  // The brazier's iron basket.
  g.fillStyle = IRON;
  g.beginPath();
  g.moveTo(-0.1, -h - 0.12);
  g.lineTo(0.1, -h - 0.12);
  g.lineTo(0.05, -h - 0.02);
  g.lineTo(-0.05, -h - 0.02);
  g.closePath();
  g.fill();
  line(g, 0, -h - 0.02, 0, -h + 0.03, IRON, 0.03);
  const merlon = (a: number) => {
    const cx = Math.cos(a) * (R - 0.035);
    const cy = -h + Math.sin(a) * (R - 0.035) * SQUASH;
    block(g, cx - 0.05, cy - 0.03, cx + 0.05, cy + 0.03, 0.14, snow ? SNOW : shade(PALETTE.stoneTop, 1.05), shade(PALETTE.stoneFront, 1.02 - Math.cos(a) * 0.15));
  };
  const n = 10;
  const angles = Array.from({ length: n }, (_, i) => (i / n) * TAU + 0.15);
  for (const a of angles.filter((a) => Math.sin(a) < 0).sort((p, q) => Math.sin(p) - Math.sin(q))) merlon(a);
  void seed;
  for (const a of angles.filter((a) => Math.sin(a) >= 0).sort((p, q) => Math.sin(p) - Math.sin(q))) merlon(a);
}

// Where the brazier's fire stands, about the tower's tile.
export const TOWER_FIRE: Pt = [0, -TOWER_H - 0.1];

// The treasury.

export const TREASURY_BOX = [-0.62, -1.6, 0.62, 0.48] as const;

/** The treasury: a stone strongroom with an iron-bound door, gold heaped before it by how full it is (0 to 4). */
export function paintTreasury(g: G, fill: number, snow: boolean, seed: number): void {
  gableHouse(
    g,
    { x0: -0.45, y0: -0.45, x1: 0.45, y1: 0.06, h: 0.78, rise: 0.34, ridge: "ew", wall: "stone", roof: "slate", overhang: 0.05, snow, seed },
    (g) => {
      // A double door banded and studded with iron, the castle's coin over it.
      g.fillStyle = PALETTE.stoneDark;
      g.fillRect(-0.17, -0.47, 0.34, 0.53);
      planks(g, -0.14, -0.44, 0.14, 0.06, seed + 4, "#4a2f18", 0.07);
      for (const by of [-0.36, -0.2, -0.04]) {
        g.fillStyle = IRON;
        g.fillRect(-0.14, by, 0.28, 0.035);
        for (let bx = -0.12; bx <= 0.12; bx += 0.06) {
          ellipse(g, bx, by + 0.017, 0.01, 0.01);
          g.fillStyle = "#8a8c90";
          g.fill();
        }
      }
      line(g, 0, -0.44, 0, 0.06, "#1d140c", 0.015);
      ellipse(g, 0, -0.58, 0.07, 0.07);
      g.fillStyle = PALETTE.gold;
      g.fill();
      g.strokeStyle = PALETTE.goldDark;
      g.lineWidth = 0.02;
      g.stroke();
      // Barred windows.
      for (const s of [-1, 1]) {
        g.fillStyle = "#14110d";
        g.fillRect(s * 0.32 - 0.04, -0.6, 0.08, 0.12);
        line(g, s * 0.32, -0.6, s * 0.32, -0.48, IRON, 0.015);
      }
    },
  );
  const r = rng(seed + 50);
  if (fill >= 1) goldHeap(g, -0.3, 0.32, 0.12 + fill * 0.02, seed + 51);
  if (fill >= 2) goldHeap(g, 0.3, 0.34, 0.12 + fill * 0.02, seed + 52);
  if (fill >= 3) {
    // Ingots stacked by the door.
    for (let i = 0; i < 3; i++) {
      const bx = 0.12 + i * 0.07;
      block(g, bx, 0.12, bx + 0.06, 0.2, 0.035, PALETTE.goldLight, PALETTE.goldDark);
    }
    block(g, 0.155, 0.12, 0.215, 0.2, 0.07, PALETTE.goldLight, PALETTE.goldDark);
  }
  if (fill >= 4) goldHeap(g, -0.06, 0.4, 0.16, seed + 53);
  if (fill === 0) coins(g, 0.2, 0.3, 2 + Math.floor(r() * 2), seed + 54);
}

// Gold coffers.

export const COFFER_BOX = [-0.42, -0.85, 0.42, 0.3] as const;

/** An extension: an iron-bound chest with its lid thrown back and gold in it by how full it is (0 to 4). */
export function paintCoffer(g: G, fill: number, snow: boolean, seed: number): void {
  const x0 = -0.27;
  const x1 = 0.27;
  const y0 = -0.14;
  const y1 = 0.15;
  const h = 0.27;
  // The lid thrown back, its inside towards us.
  const lid: Pt[] = [[x0, y0 - h], [x1, y0 - h], [x1 + 0.02, y0 - h - 0.3], [x0 - 0.02, y0 - h - 0.3]];
  fillPoly(g, lid, "#3e2814");
  fillPoly(g, [[x0 + 0.03, y0 - h - 0.02], [x1 - 0.03, y0 - h - 0.02], [x1 - 0.02, y0 - h - 0.27], [x0 + 0.02, y0 - h - 0.27]], "#5a1e1e");
  for (const bx of [-0.15, 0.15]) line(g, bx, y0 - h, bx * 1.06, y0 - h - 0.3, IRON, 0.035);
  if (snow) fillPoly(g, [[x0 - 0.02, y0 - h - 0.3], [x1 + 0.02, y0 - h - 0.3], [x1 + 0.02, y0 - h - 0.27], [x0 - 0.02, y0 - h - 0.27]], SNOW);
  // The rim, the dark inside, and the gold.
  g.fillStyle = PALETTE.woodDark;
  g.fillRect(x0, y0 - h, x1 - x0, y1 - y0);
  g.fillStyle = "#1a120a";
  g.fillRect(x0 + 0.035, y0 - h + 0.03, x1 - x0 - 0.07, y1 - y0 - 0.05);
  if (fill > 0) {
    const level = [0, 0.03, 0.08, 0.14, 0.2][fill];
    g.fillStyle = PALETTE.goldDark;
    g.fillRect(x0 + 0.035, y0 - h + 0.03, x1 - x0 - 0.07, y1 - y0 - 0.05);
    goldHeap(g, 0, y1 - h - 0.02, 0.22, seed + 9);
    if (level > 0.1) goldHeap(g, -0.06, y1 - h - 0.04 - (level - 0.1), 0.15, seed + 10);
  }
  // The body: planks bound with iron, and the lock.
  planks(g, x0, y1 - h, x1, y1, seed, PALETTE.wood, 0.27);
  for (let k = 0; k < 3; k++) {
    g.fillStyle = shade(PALETTE.wood, 0.9 + k * 0.06);
    g.fillRect(x0, y1 - h + k * 0.09, x1 - x0, 0.085);
  }
  g.fillStyle = IRON;
  for (const bx of [-0.17, 0.13]) g.fillRect(bx, y1 - h, 0.04, h);
  g.fillRect(x0, y1 - h, x1 - x0, 0.03);
  g.fillRect(x0, y1 - 0.03, x1 - x0, 0.03);
  g.fillStyle = PALETTE.goldDark;
  g.fillRect(-0.04, y1 - h + 0.04, 0.08, 0.09);
  g.fillStyle = "#14110d";
  g.fillRect(-0.008, y1 - h + 0.07, 0.016, 0.04);
}

// The trading post.

export const MARKET_BOX = [-0.62, -1.75, 0.62, 0.48] as const;

/** The terminal: a market stall under an awning in the castle's colours, its counter set with the goods it holds. */
export function paintTradingPost(g: G, field: string, other: string, goods: string[], snow: boolean, seed: number): void {
  const r = rng(seed);
  const back = -0.38;
  const front = 0.3;
  const hb = 1.18;
  const hf = 0.86;
  // Back posts, a shelf of jars between them.
  for (const s of [-1, 1]) planks(g, s * 0.42 - 0.03, back - hb, s * 0.42 + 0.03, back, seed, PALETTE.woodDark, 0.06);
  planks(g, -0.42, back - 0.62, 0.42, back - 0.58, seed + 1, PALETTE.wood, 0.84);
  for (let i = 0; i < 6; i++) {
    const jx = -0.34 + i * 0.13;
    g.fillStyle = shade(goods[i % Math.max(1, goods.length)] ?? "#8a6a4a", 0.8 + r() * 0.3);
    g.fillRect(jx, back - 0.74, 0.08, 0.12);
    g.fillStyle = "rgba(255,255,255,0.25)";
    g.fillRect(jx + 0.01, back - 0.72, 0.02, 0.08);
  }
  // Crates and a barrel behind the counter.
  block(g, -0.4, -0.3, -0.14, -0.06, 0.26, "#8a6a3e", PALETTE.wood, PALETTE.woodDark);
  cylinder(g, 0.28, -0.12, 0.11, 0.3, "#6a4a2a", PALETTE.wood);
  for (const hy of [-0.08, -0.22]) line(g, 0.17, -0.12 + hy + 0.1, 0.39, -0.12 + hy + 0.1, IRON, 0.02);
  // The counter, laid with goods.
  block(g, -0.44, 0.0, 0.44, front, 0.38, "#9a7448", PALETTE.wood);
  planks(g, -0.44, front - 0.38, 0.44, front, seed + 2, PALETTE.wood, 0.11);
  g.fillStyle = shade(PALETTE.wood, 0.7);
  g.fillRect(-0.44, front - 0.38, 0.88, 0.04);
  const wares = goods.length ? goods : [PALETTE.gold];
  for (let i = 0; i < 4; i++) {
    const sx = -0.32 + i * 0.2;
    const colour = wares[i % wares.length];
    // A sack, open at the top to show what is in it.
    g.beginPath();
    g.moveTo(sx - 0.07, 0.12 - 0.38);
    g.quadraticCurveTo(sx - 0.09, 0.0 - 0.38, sx - 0.05, -0.06 - 0.38);
    g.lineTo(sx + 0.05, -0.06 - 0.38);
    g.quadraticCurveTo(sx + 0.09, 0.0 - 0.38, sx + 0.07, 0.12 - 0.38);
    g.closePath();
    g.fillStyle = "#b59a6a";
    g.fill();
    ellipse(g, sx, -0.06 - 0.38, 0.05, 0.022);
    g.fillStyle = colour;
    g.fill();
  }
  // Scales hung from the awning's beam.
  line(g, 0.18, back - 0.98, 0.18, -0.62, "#3a2f22", 0.012);
  line(g, 0.08, -0.62, 0.28, -0.62, PALETTE.goldDark, 0.02);
  for (const s of [0.08, 0.28]) {
    line(g, s, -0.62, s, -0.52, "#3a2f22", 0.008);
    g.beginPath();
    g.ellipse(s, -0.52, 0.04, 0.015, 0, 0, Math.PI);
    g.fillStyle = PALETTE.goldDark;
    g.fill();
  }
  // Front posts.
  for (const s of [-1, 1]) planks(g, s * 0.42 - 0.03, front - hf, s * 0.42 + 0.03, front, seed + 3, PALETTE.woodDark, 0.06);
  // The awning, striped, its valance scalloped.
  const ax0 = -0.52;
  const ax1 = 0.52;
  const by = back - hb - 0.04;
  const fy = front - hf + 0.06;
  const stripes = 7;
  for (let i = 0; i < stripes; i++) {
    const u0 = ax0 + ((ax1 - ax0) * i) / stripes;
    const u1 = ax0 + ((ax1 - ax0) * (i + 1)) / stripes;
    fillPoly(g, [[u0, by], [u1, by], [u1, fy], [u0, fy]], i % 2 ? other : field);
  }
  const lit = g.createLinearGradient(0, by, 0, fy);
  lit.addColorStop(0, "rgba(255,255,255,0.12)");
  lit.addColorStop(1, "rgba(0,0,0,0.12)");
  g.fillStyle = lit;
  g.fillRect(ax0, by, ax1 - ax0, fy - by);
  if (snow) fillPoly(g, [[ax0, by], [ax1, by], [ax1, fy - 0.12], [ax0, fy - 0.08]], rgba(SNOW, 0.92));
  for (let i = 0; i < stripes; i++) {
    const u0 = ax0 + ((ax1 - ax0) * i) / stripes;
    const u1 = ax0 + ((ax1 - ax0) * (i + 1)) / stripes;
    g.beginPath();
    g.moveTo(u0, fy);
    g.lineTo(u1, fy);
    g.lineTo(u1, fy + 0.06);
    g.quadraticCurveTo((u0 + u1) / 2, fy + 0.15, u0, fy + 0.06);
    g.closePath();
    g.fillStyle = shade(i % 2 ? other : field, 0.85);
    g.fill();
  }
  // A signboard on a bracket by the stall, a gold coin painted on it.
  planks(g, 0.5, -1.3, 0.56, front - 0.02, seed + 4, PALETTE.woodDark, 0.06);
  line(g, 0.53, -1.22, 0.3, -1.22, PALETTE.woodDark, 0.03);
  for (const s of [0.34, 0.5]) line(g, s, -1.22, s, -1.12, IRON, 0.01);
  g.fillStyle = "#6a4a2a";
  g.fillRect(0.3, -1.12, 0.24, 0.2);
  g.strokeStyle = PALETTE.woodDark;
  g.lineWidth = 0.015;
  g.strokeRect(0.3, -1.12, 0.24, 0.2);
  ellipse(g, 0.42, -1.02, 0.065, 0.065);
  g.fillStyle = PALETTE.gold;
  g.fill();
  ellipse(g, 0.42, -1.02, 0.035, 0.035);
  g.fillStyle = PALETTE.goldDark;
  g.fill();
  if (snow) fillPoly(g, [[0.29, -1.13], [0.55, -1.13], [0.55, -1.16], [0.29, -1.15]], SNOW);
}

// The alchemy lab.

export const LAB_BOX = [-0.5, -1.45, 0.55, 0.32] as const;
export const LAB_FLASK: Pt = [-0.04, -0.66];
export const LAB_MOUTH: Pt = [-0.04, 0.06];

/** A lab: a brick athanor with a flask of the mineral it works bubbling on it, `level` 0 to 3 full. */
export function paintAthanor(g: G, liquid: string, level: number, snow: boolean, seed: number): void {
  const x = -0.04;
  const r = 0.26;
  const h = 0.44;
  // The receiving flask on its stand, behind.
  line(g, 0.3, -0.02, 0.3, -0.34, PALETTE.woodDark, 0.025);
  line(g, 0.22, 0.02, 0.38, 0.02, PALETTE.woodDark, 0.03);
  ellipse(g, 0.3, -0.4, 0.08, 0.08);
  g.fillStyle = "rgba(190,220,240,0.35)";
  g.fill();
  g.beginPath();
  g.ellipse(0.3, -0.4, 0.075, 0.075, 0, 0.2, Math.PI - 0.2);
  g.fillStyle = rgba(liquid, 0.85);
  g.fill();
  // The athanor, brick, its fire-mouth to the front.
  g.save();
  g.beginPath();
  g.moveTo(x - r, -h);
  g.lineTo(x - r, 0);
  g.ellipse(x, 0, r, r * SQUASH, 0, Math.PI, 0, true);
  g.lineTo(x + r, -h);
  g.closePath();
  g.clip();
  stoneFace(g, x - r, -h, x + r, r * SQUASH, seed, "#7a4a36", 0.07);
  g.restore();
  roundShading(g, x, 0, r, h, 0.45);
  ellipse(g, x, -h, r, r * SQUASH);
  g.fillStyle = snow ? SNOW : "#8f6a54";
  g.fill();
  ellipse(g, x, -h, r * 0.62, r * 0.62 * SQUASH);
  g.fillStyle = "#c7b28a";
  g.fill();
  g.fillStyle = "#14110d";
  g.beginPath();
  g.moveTo(x - 0.08, 0.1);
  g.lineTo(x - 0.08, -0.04);
  g.arc(x, -0.04, 0.08, Math.PI, 0);
  g.lineTo(x + 0.08, 0.1);
  g.fill();
  // The flask: a round belly of glass and a long neck, and the alembic's arm to the receiver.
  const [fx, fy] = LAB_FLASK;
  line(g, fx + 0.02, fy - 0.3, 0.3, -0.48, "rgba(200,225,240,0.7)", 0.025);
  g.fillStyle = "rgba(200,225,240,0.3)";
  g.fillRect(fx - 0.035, fy - 0.36, 0.07, 0.28);
  ellipse(g, fx, fy, 0.17, 0.17);
  g.fillStyle = "rgba(190,215,235,0.28)";
  g.fill();
  if (level > 0) {
    const top = fy + 0.17 - (0.34 * level) / 3.4;
    g.save();
    ellipse(g, fx, fy, 0.165, 0.165);
    g.clip();
    g.fillStyle = liquid;
    g.fillRect(fx - 0.2, top, 0.4, 0.4);
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.fillRect(fx + 0.04, top, 0.2, 0.4);
    g.restore();
  }
  g.beginPath();
  g.arc(fx, fy, 0.17, 0, TAU);
  g.strokeStyle = "rgba(225,240,250,0.75)";
  g.lineWidth = 0.018;
  g.stroke();
  g.beginPath();
  g.arc(fx - 0.06, fy - 0.06, 0.07, Math.PI * 1.05, Math.PI * 1.55);
  g.strokeStyle = "rgba(255,255,255,0.8)";
  g.lineWidth = 0.02;
  g.stroke();
}

// The workshop.

export const WORKSHOP_BOX = [-0.62, -1.95, 0.62, 0.48] as const;
export const WORKSHOP_FORGE: Pt = [-0.22, -0.08];
export const WORKSHOP_CHIMNEY: Pt = [-0.23, -1.88];

/** The factory: a smith's open-fronted shed, the forge at the back and an anvil before it. */
export function paintWorkshop(g: G, snow: boolean, seed: number): void {
  const x0 = -0.46;
  const x1 = 0.46;
  const back = -0.4;
  const front = 0.22;
  const h = 0.78;
  const rise = 0.5;
  const o = 0.07;
  // The back wall, seen under the eave through the open front, in the roof's shade.
  stoneFace(g, x0, back - h, x1, back, seed, PALETTE.stoneFront, 0.13);
  g.fillStyle = "rgba(0,0,0,0.3)";
  g.fillRect(x0, back - h, x1 - x0, h);
  for (let i = 0; i < 3; i++) {
    const tx = 0.1 + i * 0.11;
    line(g, tx, back - 0.16, tx, back - 0.02, PALETTE.woodDark, 0.02);
    g.fillStyle = IRON;
    g.fillRect(tx - 0.04, back - 0.17, 0.08, 0.04);
  }
  // The forge, its mouth towards us.
  block(g, -0.44, -0.3, 0.0, -0.02, 0.36, PALETTE.stoneTop, PALETTE.stoneFront);
  stoneFace(g, -0.44, -0.38, 0.0, -0.02, seed + 2, PALETTE.stoneFront, 0.09);
  g.fillStyle = "#1a0d06";
  g.beginPath();
  g.moveTo(-0.37, -0.1);
  g.lineTo(-0.37, -0.24);
  g.quadraticCurveTo(-0.22, -0.34, -0.07, -0.24);
  g.lineTo(-0.07, -0.1);
  g.closePath();
  g.fill();
  // The quench tub, and the anvil on its stump.
  cylinder(g, 0.3, -0.04, 0.1, 0.18, "#2d4a5a", PALETTE.wood);
  cylinder(g, 0.12, 0.14, 0.08, 0.2, "#7a5a3a", PALETTE.woodDark);
  fillPoly(g, [[0.0, -0.14], [0.22, -0.14], [0.3, -0.18], [0.22, -0.1], [0.18, -0.06], [0.06, -0.06], [0.06, -0.1], [0.0, -0.1]], IRON);
  line(g, 0.0, -0.15, 0.22, -0.15, "#6a6c70", 0.015);
  // Corner posts, and a roof of shingles on them, its gable to the front.
  for (const s of [-1, 1]) planks(g, s * 0.44 - 0.03, front - h, s * 0.44 + 0.03, front, seed + 3, PALETTE.woodDark, 0.06);
  const ey = front - h;
  const by = back - h;
  const left: Pt[] = [[x0 - o, ey + o], [x0 - o, by - o], [0, by - o - rise], [0, ey + o - rise]];
  const right: Pt[] = [[x1 + o, ey + o], [x1 + o, by - o], [0, by - o - rise], [0, ey + o - rise]];
  roofFace(g, left, "shingle", seed + 7, 1.08);
  roofFace(g, right, "shingle", seed + 9, 0.84);
  if (snow) {
    snowOnRoof(g, left, seed + 8);
    snowOnRoof(g, right, seed + 10, PALETTE.snowShade);
  }
  // The chimney up through the roof.
  const [cx, top] = WORKSHOP_CHIMNEY;
  stoneFace(g, cx - 0.09, top, cx + 0.09, top + 0.5, seed + 5, PALETTE.stoneFront, 0.1);
  g.fillStyle = "#14110d";
  g.fillRect(cx - 0.07, top - 0.02, 0.14, 0.04);
  if (snow) fillPoly(g, [[cx - 0.1, top], [cx + 0.1, top], [cx + 0.1, top + 0.04], [cx - 0.1, top + 0.03]], SNOW);
  // The gable, timbered, a horseshoe nailed up for luck.
  const gable: Pt[] = [[x0, ey], [0, ey - rise], [x1, ey]];
  g.save();
  g.beginPath();
  for (const [px, py] of gable) g.lineTo(px, py);
  g.closePath();
  g.clip();
  timberFace(g, x0, ey - rise, x1, ey, seed + 6);
  g.fillStyle = "rgba(0,0,0,0.15)";
  g.fillRect(x0, ey - rise, x1 - x0, rise);
  g.restore();
  g.beginPath();
  g.arc(0, ey - rise * 0.38, 0.06, 0.15 * Math.PI, 0.85 * Math.PI, true);
  g.strokeStyle = IRON;
  g.lineWidth = 0.025;
  g.stroke();
  g.beginPath();
  g.moveTo(x0 - o, ey + o);
  g.lineTo(0, ey + o - rise);
  g.lineTo(x1 + o, ey + o);
  g.strokeStyle = PALETTE.woodDark;
  g.lineWidth = 0.05;
  g.stroke();
}

// The jeweler's mine.

export const HEADFRAME_BOX = [-0.62, -1.8, 0.62, 0.45] as const;

/** An extractor: a timber headframe over the crystals, its rope and bucket hanging from a pulley wheel. */
export function paintHeadframe(g: G, snow: boolean, seed: number): void {
  const top = -1.45;
  const wood = PALETTE.wood;
  // The back legs, the rope and bucket, then the front legs over them.
  line(g, -0.44, -0.28, -0.1, top + 0.05, shade(wood, 0.7), 0.06);
  line(g, 0.44, -0.28, 0.1, top + 0.05, shade(wood, 0.7), 0.06);
  line(g, 0, top + 0.1, 0, -0.55, "#8a7a5a", 0.014);
  block(g, -0.07, -0.6, 0.07, -0.5, 0.1, "#4a3a2a", PALETTE.woodDark);
  line(g, -0.07, -0.65, 0, -0.75, "#8a7a5a", 0.01);
  line(g, 0.07, -0.65, 0, -0.75, "#8a7a5a", 0.01);
  line(g, -0.48, 0.28, -0.1, top + 0.1, wood, 0.07);
  line(g, 0.48, 0.28, 0.1, top + 0.1, wood, 0.07);
  line(g, -0.34, -0.2, 0.34, -0.2, wood, 0.045);
  line(g, -0.38, -0.2, 0.2, top + 0.6, shade(wood, 0.9), 0.035);
  // The crossbeam, the wheel's axle, and the wheel.
  block(g, -0.2, top - 0.04, 0.2, top + 0.04, 0.06, shade(wood, 1.15), wood);
  const wy = top - 0.2;
  g.beginPath();
  g.arc(0, wy, 0.16, 0, TAU);
  g.strokeStyle = PALETTE.woodDark;
  g.lineWidth = 0.04;
  g.stroke();
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI;
    line(g, -Math.cos(a) * 0.15, wy - Math.sin(a) * 0.15, Math.cos(a) * 0.15, wy + Math.sin(a) * 0.15, PALETTE.woodDark, 0.018);
  }
  ellipse(g, 0, wy, 0.035, 0.035);
  g.fillStyle = IRON;
  g.fill();
  line(g, 0.16, wy, 0.16, -0.02, "#8a7a5a", 0.012);
  // The windlass at the foot, with its crank.
  cylinder(g, 0.3, 0.2, 0.07, 0.04, shade(wood, 1.1), wood);
  block(g, 0.18, 0.12, 0.44, 0.28, 0.1, shade(wood, 1.1), PALETTE.woodDark);
  line(g, 0.44, 0.1, 0.52, 0.02, IRON, 0.025);
  if (snow) {
    g.fillStyle = SNOW;
    g.fillRect(-0.2, top - 0.1, 0.4, 0.03);
    g.fillRect(0.18, 0.0, 0.26, 0.03);
  }
  void seed;
}

// The seeing-stone.

export const PEDESTAL_BOX = [-0.36, -0.95, 0.36, 0.3] as const;
export const ORB: Pt = [0, -0.92];

/** The observer's pedestal: a carved column with a cup on top for the orb. */
export function paintPedestal(g: G, snow: boolean, seed: number): void {
  cylinder(g, 0, 0, 0.3, 0.1, PALETTE.stoneTop, PALETTE.stoneFront);
  cylinder(g, 0, -0.1, 0.22, 0.08, PALETTE.stoneTop, PALETTE.stoneFront);
  g.save();
  g.beginPath();
  g.rect(-0.1, -0.7, 0.2, 0.55);
  g.clip();
  stoneFace(g, -0.1, -0.7, 0.1, -0.15, seed, PALETTE.stoneFront, 0.11);
  g.restore();
  roundShading(g, 0, -0.18, 0.1, 0.52, 0.4);
  // Runes cut down the column.
  for (let i = 0; i < 3; i++) line(g, -0.02, -0.6 + i * 0.13, 0.03, -0.55 + i * 0.13, "#9fd4ff", 0.015);
  // The cup.
  g.beginPath();
  g.moveTo(-0.18, -0.76);
  g.quadraticCurveTo(-0.14, -0.66, 0, -0.66);
  g.quadraticCurveTo(0.14, -0.66, 0.18, -0.76);
  g.closePath();
  g.fillStyle = PALETTE.stoneFront;
  g.fill();
  ellipse(g, 0, -0.76, 0.18, 0.18 * SQUASH);
  g.fillStyle = snow ? SNOW : PALETTE.stoneTop;
  g.fill();
  ellipse(g, 0, -0.76, 0.12, 0.12 * SQUASH);
  g.fillStyle = PALETTE.stoneDark;
  g.fill();
}

// The power shrine.

export const SHRINE_BOX = [-0.55, -1.25, 0.55, 0.38] as const;
export const SHRINE_CRYSTAL: Pt = [0, -0.72];

/** The power spawn: a round dais with four pillars, ringed with runes, for its crystal to float in. */
export function paintShrine(g: G, snow: boolean, seed: number): void {
  cylinder(g, 0, 0, 0.46, 0.12, snow ? SNOW : PALETTE.stoneTop, PALETTE.stoneFront);
  ellipse(g, 0, -0.12, 0.34, 0.34 * SQUASH);
  g.strokeStyle = "#c2414f";
  g.lineWidth = 0.02;
  g.stroke();
  const r = rng(seed);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    ellipse(g, Math.cos(a) * 0.34, -0.12 + Math.sin(a) * 0.34 * SQUASH, 0.018 + r() * 0.01, 0.012);
    g.fillStyle = "#ff6b75";
    g.fill();
  }
  const pillar = (a: number) => {
    const px = Math.cos(a) * 0.36;
    const py = -0.12 + Math.sin(a) * 0.36 * SQUASH;
    cylinder(g, px, py, 0.055, 0.82, PALETTE.stoneTop, shade(PALETTE.stoneFront, 1.05 - Math.cos(a) * 0.1));
    roundShading(g, px, py, 0.055, 0.82);
    block(g, px - 0.075, py - 0.03, px + 0.075, py + 0.03, 0.06 + 0.82 - 0.82, PALETTE.stoneTop, PALETTE.stoneFront);
    g.save();
    g.translate(0, -0.82);
    block(g, px - 0.075, py - 0.04, px + 0.075, py + 0.04, 0.07, snow ? SNOW : PALETTE.stoneTop, PALETTE.stoneFront);
    g.restore();
  };
  for (const a of [(-3 * Math.PI) / 4, -Math.PI / 4]) pillar(a);
  for (const a of [(3 * Math.PI) / 4, Math.PI / 4]) pillar(a);
}

// The doom engine.

export const ENGINE_BOX = [-0.7, -2.15, 0.78, 0.42] as const;
export const ENGINE_RUNES: Pt[] = [
  [-0.26, -0.72],
  [0.0, 0.08],
  [-0.3, 0.08],
  [0.3, 0.08],
];

/** The nuker: a great trebuchet of black timber, its counterweight graven with violet runes. */
export function paintTrebuchet(g: G, snow: boolean, seed: number): void {
  const wood = "#2e2429";
  const dark = "#1c161a";
  // The far frame, the arm and its counterweight, then the near frame.
  line(g, -0.3, -0.18, 0.0, -1.2, dark, 0.06);
  line(g, 0.3, -0.18, 0.0, -1.2, dark, 0.06);
  // The arm, cocked: its long end up and back, the sling hanging.
  line(g, 0.0, -1.2, 0.58, -1.98, shade(wood, 1.2), 0.06);
  line(g, 0.0, -1.2, -0.24, -0.92, shade(wood, 1.2), 0.08);
  g.beginPath();
  g.moveTo(0.58, -1.98);
  g.quadraticCurveTo(0.66, -1.6, 0.52, -1.3);
  g.strokeStyle = "#5a4a3a";
  g.lineWidth = 0.015;
  g.stroke();
  ellipse(g, 0.52, -1.28, 0.06, 0.05);
  g.fillStyle = "#2a1f30";
  g.fill();
  // The counterweight, iron-bound, graven.
  block(g, -0.42, -0.72, -0.08, -0.5, 0.36, shade(wood, 1.25), wood);
  g.fillStyle = IRON;
  g.fillRect(-0.42, -0.86, 0.34, 0.03);
  g.fillRect(-0.42, -0.62, 0.34, 0.03);
  const [rx, ry] = ENGINE_RUNES[0];
  g.strokeStyle = "#8a4fd0";
  g.lineWidth = 0.02;
  g.beginPath();
  g.moveTo(rx - 0.06, ry - 0.05);
  g.lineTo(rx, ry + 0.06);
  g.lineTo(rx + 0.06, ry - 0.05);
  g.moveTo(rx - 0.04, ry + 0.0);
  g.lineTo(rx + 0.04, ry + 0.0);
  g.stroke();
  // The base: a sledge of beams on rollers, graven too.
  block(g, -0.5, -0.2, 0.5, 0.26, 0.16, shade(wood, 1.3), wood);
  for (const [bx, by] of ENGINE_RUNES.slice(1)) {
    g.beginPath();
    g.moveTo(bx - 0.04, by - 0.03);
    g.lineTo(bx + 0.04, by + 0.03);
    g.moveTo(bx + 0.04, by - 0.03);
    g.lineTo(bx - 0.04, by + 0.03);
    g.strokeStyle = "#8a4fd0";
    g.lineWidth = 0.018;
    g.stroke();
  }
  line(g, -0.34, 0.26, 0.0, -1.2, wood, 0.07);
  line(g, 0.34, 0.26, 0.0, -1.2, wood, 0.07);
  line(g, -0.2, -0.5, 0.2, -0.5, wood, 0.04);
  ellipse(g, 0, -1.2, 0.05, 0.05);
  g.fillStyle = IRON;
  g.fill();
  if (snow) {
    g.fillStyle = SNOW;
    g.fillRect(-0.5, -0.36, 1.0, 0.05);
    g.fillRect(-0.42, -1.08, 0.34, 0.04);
  }
  void seed;
}

// The Throne.

export const THRONE_BOX = [-0.98, -1.95, 0.98, 0.58] as const;

export type Owner = "mine" | "foreign" | "none";

/**
 * The controller: the Throne on a stepped dais, a banner of the castle's arms
 * either side, and eight gold studs along the dais's foot, as many lit as the
 * castle's level. An unclaimed throne stands weathered, without banners.
 */
export function paintThrone(g: G, room: string, level: number, owner: Owner, snow: boolean, seed: number): void {
  const r = rng(seed);
  const weathered = owner === "none";
  const stoneTop = weathered ? shade(PALETTE.stoneTop, 0.85) : PALETTE.stoneTop;
  const stoneFront = weathered ? shade(PALETTE.stoneFront, 0.85) : PALETTE.stoneFront;
  const banner = (s: number) => {
    const px = s * 0.7;
    const py = -0.3;
    line(g, px, py, px, py - 1.62, PALETTE.woodDark, 0.04);
    ellipse(g, px, py - 1.64, 0.035, 0.035);
    g.fillStyle = PALETTE.gold;
    g.fill();
    line(g, px - 0.17, py - 1.52, px + 0.17, py - 1.52, PALETTE.woodDark, 0.025);
    const cloth: Pt[] = [[px - 0.16, py - 1.52], [px + 0.16, py - 1.52], [px + 0.16, py - 0.86], [px, py - 0.76], [px - 0.16, py - 0.86]];
    if (owner === "mine") {
      fillPoly(g, cloth, shade(armsColours(room).field, 0.75));
      arms(g, room, px, py - 1.2, 0.24);
    } else {
      fillPoly(g, cloth, "#2a1c22");
      line(g, px - 0.1, py - 1.4, px + 0.1, py - 1.0, "#7a1f1f", 0.03);
      line(g, px + 0.1, py - 1.4, px - 0.1, py - 1.0, "#7a1f1f", 0.03);
    }
    g.beginPath();
    g.moveTo(cloth[0][0], cloth[0][1]);
    for (const p of cloth) g.lineTo(p[0], p[1]);
    g.closePath();
    g.strokeStyle = PALETTE.goldDark;
    g.lineWidth = 0.015;
    g.stroke();
  };
  if (!weathered) {
    banner(-1);
    banner(1);
  }
  // The dais in three steps.
  const steps: Array<[number, number, number, number, number]> = [
    [-0.8, -0.48, 0.8, 0.46, 0.1],
    [-0.62, -0.42, 0.62, 0.28, 0.2],
    [-0.44, -0.38, 0.44, 0.1, 0.3],
  ];
  for (const [x0, y0, x1, y1, h] of steps) {
    flagTop(g, x0, y0 - h, x1, y1 - h, seed + h * 10, snow ? mix(stoneTop, PALETTE.snow, 0.7) : stoneTop);
    stoneFace(g, x0, y1 - h, x1, y1 - h + 0.1, seed + h * 20, stoneFront, 0.1);
  }
  // The runner down the steps.
  if (!weathered) {
    const red = owner === "mine" ? "#8a1f24" : "#3a2a30";
    fillPoly(g, [[-0.13, 0.46], [0.13, 0.46], [0.13, -0.3], [-0.13, -0.3]], red);
    for (const [, , , y1, h] of steps) line(g, -0.13, y1 - h, 0.13, y1 - h, shade(red, 0.6), 0.015);
    line(g, -0.13, 0.46, -0.13, -0.3, PALETTE.goldDark, 0.015);
    line(g, 0.13, 0.46, 0.13, -0.3, PALETTE.goldDark, 0.015);
  }
  // Eight studs along the foot, the level's worth of them gold.
  for (let i = 0; i < 8; i++) {
    const sx = -0.7 + (i + (i >= 4 ? 1 : 0)) * (1.4 / 8);
    const lit = i < level && !weathered;
    ellipse(g, sx, 0.41, 0.035, 0.03);
    g.fillStyle = lit ? PALETTE.gold : "#2a2620";
    g.fill();
    if (lit) {
      ellipse(g, sx - 0.01, 0.4, 0.012, 0.01);
      g.fillStyle = PALETTE.goldLight;
      g.fill();
    }
  }
  // The throne: a high back crowned with gold, arms, and a cushion.
  g.save();
  g.translate(0, -0.3);
  const frame = weathered ? "#6f6a62" : "#3a2414";
  const trim = weathered ? "#8a857a" : PALETTE.gold;
  fillPoly(g, [[-0.22, -0.18], [-0.22, -0.82], [-0.12, -0.92], [0, -0.86], [0.12, -0.92], [0.22, -0.82], [0.22, -0.18]], frame);
  fillPoly(g, [[-0.15, -0.22], [-0.15, -0.74], [0, -0.8], [0.15, -0.74], [0.15, -0.22]], weathered ? "#5a564e" : "#7a1a20");
  for (const fx of [-0.12, 0, 0.12]) {
    ellipse(g, fx, fx === 0 ? -0.9 : -0.96, 0.03, 0.03);
    g.fillStyle = trim;
    g.fill();
  }
  line(g, -0.22, -0.82, -0.12, -0.92, trim, 0.02);
  line(g, -0.12, -0.92, 0, -0.86, trim, 0.02);
  line(g, 0, -0.86, 0.12, -0.92, trim, 0.02);
  line(g, 0.12, -0.92, 0.22, -0.82, trim, 0.02);
  // The seat and its arms.
  block(g, -0.2, -0.2, 0.2, 0.02, 0.2, weathered ? "#5a564e" : "#9a2a30", frame);
  for (const s of [-1, 1]) block(g, s * 0.22 - 0.04, -0.2, s * 0.22 + 0.04, 0.04, 0.3, trim, frame);
  if (snow) {
    g.fillStyle = SNOW;
    g.fillRect(-0.2, -0.42, 0.4, 0.05);
    ellipse(g, 0, -0.9, 0.1, 0.03);
    g.fill();
  }
  g.restore();
  // Moss and cracks on a throne no one holds.
  if (weathered) {
    for (let i = 0; i < 9; i++) {
      ellipse(g, (r() - 0.5) * 1.5, 0.3 - r() * 0.6, 0.05 + r() * 0.05, 0.025);
      g.fillStyle = r() < 0.5 ? "rgba(70,100,50,0.7)" : "rgba(90,120,60,0.6)";
      g.fill();
    }
    line(g, -0.4, 0.2, -0.3, 0.05, "#2a2620", 0.012);
    line(g, -0.3, 0.05, -0.34, -0.05, "#2a2620", 0.012);
  }
}

// The land's own.

export const VEIN_BOX = [-0.65, -1.0, 0.65, 0.45] as const;

/** A source: an outcrop of rock seamed with gold, as rich as it is full (0 to 4). */
export function paintVein(g: G, rich: number, snow: boolean, seed: number): void {
  const r = rng(seed);
  const rocks: Array<[number, number, number, number, number]> = [
    [-0.22, 0.05, 0.3, 0.6, 1],
    [0.25, 0.12, 0.28, 0.45, 0.9],
    [-0.02, 0.32, 0.36, 0.32, 1.05],
  ];
  const faces: Pt[][] = [];
  rocks.forEach(([x, y, w, h, k], i) => {
    const face = boulder(g, x, y, w, h, seed + 1 + i, shade(PALETTE.stoneFront, k));
    faces.push(face);
    // Seams of gold running through the rock's face, each sunk in a dark
    // crack, glittering with nuggets where the seam is rich.
    g.save();
    g.beginPath();
    g.moveTo(face[0][0], face[0][1]);
    for (const [px, py] of face) g.lineTo(px, py);
    g.closePath();
    g.clip();
    const seams = rich === 0 ? 1 : 1 + Math.min(2, rich - 1);
    for (let n = 0; n < seams; n++) {
      const pts: Pt[] = [];
      let px = x - w - 0.02;
      let py = y - h * (0.2 + 0.55 * ((n + 0.5 + (r() - 0.5) * 0.4) / seams));
      while (px < x + w + 0.04) {
        pts.push([px, py]);
        px += 0.04 + r() * 0.05;
        py += (r() - 0.5) * 0.07;
      }
      const stroke = (colour: string, width: number, dy: number) => {
        g.beginPath();
        pts.forEach(([sx, sy], j) => (j ? g.lineTo(sx, sy + dy) : g.moveTo(sx, sy + dy)));
        g.strokeStyle = colour;
        g.lineWidth = width;
        g.stroke();
      };
      const width = rich === 0 ? 0.014 : 0.016 + rich * 0.005;
      stroke("rgba(30,20,6,0.55)", width + 0.018, 0.008);
      stroke(rich === 0 ? shade(PALETTE.goldDark, 0.7) : PALETTE.gold, width, 0);
      if (rich >= 2) stroke(rgba(PALETTE.goldLight, 0.8), width * 0.35, -width * 0.25);
      for (let j = 0; j < rich; j++) {
        const [nx, ny] = pts[Math.floor(r() * pts.length)];
        ellipse(g, nx, ny, 0.026, 0.02);
        g.fillStyle = PALETTE.goldDark;
        g.fill();
        ellipse(g, nx - 0.006, ny - 0.006, 0.016, 0.012);
        g.fillStyle = PALETTE.goldLight;
        g.fill();
      }
    }
    g.restore();
  });
  // What the miners have broken out, heaped at the foot.
  if (rich > 1) coins(g, 0.3, 0.38, rich, seed + 9);
  if (snow) {
    g.fillStyle = SNOW;
    for (const face of faces) {
      ellipse(g, (face[2][0] + face[3][0]) / 2, (face[2][1] + face[3][1]) / 2 + 0.03, 0.14, 0.05);
      g.fill();
    }
  }
}

export const CRYSTAL_BOX = [-0.62, -1.15, 0.62, 0.45] as const;

/** A mineral: crystals of its colour on a bed of rock, worn to stumps while it is spent. */
export function paintCrystals(g: G, colour: string, spent: boolean, snow: boolean, seed: number): void {
  crystalCluster(g, spent ? mix(colour, "#6a6a6a", 0.55) : colour, 1, spent, seed, snow);
}

export const CRATES_BOX = [-0.5, -0.95, 0.5, 0.05] as const;

/** A container: crates and a barrel at the back of its tile, an open crate showing what it holds. */
export function paintCrates(g: G, goods: string | undefined, snow: boolean, seed: number): void {
  const y = -0.22;
  cylinder(g, -0.26, y - 0.1, 0.12, 0.34, "#7a5a36", PALETTE.wood);
  roundShading(g, -0.26, y - 0.1, 0.12, 0.34);
  for (const hy of [0.06, 0.26]) {
    g.beginPath();
    g.ellipse(-0.26, y - 0.1 - hy, 0.12, 0.12 * SQUASH, 0, 0, Math.PI);
    g.strokeStyle = IRON;
    g.lineWidth = 0.02;
    g.stroke();
  }
  block(g, 0.02, y - 0.2, 0.36, y + 0.06, 0.34, "#8a6a3e", PALETTE.wood, PALETTE.woodDark);
  line(g, 0.02, y + 0.06, 0.36, y + 0.06 - 0.34, PALETTE.woodDark, 0.02);
  block(g, 0.08, y - 0.14, 0.3, y + 0.02, 0.18, "#94744a", PALETTE.wood, PALETTE.woodDark);
  g.save();
  g.translate(0, -0.34);
  block(g, 0.08, y - 0.14, 0.3, y + 0.02, 0.16, "#94744a", PALETTE.wood, PALETTE.woodDark);
  g.restore();
  // The open crate at the front.
  block(g, -0.16, y + 0.0, 0.1, y + 0.18, 0.2, "#4a3420", PALETTE.wood, PALETTE.woodDark);
  if (goods) {
    if (goods === PALETTE.gold) goldHeap(g, -0.03, y + 0.12 - 0.2, 0.1, seed + 1);
    else {
      const r = rng(seed + 2);
      for (let i = 0; i < 7; i++) {
        ellipse(g, -0.12 + r() * 0.18, y + 0.04 + r() * 0.1 - 0.22, 0.03, 0.022);
        g.fillStyle = shade(goods, 0.75 + r() * 0.4);
        g.fill();
      }
    }
  }
  if (snow) {
    g.fillStyle = SNOW;
    g.fillRect(0.08, y - 0.14 - 0.5, 0.22, 0.04);
    ellipse(g, -0.26, y - 0.44, 0.1, 0.05);
    g.fill();
  }
}

export const OBELISK_BOX = [-0.3, -1.3, 0.3, 0.22] as const;
export const OBELISK_TOP: Pt = [0, -1.12];

/** A link: a tapering obelisk graven with runes of gold, as bright as it is full (0 to 4). */
export function paintObelisk(g: G, fill: number, snow: boolean, seed: number): void {
  block(g, -0.2, -0.12, 0.2, 0.12, 0.12, snow ? SNOW : PALETTE.stoneTop, PALETTE.stoneFront);
  const b = 0.12 - 0.12;
  const front: Pt[] = [[-0.11, b], [0.11, b], [0.06, -0.98], [-0.06, -0.98]];
  fillPoly(g, front, shade(PALETTE.stoneFront, 0.85));
  fillPoly(g, [[0.11, b], [0.14, b - 0.06], [0.08, -1.0], [0.06, -0.98]], shade(PALETTE.stoneFront, 0.6));
  fillPoly(g, [[-0.06, -0.98], [0.06, -0.98], [0.08, -1.0], [0.01, -1.14]], shade(PALETTE.stoneTop, 1.1));
  fillPoly(g, [[0.06, -0.98], [0.08, -1.0], [0.01, -1.14]], shade(PALETTE.stoneFront, 0.7));
  const glow = 0.2 + 0.2 * fill;
  const rune = rgba(PALETTE.gold, Math.min(1, glow));
  const r = rng(seed);
  g.strokeStyle = rune;
  g.lineWidth = 0.016;
  for (let i = 0; i < 4; i++) {
    const cy = -0.22 - i * 0.2;
    const w = 0.05 - i * 0.006;
    g.beginPath();
    g.moveTo(-w, cy - 0.05);
    g.lineTo(r() * w, cy);
    g.lineTo(-w, cy + 0.05);
    g.moveTo(w * 0.8, cy - 0.06);
    g.lineTo(w * 0.8, cy + 0.06);
    g.stroke();
  }
  if (snow) {
    fillPoly(g, [[-0.06, -0.98], [0.06, -0.98], [0.04, -1.04], [-0.02, -1.06]], SNOW);
  }
}

export const HEADSTONE_BOX = [-0.25, -0.6, 0.25, 0.12] as const;

/** A tombstone: a headstone with a cross cut in it. */
export function paintHeadstone(g: G, snow: boolean, seed: number): void {
  const r = rng(seed);
  const tilt = (r() - 0.5) * 0.08;
  g.save();
  g.transform(1, 0, tilt, 1, 0, 0);
  const slab = (dx: number, colour: string) => {
    g.beginPath();
    g.moveTo(-0.14 + dx, 0.0);
    g.lineTo(-0.14 + dx, -0.32);
    g.arc(dx, -0.32, 0.14, Math.PI, 0);
    g.lineTo(0.14 + dx, 0.0);
    g.closePath();
    g.fillStyle = colour;
    g.fill();
  };
  slab(0.035, shade(PALETTE.stoneTop, 0.85));
  slab(0, shade(PALETTE.stoneFront, 1.2));
  line(g, 0, -0.38, 0, -0.14, PALETTE.stoneDark, 0.025);
  line(g, -0.07, -0.3, 0.07, -0.3, PALETTE.stoneDark, 0.025);
  for (let i = 0; i < 3; i++) {
    ellipse(g, (r() - 0.5) * 0.2, -0.1 - r() * 0.3, 0.03, 0.02);
    g.fillStyle = "rgba(80,110,60,0.6)";
    g.fill();
  }
  if (snow) {
    g.beginPath();
    g.arc(0.01, -0.32, 0.15, Math.PI * 1.1, -0.1);
    g.strokeStyle = SNOW;
    g.lineWidth = 0.04;
    g.stroke();
  }
  g.restore();
}

export const RUBBLE_BOX = [-0.55, -0.85, 0.55, 0.45] as const;

/** A ruin: a stub of broken wall and its fallen stones. */
export function paintRubble(g: G, snow: boolean, seed: number): void {
  const r = rng(seed);
  const stub: Pt[] = [[-0.36, 0.0], [-0.36, -0.55], [-0.24, -0.66], [-0.12, -0.5], [0.0, -0.58], [0.08, -0.36], [0.2, -0.3], [0.24, 0.0]];
  g.save();
  g.beginPath();
  g.moveTo(stub[0][0], stub[0][1]);
  for (const p of stub) g.lineTo(p[0], p[1]);
  g.closePath();
  g.clip();
  stoneFace(g, -0.36, -0.7, 0.24, 0.0, seed, shade(PALETTE.stoneFront, 0.85), 0.12);
  g.fillStyle = "rgba(10,8,6,0.25)";
  g.fillRect(-0.36, -0.7, 0.6, 0.7);
  g.restore();
  for (let i = 0; i < 7; i++) {
    const x = -0.4 + r() * 0.8;
    const y = 0.05 + r() * 0.3;
    const w = 0.06 + r() * 0.06;
    block(g, x - w, y - w * 0.6, x + w, y, w, shade(PALETTE.stoneTop, 0.8 + r() * 0.2), shade(PALETTE.stoneFront, 0.8));
  }
  if (snow) {
    g.fillStyle = SNOW;
    ellipse(g, -0.24, -0.6, 0.1, 0.04);
    g.fill();
  }
}

export const SCAFFOLD_BOX = [-0.55, -1.35, 0.55, 0.45] as const;

/**
 * A construction site: stone rising as far as the work has come (0 to 5)
 * inside a scaffold of poles and planks, a red flag on it if it is not ours.
 */
export function paintScaffold(g: G, done: number, foreign: boolean, snow: boolean, seed: number): void {
  const pole = (x: number, y: number, colour: string) => line(g, x, y, x, y - 1.08, colour, 0.035);
  const back = -0.34;
  const front = 0.34;
  pole(-0.42, back, shade(PALETTE.wood, 0.75));
  pole(0.42, back, shade(PALETTE.wood, 0.75));
  line(g, -0.42, back - 0.5, 0.42, back - 0.5, shade(PALETTE.wood, 0.75), 0.025);
  line(g, -0.42, back - 0.95, 0.42, back - 0.95, shade(PALETTE.wood, 0.75), 0.025);
  // The work so far.
  const h = 0.08 + (done / 5) * 0.72;
  flagTop(g, -0.34, -0.28 - h, 0.34, 0.28 - h, seed, shade(PALETTE.stoneTop, 0.95));
  stoneFace(g, -0.34, 0.28 - h, 0.34, 0.28, seed + 1, PALETTE.stoneFront, 0.12);
  // Stones waiting on the boards above, and a bucket of mortar.
  planks(g, -0.42, back - 0.98, 0.42, back - 0.9, seed + 2, PALETTE.wood, 0.14);
  block(g, 0.1, back - 1.02, 0.24, back - 0.94, 0.06, PALETTE.stoneTop, PALETTE.stoneFront);
  // The near poles, ledgers and a brace.
  pole(-0.42, front, PALETTE.wood);
  pole(0.42, front, PALETTE.wood);
  line(g, -0.42, front - 0.5, 0.42, front - 0.5, PALETTE.wood, 0.03);
  line(g, -0.42, front - 0.98, 0.42, front - 0.98, PALETTE.wood, 0.03);
  line(g, -0.42, front - 0.02, 0.42, front - 0.5, shade(PALETTE.wood, 0.9), 0.022);
  for (const s of [-1, 1]) line(g, s * 0.42, front - 0.98, s * 0.42, back - 0.98, PALETTE.wood, 0.025);
  if (foreign) {
    line(g, 0.42, back - 1.08, 0.42, back - 1.32, PALETTE.woodDark, 0.025);
    fillPoly(g, [[0.42, back - 1.32], [0.62, back - 1.26], [0.42, back - 1.18]], "#b3202a");
  }
  if (snow) {
    g.fillStyle = SNOW;
    g.fillRect(-0.42, back - 1.0, 0.84, 0.03);
  }
}

export const LAIR_BOX = [-0.78, -1.3, 0.78, 0.5] as const;
export const LAIR_EYES: Pt = [0, -0.28];

/** A keeper's lair: a cave mouth in a heap of rock, its floor strewn with bones. */
export function paintLair(g: G, snow: boolean, seed: number): void {
  const r = rng(seed);
  boulder(g, -0.32, -0.05, 0.45, 0.95, seed + 1, PALETTE.stoneDark);
  boulder(g, 0.34, 0.0, 0.42, 0.85, seed + 2, shade(PALETTE.stoneDark, 0.9));
  boulder(g, 0, -0.15, 0.4, 1.1, seed + 3, shade(PALETTE.stoneDark, 1.1));
  g.beginPath();
  g.moveTo(-0.28, 0.2);
  g.quadraticCurveTo(-0.3, -0.62, 0, -0.66);
  g.quadraticCurveTo(0.3, -0.62, 0.28, 0.2);
  g.closePath();
  const dark = g.createLinearGradient(0, -0.66, 0, 0.2);
  dark.addColorStop(0, "#050404");
  dark.addColorStop(1, "#1b1512");
  g.fillStyle = dark;
  g.fill();
  boulder(g, -0.4, 0.38, 0.22, 0.2, seed + 4, PALETTE.stoneFront);
  boulder(g, 0.42, 0.4, 0.2, 0.18, seed + 5, PALETTE.stoneFront);
  for (let i = 0; i < 5; i++) {
    const x = -0.2 + r() * 0.4;
    const y = 0.22 + r() * 0.15;
    const a = r() * Math.PI;
    line(g, x - Math.cos(a) * 0.07, y - Math.sin(a) * 0.03, x + Math.cos(a) * 0.07, y + Math.sin(a) * 0.03, "#d8cfb8", 0.02);
  }
  if (snow) {
    g.fillStyle = SNOW;
    ellipse(g, 0, -0.95, 0.3, 0.08);
    g.fill();
  }
}

export const SPIRE_BOX = [-0.62, -2.1, 0.62, 0.45] as const;

/** An invader core: a spire of obsidian on a ring of black stones. */
export function paintSpire(g: G, seed: number): void {
  const r = rng(seed);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    block(g, Math.cos(a) * 0.4 - 0.06, Math.sin(a) * 0.25 - 0.04, Math.cos(a) * 0.4 + 0.06, Math.sin(a) * 0.25 + 0.04, 0.1 + r() * 0.1, "#3a2f48", "#1c1626");
  }
  crystal(g, -0.14, 0.1, 0.08, 0.9, -0.15, "#2a1f3a");
  crystal(g, 0.14, 0.12, 0.08, 0.8, 0.18, "#2a1f3a");
  crystal(g, 0, 0.18, 0.13, 1.85, 0, "#231a33");
  line(g, -0.06, -0.2, 0, -1.6, "rgba(190,110,255,0.6)", 0.015);
}

export const BANK_BOX = [-0.68, -1.5, 0.68, 0.45] as const;

/** A power bank: great red crystals breaking out of the rock. */
export function paintBank(g: G, seed: number): void {
  crystalCluster(g, "#d01a2c", 1.4, false, seed, false);
}

export const PORTAL_BOX = [-0.66, -1.75, 0.66, 0.42] as const;
export const PORTAL_EYE: Pt = [0, -0.78];

/** A portal: an arch of standing stones for the vortex to turn in. */
export function paintPortalArch(g: G, snow: boolean, seed: number): void {
  for (const s of [-1, 1]) {
    block(g, s * 0.48 - 0.11, -0.1, s * 0.48 + 0.11, 0.12, 1.45, PALETTE.stoneTop, PALETTE.stoneFront);
    stoneFace(g, s * 0.48 - 0.11, 0.12 - 1.45, s * 0.48 + 0.11, 0.12, seed + s, PALETTE.stoneFront, 0.16);
  }
  block(g, -0.64, -0.12, 0.64, 0.14, 0.24, snow ? SNOW : PALETTE.stoneTop, PALETTE.stoneFront);
  g.save();
  g.translate(0, -1.45);
  block(g, -0.64, -0.12, 0.64, 0.14, 0.2, snow ? SNOW : PALETTE.stoneTop, PALETTE.stoneFront);
  g.restore();
  for (let i = 0; i < 5; i++) line(g, -0.4 + i * 0.2, -1.42, -0.36 + i * 0.2, -1.36, "#c79bff", 0.018);
}

export const DEPOSIT_BOX = [-0.62, -1.15, 0.62, 0.45] as const;

// What each deposit is in the realm, and its colour.
const DEPOSIT_COLOURS: Record<string, string> = { silicon: "#4dabd7", metal: "#a0603c", biomass: "#6bbf4a", mist: "#d8c3f0" };

/** A deposit by its kind: glass sand crystals, an ore seam, a grove of mushrooms, or a mist-stone. */
export function paintDeposit(g: G, kind: string, snow: boolean, seed: number): void {
  const colour = DEPOSIT_COLOURS[kind] ?? "#9a9a9a";
  if (kind === "metal") {
    const rocks = [boulder(g, -0.2, 0.05, 0.32, 0.5, seed, "#5a4a42"), boulder(g, 0.22, 0.25, 0.3, 0.38, seed + 1, "#4a3e38")];
    const r = rng(seed + 2);
    for (const face of rocks) {
      for (let i = 0; i < 6; i++) {
        ellipse(g, face[0][0] + 0.1 + r() * 0.4, face[0][1] - 0.05 - r() * 0.25, 0.04, 0.03);
        g.fillStyle = r() < 0.5 ? colour : "#c08060";
        g.fill();
      }
    }
    return;
  }
  if (kind === "biomass") {
    const r = rng(seed);
    boulder(g, 0, 0.2, 0.42, 0.18, seed, "#4a3a2a");
    for (let i = 0; i < 7; i++) {
      const x = -0.3 + r() * 0.6;
      const y = 0.1 + r() * 0.2;
      const h = 0.2 + r() * 0.3;
      line(g, x, y, x, y - h, "#e8dcc0", 0.04);
      g.beginPath();
      g.ellipse(x, y - h, 0.1, 0.07, 0, Math.PI, 0);
      g.fillStyle = shade(colour, 0.8 + r() * 0.4);
      g.fill();
    }
    return;
  }
  crystalCluster(g, colour, 1.1, false, seed, snow);
}
