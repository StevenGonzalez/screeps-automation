// The realm map: every room around the castles and their remotes, its terrain
// and what the map view shows of it, under the bot's map overlay, and the fog
// of war over the rooms the realm does not see. Rooms not streaming in full
// are drawn from the map view here; rooms that are, as scenes (scene.ts).

import { roomFromCoords, roomCoords, roomKey, splitKey } from "../shared/realm";
import { roomOrigin, visibleRect, worldTransform, type Frame } from "./camera";
import type { Store } from "./store";
import type { Terrain } from "./terrain";

export interface RealmLayout {
  // Every room on the map, keyed "shard/room".
  rooms: string[];
  // Per shard, the box round the castles and remotes in world tiles:
  // [left, top, right, bottom].
  bounds: Map<string, [number, number, number, number]>;
}

let cached: { sig: string; layout: RealmLayout } | null = null;

/** The rooms of the realm map: the box round the castles and remotes, one room wider each way. */
export function realmLayout(store: Store): RealmLayout {
  const keys = [...store.castles.map((c) => c.key), ...store.remotes];
  const sig = keys.join(",");
  if (cached && cached.sig === sig) return cached.layout;
  const byShard = new Map<string, Array<{ x: number; y: number }>>();
  for (const key of keys) {
    const { shard, room } = splitKey(key);
    const c = roomCoords(room);
    if (!c) continue;
    byShard.set(shard, [...(byShard.get(shard) ?? []), c]);
  }
  const rooms: string[] = [];
  const bounds = new Map<string, [number, number, number, number]>();
  for (const [shard, cs] of byShard) {
    const x0 = Math.min(...cs.map((c) => c.x));
    const x1 = Math.max(...cs.map((c) => c.x));
    const y0 = Math.min(...cs.map((c) => c.y));
    const y1 = Math.max(...cs.map((c) => c.y));
    for (let y = y0 - 1; y <= y1 + 1; y++) for (let x = x0 - 1; x <= x1 + 1; x++) rooms.push(roomKey(shard, roomFromCoords(x, y)));
    const a = roomOrigin(roomKey(shard, roomFromCoords(x0, y0)))!;
    const b = roomOrigin(roomKey(shard, roomFromCoords(x1, y1)))!;
    bounds.set(shard, [a.x - 0.5, a.y - 0.5, b.x + 49.5, b.y + 49.5]);
  }
  const layout = { rooms, bounds };
  cached = { sig, layout };
  return layout;
}

function onScreen(rect: [number, number, number, number], ox: number, oy: number): boolean {
  return ox + 49.5 >= rect[0] && ox - 0.5 <= rect[2] && oy + 49.5 >= rect[1] && oy - 0.5 <= rect[3];
}

/** Terrain for every realm room on screen, sharp when the camera is close. */
export function drawTerrain(f: Frame, layout: RealmLayout, terrain: Terrain): void {
  const { ctx } = f;
  worldTransform(f);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const rect = visibleRect(f);
  const close = f.cam.scale > 5;
  for (const key of layout.rooms) {
    const o = roomOrigin(key);
    if (!o || !onScreen(rect, o.x, o.y)) continue;
    const img = (close ? terrain.detail(key) : undefined) ?? terrain.thumb(key);
    if (img) {
      // A hair of overlap hides the seam between rooms.
      ctx.drawImage(img, o.x - 0.5, o.y - 0.5, 50.04, 50.04);
    } else {
      ctx.fillStyle = "#0d0d0b";
      ctx.fillRect(o.x - 0.5, o.y - 0.5, 50, 50);
    }
  }
}

// What the map view shows, by its keys.
const MAP_LOOK: Record<string, { colour: string; size: number }> = {
  w: { colour: "#1d1b18", size: 1 },
  r: { colour: "#4a443a", size: 0.55 },
  s: { colour: "#f2c14e", size: 1.1 },
  m: { colour: "#9ab8cc", size: 1.1 },
  c: { colour: "#dddddd", size: 1.2 },
  k: { colour: "#a33a3a", size: 1.1 },
  p: { colour: "#f41f33", size: 1 },
  pb: { colour: "#f41f33", size: 1.1 },
};

