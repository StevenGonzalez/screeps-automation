// What is written over a room in full: the names of its people under their
// feet and what they say over their heads. The room itself is drawn as a
// scene (scene.ts).

import { clamp, screenTransform, toScreen, worldTransform, type Frame } from "./camera";
import { creepPosition, type LiveRoom } from "./store";

const FOE = "#e05a5a";
// How far over a creep's tile its speech is written, in tiles.
const SPEECH_HEIGHT = 1.2;

export function drawCreepLabels(f: Frame, r: LiveRoom, tickMs: number, me: string | undefined, nameAlpha: number): void {
  const { ctx } = f;
  screenTransform(f);
  const s = f.cam.scale;
  // Nothing is written over what is already written: speech first, then the
  // names that still have room.
  const taken: Array<[number, number, number, number]> = [];
  const place = (x0: number, y0: number, x1: number, y1: number): boolean => {
    if (taken.some(([a, b, c, d]) => x0 < c && x1 > a && y0 < d && y1 > b)) return false;
    taken.push([x0, y0, x1, y1]);
    return true;
  };
  // Speech: a scrap of parchment over the speaker for the tick.
  const speechPx = clamp(s * 0.4, 11, 18);
  const speechFont = `italic ${speechPx}px "IM Fell English", Georgia, serif`;
  ctx.font = speechFont;
  const said: Array<{ text: string; sx: number; sy: number; w: number; h: number }> = [];
  for (const e of r.effects) {
    if (e.kind !== "say" || !e.text) continue;
    const p = creepPosition(r, e.id, f.now, tickMs);
    // Over the speaker's head: people stand about a tile tall (see figures).
    const [sx, sy] = toScreen(f, r.ox + p.x, r.oy + p.y - SPEECH_HEIGHT);
    const w = ctx.measureText(e.text).width + 14;
    const h = speechPx + 10;
    if (place(sx - w / 2, sy - h, sx + w / 2, sy + 6)) said.push({ text: e.text, sx, sy, w, h });
  }
  if (nameAlpha > 0.01) {
    const px = clamp(s * 0.32, 9, 15);
    ctx.font = `italic ${px}px "IM Fell English", Georgia, serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineJoin = "round";
    for (const id in r.objects) {
      const o = r.objects[id];
      if (o.type !== "creep" || o.spawning || !o.name) continue;
      const p = creepPosition(r, id, f.now, tickMs);
      const [sx, sy] = toScreen(f, r.ox + p.x, r.oy + p.y + 0.5);
      const w = ctx.measureText(o.name).width + 4;
      if (!place(sx - w / 2, sy, sx + w / 2, sy + px)) continue;
      ctx.globalAlpha = nameAlpha * 0.85;
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.lineWidth = 3;
      ctx.strokeText(o.name, sx, sy);
      ctx.fillStyle = o.user === me ? "#e8d9b0" : FOE;
      ctx.fillText(o.name, sx, sy);
    }
  }
  const t = clamp((f.now - r.tickAt) / tickMs, 0, 1);
  const a = t < 0.1 ? t / 0.1 : t > 0.85 ? clamp((1 - t) / 0.15, 0, 1) : 1;
  ctx.font = speechFont;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const { text, sx, sy, w, h } of said) {
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.roundRect(sx - w / 2, sy - h, w, h, 6);
    ctx.moveTo(sx - 5, sy);
    ctx.lineTo(sx, sy + 6);
    ctx.lineTo(sx + 5, sy);
    ctx.fillStyle = "rgba(236,222,186,0.92)";
    ctx.fill();
    ctx.strokeStyle = "rgba(90,70,40,0.9)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#2a1e10";
    ctx.fillText(text, sx, sy - h / 2);
  }
  ctx.globalAlpha = 1;
  worldTransform(f);
}
