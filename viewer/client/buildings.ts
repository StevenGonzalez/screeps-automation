// The castle's works and the town in three-quarter view (see art.ts), each
// as the realm calls it: the spawn is the barracks, the controller the
// Throne, extensions gold coffers, a source a vein of gold. Walls are told
// apart by what they are for (buildings-plan.ts): the curtain wall with its
// gates and battlements, the town's watch posts, its cottages and fountain.
//
// What lies flat (roads, paving, spilt gold, the plinths warding the works)
// is drawn first, under every shadow; everything standing is a piece of the
// scene, stamped from a sprite painted once (buildings-paint.ts and
// buildings-works.ts), with what moves drawn over the stamp each frame.
// Where the bot still draws its own town dressing (RoomView.scenery), the
// pennants, lamps, camp and feast lanterns are left to it.

import type { TownPlan } from "../shared/protocol";
import type { RoomObject, RoomObjects } from "../shared/realm";
import {
  castBlock,
  castRound,
  ellipse,
  flame,
  hash2,
  mix,
  pennant,
  PALETTE,
  resourceColour,
  rgba,
  rng,
  shade,
  smoke,
  SQUASH,
  TAU,
  type Env,
  type Piece,
} from "./art";
import {
  BATTLEMENT_H,
  COTTAGE_CHIMNEY,
  COTTAGE_DORMER,
  flagTop,
  GATE_H,
  HOUSE_H,
  HOUSE_RISE,
  HOUSE_WALL,
  HOUSE_WINDOWS,
  line,
  paintBed,
  paintCottageFloor,
  paintCottageRoof,
  paintFirePit,
  paintFirePitFront,
  paintFountain,
  paintFountainPillar,
  paintGate,
  paintHouseFront,
  paintHouseWall,
  paintLanternPole,
  paintPost,
  paintRing,
  paintTent,
  planks,
  POST_DECK,
  POST_POLE,
  POST_POLE_TOP,
  door,
  WALL_H,
  WALL_INSET,
} from "./buildings-paint";
import { E, inRing, N, planRoom, ringMask, S, tileOf, W, campTiles, type RoomPlan } from "./buildings-plan";
import {
  BANK_BOX,
  BARRACKS_BOX,
  BARRACKS_CHIMNEY,
  BARRACKS_DOOR,
  coins,
  COFFER_BOX,
  CRATES_BOX,
  CRYSTAL_BOX,
  DEPOSIT_BOX,
  ENGINE_BOX,
  ENGINE_RUNES,
  HEADFRAME_BOX,
  HEADSTONE_BOX,
  LAB_BOX,
  LAB_FLASK,
  LAB_MOUTH,
  LAIR_BOX,
  LAIR_EYES,
  MARKET_BOX,
  OBELISK_BOX,
  OBELISK_TOP,
  ORB,
  paintAthanor,
  paintBank,
  paintBarracks,
  paintCoffer,
  paintCrates,
  paintCrystals,
  paintDeposit,
  paintHeadframe,
  paintHeadstone,
  paintLair,
  paintObelisk,
  paintPedestal,
  paintPortalArch,
  paintRubble,
  paintScaffold,
  paintShrine,
  paintSpire,
  paintThrone,
  paintTradingPost,
  paintTreasury,
  paintTrebuchet,
  paintVein,
  paintWatchtower,
  paintWorkshop,
  PEDESTAL_BOX,
  PORTAL_BOX,
  PORTAL_EYE,
  RUBBLE_BOX,
  SCAFFOLD_BOX,
  SHRINE_BOX,
  SHRINE_CRYSTAL,
  SPIRE_BOX,
  THRONE_BOX,
  TOWER_BOX,
  TOWER_FIRE,
  TOWER_H,
  TOWER_R,
  TREASURY_BOX,
  VEIN_BOX,
  WORKSHOP_BOX,
  WORKSHOP_CHIMNEY,
  WORKSHOP_FORGE,
  type Owner,
} from "./buildings-works";
import { clamp, smoothstep } from "./camera";
import { onScreen, type RoomView } from "./scene";

type Box = readonly [number, number, number, number];

// A room's plan is read once per tick: the objects are replaced whole when a
// tick arrives, and the town only changes with them.
const plans = new WeakMap<RoomObjects, { town: TownPlan | null; plan: RoomPlan }>();

export function planOf(v: RoomView): RoomPlan {
  const held = plans.get(v.r.objects);
  if (held && held.town === v.town) return held.plan;
  const plan = planRoom(v.r.objects, v.town);
  plans.set(v.r.objects, { town: v.town, plan });
  return plan;
}

// Which of a few painted shapes a tile takes, the same every frame.
const variantAt = (x: number, y: number, n = 3) => Math.floor(hash2(x * 3 + 11, y * 5 + 7) * n);

function amount(o: RoomObject, resource = "energy"): number {
  return Number(o.store?.[resource]) || Number(o[resource]) || 0;
}

function capacity(o: RoomObject, resource = "energy"): number {
  return Number(o.storeCapacityResource?.[resource]) || Number(o.storeCapacity) || Number(o[`${resource}Capacity`]) || 0;
}

function storeTotal(o: RoomObject): number {
  let n = 0;
  for (const k in o.store ?? {}) n += Number(o.store[k]) || 0;
  return n;
}

/** How full, in steps of `n`: 0 when empty, and 1 for the least bit in it. */
function bucket(ratio: number, n = 4): number {
  return ratio <= 0 ? 0 : clamp(Math.ceil(ratio * n), 1, n);
}

/** The resources an object holds, most first, as their colours. */
function goodsOf(o: RoomObject, most = 4): string[] {
  return Object.keys(o.store ?? {})
    .filter((k) => Number(o.store[k]) > 0)
    .sort((a, b) => o.store[b] - o.store[a])
    .slice(0, most)
    .map(resourceColour);
}

function isMine(v: RoomView, o: RoomObject): boolean {
  return !!o.user && (v.me === undefined || o.user === v.me);
}

/** A four-pointed glint, `size` across, `a` bright. */
function glint(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, a: number): void {
  if (a <= 0.01) return;
  ctx.globalAlpha = a;
  ctx.fillStyle = PALETTE.goldLight;
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size * 0.18, y - size * 0.18);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x + size * 0.18, y + size * 0.18);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size * 0.18, y + size * 0.18);
  ctx.lineTo(x - size, y);
  ctx.lineTo(x - size * 0.18, y - size * 0.18);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** How bright a glint is now: it flashes briefly once every few seconds on its own beat. */
function twinkle(now: number, seed: number, period = 2600): number {
  const p = (now / period + seed) % 1;
  return p < 0.12 ? Math.sin((p / 0.12) * Math.PI) : 0;
}

// The ground.

// Flagstones are painted into a pattern a few tiles across, laid from the
// room's corner, so paving runs on unbroken from tile to tile and, the room
// being a whole number of patterns wide, from room to room. They are laid from
// the room and not the world's origin because a shard's plane lies 100,000
// tiles out, where the browser loses a pattern's place and smears it into
// stripes.
const PATTERN_TILES = 2;
const patterns = new Map<string, CanvasPattern>();

function patternBucket(px: number): number {
  const dpr = globalThis.devicePixelRatio || 1;
  return Math.min(128, Math.pow(2, Math.ceil(Math.log2(Math.max(4, px * dpr)) * 2) / 2));
}

function pattern(ctx: CanvasRenderingContext2D, px: number, snow: boolean): CanvasPattern | null {
  const b = patternBucket(px);
  const key = `${b}:${snow}`;
  let p = patterns.get(key);
  if (p) return p;
  const c = document.createElement("canvas");
  c.width = c.height = Math.ceil(PATTERN_TILES * b);
  const g = c.getContext("2d")!;
  g.setTransform(c.width / PATTERN_TILES, 0, 0, c.height / PATTERN_TILES, 0, 0);
  paintFlags(g, snow);
  const made = ctx.createPattern(c, "repeat");
  if (!made) return null;
  p = made;
  p.setTransform(new DOMMatrix([PATTERN_TILES / c.width, 0, 0, PATTERN_TILES / c.height, 0, 0]));
  patterns.set(key, p);
  return p;
}

// Each stone is drawn again a pattern's width either side, so stones across
// its edge meet themselves on the far side.
function wrapped(draw: (dx: number, dy: number) => void): void {
  for (const dx of [-PATTERN_TILES, 0, PATTERN_TILES]) for (const dy of [-PATTERN_TILES, 0, PATTERN_TILES]) draw(dx, dy);
}

