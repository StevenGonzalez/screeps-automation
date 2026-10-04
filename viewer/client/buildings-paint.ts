// The materials the castle is built of, and the curtain wall, its gates and
// battlements, the town's watch posts, cottages and fountain, and the
// pilgrims' tents, each painted once about its anchor on the ground and
// stamped from then on (see Sprites in art.ts). Faces are drawn as they look
// by day, tops lightest and fronts in shade, as everything else in the room.

import { armsPieces, shieldOutline } from "../../src/services/services.heraldry";
import { block, ellipse, mix, PALETTE, rng, shade, SQUASH, TAU } from "./art";
import { E, N, S, W } from "./buildings-plan";

export type G = CanvasRenderingContext2D;
export type Pt = [number, number];

// Plaster and timber for the town's houses.
const PLASTER = "#d8c9a6";
const TIMBER = "#4a3220";
const SNOW = PALETTE.snow;

// Shapes.

export function fillPoly(g: G, pts: readonly Pt[], fill: string): void {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
}

export function line(g: G, x0: number, y0: number, x1: number, y1: number, colour: string, width: number): void {
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.strokeStyle = colour;
  g.lineWidth = width;
  g.stroke();
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const at = (p: Pt, q: Pt, t: number): Pt => [lerp(p[0], q[0], t), lerp(p[1], q[1], t)];

// Materials.

/** A face of coursed stone over [x0, x1] × [y0, y1] on screen, laid from the foot up. */
export function stoneFace(g: G, x0: number, y0: number, x1: number, y1: number, seed: number, base = PALETTE.stoneFront, course = 0.15): void {
  const r = rng(seed);
  g.fillStyle = shade(base, 0.55);
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  const gap = 0.012;
  let row = 0;
  for (let y = y1; y > y0 + 0.01; y -= course, row++) {
    const top = Math.max(y0, y - course);
    let x = x0 - (row % 2 ? 0.05 + r() * 0.1 : r() * 0.04);
    while (x < x1) {
      const w = 0.16 + r() * 0.2;
      const sx0 = Math.max(x0, x) + gap;
      const sx1 = Math.min(x1, x + w) - gap;
      if (sx1 > sx0) {
        g.fillStyle = shade(base, 0.84 + r() * 0.3);
        g.fillRect(sx0, top + gap, sx1 - sx0, y - top - gap * 2);
        g.fillStyle = "rgba(255,255,255,0.08)";
        g.fillRect(sx0, top + gap, sx1 - sx0, Math.min(0.02, y - top));
      }
      x += w;
    }
  }
  const dirt = g.createLinearGradient(0, y0, 0, y1);
  dirt.addColorStop(0, "rgba(0,0,0,0)");
  dirt.addColorStop(0.6, "rgba(20,16,10,0.05)");
  dirt.addColorStop(1, "rgba(20,16,10,0.35)");
  g.fillStyle = dirt;
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
}

/** Flagstones over a top face, [x0, x1] × [y0, y1] on screen. */
export function flagTop(g: G, x0: number, y0: number, x1: number, y1: number, seed: number, base = PALETTE.stoneTop): void {
  const r = rng(seed);
  g.fillStyle = shade(base, 0.7);
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  const gap = 0.012;
  for (let y = y0; y < y1 - 0.01; ) {
    const h = Math.min(y1 - y, 0.18 + r() * 0.12);
    for (let x = x0 - r() * 0.15; x < x1; ) {
      const w = 0.2 + r() * 0.22;
      const sx0 = Math.max(x0, x) + gap;
      const sx1 = Math.min(x1, x + w) - gap;
      if (sx1 > sx0) {
        g.fillStyle = shade(base, 0.9 + r() * 0.2);
        g.fillRect(sx0, y + gap, sx1 - sx0, h - gap * 2);
      }
      x += w;
    }
    y += h;
  }
}

/** Timber framing over plaster on a stone footing, [x0, x1] × [y0, y1] on screen. */
export function timberFace(g: G, x0: number, y0: number, x1: number, y1: number, seed: number): void {
  const r = rng(seed);
  g.fillStyle = PLASTER;
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  // Weathering in the plaster.
  for (let i = 0; i < (x1 - x0) * 6; i++) {
    g.fillStyle = `rgba(120,96,60,${0.05 + r() * 0.07})`;
    ellipse(g, lerp(x0, x1, r()), lerp(y0, y1, r()), 0.05 + r() * 0.1, 0.03 + r() * 0.05);
    g.fill();
  }
  const foot = Math.min(0.16, (y1 - y0) * 0.25);
  stoneFace(g, x0, y1 - foot, x1, y1, seed + 1, PALETTE.stoneFront, 0.08);
  const beam = 0.05;
  g.fillStyle = TIMBER;
  g.fillRect(x0, y0, x1 - x0, beam);
  g.fillRect(x0, y1 - foot - beam, x1 - x0, beam);
  const bays = Math.max(1, Math.round((x1 - x0) / 0.6));
  const bw = (x1 - x0) / bays;
  for (let i = 0; i <= bays; i++) g.fillRect(Math.min(x1 - beam, x0 + i * bw - (i ? beam / 2 : 0)), y0, beam, y1 - foot - y0);
  // A brace across every other bay.
  for (let i = 0; i < bays; i += 2) {
    const bx = x0 + i * bw;
    line(g, bx + beam, y1 - foot - beam, bx + bw - beam, y0 + beam, TIMBER, beam * 0.8);
  }
}

/** Upright planks over [x0, x1] × [y0, y1] on screen. */
export function planks(g: G, x0: number, y0: number, x1: number, y1: number, seed: number, base = PALETTE.wood, width = 0.09): void {
  const r = rng(seed);
  for (let x = x0; x < x1 - 0.001; x += width) {
    g.fillStyle = shade(base, 0.82 + r() * 0.3);
    g.fillRect(x, y0, Math.min(width, x1 - x), y1 - y0);
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.fillRect(x, y0, 0.008, y1 - y0);
  }
}

export type Roof = "slate" | "thatch" | "shingle";

const ROOF_BASE: Record<Roof, string> = { slate: PALETTE.slate, thatch: PALETTE.thatch, shingle: "#7a5232" };

/**
 * A slope of roof between its eave (q[0] to q[1]) and its ridge (q[3] to
 * q[2]), laid in courses along the eave: slates or shingles, or thatch.
 */
export function roofFace(g: G, q: readonly Pt[], roof: Roof, seed: number, light = 1): void {
  const r = rng(seed);
  const base = shade(ROOF_BASE[roof], light);
  const p = (u: number, t: number): Pt => at(at(q[0], q[1], u), at(q[3], q[2], u), t);
  g.save();
  g.beginPath();
  g.moveTo(q[0][0], q[0][1]);
  for (let i = 1; i < 4; i++) g.lineTo(q[i][0], q[i][1]);
  g.closePath();
  g.fillStyle = base;
  g.fill();
  g.clip();
  const slope = Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]);
  const span = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]);
  const courses = Math.max(3, Math.round(slope / (roof === "thatch" ? 0.12 : 0.14)));
  const across = Math.max(2, Math.round(span / (roof === "thatch" ? 0.035 : 0.17)));
  for (let c = 0; c < courses; c++) {
    const t0 = c / courses;
    const t1 = (c + 1.15) / courses;
    if (roof === "thatch") {
      // Straw laid downslope, each bundle a stroke from its course to the one below.
      g.lineWidth = 0.022;
      for (let i = 0; i < across; i++) {
        const u = (i + r()) / across;
        const a = p(u, t1);
        const b = p(u + (r() - 0.5) * 0.01, t0 - 0.02);
        g.strokeStyle = shade(base, 0.72 + r() * 0.5);
        g.beginPath();
        g.moveTo(a[0], a[1]);
        g.lineTo(b[0], b[1]);
        g.stroke();
      }
      const e0 = p(0, t0);
      const e1 = p(1, t0);
      line(g, e0[0], e0[1], e1[0], e1[1], "rgba(40,28,10,0.35)", 0.025);
    } else {
      const shift = c % 2 ? 0.5 : 0;
      for (let i = -1; i < across; i++) {
        const u0 = (i + shift) / across;
        const u1 = (i + shift + 1) / across;
        const tile = [p(u0, t0), p(u1, t0), p(u1, t1), p(u0, t1)];
        fillPoly(g, tile, shade(base, 0.8 + r() * 0.35));
        // The edge of the course above casts a line of shade over this one.
        line(g, tile[0][0], tile[0][1], tile[1][0], tile[1][1], "rgba(10,10,14,0.45)", 0.018);
        line(g, tile[0][0], tile[0][1], tile[3][0], tile[3][1], "rgba(10,10,14,0.3)", 0.01);
      }
    }
  }
  g.restore();
  // The eave's edge.
  line(g, q[0][0], q[0][1], q[1][0], q[1][1], shade(base, roof === "thatch" ? 0.55 : 0.4), roof === "thatch" ? 0.06 : 0.03);
}

