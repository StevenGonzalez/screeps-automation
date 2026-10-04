// The bot's own overlays, drawn as the game client draws them: RoomVisual
// primitives over a room, MapVisual primitives over the realm map. Defaults
// follow the game's API documentation for each primitive.

import { roomCoords, type VisualItem } from "../shared/realm";
import { screenTransform, shardPlane, toScreen, worldTransform, type Frame } from "./camera";

function dash(ctx: CanvasRenderingContext2D, lineStyle: unknown, width: number): void {
  if (lineStyle === "dashed") {
    ctx.setLineDash([Math.max(width * 4, 0.25), Math.max(width * 3, 0.2)]);
    ctx.lineCap = "butt";
  } else if (lineStyle === "dotted") {
    ctx.setLineDash([0.0001, Math.max(width * 2.5, 0.15)]);
    ctx.lineCap = "round";
  } else {
    ctx.setLineDash([]);
    ctx.lineCap = "round";
  }
}

interface Shape {
  fill?: string;
  stroke?: string;
  strokeWidth: number;
  opacity: number;
  lineStyle?: string;
}

function paint(ctx: CanvasRenderingContext2D, s: Shape, alpha: number): void {
  if (s.fill) {
    ctx.globalAlpha = alpha * s.opacity;
    ctx.fillStyle = s.fill;
    ctx.fill();
  }
  if (s.stroke) {
    ctx.globalAlpha = alpha * s.opacity;
    ctx.strokeStyle = s.stroke;
    ctx.lineWidth = s.strokeWidth;
    dash(ctx, s.lineStyle, s.strokeWidth);
    ctx.stroke();
  }
}

// A RoomVisual font: a number of tiles, or a CSS-like string such as
// "italic 0.5 serif" or "bold 20px Arial", where a bare number is tiles.
export function parseFont(font: unknown, scale: number): { css: string; px: number } {
  let style = "";
  let family = "sans-serif";
  let px = 0.5 * scale;
  if (typeof font === "number") {
    px = font * scale;
  } else if (typeof font === "string") {
    const tokens = font.trim().split(/\s+/);
    const i = tokens.findIndex((t) => /^\d*\.?\d+(px)?$/.test(t));
    if (i >= 0) {
      const t = tokens[i];
      px = t.endsWith("px") ? parseFloat(t) : parseFloat(t) * scale;
      style = tokens.slice(0, i).join(" ");
      if (i < tokens.length - 1) family = tokens.slice(i + 1).join(" ");
    }
  }
  return { css: `${style} ${px}px ${family}`.trim(), px };
}

interface TextLook {
  color: string;
  css: string;
  px: number;
  stroke?: string;
  strokeWidth: number;
  backgroundColor?: string;
  backgroundPadding: number;
  align: CanvasTextAlign;
  opacity: number;
  baseline: CanvasTextBaseline;
}

function drawText(f: Frame, text: string, wx: number, wy: number, look: TextLook, alpha: number): void {
  if (look.px < 3 || !text) return;
  const { ctx } = f;
  screenTransform(f);
  const [sx, sy] = toScreen(f, wx, wy);
  ctx.font = look.css;
  ctx.textAlign = look.align;
  ctx.textBaseline = look.baseline;
  ctx.globalAlpha = alpha * look.opacity;
  ctx.setLineDash([]);
  if (look.backgroundColor) {
    const w = ctx.measureText(text).width;
    const pad = look.backgroundPadding * f.cam.scale;
    const left = look.align === "left" ? sx : look.align === "right" ? sx - w : sx - w / 2;
    const top = look.baseline === "middle" ? sy - look.px / 2 : sy - look.px * 0.85;
    ctx.fillStyle = look.backgroundColor;
    ctx.fillRect(left - pad, top - pad, w + 2 * pad, look.px + 2 * pad);
  }
  if (look.stroke) {
    ctx.lineJoin = "round";
    ctx.lineWidth = look.strokeWidth * f.cam.scale * 2;
    ctx.strokeStyle = look.stroke;
    ctx.strokeText(text, sx, sy);
  }
  ctx.fillStyle = look.color;
  ctx.fillText(text, sx, sy);
  worldTransform(f);
}

