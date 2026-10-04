import { roomCoords, splitKey } from "../shared/realm";

// The camera and the frame being drawn. The world is measured in tiles on one
// plane: room (rx, ry) in world room coordinates puts its tile (x, y) at
// (rx * 50 + x, ry * 50 + y), with each tile centred on its whole coordinate,
// as RoomVisual has it. So a room view and the realm map are the same picture
// at different zooms, and the camera can fly from one castle to the next.

export interface View {
  x: number;
  y: number;
  // Screen pixels per tile.
  scale: number;
}

export interface Frame {
  ctx: CanvasRenderingContext2D;
  dpr: number;
  // Canvas size in CSS pixels.
  w: number;
  h: number;
  // The letterbox bars' height, top and bottom.
  bar: number;
  cam: View;
  now: number;
}

export function worldTransform(f: Frame): void {
  const s = f.cam.scale * f.dpr;
  f.ctx.setTransform(s, 0, 0, s, (f.w / 2 - f.cam.x * f.cam.scale) * f.dpr, (f.h / 2 - f.cam.y * f.cam.scale) * f.dpr);
}

export function screenTransform(f: Frame): void {
  f.ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
}

export function toScreen(f: Frame, x: number, y: number): [number, number] {
  return [(x - f.cam.x) * f.cam.scale + f.w / 2, (y - f.cam.y) * f.cam.scale + f.h / 2];
}

export function toWorld(f: Pick<Frame, "w" | "h" | "cam">, sx: number, sy: number): [number, number] {
  return [(sx - f.w / 2) / f.cam.scale + f.cam.x, (sy - f.h / 2) / f.cam.scale + f.cam.y];
}

/** The world rectangle on screen, as [left, top, right, bottom]. */
export function visibleRect(f: Pick<Frame, "w" | "h" | "cam">): [number, number, number, number] {
  const hw = f.w / 2 / f.cam.scale;
  const hh = f.h / 2 / f.cam.scale;
  return [f.cam.x - hw, f.cam.y - hh, f.cam.x + hw, f.cam.y + hh];
}

// The scale at which a box of the world fills the picture between the bars.
export function fitScale(w: number, h: number, bar: number, boxW: number, boxH: number): number {
  return Math.min(w / boxW, (h - 2 * bar) / boxH);
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;


// Each shard is its own plane, set far apart so no two shards' rooms meet;
// the camera cuts between shards rather than flying.
const SHARD_PLANE = 100_000;

export function shardPlane(shard: string): number {
  const m = /(\d+)$/.exec(shard);
  return (m ? Number(m[1]) : 9) * SHARD_PLANE;
}

/** The world position of a room's tile (0, 0), by its "shard/room" key. */
export function roomOrigin(key: string): { x: number; y: number } | undefined {
  const { shard, room } = splitKey(key);
  const c = roomCoords(room);
  return c ? { x: shardPlane(shard) + c.x * 50, y: c.y * 50 } : undefined;
}
