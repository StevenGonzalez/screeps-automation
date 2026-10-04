// A room up close, as a scene: the ground and what is laid on it, then, with
// every other room on screen, every shadow at once and everything standing
// from back to front: trees, the castle's works, its people, and what they
// did this tick.
// Weather and the sky are drawn over the scene by weather.ts, and the
// lighting pass darkens it all afterwards (lighting.ts).

import { armsColours } from "../../src/services/services.heraldry";
import type { TownPlan } from "../shared/protocol";
import { splitKey } from "../shared/realm";
import type { Env, Piece } from "./art";
import { drawGround, structurePieces } from "./buildings";
import { worldTransform, type Frame } from "./camera";
import { creepPieces } from "./figures";
import { forestPieces } from "./flora";
import type { Sky } from "./sky";
import type { LiveRoom } from "./store";

/** What the woods of a room need to know about it: also all a room seen only on the map has. */
export interface Wild {
  r: Pick<LiveRoom, "ox" | "oy" | "objects">;
  terrain: string | undefined;
  rect: [number, number, number, number];
}

/** What the pieces of a room need to know about it. */
export interface RoomView {
  r: LiveRoom;
  room: string;
  // The town as the bot planned it, if the room is a castle with one.
  town: TownPlan | null;
  // The castle's colours (services.heraldry), for banners and tabards.
  arms: { field: string; other: string };
  me: string | undefined;
  tickMs: number;
  // The room's terrain as 2500 digits, once fetched.
  terrain: string | undefined;
  // The world rectangle on screen, [left, top, right, bottom], so pieces
  // well off it can be left out.
  rect: [number, number, number, number];
  // Whether the viewer draws the room's sky and town dressing, or the bot
  // still draws its own (see Store.ownsScenery).
  scenery: boolean;
}

export function roomView(
  r: LiveRoom,
  town: TownPlan | null,
  me: string | undefined,
  tickMs: number,
  terrain: string | undefined,
  rect: [number, number, number, number],
  scenery: boolean,
): RoomView {
  const room = splitKey(r.key).room;
  return { r, room, town, arms: armsColours(room), me, tickMs, terrain, rect, scenery };
}

// How far beyond the screen's edge a piece may stand and still reach onto it:
// a tower or a tall tree reaches about two tiles up from its foot.
const MARGIN = 3;
// The shadows' colour, and the fraction of the picture's size they are filled at.
const SHADOW_COLOUR = "rgb(8,10,24)";
const SHADOW_RESOLUTION = 0.5;
let shade: HTMLCanvasElement | null = null;

/** Whether a tile of the room is near enough the screen to be drawn. */
export function onScreen(v: Wild, x: number, y: number): boolean {
  const wx = v.r.ox + x;
  const wy = v.r.oy + y;
  return wx >= v.rect[0] - MARGIN && wx <= v.rect[2] + MARGIN && wy >= v.rect[1] - 1 && wy <= v.rect[3] + MARGIN;
}

/**
 * Draws the room's ground, and adds what stands in it to `pieces`, to be
 * drawn with every other room's (see drawPieces).
 */
export function drawScene(f: Frame, v: RoomView, env: Env, pieces: Piece[]): void {
  const { ctx } = f;
  worldTransform(f);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  drawGround(ctx, v, env);

  forestPieces(v, env, pieces);
  structurePieces(v, env, pieces);
  creepPieces(v, env, pieces);
}

/**
 * Adds the woods of a room seen only on the map to `pieces`, so the land runs
 * on unbroken past the rooms streaming in full.
 */
export function wildPieces(w: Wild, env: Env, pieces: Piece[]): void {
  forestPieces(w, env, pieces);
}

/**
 * Draws every shadow at once, then the pieces from back to front, all the
 * rooms' together, so what stands in a room to the south covers what reaches
 * into it from the north.
 */
export function drawPieces(f: Frame, pieces: Piece[], sky: Sky): void {
  const { ctx } = f;
  worldTransform(f);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (sky.shadow.alpha > 0.01) drawShadows(ctx, pieces, sky.shadow);

  pieces.sort((a, b) => a.depth - b.depth);
  for (const p of pieces) {
    p.draw(ctx);
    ctx.globalAlpha = 1;
  }
}

// The shadows are filled solid on a canvas a quarter the size of the
// picture's, where the path of them all costs far less to fill, and laid over
// the ground at their darkness.
function drawShadows(ctx: CanvasRenderingContext2D, pieces: Piece[], cast: Sky["shadow"]): void {
  const path = new Path2D();
  for (const p of pieces) p.shadow?.(path, cast);
  const full = ctx.canvas;
  const w = Math.max(1, Math.round(full.width * SHADOW_RESOLUTION));
  const h = Math.max(1, Math.round(full.height * SHADOW_RESOLUTION));
  shade ??= document.createElement("canvas");
  if (shade.width !== w || shade.height !== h) {
    shade.width = w;
    shade.height = h;
  }
  const g = shade.getContext("2d")!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  const m = ctx.getTransform();
  const kx = w / full.width;
  const ky = h / full.height;
  g.setTransform(m.a * kx, m.b * ky, m.c * kx, m.d * ky, m.e * kx, m.f * ky);
  g.fillStyle = SHADOW_COLOUR;
  g.fill(path);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = cast.alpha;
  ctx.drawImage(shade, 0, 0, full.width, full.height);
  ctx.restore();
}