function paintFlags(g: CanvasRenderingContext2D, snow: boolean): void {
  const r = rng(977);
  g.fillStyle = "#4a4236";
  g.fillRect(0, 0, PATTERN_TILES, PATTERN_TILES);
  const rows = 5;
  const rh = PATTERN_TILES / rows;
  for (let row = 0; row < rows; row++) {
    const widths: number[] = [];
    let sum = 0;
    while (sum < PATTERN_TILES - 0.01) {
      const w = 0.3 + r() * 0.22;
      widths.push(w);
      sum += w;
    }
    const k = PATTERN_TILES / sum;
    let x = r() * 0.2;
    for (const w0 of widths) {
      const w = w0 * k;
      const y = row * rh;
      const colour = shade(mix("#a39a88", "#8a8270", r()), 0.85 + r() * 0.22);
      wrapped((dx, dy) => {
        g.fillStyle = colour;
        g.fillRect(x + dx + 0.018, y + dy + 0.018, w - 0.036, rh - 0.036);
        g.fillStyle = "rgba(255,255,255,0.07)";
        g.fillRect(x + dx + 0.03, y + dy + 0.03, w - 0.06, 0.02);
      });
      x += w;
    }
  }
  // Worn hollows and a few cracked stones.
  for (let i = 0; i < 10; i++) {
    const cx = r() * PATTERN_TILES;
    const cy = r() * PATTERN_TILES;
    wrapped((dx, dy) => {
      g.fillStyle = "rgba(40,34,26,0.12)";
      ellipse(g, cx + dx, cy + dy, 0.12 + r() * 0.1, 0.08);
      g.fill();
    });
  }
  if (snow) dustSnow(g, r, 0.45);
}

function dustSnow(g: CanvasRenderingContext2D, r: () => number, cover: number): void {
  for (let i = 0; i < 90 * cover; i++) {
    const cx = r() * PATTERN_TILES;
    const cy = r() * PATTERN_TILES;
    const rx = 0.08 + r() * 0.16;
    const a = 0.55 + r() * 0.4;
    wrapped((dx, dy) => {
      g.fillStyle = rgba(PALETTE.snow, a);
      ellipse(g, cx + dx, cy + dy, rx, rx * 0.6);
      g.fill();
    });
  }
}

// The roads of a room as one path in the room's tiles, each road joined to the
// roads beside it (a diagonal only where no corner of straight joins makes it).
const roadPaths = new WeakMap<RoomPlan, Path2D>();

function roadPath(plan: RoomPlan): Path2D {
  let path = roadPaths.get(plan);
  if (path) return path;
  path = new Path2D();
  for (const i of plan.roads) {
    const x = i % 50;
    const y = (i - x) / 50;
    let joined = false;
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      if (!plan.roads.has(tileOf(x + dx, y + dy)) || x + dx > 49 || y + dy < 0) continue;
      if (dx !== 0 && dy !== 0 && (plan.roads.has(tileOf(x + dx, y)) || plan.roads.has(tileOf(x, y + dy)))) continue;
      path.moveTo(x, y);
      path.lineTo(x + dx, y + dy);
      joined = true;
    }
    if (!joined) {
      path.moveTo(x + 0.01, y);
      path.lineTo(x, y);
    }
  }
  roadPaths.set(plan, path);
  return path;
}

// Packed earth worn into the land, and two ruts where the carts run.
const TRACK: Record<"snow" | "autumn" | "green", { edge: string; earth: string; rut: string }> = {
  snow: { edge: "rgba(132,126,120,0.35)", earth: "#a39d94", rut: "#867e74" },
  autumn: { edge: "rgba(84,64,42,0.35)", earth: "#6c5539", rut: "#56422c" },
  green: { edge: "rgba(96,78,52,0.35)", earth: "#7c6649", rut: "#665238" },
};

function drawRoads(ctx: CanvasRenderingContext2D, v: RoomView, plan: RoomPlan, env: Env): void {
  if (plan.roads.size === 0) return;
  const path = roadPath(plan);
  const look = TRACK[env.snow ? "snow" : env.season === "autumn" ? "autumn" : "green"];
  ctx.save();
  ctx.translate(v.r.ox, v.r.oy);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // A soft edge where the grass gives way, the track, then its ruts.
  ctx.strokeStyle = look.edge;
  ctx.lineWidth = 0.9;
  ctx.stroke(path);
  ctx.lineWidth = 0.78;
  ctx.stroke(path);
  ctx.strokeStyle = look.earth;
  ctx.lineWidth = 0.66;
  ctx.stroke(path);
  if (env.px >= 6) {
    ctx.strokeStyle = look.rut;
    ctx.lineWidth = 0.5;
    ctx.stroke(path);
    ctx.strokeStyle = look.earth;
    ctx.lineWidth = 0.34;
    ctx.stroke(path);
  }
  ctx.restore();
}

function drawSquare(ctx: CanvasRenderingContext2D, v: RoomView, town: TownPlan, env: Env): void {
  const tiles = new Set(town.square);
  if (town.fountain) tiles.add(town.fountain);
  if (tiles.size === 0) return;
  const at = new Set<number>();
  const area = new Path2D();
  for (const k of tiles) {
    const [x, y] = k.split(",").map(Number);
    at.add(tileOf(x, y));
    area.rect(x - 0.5, y - 0.5, 1, 1);
  }
  ctx.save();
  ctx.translate(v.r.ox, v.r.oy);
  ctx.fillStyle = (env.px >= 6 && pattern(ctx, env.px, env.snow)) || "#8f877a";
  ctx.fill(area);
  // A kerb of long stones round the edge.
  ctx.beginPath();
  for (const i of at) {
    const x = i % 50;
    const y = (i - x) / 50;
    if (!at.has(tileOf(x, y - 1))) (ctx.moveTo(x - 0.5, y - 0.5), ctx.lineTo(x + 0.5, y - 0.5));
    if (!at.has(tileOf(x, y + 1))) (ctx.moveTo(x - 0.5, y + 0.5), ctx.lineTo(x + 0.5, y + 0.5));
    if (!at.has(tileOf(x - 1, y))) (ctx.moveTo(x - 0.5, y - 0.5), ctx.lineTo(x - 0.5, y + 0.5));
    if (!at.has(tileOf(x + 1, y))) (ctx.moveTo(x + 0.5, y - 0.5), ctx.lineTo(x + 0.5, y + 0.5));
  }
  ctx.lineCap = "square";
  ctx.strokeStyle = "rgba(30,26,20,0.6)";
  ctx.lineWidth = 0.12;
  ctx.stroke();
  ctx.strokeStyle = env.snow ? "#d7dde6" : "#a9a08e";
  ctx.lineWidth = 0.07;
  ctx.stroke();
  ctx.restore();
}

const PLINTH_BOX: Box = [-0.52, -0.6, 0.52, 0.52];

function paintPlinth(g: CanvasRenderingContext2D, snow: boolean): void {
  const h = 0.08;
  flagTop(g, -0.47, -0.47 - h, 0.47, 0.47 - h, 31, snow ? mix(PALETTE.stoneTop, PALETTE.snow, 0.6) : PALETTE.stoneTop);
  g.fillStyle = PALETTE.stoneFront;
  g.fillRect(-0.47, 0.47 - h, 0.94, h);
  g.strokeStyle = rgba(PALETTE.gold, 0.5);
  g.lineWidth = 0.02;
  g.strokeRect(-0.4, -0.4 - h, 0.8, 0.8);
  for (const [cx, cy] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) {
    ellipse(g, cx, cy - h, 0.035, 0.035);
    g.fillStyle = rgba(PALETTE.gold, 0.7);
    g.fill();
  }
}

