// Painting the realm's people, part by part (figures.ts poses them). Every
// painter here works in a figure's own frame: tiles at a grown man's size,
// the feet at the origin, y up the screen negative, and +x the way the figure
// faces, so one painting serves both ways by mirroring. A figure is painted
// twice: first every part in ink, swollen a little, then the parts themselves
// over that, so one dark line rings the whole figure and its parts are parted
// only by fine seams of their own colour. Each part is laid in flat and split
// into light and shade. The sun stands in the south-west, so in this frame
// the lit side is -x for a figure facing east and +x for one facing west.

import { ellipse, flame, PALETTE, pennant, rgba, shade, smoke, TAU } from "./art";
import type { Back, Look, Off, Tool } from "./figures-looks";

// The rig, in tiles for a figure of size 1: about three quarters of a tile
// from the soles to the crown.
export const HIP = -0.27;
export const SHOULDER = -0.5;
export const HEAD = -0.625;
const HEAD_R = 0.102;
const UPPER = 0.12;
const FORE = 0.11;
// The shoulders, the near one (the arm that holds the tool, drawn over the
// body) a little forward and the far one a little back, as a body turned
// three quarters towards the way it faces.
export const NEAR_X = 0.06;
export const FAR_X = -0.07;
// How much broader the body is drawn than its outline below is written, so a
// figure stands square-shouldered rather than as a stick.
const BROAD = 1.32;
// The thickness of a limb and of an arm, and the fine seam between parts.
const LEG_W = 0.068;
const ARM_W = 0.056;
const SEAM = 0.011;
const STEEL = "#9aa3ad";
const WOOD = "#7a5530";
const BURLAP = "#a88a5c";

/** The colours a figure is painted in, its look's placeholders worked out. */
export interface Dress {
  skin: string;
  hair: string | null;
  // Hair falling to the shoulders rather than cropped short.
  long: boolean;
  beard: string | null;
  // A beard to the chest rather than trimmed to the jaw.
  longBeard: boolean;
  shirt: string;
  sleeves: string;
  legs: string;
  boots: string;
  hat: string;
  cape: string | null;
  trim: string | null;
  apron: string | null;
  // The castle's colours, for banners, tabards and shields.
  field: string;
  other: string;
}

/** How a figure stands this frame. */
export interface Pose {
  face: 1 | -1;
  // Seen from behind, walking away north.
  back: boolean;
  // How far the body has sunk at this point of the stride (down is
  // positive), and how far it leans forward from the hips, in radians.
  bob: number;
  lean: number;
  // Each foot: how far forward along the ground, and how high it is lifted.
  nearFoot: [number, number];
  farFoot: [number, number];
  // Each arm: the upper arm's angle from hanging straight down, growing
  // forward and up (π is straight up), and how far on from that the elbow bends.
  near: [number, number];
  far: [number, number];
  tool: Tool;
  // The angle of what the near hand holds, by the same reckoning.
  toolA: number;
  off: Off;
  // How far a bowstring is drawn, 0 to 1.
  drawn: number;
  // How far into its stride, 0 standing to 1 walking, and how far its hem
  // sways with the step.
  stride: number;
  sway: number;
  // A censer's swing on its chain, in radians.
  swing: number;
  // How high it floats, for those who walk on air.
  hover: number;
  // Struck this tick: its outline flashes red.
  struck: boolean;
  // Torches and lanterns burning.
  lit: boolean;
  // How full what it carries is, 0 to 1, and the goods' colour.
  fill: number;
  goods: string;
  now: number;
  seed: number;
  // 0 for a figure too small for any detail, 1 for plain, 2 for faces and fine work.
  detail: number;
}

// While the ink pass runs, how far the line about the figure reaches out
// from its parts' edges, in its frame; 0 while the figure itself is painted.
let rim = 0;
// Which way the light comes from in the figure's frame: -1 from -x.
let lit = -1;

// Paints a figure twice, first in ink and swollen by the line about it, then
// itself over that, so one dark line rings the whole and the gaps between its
// parts close up. The line is about a pixel wide however small the figure,
// and thicker as it grows.
function outlined(ctx: CanvasRenderingContext2D, p: Pose, paintAll: () => void): void {
  const px = Math.abs(ctx.getTransform().d) / (globalThis.devicePixelRatio || 1);
  lit = -p.face;
  rim = SEAM / 2 + Math.max(0.016, 1.2 / px);
  try {
    paintAll();
  } finally {
    rim = 0;
  }
  paintAll();
}

// Colours worked out from others, kept so they are worked out once.
const tones = new Map<string, string>();

function tone(colour: string, k: number): string {
  const key = `${colour}/${k}`;
  let t = tones.get(key);
  if (t === undefined) {
    t = shade(colour, k);
    tones.set(key, t);
  }
  return t;
}

// Light and shade over a part, by which side the sun is on: the lit side
// warmed a touch and the far side in cool shade, parted by a short soft edge
// that leans so the head stands more in the light than the feet. One pair of
// gradients per canvas, reused for every part of every figure.
const washes = new WeakMap<CanvasRenderingContext2D, [CanvasGradient, CanvasGradient]>();

function wash(ctx: CanvasRenderingContext2D, p: Pose): CanvasGradient {
  let w = washes.get(ctx);
  if (!w) {
    const make = (from: number) => {
      const g = ctx.createLinearGradient(from * 0.15, 0, -from * 0.11, 0.015);
      g.addColorStop(0, "rgba(255,232,196,0.2)");
      g.addColorStop(0.46, "rgba(255,232,196,0.06)");
      g.addColorStop(0.52, "rgba(14,10,26,0.46)");
      g.addColorStop(1, "rgba(14,10,26,0.55)");
      return g;
    };
    w = [make(-1), make(1)];
    washes.set(ctx, w);
  }
  return w[p.face === 1 ? 0 : 1];
}

// Fills the current path and models it, parted from what it lies on by a
// seam of its own colour; in the ink pass, lays it in ink and swells it.
function paint(ctx: CanvasRenderingContext2D, fill: string, ink: string, p: Pose | null = null): void {
  if (rim) {
    ctx.fillStyle = ink;
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = rim * 2;
    ctx.stroke();
    return;
  }
  ctx.fillStyle = fill;
  ctx.fill();
  if (p) model(ctx, p);
  ctx.strokeStyle = tone(fill, 0.45);
  ctx.lineWidth = SEAM;
  ctx.stroke();
}

// Lays light and shade over the current path.
function model(ctx: CanvasRenderingContext2D, p: Pose): void {
  if (rim || p.detail === 0) return;
  ctx.fillStyle = wash(ctx, p);
  ctx.fill();
}

// Strokes the current path as a rod `w` thick.
function rod(ctx: CanvasRenderingContext2D, w: number, colour: string, ink: string): void {
  if (rim) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = w + rim * 2;
    ctx.stroke();
    return;
  }
  ctx.strokeStyle = tone(colour, 0.45);
  ctx.lineWidth = w + SEAM;
  ctx.stroke();
  ctx.strokeStyle = colour;
  ctx.lineWidth = w;
  ctx.stroke();
}

function trace(ctx: CanvasRenderingContext2D, pts: number[], dx: number, dy: number): void {
  ctx.beginPath();
  ctx.moveTo(pts[0] + dx, pts[1] + dy);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] + dx, pts[i + 1] + dy);
}

// A limb or a pole: a line of joints. One thick enough to be modelled has its
// far, lower half in shade.
function limb(ctx: CanvasRenderingContext2D, pts: number[], w: number, colour: string, ink: string): void {
  trace(ctx, pts, 0, 0);
  rod(ctx, w, colour, ink);
  if (rim || w < 0.03) return;
  trace(ctx, pts, -lit * w * 0.17, w * 0.17);
  ctx.strokeStyle = tone(colour, 0.68);
  ctx.lineWidth = w * 0.5;
  ctx.stroke();
}

// A dot of colour on a part: nothing in the ink pass.
function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string): void {
  if (rim) return;
  ellipse(ctx, x, y, r, r);
  ctx.fillStyle = colour;
  ctx.fill();
}

// Light caught on metal, on the side towards the sun.
function glint(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, p: Pose): void {
  if (p.detail > 1) dot(ctx, x, y, r, "rgba(255,248,230,0.8)");
}

/** Where an arm's hand is, from its shoulder and pose. */
export function handAt(sx: number, sy: number, arm: [number, number]): [number, number, number, number] {
  const ex = sx + Math.sin(arm[0]) * UPPER;
  const ey = sy + Math.cos(arm[0]) * UPPER;
  const a = arm[0] + arm[1];
  return [ex, ey, ex + Math.sin(a) * FORE, ey + Math.cos(a) * FORE];
}

/** How far along a held thing its business end is, for lights and spells. */
export function toolReach(tool: Tool): number {
  switch (tool) {
    case "staff":
    case "skull-staff":
      return 0.38;
    case "orb-staff":
      return 0.42;
    case "banner":
      return 0.5;
    default:
      return 0;
  }
}

// What is held upright whatever the hand does: it hangs or stands, rather
// than turning with the wrist.
const UPRIGHT = new Set<Tool>(["tankard", "potion", "censer", "lute", "scroll", "none"]);