/** A room's RoomVisual overlays, the room's top-left tile at world (ox, oy). */
export function drawRoomVisual(f: Frame, items: VisualItem[], ox: number, oy: number, alpha: number): void {
  if (alpha <= 0.01 || items.length === 0) return;
  const { ctx } = f;
  worldTransform(f);
  for (const v of items) {
    const s = v.s ?? {};
    switch (v.t) {
      case "l": {
        ctx.beginPath();
        ctx.moveTo(v.x1 + ox, v.y1 + oy);
        ctx.lineTo(v.x2 + ox, v.y2 + oy);
        paint(ctx, { stroke: s.color ?? "#ffffff", strokeWidth: s.width ?? 0.1, opacity: s.opacity ?? 0.5, lineStyle: s.lineStyle }, alpha);
        break;
      }
      case "c": {
        ctx.beginPath();
        ctx.arc(v.x + ox, v.y + oy, s.radius ?? 0.15, 0, Math.PI * 2);
        paint(ctx, { fill: s.fill ?? "#ffffff", stroke: s.stroke, strokeWidth: s.strokeWidth ?? 0.1, opacity: s.opacity ?? 0.5, lineStyle: s.lineStyle }, alpha);
        break;
      }
      case "r": {
        ctx.beginPath();
        ctx.rect(v.x + ox, v.y + oy, v.w, v.h);
        paint(ctx, { fill: s.fill ?? "#ffffff", stroke: s.stroke, strokeWidth: s.strokeWidth ?? 0.1, opacity: s.opacity ?? 0.5, lineStyle: s.lineStyle }, alpha);
        break;
      }
      case "p": {
        const pts: Array<[number, number]> = v.points ?? [];
        if (pts.length < 2) break;
        ctx.beginPath();
        ctx.moveTo(pts[0][0] + ox, pts[0][1] + oy);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] + ox, pts[i][1] + oy);
        paint(ctx, { fill: s.fill, stroke: s.stroke ?? "#ffffff", strokeWidth: s.strokeWidth ?? 0.1, opacity: s.opacity ?? 0.5, lineStyle: s.lineStyle }, alpha);
        break;
      }
      case "t": {
        const font = parseFont(s.font, f.cam.scale);
        drawText(f, String(v.text ?? ""), v.x + ox, v.y + oy, {
          color: s.color ?? "#ffffff",
          css: font.css,
          px: font.px,
          stroke: s.stroke,
          strokeWidth: s.strokeWidth ?? 0.15,
          backgroundColor: s.backgroundColor,
          backgroundPadding: s.backgroundPadding ?? 0.3,
          align: s.align ?? "center",
          opacity: s.opacity ?? 1,
          baseline: "alphabetic",
        }, alpha);
        break;
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

/** The realm map's MapVisual overlays for a shard. */
export function drawMapVisual(f: Frame, items: VisualItem[], shard: string, alpha: number): void {
  if (alpha <= 0.01 || items.length === 0) return;
  const { ctx } = f;
  const plane = shardPlane(shard);
  // A map position: tile (x, y) of room n, in world tiles.
  const mapPoint = (n: string, x: number, y: number): [number, number] | null => {
    const c = roomCoords(n);
    return c ? [plane + c.x * 50 + x, c.y * 50 + y] : null;
  };
  worldTransform(f);
  for (const v of items) {
    const s = v.s ?? {};
    switch (v.t) {
      case "l": {
        const a = mapPoint(v.n1, v.x1, v.y1);
        const b = mapPoint(v.n2, v.x2, v.y2);
        if (!a || !b) break;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        paint(ctx, { stroke: s.color ?? "#ffffff", strokeWidth: s.width ?? 0.1, opacity: s.opacity ?? 0.5, lineStyle: s.lineStyle }, alpha);
        break;
      }
      case "c": {
        const p = mapPoint(v.n, v.x, v.y);
        if (!p) break;
        ctx.beginPath();
        ctx.arc(p[0], p[1], s.radius ?? 10, 0, Math.PI * 2);
        paint(ctx, { fill: s.fill ?? "#ffffff", stroke: s.stroke, strokeWidth: s.strokeWidth ?? 0.5, opacity: s.opacity ?? 0.5, lineStyle: s.lineStyle }, alpha);
        break;
      }
      case "r": {
        const p = mapPoint(v.n, v.x, v.y);
        if (!p) break;
        ctx.beginPath();
        ctx.rect(p[0], p[1], v.w, v.h);
        paint(ctx, { fill: s.fill ?? "#ffffff", stroke: s.stroke, strokeWidth: s.strokeWidth ?? 0.5, opacity: s.opacity ?? 0.5, lineStyle: s.lineStyle }, alpha);
        break;
      }
      case "p": {
        const pts = (v.points ?? []).map((q: any) => mapPoint(q.n, q.x, q.y)).filter(Boolean) as Array<[number, number]>;
        if (pts.length < 2) break;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        paint(ctx, { fill: s.fill, stroke: s.stroke ?? "#ffffff", strokeWidth: s.strokeWidth ?? 0.5, opacity: s.opacity ?? 0.5, lineStyle: s.lineStyle }, alpha);
        break;
      }
      case "t": {
        const p = mapPoint(v.n, v.x, v.y);
        if (!p) break;
        const px = (s.fontSize ?? 10) * f.cam.scale;
        drawText(f, String(v.text ?? ""), p[0], p[1], {
          color: s.color ?? "#ffffff",
          css: `${s.fontStyle ?? ""} ${s.fontVariant ?? ""} ${px}px ${s.fontFamily ?? "sans-serif"}`.trim(),
          px,
          stroke: s.stroke,
          strokeWidth: s.strokeWidth ?? 0.15,
          backgroundColor: s.backgroundColor,
          backgroundPadding: s.backgroundPadding ?? 2,
          align: s.align ?? "center",
          opacity: s.opacity ?? 0.5,
          baseline: "middle",
        }, alpha);
        break;
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}