/** What lies flat on the ground, drawn before every shadow and piece: roads, paving, spilt gold. */
export function drawGround(ctx: CanvasRenderingContext2D, v: RoomView, env: Env): void {
  const plan = planOf(v);
  const { sprites, snow } = env;
  const { ox, oy } = v.r;
  if (v.town && v.scenery) drawSquare(ctx, v, v.town, env);
  drawRoads(ctx, v, plan, env);

  v.town?.cottages.forEach((c) => {
    if (!cottageOnScreen(v, c)) return;
    const seed = variantAt(c.x, c.y);
    sprites.stamp(ctx, `b:floor:${seed}`, ox + c.x, oy + c.y, [-0.5, -0.5, 4.5, 4.5], (g) => paintCottageFloor(g, 300 + seed));
    for (let dy = 1; dy <= 3; dy++) {
      for (let dx = 1; dx <= 3; dx++) {
        const bv = variantAt(c.x + dx, c.y + dy, 4);
        sprites.stamp(ctx, `b:bed:${v.arms.field}:${bv}`, ox + c.x + dx, oy + c.y + dy, [-0.42, -0.5, 0.42, 0.42], (g) => paintBed(g, v.arms.field, 70 + bv));
      }
    }
  });

  for (const id in v.r.objects) {
    const o = v.r.objects[id];
    if (o.type === "creep" || o.type === "powerCreep" || !onScreen(v, o.x, o.y)) continue;
    const x = ox + o.x;
    const y = oy + o.y;
    const variant = variantAt(o.x, o.y);
    switch (o.type) {
      case "rampart":
        if (plan.ramparts.get(tileOf(o.x, o.y)) === "plinth") sprites.stamp(ctx, `b:plinth:${snow}`, x, y, PLINTH_BOX, (g) => paintPlinth(g, snow));
        break;
      case "energy":
      case "resource": {
        const kind = o.resourceType ?? "energy";
        const n = clamp(Math.round(Math.log2(Math.max(2, Number(o[kind]) || Number(o.amount) || Number(o.energy) || 0)) - 2), 1, 9);
        const colour = resourceColour(kind);
        sprites.stamp(ctx, `b:spilt:${colour}:${n}:${variant}`, x, y, [-0.4, -0.3, 0.4, 0.3], (g) => {
          if (kind === "energy") coins(g, 0, 0, n + 1, 90 + variant);
          else pebbles(g, colour, n + 1, 90 + variant);
        });
        break;
      }
      case "tombstone": {
        const n = bucket(amount(o) / 400, 3);
        sprites.stamp(ctx, `b:mound:${n}:${snow}`, x, y, [-0.42, -0.25, 0.42, 0.35], (g) => {
          ellipse(g, 0, 0.08, 0.3, 0.14);
          g.fillStyle = snow ? PALETTE.snowShade : "#4a3a28";
          g.fill();
          ellipse(g, -0.03, 0.05, 0.24, 0.09);
          g.fillStyle = snow ? PALETTE.snow : "#5c4831";
          g.fill();
          if (n > 0) coins(g, 0.15, 0.18, n * 2, 61);
        });
        break;
      }
      case "ruin": {
        sprites.stamp(ctx, `b:ruinground:${variant}`, x, y, [-0.5, -0.5, 0.5, 0.5], (g) => {
          const r = rng(500 + variant);
          for (let i = 0; i < 12; i++) {
            ellipse(g, (r() - 0.5) * 0.85, (r() - 0.5) * 0.8, 0.03 + r() * 0.05, 0.02 + r() * 0.03);
            g.fillStyle = shade(PALETTE.stoneFront, 0.7 + r() * 0.4);
            g.fill();
          }
        });
        if (o.store && amount(o) > 0) sprites.stamp(ctx, `b:spilt:${PALETTE.gold}:3:${variant}`, x, y + 0.2, [-0.4, -0.3, 0.4, 0.3], (g) => coins(g, 0, 0, 4, 90 + variant));
        break;
      }
      case "constructionSite": {
        const road = o.structureType === "road";
        const foreign = !isMine(v, o);
        sprites.stamp(ctx, `b:site:${road}:${foreign}`, x, y, [-0.55, -0.6, 0.55, 0.55], (g) => paintSiteGround(g, road, foreign));
        break;
      }
    }
  }
}

function pebbles(g: CanvasRenderingContext2D, colour: string, n: number, seed: number): void {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const cx = (r() - 0.5) * 0.5;
    const cy = (r() - 0.5) * 0.3;
    ellipse(g, cx, cy, 0.045, 0.03);
    g.fillStyle = shade(colour, 0.6 + r() * 0.5);
    g.fill();
    ellipse(g, cx - 0.012, cy - 0.01, 0.015, 0.01);
    g.fillStyle = "rgba(255,255,255,0.6)";
    g.fill();
  }
}

/** The ground marked out for building: turned earth inside pegs and string. */
function paintSiteGround(g: CanvasRenderingContext2D, road: boolean, foreign: boolean): void {
  const string = foreign ? "#c0392b" : "#e2d6b0";
  if (!road) {
    g.fillStyle = "rgba(92,72,46,0.55)";
    g.fillRect(-0.44, -0.44, 0.88, 0.88);
  } else {
    ellipse(g, 0, 0, 0.36, 0.3);
    g.fillStyle = "rgba(92,72,46,0.4)";
    g.fill();
  }
  const s = road ? 0.36 : 0.44;
  g.strokeStyle = string;
  g.lineWidth = 0.018;
  g.setLineDash([0.06, 0.04]);
  g.strokeRect(-s, -s, s * 2, s * 2);
  g.setLineDash([]);
  for (const [cx, cy] of [[-s, -s], [s, -s], [-s, s], [s, s]]) {
    g.fillStyle = PALETTE.woodDark;
    g.fillRect(cx - 0.02, cy - 0.1, 0.04, 0.1);
    g.fillStyle = PALETTE.wood;
    g.fillRect(cx - 0.02, cy - 0.11, 0.04, 0.02);
  }
}

// What stands.

function cottageOnScreen(v: RoomView, c: { x: number; y: number }): boolean {
  const x0 = v.r.ox + c.x - 1;
  const x1 = v.r.ox + c.x + 5;
  const y0 = v.r.oy + c.y - 3;
  const y1 = v.r.oy + c.y + 5;
  return x1 >= v.rect[0] && x0 <= v.rect[2] && y1 >= v.rect[1] && y0 <= v.rect[3];
}