/** A person, painted in its own frame (see the top of this file). */
export function paintPerson(ctx: CanvasRenderingContext2D, look: Look, d: Dress, p: Pose): void {
  const ink = p.struck ? "#ff3d2e" : PALETTE.ink;
  if (p.detail === 0) {
    paintSpeck(ctx, look, d, p);
    return;
  }
  // The body above the hips, raised or lowered by the stride and leaning
  // forward about them.
  const upper = (fn: () => void) => {
    ctx.save();
    ctx.translate(0, HIP + p.bob);
    ctx.rotate(p.lean);
    ctx.translate(0, -HIP);
    fn();
    ctx.restore();
  };
  outlined(ctx, p, () => {
    ctx.save();
    ctx.translate(0, -p.hover);
    if (!p.back) {
      upper(() => {
        if (d.cape) cape(ctx, d, p, ink);
        backItem(ctx, look.back, look, p, ink, 0);
        arm(ctx, FAR_X, SHOULDER, p.far, d, ink, true, () => offItem(ctx, p.off, look, p, ink));
      });
      legs(ctx, look, d, p, ink);
      upper(() => {
        body(ctx, look, d, p, ink);
        if (isShield(p.off)) shield(ctx, p.off, d, p, ink);
        // A tool on the shoulder or raised behind for a blow goes behind the head.
        const behind = p.toolA > Math.PI + 0.3 && !UPRIGHT.has(p.tool);
        if (behind) arm(ctx, NEAR_X, SHOULDER, p.near, d, ink, false, () => held(ctx, p.tool, look, d, p, ink));
        head(ctx, look, d, p, ink);
        if (p.tool === "lute") lute(ctx, p, ink);
        if (!behind) arm(ctx, NEAR_X, SHOULDER, p.near, d, ink, false, () => held(ctx, p.tool, look, d, p, ink));
      });
    } else {
      upper(() => arm(ctx, NEAR_X, SHOULDER, p.near, d, ink, false, () => held(ctx, p.tool, look, d, p, ink)));
      legs(ctx, look, d, p, ink);
      upper(() => {
        body(ctx, look, d, p, ink);
        if (d.cape) cape(ctx, d, p, ink);
        backItem(ctx, look.back, look, p, ink, 0.09);
        head(ctx, look, d, p, ink);
        if (isShield(p.off)) shield(ctx, p.off, d, p, ink);
        arm(ctx, FAR_X, SHOULDER, p.far, d, ink, true, () => offItem(ctx, p.off, look, p, ink));
      });
    }
    ctx.restore();
  });
}

// A figure a few pixels tall: a coat, a head and a hat, enough to tell a
// knight from a barmaid across the room.
function paintSpeck(ctx: CanvasRenderingContext2D, look: Look, d: Dress, p: Pose): void {
  ctx.save();
  ctx.translate(0, -p.hover);
  // A dark ground under it all, to part it from the ground it stands on.
  ctx.fillStyle = PALETTE.ink;
  ctx.fillRect(-0.12, SHOULDER - 0.05, 0.24, 0.05 - SHOULDER);
  dot(ctx, 0.005, HEAD, HEAD_R * 1.1 + 0.04, PALETTE.ink);
  ctx.fillStyle = d.legs;
  ctx.fillRect(-0.06, HIP, 0.12, -HIP);
  ctx.beginPath();
  ctx.moveTo(-0.1, SHOULDER - 0.02);
  ctx.lineTo(0.1, SHOULDER - 0.02);
  ctx.lineTo(look.robe ? 0.11 : 0.085, look.robe ? -0.02 : HIP + 0.04);
  ctx.lineTo(look.robe ? -0.11 : -0.085, look.robe ? -0.02 : HIP + 0.04);
  ctx.closePath();
  ctx.fillStyle = d.shirt;
  ctx.fill();
  dot(ctx, 0.005, HEAD, HEAD_R * 1.1, d.skin);
  if (look.hat !== "none") {
    ellipse(ctx, 0, HEAD - 0.05, HEAD_R * 1.25, HEAD_R * 0.75);
    ctx.fillStyle = d.hat;
    ctx.fill();
  }
  ctx.restore();
}

function isShield(off: Off): boolean {
  return off === "kite-shield" || off === "round-shield";
}

// A cape from the shoulders, trailing behind as it walks: from the front it
// shows round the body's back edge; from behind it covers the back.
function cape(ctx: CanvasRenderingContext2D, d: Dress, p: Pose, ink: string): void {
  const flare = 0.035 + p.stride * 0.04;
  const wave = Math.sin(p.now / 420 + p.seed) * 0.012;
  ctx.save();
  ctx.scale(BROAD, 1);
  ctx.beginPath();
  if (!p.back) {
    ctx.moveTo(-0.07, SHOULDER - 0.01);
    ctx.lineTo(0.05, SHOULDER - 0.015);
    ctx.quadraticCurveTo(0.06, -0.25, 0.03, -0.05);
    ctx.lineTo(-0.12 - flare + wave, -0.035);
    ctx.quadraticCurveTo(-0.1 - flare * 0.6, -0.3, -0.07, SHOULDER - 0.01);
  } else {
    ctx.moveTo(-0.08, SHOULDER - 0.01);
    ctx.lineTo(0.08, SHOULDER - 0.01);
    ctx.quadraticCurveTo(0.1, -0.25, 0.11 + wave, -0.04);
    ctx.quadraticCurveTo(0, -0.005, -0.12 - flare, -0.045);
    ctx.quadraticCurveTo(-0.1, -0.3, -0.08, SHOULDER - 0.01);
  }
  ctx.closePath();
  paint(ctx, d.cape!, ink, p);
  if (p.detail > 1 && p.back) {
    // Folds.
    ctx.strokeStyle = rgba(shade(d.cape!, 0.6), 0.7);
    ctx.lineWidth = 0.01;
    ctx.beginPath();
    ctx.moveTo(-0.02, SHOULDER + 0.04);
    ctx.lineTo(-0.04 - flare * 0.3, -0.06);
    ctx.moveTo(0.04, SHOULDER + 0.04);
    ctx.lineTo(0.05, -0.06);
    ctx.stroke();
  }
  ctx.restore();
}

function legs(ctx: CanvasRenderingContext2D, look: Look, d: Dress, p: Pose, ink: string): void {
  const hipY = HIP + p.bob + 0.02;
  const one = (hipX: number, foot: [number, number], far: boolean) => {
    const [fx, lift] = foot;
    const footY = -lift;
    if (!look.robe) {
      const kx = (hipX + fx) / 2 + 0.018 + lift * 0.6;
      const ky = (hipY + footY) / 2 - lift * 0.3;
      limb(ctx, [hipX, hipY, kx, ky, fx, footY - 0.04], LEG_W, far ? tone(d.legs, 0.78) : d.legs, ink);
    }
    // The boot, toe forward.
    ctx.beginPath();
    ctx.moveTo(fx - 0.036, footY - 0.065);
    ctx.lineTo(fx + 0.026, footY - 0.065);
    ctx.quadraticCurveTo(fx + 0.034, footY - 0.04, fx + 0.07, footY - 0.03);
    ctx.quadraticCurveTo(fx + 0.078, footY, fx + 0.06, footY);
    ctx.lineTo(fx - 0.038, footY);
    ctx.closePath();
    paint(ctx, far ? tone(d.boots, 0.8) : d.boots, ink, p);
  };
  one(-0.03, p.farFoot, true);
  one(0.032, p.nearFoot, false);
}

// The body: a robe to the ankles or a coat to the hips, with whatever is
// worn over it.
function body(ctx: CanvasRenderingContext2D, look: Look, d: Dress, p: Pose, ink: string): void {
  ctx.save();
  ctx.scale(BROAD, 1);
  const top = SHOULDER - 0.02;
  const sway = p.sway;
  // Square shoulders narrowing to the waist, then a coat's skirts over the
  // hips or a robe falling wide to the ankles.
  ctx.beginPath();
  ctx.moveTo(-0.074, SHOULDER + 0.03);
  ctx.quadraticCurveTo(-0.078, top, -0.035, top);
  ctx.lineTo(0.035, top);
  ctx.quadraticCurveTo(0.084, top, 0.08, SHOULDER + 0.04);
  if (look.robe) {
    ctx.quadraticCurveTo(0.07, -0.3, 0.1 + sway, -0.025);
    ctx.quadraticCurveTo(0, 0.0, -0.1 + sway * 0.5, -0.03);
    ctx.quadraticCurveTo(-0.075, -0.3, -0.074, SHOULDER + 0.03);
  } else {
    ctx.quadraticCurveTo(0.068, -0.4, 0.06, -0.33);
    ctx.quadraticCurveTo(0.062, -0.27, 0.07, HIP + 0.045);
    ctx.lineTo(-0.064, HIP + 0.045);
    ctx.quadraticCurveTo(-0.058, -0.29, -0.058, -0.33);
    ctx.quadraticCurveTo(-0.068, -0.4, -0.074, SHOULDER + 0.03);
  }
  ctx.closePath();
  paint(ctx, d.shirt, ink, p);
  const hem = look.robe ? -0.03 : HIP + 0.045;

  if (look.armour) armour(ctx, look.armour, d, p, ink, hem);
  if (d.trim && p.detail > 1) {
    // The trim down the front and along the hem or the collar.
    ctx.strokeStyle = d.trim;
    ctx.lineWidth = 0.014;
    ctx.beginPath();
    if (look.robe) {
      ctx.moveTo(0.05, top + 0.01);
      ctx.quadraticCurveTo(0.055, -0.25, 0.07 + sway, -0.035);
      ctx.moveTo(-0.095 + sway * 0.5, -0.04);
      ctx.quadraticCurveTo(0, -0.012, 0.095 + sway, -0.035);
    } else {
      ctx.moveTo(-0.03, top + 0.012);
      ctx.quadraticCurveTo(0.02, top + 0.04, 0.06, top + 0.012);
    }
    ctx.stroke();
  }
  if (d.apron) {
    ctx.beginPath();
    ctx.moveTo(-0.01, SHOULDER + 0.06);
    ctx.lineTo(0.068, SHOULDER + 0.06);
    ctx.lineTo(0.075, HIP + 0.02);
    ctx.lineTo(0.085 + sway, look.robe ? -0.08 : -0.12);
    ctx.lineTo(-0.01, look.robe ? -0.07 : -0.11);
    ctx.lineTo(-0.02, HIP + 0.02);
    ctx.closePath();
    paint(ctx, d.apron, ink, p);
  }
  if (look.tabard) {
    ctx.beginPath();
    ctx.moveTo(-0.045, top + 0.005);
    ctx.lineTo(0.06, top + 0.005);
    ctx.lineTo(0.068, -0.12);
    ctx.lineTo(-0.04, -0.12);
    ctx.closePath();
    paint(ctx, d.field, ink);
    // The castle's charge: a cross of its other colour.
    if (!rim) {
      ctx.fillStyle = d.other;
      ctx.fillRect(0.0, top + 0.02, 0.022, 0.31);
      ctx.fillRect(-0.035, -0.4, 0.095, 0.022);
    }
    model(ctx, p);
  }
  // A belt, or a cord about a robe.
  const beltY = HIP + 0.02;
  ctx.strokeStyle = look.robe ? (d.trim ?? "#a8925c") : "#2e2116";
  ctx.lineWidth = look.robe ? 0.012 : 0.02;
  ctx.beginPath();
  ctx.moveTo(-0.068, beltY);
  ctx.lineTo(0.07, beltY);
  ctx.stroke();
  if (!look.robe && p.detail > 1) {
    ctx.fillStyle = "#c9a650";
    ctx.fillRect(0.035, beltY - 0.012, 0.02, 0.024);
  }
  // A strap across the chest for what is carried on the back.
  if (look.back !== "none" && look.back !== "quiver" && !p.back) {
    ctx.strokeStyle = "#3e2a1a";
    ctx.lineWidth = 0.014;
    ctx.beginPath();
    ctx.moveTo(-0.03, top + 0.005);
    ctx.lineTo(0.03, top + 0.12);
    ctx.stroke();
  } else if (look.back === "quiver" && !p.back) {
    ctx.strokeStyle = "#3e2a1a";
    ctx.lineWidth = 0.014;
    ctx.beginPath();
    ctx.moveTo(0.05, top + 0.005);
    ctx.lineTo(-0.05, beltY - 0.01);
    ctx.stroke();
  }
  // A purse at the belt, swelling with what it carries.
  if (look.carry === "belt" && p.fill > 0) purse(ctx, -0.035, beltY + 0.01, 0.022 + 0.022 * Math.sqrt(p.fill), p, ink);
  ctx.restore();
}