/** Snow lying on a slope of roof, down to a ragged edge short of its eave. */
export function snowOnRoof(g: G, q: readonly Pt[], seed: number, colour = SNOW): void {
  const r = rng(seed);
  const p = (u: number, t: number): Pt => at(at(q[0], q[1], u), at(q[3], q[2], u), t);
  const pts: Pt[] = [p(0, 1), p(1, 1)];
  const steps = 10;
  for (let i = steps; i >= 0; i--) pts.push(p(i / steps, 0.12 + r() * 0.16));
  fillPoly(g, pts, colour);
  const edge = pts.slice(2);
  g.beginPath();
  g.moveTo(edge[0][0], edge[0][1]);
  for (const e of edge) g.lineTo(e[0], e[1]);
  g.strokeStyle = PALETTE.snowShade;
  g.lineWidth = 0.025;
  g.stroke();
}

export interface House {
  // The walls' footprint about the anchor.
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  // Up to the eaves, and from there up to the ridge.
  h: number;
  rise: number;
  // Which way the ridge runs: across the picture, or into it with a gable to the front.
  ridge: "ew" | "ns";
  wall: "stone" | "timber" | "wood";
  roof: Roof;
  overhang: number;
  snow: boolean;
  seed: number;
}

function wallFace(g: G, s: House, x0: number, y0: number, x1: number, y1: number): void {
  if (s.wall === "stone") stoneFace(g, x0, y0, x1, y1, s.seed);
  else if (s.wall === "timber") timberFace(g, x0, y0, x1, y1, s.seed);
  else planks(g, x0, y0, x1, y1, s.seed);
}

/**
 * A house with a pitched roof: hipped when its ridge runs across the picture,
 * gabled to the front when it runs into it. `front` draws on its front wall
 * (doors, windows) before the roof's eave comes down over the wall's top.
 */