/** Every structure in the room, and the town's dressing, as pieces of the scene. */
export function structurePieces(v: RoomView, env: Env, out: Piece[]): void {
  const plan = planOf(v);
  const { sprites, snow, now, sky } = env;
  const { ox, oy } = v.r;
  const lit = sky.lit;
  const lights = env.lights;
  const stamp = (key: string, x: number, y: number, box: Box, paint: (g: CanvasRenderingContext2D) => void) => (ctx: CanvasRenderingContext2D) =>
    sprites.stamp(ctx, key, x, y, box, paint);

  // Where people stand this tick, for manned posts and lit windows.
  const standing = new Set<number>();
  for (const id in v.r.objects) {
    const o = v.r.objects[id];
    if ((o.type === "creep" || o.type === "powerCreep") && !o.spawning) standing.add(tileOf(o.x, o.y));
  }

  for (const id in v.r.objects) {
    const o = v.r.objects[id];
    if (o.type === "creep" || o.type === "powerCreep" || !onScreen(v, o.x, o.y)) continue;
    const x = ox + o.x;
    const y = oy + o.y;
    const i = tileOf(o.x, o.y);
    const variant = variantAt(o.x, o.y);
    const seed = 100 + variant * 97;
    switch (o.type) {
      case "spawn": {
        const spawning = o.spawning && typeof o.spawning === "object";
        const draw = stamp(`b:barracks:${v.room}:${snow}`, x, y, BARRACKS_BOX, (g) => paintBarracks(g, v.room, snow, seed));
        out.push({
          depth: y + 0.46,
          draw(ctx) {
            draw(ctx);
            const [dx, dy] = BARRACKS_DOOR;
            if (spawning || lit > 0.05) {
              // The door stands open on the hearth inside, brightest while a recruit is mustered.
              const glow = spawning ? 0.75 + 0.2 * Math.sin(now / 260) : 0.55 * lit;
              ctx.globalAlpha = glow;
              ctx.beginPath();
              ctx.moveTo(x + dx - 0.14, y + dy);
              ctx.lineTo(x + dx - 0.14, y + dy - 0.36);
              ctx.arc(x + dx, y + dy - 0.36, 0.14, Math.PI, 0);
              ctx.lineTo(x + dx + 0.14, y + dy);
              ctx.closePath();
              const g = ctx.createLinearGradient(0, y + dy - 0.5, 0, y + dy);
              g.addColorStop(0, "#ffb347");
              g.addColorStop(1, "#ffe2a0");
              ctx.fillStyle = g;
              ctx.fill();
              ctx.globalAlpha = 1;
            }
            if (lit > 0.05) for (const s of [-1, 1]) flame(ctx, x + s * 0.25, y - 0.09, 0.09 * lit, now, o.x + s);
            smoke(ctx, x + BARRACKS_CHIMNEY[0], y + BARRACKS_CHIMNEY[1], now, o.x * 0.1, "#9a958e", 0.6);
          },
          shadow(path, cast) {
            castBlock(path, x - 0.44, y - 0.42, x + 0.44, y + 0.36, 1.05, cast);
          },
        });
        lights.push({ x, y: y + 0.2, r: spawning ? 2.6 : 1.6, colour: "#ffb347", power: spawning ? 0.95 : 0.55 * lit });
        break;
      }
      case "tower": {
        const fill = clamp(amount(o) / (capacity(o) || 1000), 0, 1);
        const draw = stamp(`b:tower:${snow}:${variant}`, x, y, TOWER_BOX, (g) => paintWatchtower(g, snow, seed));
        out.push({
          depth: y + TOWER_R * SQUASH,
          draw(ctx) {
            draw(ctx);
            const [fx, fy] = TOWER_FIRE;
            if (lit > 0.05 && fill > 0) flame(ctx, x + fx, y + fy, (0.18 + 0.2 * fill) * lit, now, o.x * 1.3 + o.y);
            else smoke(ctx, x + fx, y + fy, now, o.y * 0.3, "#7a7672", 0.35);
          },
          shadow(path, cast) {
            castRound(path, x, y, TOWER_R + 0.06, (TOWER_R + 0.06) * SQUASH, TOWER_H + 0.14, cast, TOWER_R + 0.06);
          },
        });
        if (fill > 0) lights.push({ x, y: y - TOWER_H, r: 2.2 + fill, colour: "#ff8a33", power: (0.55 + 0.35 * fill) * lit });
        break;
      }
      case "storage": {
        const fill = bucket(storeTotal(o) / (o.storeCapacity || 1000000));
        const draw = stamp(`b:treasury:${fill}:${snow}`, x, y, TREASURY_BOX, (g) => paintTreasury(g, fill, snow, seed));
        out.push({
          depth: y + 0.46,
          draw(ctx) {
            draw(ctx);
            if (fill > 0 && env.px >= 8) {
              glint(ctx, x - 0.3, y + 0.22, 0.07, twinkle(now, 0.1));
              if (fill >= 2) glint(ctx, x + 0.32, y + 0.24, 0.07, twinkle(now, 0.55));
            }
          },
          shadow(path, cast) {
            castBlock(path, x - 0.45, y - 0.45, x + 0.45, y + 0.06, 0.95, cast);
          },
        });
        break;
      }
      case "extension": {
        const fill = bucket(amount(o) / (capacity(o) || 50));
        const draw = stamp(`b:coffer:${fill}:${snow}`, x, y, COFFER_BOX, (g) => paintCoffer(g, fill, snow, seed));
        const beat = hash2(o.x, o.y);
        out.push({
          depth: y + 0.15,
          draw(ctx) {
            draw(ctx);
            if (fill >= 2 && env.px >= 8) glint(ctx, x - 0.08 + beat * 0.16, y - 0.2, 0.06, twinkle(now, beat, 3400));
          },
          shadow(path, cast) {
            castBlock(path, x - 0.27, y - 0.14, x + 0.27, y + 0.15, 0.3, cast);
          },
        });
        break;
      }
      case "terminal": {
        const goods = goodsOf(o);
        const draw = stamp(`b:market:${v.room}:${goods.join()}:${snow}`, x, y, MARKET_BOX, (g) => paintTradingPost(g, v.arms.field, v.arms.other, goods, snow, seed));
        out.push({
          depth: y + 0.31,
          draw,
          shadow(path, cast) {
            castBlock(path, x - 0.5, y - 0.4, x + 0.5, y + 0.3, 1.0, cast);
          },
        });
        break;
      }
      case "lab": {
        const mineral = o.mineralType ?? Object.keys(o.store ?? {}).find((k) => k !== "energy" && o.store[k] > 0);
        const held = mineral ? amount(o, mineral) : 0;
        const level = bucket(held / 3000, 3);
        const colour = mineral ? resourceColour(mineral) : "#7fc4e8";
        const working = Number(o.cooldown) > 0;
        const draw = stamp(`b:lab:${colour}:${level}:${snow}`, x, y, LAB_BOX, (g) => paintAthanor(g, colour, level, snow, seed));
        out.push({
          depth: y + 0.17,
          draw(ctx) {
            draw(ctx);
            const [mx, my] = LAB_MOUTH;
            ctx.globalAlpha = 0.55 + 0.35 * Math.sin(now / 90 + o.x);
            ctx.fillStyle = PALETTE.fire;
            ellipse(ctx, x + mx, y + my - 0.02, 0.05, 0.035);
            ctx.fill();
            ctx.globalAlpha = 1;
            if (level > 0 && env.px >= 8) {
              const [fx, fy] = LAB_FLASK;
              for (let k = 0; k < (working ? 5 : 3); k++) {
                const p = (now / (working ? 700 : 1300) + k / 3 + o.y * 0.1) % 1;
                ellipse(ctx, x + fx + Math.sin(p * 9 + k) * 0.05, y + fy + 0.12 - p * 0.26, 0.018 + p * 0.012, 0.018 + p * 0.012);
                ctx.fillStyle = rgba("#ffffff", 0.7 * (1 - p));
                ctx.fill();
              }
              if (working) smoke(ctx, x + 0.3, y - 0.5, now, o.x * 0.2, mix(colour, "#ffffff", 0.4), 0.35);
            }
          },
          shadow(path, cast) {
            castRound(path, x - 0.04, y, 0.26, 0.16, 0.86, cast, 0.17);
          },
        });
        lights.push({ x: x - 0.04, y: y - 0.6, r: 1.3, colour: level > 0 ? colour : "#ff7a22", power: 0.45 });
        break;
      }
      case "factory": {
        const draw = stamp(`b:workshop:${snow}`, x, y, WORKSHOP_BOX, (g) => paintWorkshop(g, snow, seed));
        out.push({
          depth: y + 0.22,
          draw(ctx) {
            draw(ctx);
            const [fx, fy] = WORKSHOP_FORGE;
            const heat = 0.6 + 0.25 * Math.sin(now / 120 + o.x) + 0.15 * Math.sin(now / 47);
            // The fire in the forge's arched mouth, breathing.
            ctx.globalAlpha = heat;
            ctx.beginPath();
            ctx.moveTo(x + fx - 0.15, y + fy - 0.02);
            ctx.lineTo(x + fx - 0.15, y + fy - 0.16);
            ctx.quadraticCurveTo(x + fx, y + fy - 0.26, x + fx + 0.15, y + fy - 0.16);
            ctx.lineTo(x + fx + 0.15, y + fy - 0.02);
            ctx.closePath();
            ctx.fillStyle = PALETTE.fire;
            ctx.fill();
            ellipse(ctx, x + fx, y + fy - 0.06, 0.09, 0.045);
            ctx.fillStyle = PALETTE.fireCore;
            ctx.fill();
            ctx.globalAlpha = 1;
            smoke(ctx, x + WORKSHOP_CHIMNEY[0], y + WORKSHOP_CHIMNEY[1], now, o.y * 0.2, "#6e6a66", 0.8);
          },
          shadow(path, cast) {
            castBlock(path, x - 0.5, y - 0.45, x + 0.5, y + 0.22, 1.0, cast);
          },
        });
        lights.push({ x: x + WORKSHOP_FORGE[0], y: y + WORKSHOP_FORGE[1], r: 1.7, colour: "#ff7a22", power: 0.7 });
        break;
      }
      case "extractor": {
        const draw = stamp(`b:headframe:${snow}`, x, y, HEADFRAME_BOX, (g) => paintHeadframe(g, snow, seed));
        out.push({
          depth: y + 0.51,
          draw,
          shadow(path, cast) {
            castRound(path, x, y, 0.42, 0.26, 1.5, cast, 0.16);
          },
        });
        break;
      }
      case "observer": {
        const draw = stamp(`b:pedestal:${snow}`, x, y, PEDESTAL_BOX, (g) => paintPedestal(g, snow, seed));
        out.push({
          depth: y + 0.19,
          draw(ctx) {
            draw(ctx);
            drawOrb(ctx, x + ORB[0], y + ORB[1], now);
          },
          shadow(path, cast) {
            castRound(path, x, y, 0.3, 0.19, 1.05, cast, 0.16);
          },
        });
        lights.push({ x, y: y + ORB[1], r: 1.6, colour: "#9fd4ff", power: 0.6 });
        break;
      }
      case "powerSpawn": {
        const draw = stamp(`b:shrine:${snow}`, x, y, SHRINE_BOX, (g) => paintShrine(g, snow, seed));
        out.push({
          depth: y + 0.29,
          draw(ctx) {
            draw(ctx);
            const bob = Math.sin(now / 700) * 0.05;
            drawShard(ctx, x + SHRINE_CRYSTAL[0], y + SHRINE_CRYSTAL[1] + bob, 0.1, 0.3, "#f41f33", now);
          },
          shadow(path, cast) {
            castRound(path, x, y, 0.46, 0.29, 0.95, cast, 0.4);
          },
        });
        lights.push({ x, y: y - 0.7, r: 1.7, colour: "#ff3b4a", power: 0.7 });
        break;
      }
      case "nuker": {
        const draw = stamp(`b:engine:${snow}`, x, y, ENGINE_BOX, (g) => paintTrebuchet(g, snow, seed));
        out.push({
          depth: y + 0.26,
          draw(ctx) {
            draw(ctx);
            const pulse = 0.45 + 0.35 * Math.sin(now / 600 + o.x);
            ctx.globalAlpha = pulse;
            ctx.fillStyle = "#c79bff";
            for (const [rx, ry] of ENGINE_RUNES) {
              ellipse(ctx, x + rx, y + ry, 0.05, 0.05);
              ctx.fill();
            }
            ctx.globalAlpha = 1;
          },
          shadow(path, cast) {
            castBlock(path, x - 0.5, y - 0.2, x + 0.5, y + 0.26, 1.2, cast);
          },
        });
        lights.push({ x, y: y - 0.4, r: 1.8, colour: "#b06cff", power: 0.5 });
        break;
      }
      case "controller": {
        const owner: Owner = o.user ? (isMine(v, o) ? "mine" : "foreign") : "none";
        const level = Number(o.level) || 0;
        const draw = stamp(`b:throne:${v.room}:${level}:${owner}:${snow}`, x, y, THRONE_BOX, (g) => paintThrone(g, v.room, level, owner, snow, seed));
        out.push({
          depth: y + 0.46,
          draw,
          shadow(path, cast) {
            castBlock(path, x - 0.8, y - 0.48, x + 0.8, y + 0.46, 0.3, cast);
            castBlock(path, x - 0.22, y - 0.6, x + 0.22, y - 0.3, 1.25, cast);
            if (owner !== "none") for (const s of [-1, 1]) castRound(path, x + s * 0.7, y - 0.3, 0.04, 0.03, 1.6, cast, 0.16);
          },
        });
        break;
      }
      case "source": {
        const ratio = clamp((Number(o.energy) || 0) / (o.energyCapacity || 3000), 0, 1);
        const rich = bucket(ratio);
        const draw = stamp(`b:vein:${rich}:${snow}:${variant}`, x, y, VEIN_BOX, (g) => paintVein(g, rich, snow, seed));
        out.push({
          depth: y + 0.4,
          draw(ctx) {
            draw(ctx);
            if (env.px < 8) return;
            for (let k = 0; k < rich; k++) {
              const h = hash2(o.x * 31 + k, o.y * 17 - k);
              glint(ctx, x - 0.35 + h * 0.7, y - 0.15 - hash2(k, o.x) * 0.4, 0.07, twinkle(now, h, 1800 + k * 300));
            }
          },
          shadow(path, cast) {
            castRound(path, x, y + 0.12, 0.5, 0.3, 0.55, cast, 0.4);
          },
        });
        lights.push({ x, y: y - 0.2, r: 1.5, colour: PALETTE.gold, power: 0.12 + 0.3 * ratio });
        break;
      }
      case "mineral": {
        const spent = !(Number(o.mineralAmount) > 0);
        const colour = resourceColour(o.mineralType);
        const draw = stamp(`b:crystal:${o.mineralType}:${spent}:${snow}`, x, y, CRYSTAL_BOX, (g) => paintCrystals(g, colour, spent, snow, seed));
        out.push({
          depth: y + 0.3,
          draw,
          shadow(path, cast) {
            castRound(path, x, y + 0.1, 0.4, 0.25, spent ? 0.3 : 0.8, cast, 0.15);
          },
        });
        if (!spent) lights.push({ x, y: y - 0.3, r: 1.1, colour, power: 0.3 });
        break;
      }
      case "container": {
        const goods = amount(o) > 0 ? PALETTE.gold : goodsOf(o, 1)[0];
        const draw = stamp(`b:crates:${goods}:${snow}`, x, y, CRATES_BOX, (g) => paintCrates(g, goods, snow, seed));
        out.push({
          depth: y - 0.05,
          draw,
          shadow(path, cast) {
            castBlock(path, x - 0.38, y - 0.42, x + 0.36, y - 0.1, 0.52, cast);
          },
        });
        break;
      }
      case "link": {
        const ratio = clamp(amount(o) / (capacity(o) || 800), 0, 1);
        const fill = bucket(ratio);
        const draw = stamp(`b:obelisk:${fill}:${snow}`, x, y, OBELISK_BOX, (g) => paintObelisk(g, fill, snow, seed));
        out.push({
          depth: y + 0.12,
          draw,
          shadow(path, cast) {
            castRound(path, x, y, 0.14, 0.09, 1.12, cast, 0.03);
          },
        });
        lights.push({ x, y: y - 0.6, r: 1.1, colour: PALETTE.gold, power: 0.12 + 0.4 * ratio });
        break;
      }
      case "constructedWall": {
        if (!plan.curtain.has(i)) break;
        const mask = ringMask(plan, o.x, o.y);
        out.push(ringPiece(v, env, "wall", o.x, o.y, mask, variant));
        break;
      }
      case "rampart": {
        const kind = plan.ramparts.get(i);
        if (kind === "gate") out.push(gatePiece(v, env, plan, o.x, o.y));
        else if (kind === "battlement") out.push(ringPiece(v, env, "battlement", o.x, o.y, ringMask(plan, o.x, o.y), variant));
        else if (kind === "post") postPieces(v, env, plan, o.x, o.y, standing.has(i), out);
        break;
      }
      case "keeperLair": {
        const draw = stamp(`b:lair:${snow}`, x, y, LAIR_BOX, (g) => paintLair(g, snow, seed));
        out.push({
          depth: y + 0.45,
          draw(ctx) {
            draw(ctx);
            const blink = (now / 3800 + o.x * 0.13) % 1 < 0.05 ? 0 : 1;
            ctx.globalAlpha = 0.85 * blink;
            ctx.fillStyle = "#ff2a1a";
            for (const s of [-1, 1]) {
              ellipse(ctx, x + LAIR_EYES[0] + s * 0.07, y + LAIR_EYES[1], 0.03, 0.018);
              ctx.fill();
            }
            ctx.globalAlpha = 1;
          },
          shadow(path, cast) {
            castRound(path, x, y, 0.6, 0.36, 1.0, cast, 0.4);
          },
        });
        lights.push({ x, y: y - 0.3, r: 0.9, colour: "#ff3020", power: 0.4 });
        break;
      }
      case "invaderCore": {
        const draw = stamp(`b:spire`, x, y, SPIRE_BOX, (g) => paintSpire(g, seed));
        out.push({
          depth: y + 0.3,
          draw,
          shadow(path, cast) {
            castRound(path, x, y, 0.3, 0.2, 1.9, cast, 0.04);
          },
        });
        lights.push({ x, y: y - 1.0, r: 1.8, colour: "#c050ff", power: 0.6 });
        break;
      }
      case "powerBank": {
        const draw = stamp(`b:bank`, x, y, BANK_BOX, (g) => paintBank(g, seed));
        out.push({
          depth: y + 0.35,
          draw,
          shadow(path, cast) {
            castRound(path, x, y + 0.1, 0.45, 0.28, 1.1, cast, 0.15);
          },
        });
        lights.push({ x, y: y - 0.5, r: 1.6, colour: "#f41f33", power: 0.55 });
        break;
      }
      case "portal": {
        const draw = stamp(`b:portal:${snow}`, x, y, PORTAL_BOX, (g) => paintPortalArch(g, snow, seed));
        out.push({
          depth: y + 0.14,
          draw(ctx) {
            drawVortex(ctx, x + PORTAL_EYE[0], y + PORTAL_EYE[1], now);
            draw(ctx);
          },
          shadow(path, cast) {
            castBlock(path, x - 0.64, y - 0.12, x + 0.64, y + 0.14, 1.65, cast);
          },
        });
        lights.push({ x, y: y - 0.8, r: 2.2, colour: "#b07cff", power: 0.8 });
        break;
      }
      case "deposit": {
        const kind = String(o.depositType ?? "silicon");
        const draw = stamp(`b:deposit:${kind}:${snow}`, x, y, DEPOSIT_BOX, (g) => paintDeposit(g, kind, snow, seed));
        out.push({ depth: y + 0.35, draw });
        break;
      }
      case "ruin": {
        const draw = stamp(`b:rubble:${snow}:${variant}`, x, y, RUBBLE_BOX, (g) => paintRubble(g, snow, seed));
        out.push({
          depth: y + 0.05,
          draw,
          shadow(path, cast) {
            castBlock(path, x - 0.36, y - 0.08, x + 0.24, y, 0.6, cast);
          },
        });
        break;
      }
      case "tombstone": {
        const draw = stamp(`b:headstone:${snow}:${variant}`, x, y, HEADSTONE_BOX, (g) => paintHeadstone(g, snow, seed));
        out.push({
          depth: y + 0.02,
          draw,
          shadow(path, cast) {
            castBlock(path, x - 0.14, y - 0.03, x + 0.14, y + 0.03, 0.46, cast);
          },
        });
        break;
      }
      case "constructionSite": {
        if (o.structureType === "road") break;
        const done = Math.floor(clamp((Number(o.progress) || 0) / (Number(o.progressTotal) || 1), 0, 0.999) * 6);
        const foreign = !isMine(v, o);
        const draw = stamp(`b:scaffold:${done}:${foreign}:${snow}`, x, y, SCAFFOLD_BOX, (g) => paintScaffold(g, done, foreign, snow, seed));
        out.push({
          depth: y + 0.36,
          draw,
          shadow(path, cast) {
            castBlock(path, x - 0.34, y - 0.28, x + 0.34, y + 0.28, 0.08 + (done / 5) * 0.72, cast);
            for (const [px, py] of [[-0.42, -0.34], [0.42, -0.34], [-0.42, 0.34], [0.42, 0.34]]) castRound(path, x + px, y + py, 0.02, 0.015, 1.08, cast);
          },
        });
        break;
      }
    }
  }

  const town = v.town;
  if (town) {
    const occupied = new Set<number>();
    for (const i of standing) {
      const n = plan.house.get(i);
      const x = i % 50;
      const y = (i - x) / 50;
      if (n !== undefined) {
        const c = town.cottages[n];
        if (x > c.x && x < c.x + 4 && y > c.y && y < c.y + 4) occupied.add(n);
      }
    }
    town.cottages.forEach((c, n) => {
      if (cottageOnScreen(v, c)) cottagePieces(v, env, c, occupied.has(n), out);
    });
    if (plan.fountain !== undefined) {
      const fx = plan.fountain % 50;
      const fy = (plan.fountain - fx) / 50;
      if (onScreen(v, fx, fy)) out.push(fountainPiece(v, env, fx, fy));
      if (v.scenery && sky.feast) feastPieces(v, env, fx, fy, out);
    }
  } else if (v.scenery && v.terrain) {
    campPieces(v, env, out);
  }

  effectPieces(v, env, out);

}