function armour(ctx: CanvasRenderingContext2D, kind: "plate" | "mail" | "leather", d: Dress, p: Pose, ink: string, hem: number): void {
  const top = SHOULDER - 0.02;
  if (kind === "plate") {
    // Pauldrons, the breastplate's ridge and its shine, and the faulds.
    // Pauldrons, over the shoulders the arms hang from.
    for (const x of [FAR_X, NEAR_X]) {
      ellipse(ctx, x / BROAD, SHOULDER + 0.002, 0.044, 0.036);
      paint(ctx, tone(d.sleeves, x < 0 ? 0.85 : 1.05), ink, p);
      glint(ctx, x / BROAD + lit * 0.015, SHOULDER - 0.014, 0.008, p);
    }
    if (p.detail > 1) {
      ctx.strokeStyle = shade(d.shirt, 1.35);
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      ctx.moveTo(0.03, top + 0.04);
      ctx.quadraticCurveTo(0.045, -0.38, 0.03, HIP + 0.04);
      ctx.stroke();
      ctx.strokeStyle = shade(d.shirt, 0.6);
      ctx.lineWidth = 0.008;
      for (const y of [HIP + 0.01, HIP + 0.04]) {
        ctx.beginPath();
        ctx.moveTo(-0.062, y);
        ctx.lineTo(0.066, y);
        ctx.stroke();
      }
    }
  } else if (kind === "mail") {
    if (p.detail > 1) {
      // Rings of mail as rows of little arcs.
      ctx.strokeStyle = rgba(shade(d.shirt, 0.55), 0.8);
      ctx.lineWidth = 0.006;
      for (let y = top + 0.035; y < hem - 0.01; y += 0.022) {
        ctx.beginPath();
        for (let x = -0.06; x < 0.07; x += 0.022) {
          ctx.moveTo(x, y);
          ctx.arc(x + 0.011, y, 0.011, Math.PI, 0, true);
        }
        ctx.stroke();
      }
    }
  } else {
    // A leather jerkin over the shirt, laced up the front.
    ctx.beginPath();
    ctx.moveTo(-0.07, SHOULDER + 0.035);
    ctx.lineTo(0.076, SHOULDER + 0.04);
    ctx.quadraticCurveTo(0.064, -0.4, 0.057, -0.33);
    ctx.quadraticCurveTo(0.059, -0.27, 0.067, HIP + 0.05);
    ctx.lineTo(-0.061, HIP + 0.05);
    ctx.quadraticCurveTo(-0.055, -0.29, -0.055, -0.33);
    ctx.quadraticCurveTo(-0.064, -0.4, -0.07, SHOULDER + 0.035);
    paint(ctx, "#5e4128", ink, p);
    if (p.detail > 1) {
      ctx.strokeStyle = "#2e1f12";
      ctx.lineWidth = 0.007;
      ctx.beginPath();
      for (let y = SHOULDER + 0.05; y < HIP + 0.02; y += 0.035) {
        ctx.moveTo(0.03, y);
        ctx.lineTo(0.05, y + 0.02);
        ctx.moveTo(0.05, y);
        ctx.lineTo(0.03, y + 0.02);
      }
      ctx.stroke();
    }
  }
}

function purse(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, p: Pose, ink: string): void {
  ctx.beginPath();
  ctx.moveTo(x - r * 0.4, y);
  ctx.quadraticCurveTo(x - r * 1.2, y + r * 1.6, x, y + r * 1.8);
  ctx.quadraticCurveTo(x + r * 1.2, y + r * 1.6, x + r * 0.4, y);
  ctx.closePath();
  paint(ctx, "#6b4a2e", ink);
  dot(ctx, x, y + r * 0.2, r * 0.35, p.goods);
}

// An arm from its shoulder, with what its hand holds: the hand is painted
// last, closed over the handle.
function arm(ctx: CanvasRenderingContext2D, sx: number, sy: number, pose: [number, number], d: Dress, ink: string, far: boolean, hold: () => void): void {
  const [ex, ey, hx, hy] = handAt(sx, sy, pose);
  limb(ctx, [sx, sy + 0.018, ex, ey, hx, hy], ARM_W, far ? tone(d.sleeves, 0.8) : d.sleeves, ink);
  ctx.save();
  ctx.translate(hx, hy);
  hold();
  ctx.restore();
  ellipse(ctx, hx, hy, 0.027, 0.027);
  paint(ctx, far ? tone(d.skin, 0.85) : d.skin, ink);
}

// What the near hand holds, painted about the hand.
function held(ctx: CanvasRenderingContext2D, tool: Tool, look: Look, d: Dress, p: Pose, ink: string): void {
  if (tool === "none" || tool === "lute") return;
  if (!UPRIGHT.has(tool)) ctx.rotate(-p.toolA);
  switch (tool) {
    case "hammer":
      limb(ctx, [0, -0.03, 0, 0.16], 0.02, WOOD, ink);
      ctx.beginPath();
      ctx.rect(-0.045, 0.15, 0.09, 0.045);
      paint(ctx, "#4c4f55", ink);
      break;
    case "mallet":
      limb(ctx, [0, -0.03, 0, 0.15], 0.02, WOOD, ink);
      ctx.beginPath();
      ctx.rect(-0.05, 0.14, 0.1, 0.06);
      paint(ctx, "#9a7448", ink);
      break;
    case "pickaxe":
      limb(ctx, [0, -0.04, 0, 0.2], 0.02, WOOD, ink);
      ctx.beginPath();
      ctx.moveTo(-0.1, 0.16);
      ctx.quadraticCurveTo(0, 0.2, 0.1, 0.16);
      ctx.quadraticCurveTo(0, 0.235, -0.1, 0.16);
      paint(ctx, "#5d6066", ink);
      break;
    case "axe":
    case "greataxe": {
      const big = tool === "greataxe";
      const len = big ? 0.3 : 0.2;
      limb(ctx, [0, -0.04, 0, len], 0.022, WOOD, ink);
      const blade = (s: number) => {
        ctx.beginPath();
        ctx.moveTo(0, len - 0.09);
        ctx.quadraticCurveTo(s * 0.11, len - 0.13, s * 0.1, len - 0.05);
        ctx.quadraticCurveTo(s * 0.12, len + 0.03, 0, len);
        ctx.closePath();
        paint(ctx, STEEL, ink);
        glint(ctx, s * 0.075, len - 0.06, 0.012, p);
      };
      blade(-1);
      if (big) blade(1);
      break;
    }
    case "maul":
      limb(ctx, [0, -0.06, 0, 0.3], 0.024, WOOD, ink);
      ctx.beginPath();
      ctx.rect(-0.06, 0.27, 0.12, 0.075);
      paint(ctx, "#4c4f55", ink);
      break;
    case "club":
      ctx.beginPath();
      ctx.moveTo(-0.014, -0.03);
      ctx.lineTo(0.014, -0.03);
      ctx.quadraticCurveTo(0.05, 0.18, 0.035, 0.27);
      ctx.quadraticCurveTo(0, 0.31, -0.04, 0.26);
      ctx.quadraticCurveTo(-0.045, 0.17, -0.014, -0.03);
      paint(ctx, "#6a4a2a", ink);
      if (p.detail > 1) {
        dot(ctx, 0.02, 0.2, 0.008, "#3e2a16");
        dot(ctx, -0.02, 0.24, 0.008, "#3e2a16");
      }
      break;
    case "flail":
      limb(ctx, [0, -0.03, 0, 0.12], 0.02, WOOD, ink);
      ctx.strokeStyle = "#5d6066";
      ctx.lineWidth = 0.008;
      ctx.beginPath();
      ctx.moveTo(0, 0.12);
      ctx.lineTo(0.03, 0.2);
      ctx.stroke();
      ellipse(ctx, 0.035, 0.22, 0.03, 0.03);
      paint(ctx, "#4c4f55", ink);
      break;
    case "sword":
    case "greatsword": {
      const len = tool === "sword" ? 0.25 : 0.36;
      limb(ctx, [0, -0.035, 0, 0.03], 0.018, "#3e2a1a", ink);
      dot(ctx, 0, -0.045, 0.014, "#c9a650");
      ctx.beginPath();
      ctx.moveTo(-0.022, 0.035);
      ctx.lineTo(0.022, 0.035);
      ctx.lineTo(0.016, len);
      ctx.lineTo(0, len + 0.04);
      ctx.lineTo(-0.016, len);
      ctx.closePath();
      paint(ctx, "#c9d0d8", ink);
      if (p.detail > 1) {
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = 0.006;
        ctx.beginPath();
        ctx.moveTo(-0.004, 0.05);
        ctx.lineTo(-0.004, len);
        ctx.stroke();
      }
      limb(ctx, [-0.05, 0.03, 0.05, 0.03], 0.016, "#c9a650", ink);
      break;
    }
    case "dagger":
      limb(ctx, [0, -0.025, 0, 0.02], 0.016, "#2e2116", ink);
      ctx.beginPath();
      ctx.moveTo(-0.014, 0.025);
      ctx.lineTo(0.014, 0.025);
      ctx.lineTo(0, 0.13);
      ctx.closePath();
      paint(ctx, "#c9d0d8", ink);
      glint(ctx, -0.003, 0.05, 0.007, p);
      break;
    case "chisel":
      limb(ctx, [0, -0.03, 0, 0.07], 0.012, "#8d939b", ink);
      break;
    case "staff":
    case "orb-staff":
    case "skull-staff":
      staff(ctx, tool, look, p, ink);
      break;
    case "banner": {
      limb(ctx, [0, -0.25, 0, 0.52], 0.016, WOOD, ink);
      dot(ctx, 0, 0.53, 0.016, "#e0b44a");
      // The flag flies back from the pole, the way the wind of walking takes it.
      ctx.save();
      ctx.translate(0, 0.49);
      ctx.rotate(p.toolA);
      ctx.scale(-1, 1);
      flag(ctx, 0.28, d, p, ink, p.seed);
      ctx.restore();
      break;
    }
    case "lance": {
      ctx.beginPath();
      ctx.moveTo(-0.018, -0.25);
      ctx.lineTo(0.018, -0.25);
      ctx.lineTo(0.008, 0.62);
      ctx.lineTo(-0.008, 0.62);
      ctx.closePath();
      paint(ctx, "#b08a5a", ink);
      ctx.beginPath();
      ctx.moveTo(-0.016, 0.62);
      ctx.lineTo(0, 0.72);
      ctx.lineTo(0.016, 0.62);
      ctx.closePath();
      paint(ctx, STEEL, ink);
      // A vamplate over the hand.
      ctx.beginPath();
      ctx.moveTo(-0.045, 0.05);
      ctx.lineTo(0.045, 0.05);
      ctx.lineTo(0.012, -0.03);
      ctx.lineTo(-0.012, -0.03);
      ctx.closePath();
      paint(ctx, STEEL, ink);
      ctx.save();
      ctx.translate(0, 0.58);
      ctx.rotate(p.toolA);
      ctx.scale(-1, 1);
      flag(ctx, 0.14, d, p, ink, p.seed + 1);
      ctx.restore();
      break;
    }
    case "trident":
      limb(ctx, [0, -0.25, 0, 0.42], 0.018, "#8a6a3a", ink);
      ctx.beginPath();
      ctx.moveTo(-0.045, 0.5);
      ctx.lineTo(-0.045, 0.42);
      ctx.lineTo(0.045, 0.42);
      ctx.lineTo(0.045, 0.5);
      ctx.moveTo(0, 0.42);
      ctx.lineTo(0, 0.53);
      rod(ctx, 0.014, "#c0c6cc", ink);
      break;
    case "longbow":
      bow(ctx, p, ink);
      break;
    case "tankard":
      tankard(ctx, p, ink);
      break;
    case "potion":
      flask(ctx, 0, -0.03, 0.03, "#8cff6b", ink);
      break;
    case "scroll":
      scroll(ctx, ink);
      break;
    case "censer":
      censer(ctx, p, ink);
      break;
  }
}