/** A room as the map view sees it, for rooms not streaming in full. */
export function drawMapView(f: Frame, store: Store, key: string, alpha: number): void {
  const view = store.maps.get(key);
  const o = roomOrigin(key);
  if (!view || !o || alpha <= 0.01) return;
  const { ctx } = f;
  ctx.globalAlpha = alpha;
  for (const k in view) {
    const list = view[k];
    if (!Array.isArray(list) || list.length === 0) continue;
    const look = MAP_LOOK[k] ?? (k === store.me?.id ? { colour: "#e8d9b0", size: 0.8 } : { colour: "#e05a5a", size: 0.9 });
    ctx.fillStyle = look.colour;
    ctx.beginPath();
    const half = look.size / 2;
    for (const p of list as Array<[number, number]>) ctx.rect(o.x + p[0] - half, o.y + p[1] - half, look.size, look.size);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// The fog of war is drawn from a map of the realm this many pixels to a room,
// smoothed as it is stretched over the world, and held a pixel back from the
// rooms the realm sees, so it thickens over the first few tiles beyond them.
const SHROUD_PX = 8;
const SHROUD = "rgba(10,12,20,0.7)";
let shroud: { sig: string; layout: RealmLayout; maps: Array<{ canvas: HTMLCanvasElement; rect: [number, number, number, number] }> } | null = null;

/** Lays the fog of war over the realm map's rooms in `unseen`. */
export function drawShroud(f: Frame, layout: RealmLayout, unseen: Set<string>): void {
  if (unseen.size === 0) return;
  const sig = [...unseen].join(",");
  if (shroud?.sig !== sig || shroud.layout !== layout) shroud = { sig, layout, maps: shroudMaps(layout, unseen) };
  const { ctx } = f;
  worldTransform(f);
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = 1;
  for (const { canvas, rect } of shroud.maps) ctx.drawImage(canvas, ...rect);
}

// A map for each shard of the realm, a block of pixels to a room, filled
// where the room is unseen, with where it is to be drawn in the world.
function shroudMaps(layout: RealmLayout, unseen: Set<string>) {
  const byShard = new Map<string, Array<{ key: string; x: number; y: number }>>();
  for (const key of layout.rooms) {
    const o = roomOrigin(key);
    const { shard } = splitKey(key);
    if (o) byShard.set(shard, [...(byShard.get(shard) ?? []), { key, ...o }]);
  }
  return [...byShard.values()].map((rooms) => {
    const x0 = Math.min(...rooms.map((r) => r.x));
    const y0 = Math.min(...rooms.map((r) => r.y));
    const cols = (Math.max(...rooms.map((r) => r.x)) - x0) / 50 + 1;
    const rows = (Math.max(...rooms.map((r) => r.y)) - y0) / 50 + 1;
    const canvas = document.createElement("canvas");
    canvas.width = cols * SHROUD_PX;
    canvas.height = rows * SHROUD_PX;
    const g = canvas.getContext("2d")!;
    g.fillStyle = SHROUD;
    const px = (r: { x: number; y: number }) => [((r.x - x0) / 50) * SHROUD_PX, ((r.y - y0) / 50) * SHROUD_PX] as const;
    for (const r of rooms) if (unseen.has(r.key)) g.fillRect(...px(r), SHROUD_PX, SHROUD_PX);
    for (const r of rooms) if (!unseen.has(r.key)) g.clearRect(px(r)[0] - 1, px(r)[1] - 1, SHROUD_PX + 2, SHROUD_PX + 2);
    const rect: [number, number, number, number] = [x0 - 0.5, y0 - 0.5, cols * 50, rows * 50];
    return { canvas, rect };
  });
}

/** Room borders, and each castle outlined in gold, or red while foes are in it. */
export function drawBorders(f: Frame, store: Store, layout: RealmLayout, alpha: number): void {
  if (alpha <= 0.01) return;
  const { ctx } = f;
  worldTransform(f);
  const rect = visibleRect(f);
  const px = 1 / f.cam.scale;
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(200,190,160,0.08)";
  ctx.lineWidth = px;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  for (const key of layout.rooms) {
    const o = roomOrigin(key);
    if (o && onScreen(rect, o.x, o.y)) ctx.rect(o.x - 0.5, o.y - 0.5, 50, 50);
  }
  ctx.stroke();
  for (const c of store.castles) {
    const o = roomOrigin(c.key);
    if (!o || !onScreen(rect, o.x, o.y)) continue;
    const raided = store.foreigners(c.key).length > 0;
    ctx.strokeStyle = raided ? `rgba(224,90,90,${0.55 + 0.4 * Math.sin(f.now / 250)})` : "rgba(242,193,78,0.45)";
    ctx.lineWidth = 2 * px;
    ctx.strokeRect(o.x - 0.5, o.y - 0.5, 50, 50);
  }
  ctx.globalAlpha = 1;
}