// The ring: curtain wall, battlements and gates.

function ringPiece(v: RoomView, env: Env, kind: "wall" | "battlement", rx: number, ry: number, mask: number, variant: number): Piece {
  const x = v.r.ox + rx;
  const y = v.r.oy + ry;
  const wall = kind === "wall";
  const h = wall ? WALL_H : BATTLEMENT_H;
  const i = wall ? 0.5 - WALL_INSET : 0.46;
  const key = `b:${kind}:${mask}:${variant}:${env.snow}`;
  const box: Box = [-0.55, -0.5 - h - 0.25, 0.55, 0.55];
  const x0 = mask & W ? -0.5 : -i;
  const x1 = mask & E ? 0.5 : i;
  const y0 = mask & N ? -0.5 : -i;
  const y1 = mask & S ? 0.5 : i;
  return {
    // A battlement is a platform people stand on, so they are drawn over it.
    depth: wall ? y + y1 : y - 0.1,
    draw(ctx) {
      env.sprites.stamp(ctx, key, x, y, box, (g) => paintRing(g, kind, mask, 700 + variant * 31, env.snow));
    },
    shadow(path, cast) {
      castBlock(path, x + x0, y + y0, x + x1, y + y1, h + (wall ? 0.18 : 0.12), cast);
    },
  };
}