// The castle's pennant flying from the pole's head, ringed in ink like the rest.
function flag(ctx: CanvasRenderingContext2D, length: number, d: Dress, p: Pose, ink: string, seed: number): void {
  if (!rim) {
    pennant(ctx, 0, 0, length, d.field, d.other, p.now, seed);
    return;
  }
  pennant(ctx, 0, 0, length, ink, ink, p.now, seed);
  ctx.lineWidth = rim * 2;
  ctx.stroke();
}

function staff(ctx: CanvasRenderingContext2D, tool: Tool, look: Look, p: Pose, ink: string): void {
  const glow = look.glow?.colour ?? "#c9a0ff";
  if (tool === "skull-staff") {
    // A gnarled black staff with a skull for its head.
    ctx.beginPath();
    ctx.moveTo(0, -0.26);
    ctx.quadraticCurveTo(0.02, 0, -0.01, 0.15);
    ctx.quadraticCurveTo(0.02, 0.28, 0, 0.34);
    rod(ctx, 0.024, "#3a2e26", ink);
    ctx.save();
    ctx.translate(0, 0.37);
    ctx.rotate(p.toolA);
    ellipse(ctx, 0, -0.005, 0.036, 0.034);
    paint(ctx, "#e6dcc4", ink);
    ctx.beginPath();
    ctx.rect(-0.02, 0.02, 0.04, 0.02);
    paint(ctx, "#d8ccb0", ink);
    dot(ctx, -0.012, 0.0, 0.009, glow);
    dot(ctx, 0.012, 0.0, 0.009, glow);
    ctx.restore();
    return;
  }
  limb(ctx, [0, -0.27, 0, 0.36], 0.018, tool === "orb-staff" ? "#5a3a20" : "#8a6a3a", ink);
  if (tool === "orb-staff") {
    // Prongs cradling a crystal orb, alight from within.
    ctx.strokeStyle = "#c9a650";
    ctx.lineWidth = 0.01;
    ctx.beginPath();
    ctx.moveTo(-0.03, 0.4);
    ctx.quadraticCurveTo(-0.03, 0.36, 0, 0.35);
    ctx.quadraticCurveTo(0.03, 0.36, 0.03, 0.4);
    ctx.stroke();
    const pulse = 0.8 + 0.2 * Math.sin(p.now / 300 + p.seed);
    ellipse(ctx, 0, 0.42, 0.034, 0.034);
    paint(ctx, glow, ink);
    dot(ctx, -0.01, 0.43, 0.012, "rgba(255,255,255,0.85)");
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.35 * pulse;
    dot(ctx, 0, 0.42, 0.075, glow);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  } else {
    dot(ctx, 0, 0.37, 0.018, "#6a4a2a");
  }
}

// A longbow held upright by its grip: the belly towards the mark, the
// string pulled back to the cheek as it draws, an arrow on it.
function bow(ctx: CanvasRenderingContext2D, p: Pose, ink: string): void {
  // In the bow's frame +x points back towards the archer's body.
  const pull = 0.13 * p.drawn;
  ctx.strokeStyle = "rgba(230,220,200,0.9)";
  ctx.lineWidth = 0.006;
  ctx.beginPath();
  ctx.moveTo(0.01, -0.3);
  ctx.lineTo(0.01 + pull, 0);
  ctx.lineTo(0.01, 0.3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.01, -0.3);
  ctx.quadraticCurveTo(-0.12 - p.drawn * 0.03, 0, 0.01, 0.3);
  rod(ctx, 0.022, "#7a5028", ink);
  if (p.drawn > 0.05) {
    limb(ctx, [0.01 + pull, 0, -0.1, 0], 0.008, "#c9b08a", ink);
    ctx.beginPath();
    ctx.moveTo(-0.1, -0.012);
    ctx.lineTo(-0.125, 0);
    ctx.lineTo(-0.1, 0.012);
    ctx.fillStyle = "#c0c6cc";
    ctx.fill();
  }
}

function tankard(ctx: CanvasRenderingContext2D, p: Pose, ink: string): void {
  ctx.beginPath();
  ctx.arc(-0.03, -0.035, 0.018, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.012;
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(-0.024, -0.065, 0.05, 0.065);
  paint(ctx, "#8d8a84", ink, p);
  ctx.strokeStyle = "#5d5a54";
  ctx.lineWidth = 0.008;
  ctx.beginPath();
  ctx.moveTo(-0.024, -0.02);
  ctx.lineTo(0.026, -0.02);
  ctx.stroke();
  ellipse(ctx, 0.001, -0.068, 0.03, 0.014);
  paint(ctx, "#f4ecd8", ink);
}

function flask(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string, ink: string): void {
  ctx.beginPath();
  ctx.rect(x - r * 0.35, y - r * 1.9, r * 0.7, r);
  paint(ctx, "#cfd8d4", ink);
  ellipse(ctx, x, y, r, r);
  paint(ctx, "#cfd8d4", ink);
  ellipse(ctx, x, y + r * 0.2, r * 0.8, r * 0.7);
  ctx.fillStyle = colour;
  ctx.fill();
  dot(ctx, x - r * 0.35, y - r * 0.3, r * 0.22, "rgba(255,255,255,0.8)");
  ctx.fillStyle = "#7a5530";
  ctx.fillRect(x - r * 0.3, y - r * 2.3, r * 0.6, r * 0.45);
}

function scroll(ctx: CanvasRenderingContext2D, ink: string): void {
  ctx.beginPath();
  ctx.rect(-0.05, -0.02, 0.1, 0.035);
  paint(ctx, "#e8dcb8", ink);
  dot(ctx, 0, 0.0, 0.012, "#a82a2a");
}

// A censer swung on its chain, sweet smoke rising from it.
function censer(ctx: CanvasRenderingContext2D, p: Pose, ink: string): void {
  const a = p.swing;
  const x = Math.sin(a) * 0.13;
  const y = Math.cos(a) * 0.13;
  ctx.strokeStyle = "#8a7440";
  ctx.lineWidth = 0.006;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y + 0.012, 0.03, 0, Math.PI);
  ctx.closePath();
  paint(ctx, "#c9a650", ink);
  ctx.beginPath();
  ctx.moveTo(x - 0.03, y + 0.012);
  ctx.quadraticCurveTo(x, y - 0.03, x + 0.03, y + 0.012);
  paint(ctx, "#a8863a", ink);
  if (p.detail > 1 && !rim) smoke(ctx, x, y - 0.02, p.now, p.seed, "#d8d0c4", 0.12);
}