export function gableHouse(g: G, s: House, front?: (g: G) => void): void {
  const { x0, y0, x1, y1, h, rise, overhang: o } = s;
  if (s.ridge === "ew") {
    wallFace(g, s, x0, y1 - h, x1, y1);
    front?.(g);
    // Hipped: the ends fall away as steeply as the front, so the ridge is
    // short of the eaves by the roof's depth to it.
    const ym = (y0 + y1) / 2;
    const hip = Math.min((x1 - x0) / 2 - 0.05, ym - y0 + o);
    const ridgeL: Pt = [x0 - o + hip, ym - h - rise];
    const ridgeR: Pt = [x1 + o - hip, ym - h - rise];
    const backL: Pt = [x0 - o, y0 - o - h];
    const backR: Pt = [x1 + o, y0 - o - h];
    const frontL: Pt = [x0 - o, y1 + o * 0.6 - h];
    const frontR: Pt = [x1 + o, y1 + o * 0.6 - h];
    const back: Pt[] = [backL, backR, ridgeR, ridgeL];
    const west: Pt[] = [frontL, backL, ridgeL, ridgeL];
    const east: Pt[] = [backR, frontR, ridgeR, ridgeR];
    const face: Pt[] = [frontL, frontR, ridgeR, ridgeL];
    if (rise < ym - y0) roofFace(g, back, s.roof, s.seed + 7, 0.85);
    roofFace(g, west, s.roof, s.seed + 11, 1.12);
    roofFace(g, east, s.roof, s.seed + 12, 0.76);
    roofFace(g, face, s.roof, s.seed + 9, 0.96);
    if (s.snow) {
      if (rise < ym - y0) snowOnRoof(g, back, s.seed + 8, PALETTE.snowShade);
      snowOnRoof(g, west, s.seed + 13);
      snowOnRoof(g, east, s.seed + 14, PALETTE.snowShade);
      snowOnRoof(g, face, s.seed + 10);
    }
    const hips = shade(ROOF_BASE[s.roof], 0.5);
    for (const [a, b] of [[frontL, ridgeL], [frontR, ridgeR]] as const) line(g, a[0], a[1], b[0], b[1], hips, 0.03);
    line(g, ridgeL[0], ridgeL[1], ridgeR[0], ridgeR[1], hips, 0.05);
    return;
  }
  const xm = (x0 + x1) / 2;
  const gable: Pt[] = [[x0, y1], [x0, y1 - h], [xm, y1 - h - rise], [x1, y1 - h], [x1, y1]];
  g.save();
  g.beginPath();
  g.moveTo(gable[0][0], gable[0][1]);
  for (const p of gable) g.lineTo(p[0], p[1]);
  g.closePath();
  g.clip();
  wallFace(g, s, x0, y1 - h - rise, x1, y1);
  // The gable in the roof's shade.
  g.fillStyle = "rgba(0,0,0,0.12)";
  g.fillRect(x0, y1 - h - rise, x1 - x0, rise);
  g.restore();
  front?.(g);
  const left: Pt[] = [[x0 - o, y1 + o - h], [x0 - o, y0 - o - h], [xm, y0 - o - h - rise], [xm, y1 + o - h - rise]];
  const right: Pt[] = [[x1 + o, y1 + o - h], [x1 + o, y0 - o - h], [xm, y0 - o - h - rise], [xm, y1 + o - h - rise]];
  roofFace(g, left, s.roof, s.seed + 7, 1.08);
  roofFace(g, right, s.roof, s.seed + 9, 0.86);
  if (s.snow) {
    snowOnRoof(g, left, s.seed + 8);
    snowOnRoof(g, right, s.seed + 10);
  }
  // Bargeboards along the gable's front.
  g.beginPath();
  g.moveTo(x0 - o, y1 + o - h);
  g.lineTo(xm, y1 + o - h - rise);
  g.lineTo(x1 + o, y1 + o - h);
  g.strokeStyle = PALETTE.woodDark;
  g.lineWidth = 0.05;
  g.stroke();
}

/** A window with its frame and shutters, on a front face, centred at (x, y). */
export function casement(g: G, x: number, y: number, w: number, h: number, flowers?: string): void {
  g.fillStyle = PALETTE.woodDark;
  g.fillRect(x - w / 2 - 0.02, y - h / 2 - 0.02, w + 0.04, h + 0.04);
  g.fillStyle = "#1d2230";
  g.fillRect(x - w / 2, y - h / 2, w, h);
  g.fillStyle = "rgba(170,190,220,0.25)";
  g.fillRect(x - w / 2, y - h / 2, w / 2, h / 2);
  line(g, x, y - h / 2, x, y + h / 2, PALETTE.woodDark, 0.015);
  line(g, x - w / 2, y, x + w / 2, y, PALETTE.woodDark, 0.015);
  // Shutters thrown open.
  g.fillStyle = "#3f5a3a";
  g.fillRect(x - w / 2 - 0.08, y - h / 2, 0.06, h);
  g.fillRect(x + w / 2 + 0.02, y - h / 2, 0.06, h);
  if (flowers) {
    g.fillStyle = PALETTE.woodDark;
    g.fillRect(x - w / 2 - 0.02, y + h / 2, w + 0.04, 0.05);
    const r = rng(Math.round(x * 100 + y * 1000));
    for (let i = 0; i < 6; i++) {
      g.fillStyle = i % 2 ? "#3d6b2c" : flowers;
      ellipse(g, x - w / 2 + (i + 0.5) * (w / 6), y + h / 2 - 0.01 - r() * 0.02, 0.025, 0.022);
      g.fill();
    }
  }
}

/** An arched door on a front face, its foot at (x, y). */
export function door(g: G, x: number, y: number, w: number, h: number, seed: number): void {
  g.fillStyle = PALETTE.stoneDark;
  g.beginPath();
  g.moveTo(x - w / 2 - 0.03, y);
  g.lineTo(x - w / 2 - 0.03, y - h + w / 2);
  g.arc(x, y - h + w / 2, w / 2 + 0.03, Math.PI, 0);
  g.lineTo(x + w / 2 + 0.03, y);
  g.fill();
  g.save();
  g.beginPath();
  g.moveTo(x - w / 2, y);
  g.lineTo(x - w / 2, y - h + w / 2);
  g.arc(x, y - h + w / 2, w / 2, Math.PI, 0);
  g.lineTo(x + w / 2, y);
  g.clip();
  planks(g, x - w / 2, y - h, x + w / 2, y, seed, "#5a3a1e", w / 4);
  g.fillStyle = PALETTE.iron;
  g.fillRect(x - w / 2, y - h * 0.3, w, 0.025);
  g.fillRect(x - w / 2, y - h * 0.7, w, 0.025);
  g.restore();
}

/** The castle's arms on a shield `w` wide, centred at (x, y). */
export function arms(g: G, room: string, x: number, y: number, w: number): void {
  const k = w / 2;
  for (const piece of armsPieces(room)) {
    g.beginPath();
    piece.points.forEach(([px, py], i) => (i ? g.lineTo(x + px * k, y + py * k) : g.moveTo(x + px * k, y + py * k)));
    g.closePath();
    g.fillStyle = piece.fill;
    g.fill();
  }
  const outline = shieldOutline();
  g.beginPath();
  outline.forEach(([px, py], i) => (i ? g.lineTo(x + px * k, y + py * k) : g.moveTo(x + px * k, y + py * k)));
  g.closePath();
  g.strokeStyle = PALETTE.goldDark;
  g.lineWidth = w * 0.07;
  g.stroke();
}