function gatePiece(v: RoomView, env: Env, plan: RoomPlan, rx: number, ry: number): Piece {
  const x = v.r.ox + rx;
  const y = v.r.oy + ry;
  // The wall runs across the picture when it goes on east or west of the gate.
  const across = plan.curtain.has(tileOf(rx - 1, ry)) || plan.curtain.has(tileOf(rx + 1, ry)) || !(inRing(plan, tileOf(rx, ry - 1)) || inRing(plan, tileOf(rx, ry + 1)));
  const key = `b:gate:${across}:${env.snow}`;
  const box: Box = [-0.55, -0.5 - GATE_H - 0.3, 0.55, 0.55];
  return {
    // People walking through the arch are drawn in it, over the gatehouse.
    depth: across ? y : y + 0.5,
    draw(ctx) {
      env.sprites.stamp(ctx, key, x, y, box, (g) => paintGate(g, across, 811, env.snow));
    },
    shadow(path, cast) {
      castBlock(path, x - 0.5, y - 0.5, x + 0.5, y + 0.5, GATE_H + 0.2, cast);
    },
  };
}

// The town.

function postPieces(v: RoomView, env: Env, plan: RoomPlan, rx: number, ry: number, manned: boolean, out: Piece[]): void {
  const x = v.r.ox + rx;
  const y = v.r.oy + ry;
  const mask = (plan.posts.has(tileOf(rx + 1, ry)) ? E : 0) | (plan.posts.has(tileOf(rx - 1, ry)) ? W : 0);
  const pole = v.scenery;
  const key = `b:post:${mask}:${env.snow}:${pole}`;
  const box: Box = [-0.55, -POST_DECK - 1.5, 0.55, 0.5];
  const { now, sky } = env;
  const lit = sky.lit;
  const seed = rx * 7 + ry * 3;
  out.push({
    // The militia stand on the deck, so they are drawn over the post.
    depth: y - 0.3,
    draw(ctx) {
      env.sprites.stamp(ctx, key, x, y, box, (g) => paintPost(g, mask, 900 + seed, env.snow, pole));
      if (!pole) return;
      const px = x + POST_POLE[0];
      const top = y + POST_POLE[1] - POST_POLE_TOP;
      if (manned) pennant(ctx, px, top, 0.42, v.arms.field, v.arms.other, now, seed);
      else {
        // Furled against the pole while no one keeps the post.
        ctx.fillStyle = shade(v.arms.field, 0.7);
        ctx.fillRect(px + 0.01, top + 0.02, 0.05, 0.3);
      }
      if (lit > 0.05) {
        const tx = x + 0.32;
        const ty = y - 0.34 - POST_DECK - 0.22;
        line(ctx, tx, ty, tx, ty + 0.24, PALETTE.woodDark, 0.03);
        flame(ctx, tx, ty, 0.16 * lit, now, seed);
      }
    },
    shadow(path, cast) {
      castBlock(path, x - 0.42, y - 0.4, x + 0.42, y + 0.36, POST_DECK + 0.1, cast);
    },
  });
  if (pole && lit > 0.05) env.lights.push({ x: x + 0.32, y: y - 1.1, r: 1.8, colour: "#ff9933", power: 0.75 * lit });
}

type Cottage = TownPlan["cottages"][number];

function cottagePieces(v: RoomView, env: Env, c: Cottage, occupied: boolean, out: Piece[]): void {
  const { ox, oy } = v.r;
  const { sprites, snow, season, now, sky } = env;
  const X = ox + c.x;
  const Y = oy + c.y;
  const seed = 400 + variantAt(c.x, c.y) * 13;
  const [doorX, doorY] = c.door.split(",").map(Number);
  const ddx = doorX - c.x;
  const ddy = doorY - c.y;
  const side = ddy === 0 ? "n" : ddy === 4 ? "s" : ddx === 0 ? "w" : "e";
  const wall = HOUSE_WALL;
  // Lamps in the windows while someone is abed and the town's lamps are lit.
  const lamps = v.scenery && occupied ? sky.lit : 0;
  const roofAlpha = 1 - smoothstep(40, 52, env.px);

  // The north wall, its inner face towards us.
  out.push({
    depth: Y - 0.5 + wall,
    draw(ctx) {
      sprites.stamp(ctx, `b:cnorth:${side === "n" ? ddx : -1}:${snow}`, X, Y, [-0.6, -0.5 - HOUSE_H - 0.1, 4.6, -0.5 + wall + 0.05], (g) => {
        paintHouseWall(g, -0.5, -0.5, 4.5, -0.5 + wall, seed + 1, snow);
        if (side === "n") door(g, ddx, -0.5 + wall, 0.34, 0.62, seed + 2);
      });
    },
  });
  // The side walls, in runs either side of a door.
  for (const s of ["w", "e"] as const) {
    const x0 = s === "w" ? X - 0.5 : X + 4.5 - wall;
    const x1 = x0 + wall;
    const runs: Array<[number, number]> = side === s ? [[Y - 0.5, Y + ddy - 0.32], [Y + ddy + 0.32, Y + 4.5 - wall]] : [[Y - 0.5, Y + 4.5 - wall]];
    for (const [y0, y1] of runs) {
      out.push({
        depth: y1,
        draw(ctx) {
          paintHouseWall(ctx, x0, y0, x1, y1, seed + 3, snow);
        },
      });
    }
    if (side === s) {
      // The door swung in against the wall's inner face.
      const hinge = Y + ddy - 0.32;
      const lx = s === "w" ? x1 : x0 - 0.46;
      out.push({
        depth: hinge + 0.02,
        draw(ctx) {
          planks(ctx, lx, hinge - 0.62, lx + 0.46, hinge, seed + 4, "#5a3a1e", 0.115);
        },
      });
    }
  }
  // The front, with its windows.
  const front = Y + 4.5;
  out.push({
    depth: front,
    draw(ctx) {
      sprites.stamp(ctx, `b:cfront:${side === "s" ? ddx : -1}:${season}:${snow}`, X, front, [-0.65, -HOUSE_H - wall - 0.1, 4.65, 0.08], (g) =>
        paintHouseFront(g, side === "s" ? ddx : undefined, season, seed + 5, snow),
      );
      if (lamps > 0.02) {
        ctx.globalAlpha = 0.85 * lamps;
        ctx.fillStyle = "#ffc46a";
        for (const [wx, wy] of HOUSE_WINDOWS) if (!(side === "s" && wx === ddx)) ctx.fillRect(X + wx - 0.11, front + wy - 0.12, 0.22, 0.24);
        ctx.globalAlpha = 1;
      }
    },
    shadow(path, cast) {
      if (roofAlpha > 0.5) castBlock(path, X - 0.5, Y - 0.5, X + 4.5, Y + 4.5, HOUSE_H + HOUSE_RISE * 0.6, cast);
      else {
        castBlock(path, X - 0.5, Y - 0.5, X + 4.5, Y - 0.5 + wall, HOUSE_H, cast);
        castBlock(path, X - 0.5, Y + 4.5 - wall, X + 4.5, Y + 4.5, HOUSE_H, cast);
        castBlock(path, X - 0.5, Y - 0.5, X - 0.5 + wall, Y + 4.5, HOUSE_H, cast);
        castBlock(path, X + 4.5 - wall, Y - 0.5, X + 4.5, Y + 4.5, HOUSE_H, cast);
      }
    },
  });
  if (lamps > 0.02) {
    for (const [wx, wy] of HOUSE_WINDOWS) env.lights.push({ x: X + wx, y: front + wy + 0.4, r: 1.5, colour: "#ffb24a", power: 0.55 * lamps });
  }
  // The roof, lifted away as the camera comes close, to show who sleeps inside.
  if (roofAlpha > 0.01) {
    out.push({
      depth: front + 0.02,
      draw(ctx) {
        ctx.globalAlpha = roofAlpha;
        sprites.stamp(ctx, `b:roof:${snow}:${seed % 3}`, X, Y, [-0.85, -1.85, 4.85, 3.85], (g) => paintCottageRoof(g, seed + 6, snow));
        if (lamps > 0.02) {
          ctx.globalAlpha = roofAlpha * 0.85 * lamps;
          ctx.fillStyle = "#ffc46a";
          ctx.fillRect(X + COTTAGE_DORMER[0] - 0.1, Y + COTTAGE_DORMER[1] - 0.1, 0.2, 0.2);
        }
        ctx.globalAlpha = roofAlpha;
        smoke(ctx, X + COTTAGE_CHIMNEY[0], Y + COTTAGE_CHIMNEY[1], now, c.x * 0.1, "#9a958e", 0.8);
        ctx.globalAlpha = 1;
      },
    });
  }
}