// The lute is held across the body, the near hand strumming at its belly and
// the far hand stopping the strings up its neck.
function lute(ctx: CanvasRenderingContext2D, p: Pose, ink: string): void {
  ctx.save();
  ctx.translate(0.035, -0.355);
  ctx.rotate(-0.55);
  limb(ctx, [0, 0, -0.17, 0], 0.024, "#5a3a1e", ink);
  ctx.beginPath();
  ctx.moveTo(-0.17, 0.0);
  ctx.lineTo(-0.2, 0.03);
  ctx.strokeStyle = "#5a3a1e";
  ctx.lineWidth = 0.022;
  ctx.stroke();
  ellipse(ctx, 0.02, 0, 0.068, 0.05);
  paint(ctx, "#b07a3a", ink, p);
  dot(ctx, 0.0, 0.0, 0.016, "#3a2412");
  if (p.detail > 1) {
    ctx.strokeStyle = "rgba(240,230,200,0.7)";
    ctx.lineWidth = 0.003;
    ctx.beginPath();
    for (const y of [-0.008, 0, 0.008]) {
      ctx.moveTo(0.06, y);
      ctx.lineTo(-0.17, y * 0.6);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// What the far hand carries, painted about the hand; or for a shield, on the
// far arm in front of the body (see shield).
function offItem(ctx: CanvasRenderingContext2D, off: Off, look: Look, p: Pose, ink: string): void {
  switch (off) {
    case "buckler":
      ellipse(ctx, 0.01, 0, 0.05, 0.05);
      paint(ctx, "#8d939b", ink, p);
      dot(ctx, 0.01, 0, 0.016, "#c9d0d8");
      break;
    case "lantern": {
      // Hung from a ring, swaying, its candle lit after dark.
      const sway = Math.sin(p.now / 520 + p.seed) * 0.15;
      ctx.rotate(sway);
      ctx.strokeStyle = "#3d3f44";
      ctx.lineWidth = 0.008;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 0.04);
      ctx.stroke();
      ctx.beginPath();
      ctx.rect(-0.026, 0.04, 0.052, 0.07);
      paint(ctx, p.lit ? "#ffd27a" : "#6a6050", ink);
      if (p.lit) {
        dot(ctx, 0, 0.078, 0.014, "#fff2c0");
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.5;
        dot(ctx, 0, 0.075, 0.07, "#ffb24a");
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.strokeStyle = "#2e2a26";
      ctx.lineWidth = 0.008;
      ctx.beginPath();
      ctx.moveTo(0, 0.04);
      ctx.lineTo(0, 0.11);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-0.034, 0.04);
      ctx.lineTo(0, 0.02);
      ctx.lineTo(0.034, 0.04);
      ctx.closePath();
      paint(ctx, "#3d3f44", ink);
      break;
    }
    case "torch": {
      limb(ctx, [0, 0.05, 0.02, -0.16], 0.02, "#5a3a1e", ink);
      ellipse(ctx, 0.021, -0.17, 0.022, 0.028);
      paint(ctx, "#3a2a1e", ink);
      if (p.lit && !rim) flame(ctx, 0.021, -0.17, 0.13, p.now, p.seed);
      break;
    }
    case "potion":
      flask(ctx, 0, 0.0, 0.026, "#ff6a8a", ink);
      break;
    case "scroll":
      scroll(ctx, ink);
      break;
    case "gold-sack": {
      const r = 0.035 + 0.035 * Math.sqrt(look.carry === "off" ? p.fill : 0.3);
      sack(ctx, 0, 0.02 + r, r, BURLAP, p, ink);
      break;
    }
    case "gems": {
      // A few stones in the palm, glinting the colour of what it carries.
      const colour = p.fill > 0 ? p.goods : "#9fd8ff";
      const n = 1 + Math.round(p.fill * 3);
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * 0.022;
        ctx.beginPath();
        ctx.moveTo(x, -0.04);
        ctx.lineTo(x + 0.013, -0.025);
        ctx.lineTo(x, -0.01);
        ctx.lineTo(x - 0.013, -0.025);
        ctx.closePath();
        paint(ctx, colour, ink);
      }
      break;
    }
  }
  // What a carrier holds in the hand: a sack that swells as it fills.
  if (off === "none" && look.carry === "hand" && p.fill > 0) {
    const r = 0.03 + 0.035 * Math.sqrt(p.fill);
    sack(ctx, 0, 0.02 + r, r, "#c9b48a", p, ink);
  }
}

function sack(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string, p: Pose, ink: string): void {
  ctx.beginPath();
  ctx.moveTo(x - r * 0.35, y - r * 1.05);
  ctx.quadraticCurveTo(x - r * 1.25, y - r * 0.6, x - r * 1.05, y + r * 0.4);
  ctx.quadraticCurveTo(x, y + r * 1.2, x + r * 1.05, y + r * 0.4);
  ctx.quadraticCurveTo(x + r * 1.25, y - r * 0.6, x + r * 0.35, y - r * 1.05);
  ctx.closePath();
  paint(ctx, colour, ink, p);
  // The neck tied off, the goods glinting at its mouth.
  if (p.fill > 0) dot(ctx, x, y - r * 1.02, r * 0.38, p.goods);
  ctx.strokeStyle = "#4a3220";
  ctx.lineWidth = 0.01;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.4, y - r * 0.85);
  ctx.lineTo(x + r * 0.4, y - r * 0.85);
  ctx.stroke();
}

// A shield on the far arm, held before the body.
function shield(ctx: CanvasRenderingContext2D, off: Off, d: Dress, p: Pose, ink: string): void {
  const [, , hx, hy] = handAt(FAR_X, SHOULDER, p.far);
  const x = p.back ? hx - 0.07 : hx - 0.035;
  const y = hy + 0.02;
  // Drawn to the old measure, grown to cover the broader body.
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1.22, 1.22);
  if (off === "kite-shield") {
    ctx.beginPath();
    ctx.moveTo(-0.075, -0.1);
    ctx.quadraticCurveTo(0, -0.13, 0.075, -0.1);
    ctx.quadraticCurveTo(0.075, 0.04, 0, 0.16);
    ctx.quadraticCurveTo(-0.075, 0.04, -0.075, -0.1);
    ctx.closePath();
    paint(ctx, p.back ? "#6a4a2e" : d.field, ink);
    if (!p.back && !rim) {
      // The castle's charge, and the rim's gilt.
      ctx.fillStyle = d.other;
      ctx.fillRect(-0.012, -0.1, 0.024, 0.23);
      ctx.fillRect(-0.06, -0.05, 0.12, 0.024);
      ctx.strokeStyle = "#c9a650";
      ctx.lineWidth = 0.01;
      ctx.stroke();
    }
    model(ctx, p);
  } else {
    ellipse(ctx, 0, 0, 0.09, 0.09);
    paint(ctx, "#7a5530", ink);
    if (!p.back && !rim) {
      ctx.strokeStyle = d.field;
      ctx.lineWidth = 0.02;
      ellipse(ctx, 0, 0, 0.065, 0.065);
      ctx.stroke();
    }
    ellipse(ctx, 0, 0, 0.09, 0.09);
    model(ctx, p);
    if (!p.back) {
      ellipse(ctx, 0, 0, 0.025, 0.025);
      paint(ctx, STEEL, ink);
      glint(ctx, lit * 0.008, -0.008, 0.007, p);
    }
  }
  ctx.restore();
}