// The curtain wall, its gates and its battlements.

export const WALL_H = 0.9;
export const BATTLEMENT_H = 0.36;
export const GATE_H = 1.2;
// How far the curtain's faces stand in from the edges of its tiles.
export const WALL_INSET = 0.14;
const MERLON_STEP = 0.25;
const MERLON_W = 0.13;

interface Merlon {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Merlons along an edge of a wall's top, keeping to a beat of their own across
// the realm so they line up from tile to tile.
function merlonRun(out: Merlon[], along: "x" | "y", from: number, to: number, edge0: number, edge1: number): void {
  const start = Math.ceil((from + 0.5) / MERLON_STEP) * MERLON_STEP - 0.5;
  for (let p = start; p + MERLON_W <= to + 0.001; p += MERLON_STEP) {
    if (along === "x") out.push({ x0: p, y0: edge0, x1: p + MERLON_W, y1: edge1 });
    else out.push({ x0: edge0, y0: p, x1: edge1, y1: p + MERLON_W });
  }
}

/**
 * A tile of the ring about its centre: the curtain wall, or a rampart's
 * fighting platform, joined to its neighbours in `mask` and crenellated along
 * every edge it shows.
 */
export function paintRing(g: G, kind: "wall" | "battlement", mask: number, seed: number, snow: boolean): void {
  const wall = kind === "wall";
  const h = wall ? WALL_H : BATTLEMENT_H;
  const i = wall ? 0.5 - WALL_INSET : 0.46;
  const mh = wall ? 0.18 : 0.12;
  const md = wall ? 0.11 : 0.08;
  const top = wall ? PALETTE.stoneTop : shade(PALETTE.stoneTop, 0.92);
  const front = wall ? PALETTE.stoneFront : shade(PALETTE.stoneFront, 0.9);
  const xl = mask & W ? -0.5 : -i;
  const xr = mask & E ? 0.5 : i;
  // The north arm, then the middle with any east and west arms, then the south arm.
  const parts: Array<[number, number, number, number]> = [];
  if (mask & N) parts.push([-i, -0.5, i, -i]);
  parts.push([xl, -i, xr, i]);
  if (mask & S) parts.push([-i, i, i, 0.5]);
  for (const [x0, y0, x1, y1] of parts) {
    flagTop(g, x0, y0 - h, x1, y1 - h, seed + Math.round(y0 * 10), top);
    stoneFace(g, x0, y1 - h, x1, y1, seed + 3 + Math.round(y0 * 10), front);
  }
  // A shadow inside the parapet.
  const merlons: Merlon[] = [];
  if (mask & N) {
    merlonRun(merlons, "y", -0.5, -i, -i, -i + md);
    merlonRun(merlons, "y", -0.5, -i, i - md, i);
  }
  if (mask & S) {
    merlonRun(merlons, "y", i, 0.5, -i, -i + md);
    merlonRun(merlons, "y", i, 0.5, i - md, i);
  }
  if (mask & W) {
    merlonRun(merlons, "x", -0.5, -i, -i, -i + md);
    merlonRun(merlons, "x", -0.5, -i, i - md, i);
  }
  if (mask & E) {
    merlonRun(merlons, "x", i, 0.5, -i, -i + md);
    merlonRun(merlons, "x", i, 0.5, i - md, i);
  }
  if (!(mask & N)) merlonRun(merlons, "x", -i, i, -i, -i + md);
  if (!(mask & S)) merlonRun(merlons, "x", -i, i, i - md, i);
  if (!(mask & W)) merlonRun(merlons, "y", -i, i, -i, -i + md);
  if (!(mask & E)) merlonRun(merlons, "y", -i, i, i - md, i);
  merlons.sort((a, b) => a.y1 - b.y1);
  g.save();
  g.translate(0, -h);
  for (const m of merlons) {
    block(g, m.x0, m.y0, m.x1, m.y1, mh, snow ? SNOW : shade(top, 1.06), shade(front, 1.05));
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.fillRect(m.x0, m.y1, m.x1 - m.x0, 0.02);
  }
  g.restore();
  if (snow) {
    const r = rng(seed + 99);
    g.fillStyle = SNOW;
    for (const [x0, y0, x1, y1] of parts) {
      for (let k = 0; k < 6; k++) {
        ellipse(g, lerp(x0 + md, x1 - md, r()), lerp(y0, y1, r()) - h, 0.12 + r() * 0.1, 0.05 + r() * 0.04);
        g.fill();
      }
    }
  }
}

/**
 * A gatehouse in the curtain wall about its tile's centre: a tower over an
 * open arch, its doors swung back and the portcullis drawn up. `across` when
 * the wall runs across the picture, so the passage runs into it.
 */
export function paintGate(g: G, across: boolean, seed: number, snow: boolean): void {
  const hw = across ? 0.5 : 0.44;
  const hd = across ? 0.44 : 0.5;
  const h = GATE_H;
  flagTop(g, -hw, -hd - h, hw, hd - h, seed);
  stoneFace(g, -hw, hd - h, hw, hd, seed + 1);
  // Quoins at the corners.
  g.fillStyle = "rgba(255,255,255,0.07)";
  g.fillRect(-hw, hd - h, 0.07, h);
  g.fillStyle = "rgba(0,0,0,0.12)";
  g.fillRect(hw - 0.07, hd - h, 0.07, h);
  // The arch.
  const aw = across ? 0.25 : 0.2;
  const ah = across ? 0.72 : 0.62;
  g.beginPath();
  g.moveTo(-aw - 0.05, hd);
  g.lineTo(-aw - 0.05, hd - ah + aw);
  g.arc(0, hd - ah + aw, aw + 0.05, Math.PI, 0);
  g.lineTo(aw + 0.05, hd);
  g.fillStyle = shade(PALETTE.stoneTop, 0.85);
  g.fill();
  g.beginPath();
  g.moveTo(-aw, hd);
  g.lineTo(-aw, hd - ah + aw);
  g.arc(0, hd - ah + aw, aw, Math.PI, 0);
  g.lineTo(aw, hd);
  const dark = g.createLinearGradient(0, hd - ah, 0, hd);
  dark.addColorStop(0, "#0d0b09");
  dark.addColorStop(1, "#2a241c");
  g.fillStyle = dark;
  g.fill();
  // The light at the far end of the passage.
  if (across) {
    g.fillStyle = "rgba(120,110,85,0.35)";
    g.fillRect(-aw * 0.6, hd - ah * 0.55, aw * 1.2, ah * 0.55);
  }
  // The portcullis's teeth below its slot.
  for (let x = -aw + 0.04; x < aw; x += 0.08) line(g, x, hd - ah + 0.02, x, hd - ah + 0.16, PALETTE.iron, 0.02);
  line(g, -aw, hd - ah + 0.15, aw, hd - ah + 0.15, PALETTE.iron, 0.02);
  // Doors swung back against the passage.
  g.fillStyle = "#5a3a1e";
  g.fillRect(-aw, hd - ah * 0.7, 0.06, ah * 0.7);
  g.fillRect(aw - 0.06, hd - ah * 0.7, 0.06, ah * 0.7);
  // An arrow slit over the arch.
  g.fillStyle = "#14110d";
  g.fillRect(-0.02, hd - h + 0.12, 0.04, 0.16);
  // Merlons all round the top.
  const merlons: Merlon[] = [];
  const md = 0.11;
  merlonRun(merlons, "x", -hw, hw, -hd, -hd + md);
  merlonRun(merlons, "y", -hd + md, hd - md, -hw, -hw + md);
  merlonRun(merlons, "y", -hd + md, hd - md, hw - md, hw);
  merlonRun(merlons, "x", -hw, hw, hd - md, hd);
  merlons.sort((a, b) => a.y1 - b.y1);
  g.save();
  g.translate(0, -h);
  for (const m of merlons) block(g, m.x0, m.y0, m.x1, m.y1, 0.2, snow ? SNOW : shade(PALETTE.stoneTop, 1.06), shade(PALETTE.stoneFront, 1.05));
  g.restore();
}

// The town.

export const POST_DECK = 0.62;

/**
 * A militia watch post about its tile's centre: a deck of planks on four
 * legs with a ladder up its front, its deck running on into the posts in
 * `mask` (east and west) beside it, and the pole its pennant flies from.
 */
export function paintPost(g: G, mask: number, seed: number, snow: boolean, pole: boolean): void {
  const r = rng(seed);
  const x0 = mask & W ? -0.5 : -0.42;
  const x1 = mask & E ? 0.5 : 0.42;
  const y0 = -0.4;
  const y1 = 0.36;
  const d = POST_DECK;
  const leg = 0.06;
  const legs: number[] = [];
  if (!(mask & W)) legs.push(-0.38);
  if (!(mask & E)) legs.push(0.38 - leg);
  if (mask & W && mask & E) legs.push(-leg / 2);
  // Back legs, the bracing, the deck, the front legs.
  for (const lx of legs) planks(g, lx, y0 + 0.06 - d, lx + leg, y0 + 0.06, seed, PALETTE.woodDark, leg);
  g.strokeStyle = PALETTE.woodDark;
  g.lineWidth = 0.03;
  g.beginPath();
  g.moveTo(x0 + 0.05, y1 - 0.05);
  g.lineTo(x1 - 0.05, y1 - d + 0.12);
  g.moveTo(x0 + 0.05, y1 - d + 0.12);
  g.lineTo(x1 - 0.05, y1 - 0.05);
  g.stroke();
  g.save();
  g.translate(0, -d);
  planks(g, x0, y0, x1, y1, seed + 1, PALETTE.wood, 0.11);
  g.fillStyle = "rgba(255,255,255,0.08)";
  g.fillRect(x0, y0, x1 - x0, 0.02);
  planks(g, x0, y1, x1, y1 + 0.07, seed + 2, PALETTE.woodDark, 0.5);
  if (snow) {
    g.fillStyle = SNOW;
    for (let k = 0; k < 5; k++) {
      ellipse(g, lerp(x0 + 0.1, x1 - 0.1, r()), lerp(y0 + 0.1, y1 - 0.1, r()), 0.12 + r() * 0.08, 0.06);
      g.fill();
    }
  }
  // The railing at the back and the open ends.
  g.strokeStyle = PALETTE.wood;
  g.lineWidth = 0.025;
  g.beginPath();
  g.moveTo(x0, y0 - 0.22);
  g.lineTo(x1, y0 - 0.22);
  for (let x = x0 + 0.02; x <= x1; x += 0.2) {
    g.moveTo(x, y0);
    g.lineTo(x, y0 - 0.22);
  }
  if (!(mask & W)) {
    g.moveTo(x0 + 0.02, y0 - 0.22);
    g.lineTo(x0 + 0.02, y1 - 0.22);
    g.lineTo(x0 + 0.02, y1);
  }
  if (!(mask & E)) {
    g.moveTo(x1 - 0.02, y0 - 0.22);
    g.lineTo(x1 - 0.02, y1 - 0.22);
    g.lineTo(x1 - 0.02, y1);
  }
  g.stroke();
  g.restore();
  for (const lx of legs) planks(g, lx, y1 - d, lx + leg, y1, seed + 3, PALETTE.woodDark, leg);
  // The ladder.
  const lx = mask & E ? -0.1 : 0.1;
  line(g, lx - 0.08, y1 + 0.06, lx - 0.08, y1 - d, PALETTE.wood, 0.025);
  line(g, lx + 0.08, y1 + 0.06, lx + 0.08, y1 - d, PALETTE.wood, 0.025);
  for (let k = 0.1; k < d; k += 0.12) line(g, lx - 0.08, y1 + 0.06 - k, lx + 0.08, y1 + 0.06 - k, PALETTE.wood, 0.02);
  if (pole) line(g, POST_POLE[0], POST_POLE[1] - d, POST_POLE[0], POST_POLE[1] - d - 0.95, PALETTE.woodDark, 0.035);
}

// Where a post's pennant pole stands on its deck, and its top.
export const POST_POLE: Pt = [-0.3, -0.34];
export const POST_POLE_TOP = POST_DECK + 0.95;

export const HOUSE_H = 0.95;
export const HOUSE_RISE = 1.35;
// How thick a cottage's walls are, inside the edge of its five tiles.
export const HOUSE_WALL = 0.26;

/** A stretch of a cottage's wall, [x0, x1] × [y0, y1] about its anchor, its front shown or not. */
export function paintHouseWall(g: G, x0: number, y0: number, x1: number, y1: number, seed: number, snow: boolean): void {
  g.fillStyle = TIMBER;
  g.fillRect(x0, y0 - HOUSE_H, x1 - x0, y1 - y0);
  g.fillStyle = "rgba(255,255,255,0.08)";
  g.fillRect(x0, y0 - HOUSE_H, x1 - x0, 0.02);
  if (snow) {
    g.fillStyle = SNOW;
    g.fillRect(x0, y0 - HOUSE_H, x1 - x0, Math.min(0.06, y1 - y0));
  }
  timberFace(g, x0, y1 - HOUSE_H, x1, y1, seed);
}

// Flowers in the window boxes, by season.
const FLOWERS: Record<string, string | undefined> = { spring: "#e98bb0", summer: "#e8c84a", autumn: "#c4622a", winter: undefined };

/**
 * A cottage's front wall, five tiles wide about the anchor at its west end,
 * with a window for each of the three beds behind it, and its door if the
 * door is on this side, `doorAt` tiles along.
 */
export function paintHouseFront(g: G, doorAt: number | undefined, season: string, seed: number, snow: boolean): void {
  const x0 = -0.5;
  const x1 = 4.5;
  paintHouseWall(g, x0, -HOUSE_WALL, x1, 0, seed, snow);
  for (let k = 1; k <= 3; k++) {
    if (k === doorAt) continue;
    casement(g, k, -HOUSE_H * 0.55, 0.22, 0.24, FLOWERS[season]);
  }
  if (doorAt !== undefined) door(g, doorAt, 0, 0.34, 0.62, seed + 5);
}

/** Where the windows of a cottage's front wall are, about its anchor, for their lamplight. */
export const HOUSE_WINDOWS: Pt[] = [
  [1, -HOUSE_H * 0.55],
  [2, -HOUSE_H * 0.55],
  [3, -HOUSE_H * 0.55],
];

/**
 * A cottage's thatched roof over its five tiles about the anchor at its
 * north-west tile's centre: hipped, so it falls away to the east and west as
 * well as front and back, its ridge bound with crossed spars, with a chimney
 * behind the ridge and a dormer in the front slope.
 */
export function paintCottageRoof(g: G, seed: number, snow: boolean): void {
  const x0 = -0.5;
  const x1 = 4.5;
  const y0 = -0.5;
  const y1 = 4.5;
  const o = 0.22;
  const ym = 2;
  const h = HOUSE_H;
  const rise = HOUSE_RISE;
  const hip = 1.25;
  const ridgeY = ym - h - rise;
  const ridgeL: Pt = [x0 + hip, ridgeY];
  const ridgeR: Pt = [x1 - hip, ridgeY];
  const backL: Pt = [x0 - o, y0 - o - h];
  const backR: Pt = [x1 + o, y0 - o - h];
  const frontL: Pt = [x0 - o, y1 + o * 0.6 - h];
  const frontR: Pt = [x1 + o, y1 + o * 0.6 - h];
  const back: Pt[] = [backL, backR, ridgeR, ridgeL];
  const west: Pt[] = [frontL, backL, ridgeL, ridgeL];
  const east: Pt[] = [backR, frontR, ridgeR, ridgeR];
  const face: Pt[] = [frontL, frontR, ridgeR, ridgeL];
  // The back slope and the hips first, the far side in shade, the west end in the low sun.
  roofFace(g, back, "thatch", seed + 7, 0.82);
  roofFace(g, west, "thatch", seed + 13, 1.1);
  roofFace(g, east, "thatch", seed + 14, 0.74);
  if (snow) {
    snowOnRoof(g, back, seed + 8, PALETTE.snowShade);
    snowOnRoof(g, west, seed + 15);
    snowOnRoof(g, east, seed + 16, PALETTE.snowShade);
  }
  // The chimney, rising behind the ridge.
  const [cx, top] = COTTAGE_CHIMNEY;
  const cy = top + 0.66;
  stoneFace(g, cx - 0.18, cy - 0.5, cx + 0.18, cy + 0.32, seed + 11, PALETTE.stoneFront, 0.1);
  block(g, cx - 0.2, cy - 0.62, cx + 0.2, cy - 0.5, 0.06, PALETTE.stoneTop, PALETTE.stoneFront);
  g.fillStyle = "#14110d";
  g.fillRect(cx - 0.12, cy - 0.66, 0.24, 0.06);
  roofFace(g, face, "thatch", seed + 9, 1);
  // Darker straw where the hips meet the front slope.
  for (const [a, b] of [[frontL, ridgeL], [frontR, ridgeR]] as const) line(g, a[0], a[1], b[0], b[1], shade(PALETTE.thatch, 0.6), 0.05);
  // A dormer over the middle window.
  const dx = COTTAGE_DORMER[0];
  const dy = y1 - h - 0.55;
  fillPoly(g, [[dx - 0.32, dy + 0.12], [dx - 0.32, dy - 0.3], [dx + 0.32, dy - 0.3], [dx + 0.32, dy + 0.12]], PLASTER);
  casement(g, dx, dy - 0.08, 0.2, 0.2);
  fillPoly(g, [[dx - 0.42, dy - 0.24], [dx, dy - 0.64], [dx + 0.42, dy - 0.24], [dx + 0.3, dy - 0.24], [dx, dy - 0.52], [dx - 0.3, dy - 0.24]], shade(PALETTE.thatch, 0.8));
  if (snow) {
    snowOnRoof(g, face, seed + 10);
    fillPoly(g, [[dx - 0.4, dy - 0.27], [dx, dy - 0.64], [dx + 0.4, dy - 0.27], [dx, dy - 0.5]], SNOW);
  }
  // Light gathers towards the ridge and the eaves sink into shade.
  g.save();
  g.beginPath();
  for (const [x, y] of [frontL, frontR, ridgeR, ridgeL]) g.lineTo(x, y);
  g.closePath();
  g.clip();
  const fall = g.createLinearGradient(0, ridgeY, 0, frontL[1]);
  fall.addColorStop(0, "rgba(255,244,214,0.16)");
  fall.addColorStop(0.6, "rgba(0,0,0,0)");
  fall.addColorStop(1, "rgba(30,20,8,0.22)");
  g.fillStyle = fall;
  g.fillRect(frontL[0], ridgeY, frontR[0] - frontL[0], frontL[1] - ridgeY);
  g.restore();
  // The ridge: a roll of straw held down by spars laid crosswise.
  const capL: Pt = [ridgeL[0] - 0.08, ridgeY];
  const capR: Pt = [ridgeR[0] + 0.08, ridgeY];
  line(g, capL[0], capL[1] + 0.06, capR[0], capR[1] + 0.06, shade(PALETTE.thatch, snow ? 0.75 : 0.62), 0.2);
  line(g, capL[0], capL[1], capR[0], capR[1], snow ? SNOW : shade(PALETTE.thatch, 0.85), 0.1);
  const spars = Math.round((capR[0] - capL[0]) / 0.18);
  for (let i = 0; i < spars; i++) {
    const sx = capL[0] + (i + 0.5) * ((capR[0] - capL[0]) / spars);
    line(g, sx - 0.08, ridgeY + 0.04, sx + 0.08, ridgeY + 0.2, PALETTE.woodDark, 0.018);
    line(g, sx + 0.08, ridgeY + 0.04, sx - 0.08, ridgeY + 0.2, PALETTE.woodDark, 0.018);
  }
  line(g, capL[0], ridgeY + 0.04, capR[0], ridgeY + 0.04, PALETTE.woodDark, 0.014);
  line(g, capL[0], ridgeY + 0.2, capR[0], ridgeY + 0.2, PALETTE.woodDark, 0.014);
}

/** Where a cottage's chimney smokes from, about its anchor. */
export const COTTAGE_CHIMNEY: Pt = [2.9, 2 - HOUSE_H - HOUSE_RISE * 0.82 - 0.25 - 0.66];
/** Where its dormer window is, about its anchor. */
export const COTTAGE_DORMER: Pt = [2, 4.5 - HOUSE_H - 0.55 - 0.08];

/** A plank floor over the inside of a cottage, the anchor at its north-west tile's centre. */
export function paintCottageFloor(g: G, seed: number): void {
  const i = -0.5 + HOUSE_WALL;
  const o = 4.5 - HOUSE_WALL;
  const r = rng(seed);
  for (let y = i; y < o; y += 0.16) {
    let x = i - r() * 0.6;
    while (x < o) {
      const w = 0.6 + r() * 0.7;
      g.fillStyle = shade("#7b5734", 0.82 + r() * 0.25);
      g.fillRect(Math.max(i, x), y, Math.min(o, x + w) - Math.max(i, x), Math.min(0.155, o - y));
      x += w;
    }
  }
  g.fillStyle = "rgba(0,0,0,0.25)";
  g.fillRect(i, i, o - i, 0.18);
  g.fillRect(i, i, 0.12, o - i);
  // The hearth, in the north-east corner.
  g.fillStyle = PALETTE.stoneDark;
  g.fillRect(o - 0.5, i, 0.5, 0.3);
  g.fillStyle = "#2a1408";
  g.fillRect(o - 0.42, i + 0.04, 0.34, 0.18);
}

/** A straw bed with a blanket in the castle's colour, about its tile's centre. */
export function paintBed(g: G, blanket: string, seed: number): void {
  const r = rng(seed);
  const turn = r() < 0.5;
  const w = turn ? 0.62 : 0.38;
  const h = turn ? 0.38 : 0.62;
  block(g, -w / 2, -h / 2, w / 2, h / 2, 0.1, "#c8ad6a", PALETTE.woodDark);
  g.fillStyle = blanket;
  if (turn) g.fillRect(-w / 2 + 0.2, -h / 2 - 0.1, w - 0.22, h);
  else g.fillRect(-w / 2, -h / 2 + 0.2 - 0.1, w, h - 0.22);
  g.fillStyle = "#efe6cf";
  if (turn) g.fillRect(-w / 2 + 0.03, -h / 2 - 0.07, 0.14, h - 0.06);
  else g.fillRect(-w / 2 + 0.03, -h / 2 - 0.07, w - 0.06, 0.14);
}

/** The town fountain's basin and its pillar, about its tile's centre; the water is drawn as it runs. */
export function paintFountain(g: G, seed: number, frozen: boolean): void {
  const r = 0.66;
  const h = 0.26;
  g.beginPath();
  g.moveTo(-r, -h);
  g.lineTo(-r, 0);
  g.ellipse(0, 0, r, r * SQUASH, 0, Math.PI, 0, true);
  g.lineTo(r, -h);
  g.closePath();
  g.save();
  g.clip();
  stoneFace(g, -r, -h - r * SQUASH, r, r * SQUASH, seed, PALETTE.stoneFront, 0.09);
  const round = g.createLinearGradient(-r, 0, r, 0);
  round.addColorStop(0, "rgba(0,0,0,0.3)");
  round.addColorStop(0.4, "rgba(0,0,0,0)");
  round.addColorStop(1, "rgba(0,0,0,0.35)");
  g.fillStyle = round;
  g.fillRect(-r, -h - 1, 2 * r, 2);
  g.restore();
  ellipse(g, 0, -h, r, r * SQUASH);
  g.fillStyle = PALETTE.stoneTop;
  g.fill();
  ellipse(g, 0, -h + 0.02, r - 0.09, (r - 0.09) * SQUASH);
  g.fillStyle = frozen ? "#c9dbe8" : "#2c5d7c";
  g.fill();
  if (frozen) {
    const rr = rng(seed + 3);
    for (let k = 0; k < 5; k++) line(g, (rr() - 0.5) * 0.7, -h + (rr() - 0.5) * 0.4, (rr() - 0.5) * 0.7, -h + (rr() - 0.5) * 0.4, "rgba(255,255,255,0.6)", 0.012);
  }
}

/** The fountain's pillar and upper bowl, drawn over its water. */
export function paintFountainPillar(g: G, frozen: boolean): void {
  block(g, -0.06, -0.3, 0.06, -0.22, 0.48, PALETTE.stoneTop, PALETTE.stoneFront);
  ellipse(g, 0, -0.26 - 0.66, 0.24, 0.24 * SQUASH);
  g.fillStyle = PALETTE.stoneFront;
  g.fill();
  g.beginPath();
  g.ellipse(0, -0.26 - 0.66, 0.24, 0.24 * SQUASH, 0, 0, Math.PI);
  g.lineTo(-0.1, -0.26 - 0.56);
  g.closePath();
  g.fillStyle = shade(PALETTE.stoneFront, 0.8);
  g.fill();
  ellipse(g, 0, -0.26 - 0.68, 0.2, 0.2 * SQUASH);
  g.fillStyle = frozen ? "#d4e3ee" : "#3f7aa0";
  g.fill();
  block(g, -0.03, -0.27, 0.03, -0.25, 0.85, PALETTE.stoneTop, PALETTE.stoneFront);
  ellipse(g, 0, -0.26 - 0.86, 0.05, 0.05);
  g.fillStyle = PALETTE.gold;
  g.fill();
  if (frozen) for (let k = -2; k <= 2; k++) fillPoly(g, [[k * 0.08 - 0.02, -0.86], [k * 0.08 + 0.02, -0.86], [k * 0.08, -0.74 + Math.abs(k) * 0.03]], "#e8f2fa");
}

/** A pilgrims' tent about its tile's centre, its canvas patched and a strip of the castle's colour at its peak. */
export function paintTent(g: G, seed: number, colour: string, snow: boolean): void {
  const r = rng(seed);
  const canvas = mix("#cdbb92", "#a89770", r());
  const hw = 0.42;
  const hd = 0.36;
  const h = 0.66;
  const left: Pt[] = [[-hw, hd], [-hw, -hd], [0, -hd - h], [0, hd - h]];
  const right: Pt[] = [[hw, hd], [hw, -hd], [0, -hd - h], [0, hd - h]];
  fillPoly(g, left, shade(canvas, 1.05));
  fillPoly(g, right, shade(canvas, 0.8));
  for (let k = 1; k < 4; k++) {
    const t = k / 4;
    line(g, -hw * (1 - t), hd - h * t, -hw * (1 - t), -hd - h * t, "rgba(80,60,30,0.25)", 0.012);
    line(g, hw * (1 - t), hd - h * t, hw * (1 - t), -hd - h * t, "rgba(60,40,20,0.25)", 0.012);
  }
  if (snow) {
    fillPoly(g, [[-hw * 0.5, hd - h * 0.5], [-hw * 0.5, -hd - h * 0.5], [0, -hd - h], [0, hd - h]], SNOW);
    fillPoly(g, [[hw * 0.5, hd - h * 0.5], [hw * 0.5, -hd - h * 0.5], [0, -hd - h], [0, hd - h]], PALETTE.snowShade);
  }
  // The front, its flap tied back.
  fillPoly(g, [[-hw, hd], [0, hd - h], [hw, hd]], shade(canvas, 0.92));
  fillPoly(g, [[-0.14, hd], [0, hd - h * 0.75], [0.14, hd]], "#1a140c");
  fillPoly(g, [[-0.14, hd], [0, hd - h * 0.75], [-0.2, hd - 0.1]], shade(canvas, 0.7));
  line(g, 0, hd - h, 0, hd - h - 0.18, PALETTE.woodDark, 0.025);
  fillPoly(g, [[0, hd - h - 0.18], [0.2, hd - h - 0.14], [0, hd - h - 0.1]], colour);
  // Guy ropes and pegs.
  line(g, -hw, hd, -hw - 0.12, hd + 0.1, "#8a7a5a", 0.012);
  line(g, hw, hd, hw + 0.12, hd + 0.1, "#8a7a5a", 0.012);
}

/** A ring of stones with logs laid in it, about its tile's centre. */
export function paintFirePit(g: G, seed: number): void {
  const r = rng(seed);
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * TAU + r() * 0.2;
    if (Math.sin(a) > 0.2) continue;
    ellipse(g, Math.cos(a) * 0.26, Math.sin(a) * 0.26 * SQUASH, 0.07, 0.05);
    g.fillStyle = shade(PALETTE.stoneTop, 0.8 + r() * 0.3);
    g.fill();
  }
  g.fillStyle = "#1a120b";
  ellipse(g, 0, 0, 0.2, 0.2 * SQUASH);
  g.fill();
  line(g, -0.18, 0.04, 0.16, -0.06, "#5a3a1e", 0.07);
  line(g, -0.16, -0.06, 0.18, 0.05, "#4a2f18", 0.07);
}

/** The front half of the fire pit's ring of stones, drawn over the fire. */
export function paintFirePitFront(g: G, seed: number): void {
  const r = rng(seed);
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * TAU + r() * 0.2;
    if (Math.sin(a) <= 0.2) continue;
    ellipse(g, Math.cos(a) * 0.26, Math.sin(a) * 0.26 * SQUASH, 0.07, 0.05);
    g.fillStyle = shade(PALETTE.stoneTop, 0.8 + r() * 0.3);
    g.fill();
  }
}

/** A feast lantern's pole and crook, its foot at the anchor; the lantern hangs from (0.16, -0.9). */
export function paintLanternPole(g: G): void {
  line(g, 0, 0, 0, -1.05, PALETTE.woodDark, 0.035);
  g.beginPath();
  g.moveTo(0, -1.04);
  g.quadraticCurveTo(0.02, -1.14, 0.16, -1.08);
  g.strokeStyle = PALETTE.woodDark;
  g.lineWidth = 0.03;
  g.stroke();
  line(g, 0.16, -1.08, 0.16, -0.98, "#2a2218", 0.012);
}