function fountainPiece(v: RoomView, env: Env, fx: number, fy: number): Piece {
  const x = v.r.ox + fx;
  const y = v.r.oy + fy;
  const frozen = env.snow;
  const { now } = env;
  const running = v.scenery && !frozen;
  return {
    depth: y + 0.66 * SQUASH,
    draw(ctx) {
      env.sprites.stamp(ctx, `b:fountain:${frozen}`, x, y, [-0.75, -0.75, 0.75, 0.5], (g) => paintFountain(g, 1201, frozen));
      if (running) {
        // Rings spreading where the water falls.
        for (let k = 0; k < 3; k++) {
          const p = (now / 2200 + k / 3) % 1;
          ctx.globalAlpha = 0.5 * (1 - p);
          ctx.strokeStyle = "#a8d8f0";
          ctx.lineWidth = 0.02;
          ctx.beginPath();
          ctx.ellipse(x, y - 0.24, 0.12 + p * 0.42, (0.12 + p * 0.42) * SQUASH, 0, 0, TAU);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      env.sprites.stamp(ctx, `b:fountaintop:${frozen}`, x, y, [-0.3, -1.25, 0.3, 0], (g) => paintFountainPillar(g, frozen));
      if (running) {
        // Water falling from the bowl in four arcs, and the jet over it.
        ctx.strokeStyle = "rgba(190,225,245,0.75)";
        ctx.lineWidth = 0.025;
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(x + s * 0.2, y - 0.93);
          ctx.quadraticCurveTo(x + s * 0.32, y - 0.88, x + s * 0.34, y - 0.3);
          ctx.stroke();
        }
        for (let k = 0; k < 5; k++) {
          const p = (now / 600 + k / 5) % 1;
          const dx = Math.sin(k * 2.4) * 0.12 * p;
          ellipse(ctx, x + dx, y - 1.12 - Math.sin(p * Math.PI) * 0.18 + p * 0.1, 0.018, 0.018);
          ctx.fillStyle = "rgba(220,240,255,0.85)";
          ctx.fill();
        }
      }
    },
    shadow(path, cast) {
      castRound(path, x, y, 0.66, 0.66 * SQUASH, 0.26, cast, 0.66);
      castRound(path, x, y - 0.26, 0.06, 0.04, 0.9, cast, 0.2);
    },
  };
}

const LANTERNS = 12;
const LANTERN_COLOURS = ["#ff6b4a", "#ffd27f", "#7fd4ff"];

function feastPieces(v: RoomView, env: Env, fx: number, fy: number, out: Piece[]): void {
  const turn = Math.floor(env.sky.time / 5);
  for (let i = 0; i < LANTERNS; i++) {
    const a = (i * TAU) / LANTERNS;
    const rx = fx + Math.cos(a) * 2.4;
    const ry = fy + Math.sin(a) * 2.4;
    if (!onScreen(v, rx, ry)) continue;
    const x = v.r.ox + rx;
    const y = v.r.oy + ry;
    const colour = LANTERN_COLOURS[(i + turn) % LANTERN_COLOURS.length];
    const sway = Math.sin(env.now / 900 + i) * 0.03;
    out.push({
      depth: y,
      draw(ctx) {
        env.sprites.stamp(ctx, "b:lanternpole", x, y, [-0.1, -1.2, 0.3, 0.05], paintLanternPole);
        const lx = x + 0.16 + sway;
        const ly = y - 0.92;
        ctx.fillStyle = PALETTE.woodDark;
        ctx.fillRect(lx - 0.06, ly - 0.08, 0.12, 0.02);
        ellipse(ctx, lx, ly, 0.07, 0.08);
        ctx.fillStyle = colour;
        ctx.fill();
        ellipse(ctx, lx - 0.02, ly - 0.02, 0.025, 0.03);
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fill();
      },
      shadow(path, cast) {
        castRound(path, x, y, 0.02, 0.015, 1.05, cast);
      },
    });
    env.lights.push({ x: x + 0.16, y: y - 0.6, r: 1.6, colour, power: 0.85 });
  }
}

function campPieces(v: RoomView, env: Env, out: Piece[]): void {
  let anchor: RoomObject | undefined;
  for (const id in v.r.objects) {
    const o = v.r.objects[id];
    if (o.type === "spawn" && isMine(v, o)) {
      anchor = o;
      break;
    }
    if (o.type === "constructionSite" && o.structureType === "spawn" && isMine(v, o)) anchor ??= o;
  }
  if (!anchor) return;
  const camp = campTiles(anchor.x, anchor.y, v.terrain!);
  if (!camp) return;
  const { sprites, snow, now, sky } = env;
  camp.tents.forEach(([tx, ty], k) => {
    if (!onScreen(v, tx, ty)) return;
    const x = v.r.ox + tx;
    const y = v.r.oy + ty;
    const variant = (k + tx) % 3;
    out.push({
      depth: y + 0.36,
      draw(ctx) {
        sprites.stamp(ctx, `b:tent:${variant}:${snow}:${v.arms.field}`, x, y, [-0.6, -1.05, 0.6, 0.5], (g) => paintTent(g, 60 + variant, v.arms.field, snow));
      },
      shadow(path, cast) {
        castRound(path, x, y, 0.42, 0.36, 0.66, cast, 0.04);
      },
    });
  });
  const [fx, fy] = camp.fire;
  if (!onScreen(v, fx, fy)) return;
  const x = v.r.ox + fx;
  const y = v.r.oy + fy;
  const burn = sky.lit;
  out.push({
    depth: y + 0.18,
    draw(ctx) {
      sprites.stamp(ctx, "b:firepit", x, y, [-0.4, -0.3, 0.4, 0.3], (g) => paintFirePit(g, 77));
      if (burn > 0.05) flame(ctx, x, y + 0.02, 0.5 * burn, now, fx + fy);
      else {
        ctx.globalAlpha = 0.5 + 0.3 * Math.sin(now / 400);
        ctx.fillStyle = PALETTE.fire;
        ellipse(ctx, x, y, 0.06, 0.03);
        ctx.fill();
        ctx.globalAlpha = 1;
        smoke(ctx, x, y - 0.05, now, fx, "#8c8a86", 0.7);
      }
      sprites.stamp(ctx, "b:firepitfront", x, y, [-0.4, -0.3, 0.4, 0.3], (g) => paintFirePitFront(g, 77));
    },
  });
  env.lights.push({ x, y: y - 0.3, r: 1 + 2 * burn, colour: "#ff8a33", power: 0.35 + 0.6 * burn });
}

// Moving lights.

function drawOrb(ctx: CanvasRenderingContext2D, x: number, y: number, now: number): void {
  const r = 0.13;
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, "#f4fbff");
  g.addColorStop(0.45, "#9fd4ff");
  g.addColorStop(1, "#2b5a8c");
  ctx.fillStyle = g;
  ellipse(ctx, x, y, r, r);
  ctx.fill();
  // Mist turning inside it.
  const a = now / 900;
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 0.015;
  for (let k = 0; k < 2; k++) {
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.7, r * 0.3, a + k * 1.7, 0, Math.PI * 1.2);
    ctx.stroke();
  }
}