// What is carried on the back. From the front it peeks out behind the body;
// from behind it is painted over it, `dx` towards the middle of the back.
function backItem(ctx: CanvasRenderingContext2D, back: Back, look: Look, p: Pose, ink: string, dx: number): void {
  const fill = look.carry === "back" ? p.fill : 0;
  const x = -0.105 + dx;
  switch (back) {
    case "sack":
    case "loot": {
      const r = 0.055 + 0.05 * Math.sqrt(fill);
      if (back === "loot" && fill > 0.2) {
        // A candlestick and a goblet poking out of the swag.
        limb(ctx, [x - 0.01, -0.42 - r, x - 0.03, -0.5 - r], 0.012, "#e0b44a", ink);
        ellipse(ctx, x + 0.02, -0.46 - r, 0.02, 0.012);
        paint(ctx, "#e0b44a", ink);
      }
      sack(ctx, x, -0.4, r, back === "loot" ? "#5a4a3a" : BURLAP, { ...p, fill }, ink);
      break;
    }
    case "pack": {
      ctx.beginPath();
      ctx.rect(x - 0.06, -0.52, 0.11, 0.18);
      paint(ctx, "#6b4a2e", ink, p);
      // A rolled blanket on top.
      ellipse(ctx, x - 0.005, -0.535, 0.07, 0.028);
      paint(ctx, "#7a3a2a", ink);
      break;
    }
    case "big-pack": {
      // Wares lashed high: a chest, a roll of carpet and a cooking pot.
      const h = 0.36 + 0.1 * fill;
      ctx.beginPath();
      ctx.rect(x - 0.08, -0.25 - h, 0.15, h);
      paint(ctx, "#7a5530", ink, p);
      ctx.strokeStyle = "#3e2a1a";
      ctx.lineWidth = 0.01;
      ctx.beginPath();
      ctx.moveTo(x - 0.08, -0.4);
      ctx.lineTo(x + 0.07, -0.4);
      ctx.moveTo(x - 0.08, -0.25 - h * 0.75);
      ctx.lineTo(x + 0.07, -0.25 - h * 0.75);
      ctx.stroke();
      ellipse(ctx, x - 0.005, -0.27 - h, 0.09, 0.03);
      paint(ctx, "#8a2f2a", ink);
      ctx.beginPath();
      ctx.arc(x + 0.06, -0.32, 0.035, 0, Math.PI);
      ctx.closePath();
      paint(ctx, "#3d3f44", ink);
      if (fill > 0) dot(ctx, x - 0.02, -0.3 - h * 0.5, 0.025, p.goods);
      break;
    }
    case "hod": {
      // A mason's hod on the shoulder, heaped with what it carries.
      ctx.save();
      ctx.translate(x - 0.035, -0.58);
      ctx.rotate(-0.6);
      limb(ctx, [0, 0.0, 0, 0.3], 0.016, WOOD, ink);
      ctx.beginPath();
      ctx.moveTo(-0.07, -0.04);
      ctx.lineTo(0.07, -0.04);
      ctx.lineTo(0.05, 0.05);
      ctx.lineTo(-0.05, 0.05);
      ctx.closePath();
      paint(ctx, "#8a6a3a", ink, p);
      const heap = fill > 0 ? p.goods : "#9a5a3a";
      ctx.beginPath();
      ctx.moveTo(-0.065, -0.04);
      ctx.quadraticCurveTo(0, -0.04 - 0.03 - 0.05 * (fill > 0 ? fill : 0.4), 0.065, -0.04);
      ctx.closePath();
      paint(ctx, heap, ink);
      ctx.restore();
      break;
    }
    case "basket": {
      ctx.beginPath();
      ctx.moveTo(x - 0.07, -0.5);
      ctx.lineTo(x + 0.06, -0.5);
      ctx.lineTo(x + 0.045, -0.33);
      ctx.lineTo(x - 0.055, -0.33);
      ctx.closePath();
      paint(ctx, "#a8844a", ink, p);
      if (p.detail > 1) {
        ctx.strokeStyle = "#6e5228";
        ctx.lineWidth = 0.006;
        ctx.beginPath();
        for (let y = -0.47; y < -0.34; y += 0.03) {
          ctx.moveTo(x - 0.065, y);
          ctx.lineTo(x + 0.055, y);
        }
        ctx.stroke();
      }
      if (fill > 0) {
        ctx.beginPath();
        ctx.moveTo(x - 0.068, -0.5);
        ctx.quadraticCurveTo(x - 0.005, -0.5 - 0.1 * fill, x + 0.058, -0.5);
        ctx.closePath();
        paint(ctx, p.goods, ink);
      }
      break;
    }
    case "quiver": {
      ctx.save();
      ctx.translate(x + 0.02, -0.41);
      ctx.rotate(0.35);
      ctx.beginPath();
      ctx.rect(-0.025, -0.14, 0.05, 0.2);
      paint(ctx, "#5e4128", ink, p);
      for (const fx of [-0.014, 0, 0.014]) {
        limb(ctx, [fx, -0.14, fx, -0.19], 0.005, "#c9b08a", ink);
        ctx.beginPath();
        ctx.moveTo(fx, -0.2);
        ctx.lineTo(fx - 0.01, -0.17);
        ctx.lineTo(fx + 0.01, -0.17);
        ctx.closePath();
        ctx.fillStyle = "#e8e0d0";
        ctx.fill();
      }
      ctx.restore();
      break;
    }
    case "bundle": {
      ellipse(ctx, x + 0.01, -0.47, 0.08, 0.04);
      paint(ctx, "#8a7a5a", ink, p);
      ctx.strokeStyle = "#3e2a1a";
      ctx.lineWidth = 0.01;
      ctx.beginPath();
      ctx.moveTo(x - 0.03, -0.51);
      ctx.lineTo(x - 0.03, -0.43);
      ctx.moveTo(x + 0.05, -0.51);
      ctx.lineTo(x + 0.05, -0.43);
      ctx.stroke();
      break;
    }
  }
}

// The head: what lies behind it (long hair, a hood's mass), the head itself
// or a helm, then the face and what is worn over it.
function head(ctx: CanvasRenderingContext2D, look: Look, d: Dress, p: Pose, ink: string): void {
  const hx = 0.008;
  const hy = HEAD;
  const r = HEAD_R;
  const hat = look.hat;
  const hooded = hat === "hood" || hat === "mask-hood" || hat === "coif";
  const helmed = hat === "plume-helm" || hat === "crown-helm";

  // Helms are drawn to a fixed measure, grown here to fit the head.
  const fitted = (fn: () => void) => {
    ctx.save();
    ctx.translate(hx, hy);
    ctx.scale(r / 0.093, r / 0.093);
    ctx.translate(-hx, -hy);
    fn();
    ctx.restore();
  };
  if (hat === "plume-helm") fitted(() => plume(ctx, hx, hy, d.hat, p, ink));
  if (hooded) {
    // The hood's mass behind the head, falling onto the shoulders.
    ctx.beginPath();
    ctx.moveTo(hx - r * 1.35, hy + r * 1.3);
    ctx.quadraticCurveTo(hx - r * 1.5, hy - r * 1.4, hx + r * 0.1, hy - r * 1.32);
    ctx.quadraticCurveTo(hx + r * 1.35, hy - r * 1.2, hx + r * 1.15, hy + r * 0.6);
    ctx.lineTo(hx + r * 0.9, hy + r * 1.3);
    ctx.closePath();
    paint(ctx, d.hat, ink, p);
  } else if (d.hair && d.long && !helmed) {
    ctx.beginPath();
    ctx.moveTo(hx - r * 0.2, hy - r);
    ctx.quadraticCurveTo(hx - r * 1.4, hy - r * 0.6, hx - r * 1.2, hy + r * 1.5);
    ctx.lineTo(hx - r * 0.1, hy + r * 1.2);
    ctx.closePath();
    paint(ctx, d.hair, ink, p);
  }

  if (helmed) {
    fitted(() => helm(ctx, look, hx, hy, d, p, ink));
    return;
  }

  // The head, the face a little forward of it. Left unmodelled like the
  // hands: the wash's edge would part the face down the middle, and crawl
  // across it as the figure walks.
  if (hooded) ellipse(ctx, hx + r * 0.22, hy + r * 0.08, r * 0.8, r * 0.86);
  else ellipse(ctx, hx, hy, r, r * 1.03);
  paint(ctx, d.skin, ink);

  if (look.ears === "pointed" && !hooded) {
    for (const s of p.back ? [-1, 1] : [-1]) {
      ctx.beginPath();
      ctx.moveTo(hx + s * r * 0.8, hy - r * 0.15);
      ctx.lineTo(hx + s * r * 2.0, hy - r * 0.75);
      ctx.lineTo(hx + s * r * 0.85, hy + r * 0.35);
      ctx.closePath();
      paint(ctx, d.skin, ink);
    }
  }

  // Cropped hair over the crown and the back of the head; from behind it
  // covers the head.
  const capped = hat === "turban" || hat === "galea" || hat === "kettle" || hat === "miner";
  if (d.hair && !hooded && !capped) {
    ctx.beginPath();
    if (p.back) {
      ctx.arc(hx, hy, r * 1.04, Math.PI * 0.95, Math.PI * 2.05);
      ctx.quadraticCurveTo(hx + r, hy + r * (d.long ? 1.5 : 0.8), hx, hy + r * (d.long ? 1.4 : 0.9));
      ctx.quadraticCurveTo(hx - r, hy + r * (d.long ? 1.5 : 0.8), hx - r * 1.03, hy - r * 0.05);
    } else {
      ctx.moveTo(hx + r * 0.75, hy - r * 0.62);
      ctx.quadraticCurveTo(hx + r * 0.2, hy - r * 1.35, hx - r * 0.75, hy - r * 0.75);
      ctx.quadraticCurveTo(hx - r * 1.15, hy - r * 0.1, hx - r * 0.7, hy + r * 0.55);
      ctx.quadraticCurveTo(hx - r * 0.35, hy - r * 0.2, hx + r * 0.0, hy - r * 0.45);
      ctx.quadraticCurveTo(hx + r * 0.45, hy - r * 0.6, hx + r * 0.75, hy - r * 0.62);
    }
    ctx.closePath();
    paint(ctx, d.hair, ink, p);
  }

  if (!p.back) face(ctx, look, d, p, ink, hooded ? hx + r * 0.22 : hx, hooded ? hy + r * 0.08 : hy, hooded ? r * 0.82 : r);
  hatOver(ctx, look, hx, hy, r, d, p, ink);
}

function face(ctx: CanvasRenderingContext2D, look: Look, d: Dress, p: Pose, ink: string, hx: number, hy: number, r: number): void {
  if (d.beard) {
    // Along the jaw from below the ear to the chin, the mouth left bare.
    const long = d.longBeard ? 1.85 : 1.15;
    ctx.beginPath();
    ctx.moveTo(hx - r * 0.1, hy + r * 0.3);
    ctx.quadraticCurveTo(hx - r * 0.05, hy + r * long, hx + r * 0.55, hy + r * long);
    ctx.quadraticCurveTo(hx + r * 0.95, hy + r * 0.8, hx + r * 0.95, hy + r * 0.45);
    ctx.quadraticCurveTo(hx + r * 0.6, hy + r * 0.6, hx + r * 0.3, hy + r * 0.5);
    ctx.closePath();
    paint(ctx, d.beard, ink, p);
  }
  if (look.tusks) {
    for (const x of [0.45, 0.8]) {
      ctx.beginPath();
      ctx.moveTo(hx + r * x - r * 0.1, hy + r * 0.6);
      ctx.lineTo(hx + r * x, hy + r * 0.15);
      ctx.lineTo(hx + r * x + r * 0.12, hy + r * 0.6);
      ctx.closePath();
      paint(ctx, "#f0e6c8", ink);
    }
  }
  if (p.detail < 2) return;
  // The nose and the eyes, turned towards the way it faces.
  ellipse(ctx, hx + r * 1.0, hy + r * 0.12, r * 0.17, r * 0.15);
  ctx.fillStyle = shade(d.skin, 0.88);
  ctx.fill();
  const eye = look.eyes ?? "#1d1712";
  const er = look.eyes ? r * 0.15 : r * 0.11;
  dot(ctx, hx + r * 0.42, hy - r * 0.05, er, eye);
  dot(ctx, hx + r * 0.8, hy - r * 0.04, er * 0.9, eye);
  if (look.eyes) {
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.6;
    dot(ctx, hx + r * 0.6, hy - r * 0.05, r * 0.5, look.eyes);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}

function plume(ctx: CanvasRenderingContext2D, hx: number, hy: number, colour: string, p: Pose, ink: string): void {
  const wave = Math.sin(p.now / 380 + p.seed) * 0.012;
  ctx.beginPath();
  ctx.moveTo(hx + 0.01, hy - 0.1);
  ctx.quadraticCurveTo(hx - 0.04, hy - 0.2, hx - 0.15 + wave, hy - 0.08);
  ctx.quadraticCurveTo(hx - 0.08, hy - 0.11, hx - 0.03, hy - 0.06);
  ctx.closePath();
  paint(ctx, colour, ink);
}

// A great helm closed over the face: a slit to see by, through which glowing
// eyes show; a crown of spikes about the dark lord's.
function helm(ctx: CanvasRenderingContext2D, look: Look, hx: number, hy: number, d: Dress, p: Pose, ink: string): void {
  const colour = look.hat === "plume-helm" ? "#aeb6bf" : d.hat;
  if (look.hat === "crown-helm") {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const x = hx - 0.075 + i * 0.0375;
      ctx.moveTo(x - 0.016, hy - 0.08);
      ctx.lineTo(x, hy - 0.16 - (i === 2 ? 0.035 : 0));
      ctx.lineTo(x + 0.016, hy - 0.08);
    }
    paint(ctx, shade(colour, 1.2), ink);
  }
  ctx.beginPath();
  ctx.moveTo(hx - 0.092, hy + 0.07);
  ctx.quadraticCurveTo(hx - 0.105, hy - 0.115, hx, hy - 0.112);
  ctx.quadraticCurveTo(hx + 0.108, hy - 0.11, hx + 0.1, hy + 0.05);
  ctx.quadraticCurveTo(hx + 0.07, hy + 0.1, hx - 0.092, hy + 0.07);
  ctx.closePath();
  paint(ctx, colour, ink, p);
  glint(ctx, hx + lit * 0.045, hy - 0.07, 0.012, p);
  if (p.back) return;
  ctx.strokeStyle = "#0e0c10";
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  ctx.moveTo(hx + 0.015, hy - 0.01);
  ctx.lineTo(hx + 0.1, hy - 0.016);
  ctx.stroke();
  if (look.eyes) {
    dot(ctx, hx + 0.045, hy - 0.012, 0.011, look.eyes);
    dot(ctx, hx + 0.08, hy - 0.013, 0.01, look.eyes);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.55;
    dot(ctx, hx + 0.062, hy - 0.012, 0.04, look.eyes);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
  if (p.detail > 1) {
    // Breaths pierced below the slit, and the ridge down the middle.
    ctx.fillStyle = "#1a181c";
    for (let i = 0; i < 3; i++) ctx.fillRect(hx + 0.05 + i * 0.016, hy + 0.025, 0.007, 0.022);
    ctx.strokeStyle = rgba("#ffffff", 0.35);
    ctx.lineWidth = 0.008;
    ctx.beginPath();
    ctx.moveTo(hx + 0.03, hy - 0.1);
    ctx.quadraticCurveTo(hx + 0.07, hy - 0.06, hx + 0.075, hy - 0.03);
    ctx.stroke();
  }
}

// What is worn on the head, over the hair.
function hatOver(ctx: CanvasRenderingContext2D, look: Look, hx: number, hy: number, r: number, d: Dress, p: Pose, ink: string): void {
  const c = d.hat;
  switch (look.hat) {
    case "hood":
    case "coif":
    case "mask-hood": {
      // The hood's rim about the face.
      ctx.beginPath();
      ctx.moveTo(hx + r * 1.05, hy + r * 0.85);
      ctx.quadraticCurveTo(hx + r * 1.35, hy - r * 1.1, hx + r * 0.1, hy - r * 1.05);
      ctx.quadraticCurveTo(hx - r * 0.65, hy - r * 0.9, hx - r * 0.55, hy + r * 0.4);
      ctx.quadraticCurveTo(hx - r * 0.75, hy - r * 1.25, hx + r * 0.1, hy - r * 1.32);
      ctx.quadraticCurveTo(hx + r * 1.55, hy - r * 1.2, hx + r * 1.05, hy + r * 0.85);
      ctx.closePath();
      paint(ctx, shade(c, look.hat === "coif" ? 0.95 : 0.85), ink);
      if (look.hat === "mask-hood" && !p.back) {
        // A cloth over the mouth and nose: only the eyes show.
        ctx.beginPath();
        ctx.moveTo(hx - r * 0.35, hy + r * 0.05);
        ctx.lineTo(hx + r * 1.2, hy + r * 0.0);
        ctx.quadraticCurveTo(hx + r * 1.1, hy + r * 0.85, hx + r * 0.3, hy + r * 0.95);
        ctx.closePath();
        paint(ctx, shade(c, 1.2), ink);
      }
      break;
    }
    case "cap":
      ctx.beginPath();
      ctx.arc(hx, hy - r * 0.05, r * 1.06, Math.PI * 1.02, Math.PI * 1.98);
      ctx.closePath();
      paint(ctx, c, ink, p);
      ellipse(ctx, hx + r * 0.85, hy - r * 0.25, r * 0.6, r * 0.18);
      paint(ctx, shade(c, 0.8), ink);
      break;
    case "feather-cap": {
      // A soft cap worn at a slant, a feather sweeping back from it.
      const wave = Math.sin(p.now / 450 + p.seed) * 0.01;
      ctx.beginPath();
      ctx.moveTo(hx - r * 0.2, hy - r * 0.9);
      ctx.quadraticCurveTo(hx - r * 1.4, hy - r * 1.6 + wave * 5, hx - r * 2.0, hy - r * 1.1 + wave * 5);
      rod(ctx, 0.02, look.trim ?? "#f2ead8", ink);
      ellipse(ctx, hx + r * 0.1, hy - r * 0.75, r * 1.25, r * 0.5);
      paint(ctx, c, ink, p);
      break;
    }
    case "miner":
    case "kettle": {
      const brim = look.hat === "kettle" ? 1.7 : 1.3;
      ctx.beginPath();
      ctx.arc(hx, hy - r * 0.1, r * 1.08, Math.PI, TAU);
      ctx.closePath();
      paint(ctx, c, ink, p);
      glint(ctx, hx + lit * r * 0.45, hy - r * 0.75, r * 0.13, p);
      ellipse(ctx, hx, hy - r * 0.12, r * brim, r * 0.24);
      paint(ctx, shade(c, 0.85), ink);
      if (look.hat === "miner" && !p.back) {
        // The lamp on the brow.
        ellipse(ctx, hx + r * 0.8, hy - r * 0.55, r * 0.3, r * 0.3);
        paint(ctx, "#ffe2a0", ink);
      }
      break;
    }
    case "wizard": {
      const tip = Math.sin(p.now / 900 + p.seed) * 0.01;
      ctx.beginPath();
      ctx.moveTo(hx - r * 0.95, hy - r * 0.55);
      ctx.quadraticCurveTo(hx - r * 0.3, hy - r * 2.2, hx - r * 1.6 + tip, hy - r * 3.3);
      ctx.quadraticCurveTo(hx + r * 0.3, hy - r * 2.4, hx + r * 0.95, hy - r * 0.55);
      ctx.closePath();
      paint(ctx, c, ink, p);
      ellipse(ctx, hx, hy - r * 0.55, r * 1.75, r * 0.38);
      paint(ctx, shade(c, 0.8), ink);
      if (look.trim) {
        ctx.strokeStyle = look.trim;
        ctx.lineWidth = 0.014;
        ctx.beginPath();
        ctx.moveTo(hx - r * 0.85, hy - r * 0.78);
        ctx.quadraticCurveTo(hx, hy - r * 0.95, hx + r * 0.85, hy - r * 0.78);
        ctx.stroke();
      }
      break;
    }
    case "pilgrim": {
      ellipse(ctx, hx, hy - r * 0.95, r * 0.8, r * 0.5);
      paint(ctx, c, ink, p);
      ellipse(ctx, hx, hy - r * 0.6, r * 2.0, r * 0.42);
      paint(ctx, shade(c, 0.85), ink);
      if (!p.back && p.detail > 1) {
        // The scallop shell pilgrims wear.
        ctx.beginPath();
        ctx.moveTo(hx + r * 0.45, hy - r * 0.75);
        ctx.arc(hx + r * 0.45, hy - r * 0.75, r * 0.3, Math.PI * 1.1, Math.PI * 1.9);
        ctx.closePath();
        paint(ctx, "#f2ead8", ink);
      }
      break;
    }
    case "horned": {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(hx + s * r * 0.75, hy - r * 0.55);
        ctx.quadraticCurveTo(hx + s * r * 1.9, hy - r * 0.8, hx + s * r * 1.9, hy - r * 2.0);
        ctx.quadraticCurveTo(hx + s * r * 1.35, hy - r * 1.1, hx + s * r * 0.55, hy - r * 0.95);
        ctx.closePath();
        paint(ctx, "#e8dcc0", ink);
      }
      ctx.beginPath();
      ctx.arc(hx, hy - r * 0.15, r * 1.08, Math.PI, TAU);
      ctx.closePath();
      paint(ctx, c, ink, p);
      glint(ctx, hx + lit * r * 0.45, hy - r * 0.8, r * 0.13, p);
      if (!p.back) {
        // The nasal guard.
        ctx.beginPath();
        ctx.rect(hx + r * 0.62, hy - r * 0.2, r * 0.22, r * 0.55);
        paint(ctx, c, ink);
      }
      break;
    }
    case "galea": {
      ctx.beginPath();
      ctx.arc(hx, hy - r * 0.05, r * 1.08, Math.PI * 0.85, TAU);
      ctx.lineTo(hx + r * 0.6, hy - r * 0.1);
      ctx.lineTo(hx + r * 0.55, hy + r * 0.7);
      ctx.lineTo(hx - r * 0.95, hy + r * 0.5);
      ctx.closePath();
      paint(ctx, c, ink, p);
      glint(ctx, hx + lit * r * 0.4, hy - r * 0.7, r * 0.13, p);
      // The horsehair crest, front to back.
      ctx.beginPath();
      ctx.moveTo(hx + r * 0.85, hy - r * 0.85);
      ctx.quadraticCurveTo(hx, hy - r * 2.0, hx - r * 1.15, hy - r * 0.55);
      ctx.quadraticCurveTo(hx, hy - r * 1.35, hx + r * 0.85, hy - r * 0.85);
      ctx.closePath();
      paint(ctx, "#a8231e", ink);
      break;
    }
    case "turban":
      ellipse(ctx, hx - r * 0.05, hy - r * 0.55, r * 1.2, r * 0.75);
      paint(ctx, c, ink, p);
      if (p.detail > 1) {
        ctx.strokeStyle = shade(c, 0.75);
        ctx.lineWidth = 0.008;
        ctx.beginPath();
        ctx.moveTo(hx - r * 1.1, hy - r * 0.3);
        ctx.quadraticCurveTo(hx, hy - r * 1.1, hx + r * 1.1, hy - r * 0.6);
        ctx.moveTo(hx - r * 1.0, hy - r * 0.7);
        ctx.quadraticCurveTo(hx, hy - r * 1.4, hx + r * 0.9, hy - r * 0.95);
        ctx.stroke();
      }
      break;
    case "crown": {
      ctx.beginPath();
      ctx.moveTo(hx - r * 0.85, hy - r * 0.6);
      for (let i = 0; i <= 4; i++) {
        const x = hx - r * 0.85 + (i / 4) * r * 1.7;
        ctx.lineTo(x, hy - r * (i % 2 === 0 ? 1.55 : 1.05));
        if (i < 4) ctx.lineTo(x + r * 0.21, hy - r * 1.05);
      }
      ctx.lineTo(hx + r * 0.85, hy - r * 0.6);
      ctx.closePath();
      paint(ctx, c, ink, p);
      glint(ctx, hx + lit * r * 0.5, hy - r * 1.0, r * 0.12, p);
      if (p.detail > 1) dot(ctx, hx, hy - r * 0.85, r * 0.15, "#c8283a");
      break;
    }
  }
}