function drawShard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, colour: string, now: number): void {
  const turn = Math.sin(now / 900);
  const lw = w * (0.55 + 0.45 * Math.abs(turn));
  ctx.beginPath();
  ctx.moveTo(x, y - h / 2);
  ctx.lineTo(x + lw, y);
  ctx.lineTo(x, y + h / 2);
  ctx.lineTo(x - lw, y);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y - h / 2);
  ctx.lineTo(x + lw * turn, y);
  ctx.lineTo(x, y + h / 2);
  ctx.lineTo(x - lw, y);
  ctx.closePath();
  ctx.fillStyle = mix(colour, "#ffffff", 0.35);
  ctx.fill();
}

function drawVortex(ctx: CanvasRenderingContext2D, x: number, y: number, now: number): void {
  ctx.fillStyle = "#1a0f2a";
  ctx.beginPath();
  ctx.ellipse(x, y, 0.36, 0.62, 0, 0, TAU);
  ctx.fill();
  for (let k = 0; k < 6; k++) {
    const t = ((now / 1600 + k / 6) % 1);
    ctx.strokeStyle = rgba(k % 2 ? "#c79bff" : "#7fd4ff", 0.75 * (1 - t));
    ctx.lineWidth = 0.03;
    ctx.beginPath();
    ctx.ellipse(x, y, 0.36 * (1 - t), 0.62 * (1 - t), 0, now / 500 + k, now / 500 + k + Math.PI * 1.3);
    ctx.stroke();
  }
}

// What the works did this tick: arrows and spells from the towers, and gold
// leaping between obelisks.

function effectPieces(v: RoomView, env: Env, out: Piece[]): void {
  if (v.r.effects.length === 0) return;
  const t = clamp((env.now - v.r.tickAt) / v.tickMs, 0, 1);
  const { ox, oy } = v.r;
  for (const e of v.r.effects) {
    if (e.kind === "tower-attack" || e.kind === "tower-heal" || e.kind === "tower-repair") {
      if (t > 0.55) continue;
      const x0 = ox + e.x1;
      const y0 = oy + e.y1 - TOWER_H - 0.1;
      const x1 = ox + e.x2;
      const y1 = oy + e.y2 - 0.4;
      const colour = e.kind === "tower-attack" ? "#ff7a22" : e.kind === "tower-heal" ? "#9fffc0" : "#ffcc66";
      const seed = e.x2 * 7 + e.y2;
      out.push({
        depth: 1e9,
        draw(ctx) {
          if (t < 0.3) drawBolt(ctx, e.kind, x0, y0, x1, y1, t / 0.3, env.now, seed);
          else drawImpact(ctx, e.kind, x1, y1, (t - 0.3) / 0.25, seed);
        },
      });
      const p = Math.min(1, t / 0.3);
      env.lights.push({ x: x0 + (x1 - x0) * p, y: y0 + (y1 - y0) * p, r: 1.3, colour, power: 0.9 });
    } else if (e.kind === "link") {
      if (t > 0.4) continue;
      const a = 1 - t / 0.4;
      const x0 = ox + e.x1 + OBELISK_TOP[0];
      const y0 = oy + e.y1 + OBELISK_TOP[1];
      const x1 = ox + e.x2 + OBELISK_TOP[0];
      const y1 = oy + e.y2 + OBELISK_TOP[1];
      out.push({
        depth: 1e9,
        draw(ctx) {
          drawLightning(ctx, x0, y0, x1, y1, a, Math.floor(env.now / 70) + e.x1);
        },
      });
      env.lights.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, r: 2.4, colour: PALETTE.gold, power: 0.9 * a });
    }
  }
}

/** A tower's shot in flight, `p` of the way, arcing over. */
function drawBolt(ctx: CanvasRenderingContext2D, kind: string, x0: number, y0: number, x1: number, y1: number, p: number, now: number, seed: number): void {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const lift = 0.2 + dist * 0.12;
  const at = (q: number): [number, number] => [x0 + (x1 - x0) * q, y0 + (y1 - y0) * q - Math.sin(Math.PI * q) * lift];
  const [x, y] = at(p);
  const [bx, by] = at(Math.max(0, p - 0.08));
  const angle = Math.atan2(y - by, x - bx);
  if (kind === "tower-attack") {
    // A flaming arrow: its trail of fire, the shaft and its burning head.
    const [tx, ty] = at(Math.max(0, p - 0.25));
    const trail = ctx.createLinearGradient(tx, ty, x, y);
    trail.addColorStop(0, "rgba(255,122,34,0)");
    trail.addColorStop(1, "rgba(255,170,80,0.8)");
    ctx.strokeStyle = trail;
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    for (let q = Math.max(0, p - 0.25); q <= p; q += 0.02) {
      const [qx, qy] = at(q);
      if (q === Math.max(0, p - 0.25)) ctx.moveTo(qx, qy);
      else ctx.lineTo(qx, qy);
    }
    ctx.stroke();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    line(ctx, -0.32, 0, 0, 0, "#4a311b", 0.025);
    ctx.fillStyle = "#d8d0c0";
    ctx.fillRect(-0.34, -0.03, 0.06, 0.06);
    ctx.rotate(-angle - Math.PI / 2);
    flame(ctx, 0, 0.04, 0.14, now, seed);
    ctx.restore();
    return;
  }
  const colour = kind === "tower-heal" ? "#9fffc0" : "#ffcc66";
  for (let k = 1; k <= 4; k++) {
    const [qx, qy] = at(Math.max(0, p - k * 0.04));
    ctx.globalAlpha = 0.5 * (1 - k / 5);
    ellipse(ctx, qx, qy, 0.05, 0.05);
    ctx.fillStyle = colour;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ellipse(ctx, x, y, 0.08, 0.08);
  ctx.fillStyle = colour;
  ctx.fill();
  ellipse(ctx, x, y, 0.04, 0.04);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
}

/** Where a tower's shot lands, `q` of the way through its burst. */
function drawImpact(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, q: number, seed: number): void {
  const colour = kind === "tower-attack" ? "#ff7a22" : kind === "tower-heal" ? "#9fffc0" : "#ffcc66";
  const r = rng(seed);
  ctx.globalAlpha = 1 - q;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 0.04 * (1 - q) + 0.01;
  ctx.beginPath();
  ctx.ellipse(x, y, 0.12 + q * 0.4, (0.12 + q * 0.4) * 0.8, 0, 0, TAU);
  ctx.stroke();
  for (let k = 0; k < 8; k++) {
    const a = r() * TAU;
    const d = q * (0.25 + r() * 0.3);
    const rise = kind === "tower-attack" ? 0 : q * 0.3;
    ellipse(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7 - rise, 0.025, 0.025);
    ctx.fillStyle = k % 2 ? colour : "#ffffff";
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Gold leaping between two obelisks: a forked line, redrawn every few frames. */
function drawLightning(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, a: number, seed: number): void {
  const r = rng(seed);
  const n = Math.max(4, Math.round(Math.hypot(x1 - x0, y1 - y0) * 2));
  const nx = -(y1 - y0);
  const ny = x1 - x0;
  const len = Math.hypot(nx, ny) || 1;
  const pts: Array<[number, number]> = [[x0, y0]];
  for (let k = 1; k < n; k++) {
    const q = k / n;
    const off = (r() - 0.5) * 0.5 * Math.sin(Math.PI * q);
    pts.push([x0 + (x1 - x0) * q + (nx / len) * off, y0 + (y1 - y0) * q + (ny / len) * off - Math.sin(Math.PI * q) * 0.4]);
  }
  pts.push([x1, y1]);
  const stroke = (width: number, colour: string, alpha: number) => {
    ctx.globalAlpha = alpha * a;
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.stroke();
  };
  stroke(0.16, PALETTE.gold, 0.25);
  stroke(0.06, PALETTE.goldLight, 0.8);
  stroke(0.02, "#ffffff", 1);
  ctx.globalAlpha = 1;
}