/** A mule with panniers, in its own frame like a person, about half a tile tall. */
export function paintMule(ctx: CanvasRenderingContext2D, d: Dress, p: Pose): void {
  const ink = p.struck ? "#ff3d2e" : PALETTE.ink;
  const hide = "#7a6552";
  const y = -0.3 + p.bob;
  const legPair = (x: number, swing: number, lift: number, far: boolean) => {
    limb(ctx, [x, y + 0.04, x + swing * 0.5, y + 0.17 - lift, x + swing, -lift - 0.01], 0.054, far ? tone(hide, 0.75) : hide, ink);
    ctx.beginPath();
    ctx.rect(x + swing - 0.028, -lift - 0.03, 0.056, 0.03);
    paint(ctx, "#2a2018", ink);
  };
  const [s1, l1] = p.nearFoot;
  const [s2, l2] = p.farFoot;
  outlined(ctx, p, () => {
    legPair(0.13, s2, l2, true);
    legPair(-0.13, s1, l1, true);
    // The tail, swishing.
    const swish = Math.sin(p.now / 700 + p.seed) * 0.04;
    limb(ctx, [-0.2, y - 0.04, -0.25 + swish, y + 0.1, -0.24 + swish * 1.5, y + 0.18], 0.016, "#3e3028", ink);
    ellipse(ctx, 0, y, 0.22, 0.11);
    paint(ctx, hide, ink, p);
    if (!rim) {
      ellipse(ctx, 0.01, y + 0.05, 0.16, 0.045);
      ctx.fillStyle = "#a8957e";
      ctx.fill();
    }
    // Neck and head, nodding with the walk.
    const nod = Math.sin(p.now / 500) * 0.01 + p.bob * 2;
    ctx.beginPath();
    ctx.moveTo(0.11, y - 0.08);
    ctx.lineTo(0.25, y - 0.21 + nod);
    ctx.lineTo(0.31, y - 0.14 + nod);
    ctx.lineTo(0.2, y + 0.04);
    ctx.closePath();
    paint(ctx, hide, ink, p);
    ctx.save();
    ctx.translate(0.29, y - 0.17 + nod);
    ctx.rotate(0.6);
    for (const s of [-0.5, 0.3]) {
      ctx.beginPath();
      ctx.ellipse(-0.04 + s * 0.02, -0.08, 0.02, 0.072, s * 0.6, 0, TAU);
      paint(ctx, tone(hide, s < 0 ? 0.8 : 1), ink);
    }
    ctx.beginPath();
    ctx.ellipse(0.0, 0.0, 0.055, 0.105, 0, 0, TAU);
    paint(ctx, hide, ink, p);
    ellipse(ctx, 0.0, 0.07, 0.042, 0.042);
    paint(ctx, "#4a3c32", ink);
    if (p.detail > 1) dot(ctx, 0.022, -0.03, 0.009, "#14100c");
    ctx.restore();
    // A blanket in the castle's colours under the pack saddle, and the panniers.
    ctx.beginPath();
    ctx.rect(-0.12, y - 0.11, 0.2, 0.12);
    paint(ctx, d.field, ink, p);
    if (!rim) {
      ctx.fillStyle = d.other;
      ctx.fillRect(-0.12, y - 0.0, 0.2, 0.015);
    }
    const r = 0.05 + 0.04 * Math.sqrt(p.fill);
    ctx.beginPath();
    ctx.rect(-0.07 - r * 0.5, y - 0.02, r * 1.9, r * 1.5);
    paint(ctx, "#a8844a", ink, p);
    if (p.fill > 0) {
      ctx.beginPath();
      ctx.moveTo(-0.07 - r * 0.5, y - 0.02);
      ctx.quadraticCurveTo(-0.07 + r * 0.45, y - 0.02 - r * 0.9 * p.fill, -0.07 + r * 1.4, y - 0.02);
      ctx.closePath();
      paint(ctx, p.goods, ink);
    }
    legPair(0.11, s1, l1, false);
    legPair(-0.15, s2, l2, false);
  });
}

/** A bird, in its own frame: on the ground, or `flying` some way above it. */
export function paintBird(ctx: CanvasRenderingContext2D, look: Look, p: Pose, flying: boolean): void {
  const raven = look.bird === "raven";
  const body = raven ? "#1d1c24" : "#8d939e";
  const wing = raven ? "#2a2a36" : "#a7adb6";
  const ink = p.struck ? "#ff3d2e" : PALETTE.ink;
  const s = raven ? 1.15 : 1;
  outlined(ctx, p, () => {
    ctx.save();
    ctx.scale(s, s);
    if (flying) {
      const h = 0.42 + Math.sin(p.now / 420 + p.seed) * 0.025;
      const flap = Math.sin(p.now / 85 + p.seed);
      ctx.translate(0, -h);
      const wingPath = (up: number, far: boolean) => {
        ctx.beginPath();
        ctx.moveTo(-0.02, -0.005);
        ctx.quadraticCurveTo(-0.03, -0.09 * up, -0.11, -0.13 * up);
        ctx.quadraticCurveTo(-0.04, -0.04 * up, 0.03, 0.0);
        ctx.closePath();
        paint(ctx, far ? shade(wing, 0.75) : wing, ink);
      };
      wingPath(flap, true);
      // The tail fanned behind.
      ctx.beginPath();
      ctx.moveTo(-0.05, 0);
      ctx.lineTo(-0.13, -0.025);
      ctx.lineTo(-0.13, 0.025);
      ctx.closePath();
      paint(ctx, body, ink);
      ellipse(ctx, 0, 0, 0.075, 0.032);
      paint(ctx, body, ink);
      ellipse(ctx, 0.07, -0.012, 0.03, 0.028);
      paint(ctx, raven ? body : "#5f7f74", ink);
      ctx.beginPath();
      ctx.moveTo(0.095, -0.02);
      ctx.lineTo(0.135, -0.008);
      ctx.lineTo(0.095, 0.0);
      ctx.closePath();
      paint(ctx, raven ? "#2e2c30" : "#d8c49a", ink);
      wingPath(-flap * 0.6 + 0.4, false);
    } else {
      // Hopping now and then, pecking at the ground between hops.
      const t = p.now / 1000 + p.seed * 10;
      const hop = Math.max(0, Math.sin(t * 3.1)) ** 8 * 0.05;
      const peck = Math.max(0, Math.sin(t * 1.7 + 1)) ** 12;
      ctx.translate(0, -hop);
      limb(ctx, [0.0, -0.05, -0.005, 0], 0.008, raven ? "#2e2c30" : "#c0504a", ink);
      limb(ctx, [0.02, -0.05, 0.022, 0], 0.008, raven ? "#2e2c30" : "#c0504a", ink);
      ctx.beginPath();
      ctx.moveTo(-0.05, -0.07);
      ctx.lineTo(-0.11, -0.05);
      ctx.lineTo(-0.1, -0.035);
      ctx.closePath();
      paint(ctx, body, ink);
      ctx.beginPath();
      ctx.ellipse(0, -0.075, 0.065, 0.04, -0.25, 0, TAU);
      paint(ctx, body, ink);
      ctx.beginPath();
      ctx.ellipse(-0.01, -0.08, 0.045, 0.025, -0.3, 0, TAU);
      paint(ctx, wing, ink);
      const hx = 0.05 + peck * 0.02;
      const hy = -0.12 + peck * 0.07;
      ellipse(ctx, hx, hy, 0.03, 0.028);
      paint(ctx, raven ? body : "#5f7f74", ink);
      ctx.beginPath();
      ctx.moveTo(hx + 0.022, hy - 0.006);
      ctx.lineTo(hx + 0.06, hy + 0.006 + peck * 0.02);
      ctx.lineTo(hx + 0.022, hy + 0.012);
      ctx.closePath();
      paint(ctx, raven ? "#2e2c30" : "#d8c49a", ink);
      if (p.detail > 1) dot(ctx, hx + 0.008, hy - 0.006, 0.006, raven ? "#c9b8ff" : "#ff8a3a");
    }
    ctx.restore();
  });
}
