// What a castle's works are, read from the room's objects before any of them
// is drawn: which walls are the curtain and which are a cottage's, what each
// rampart stands for, and where the pilgrims pitch their camp. The game has
// one kind of rampart; the realm has houses, watch posts, gates, warded
// works and battlements, told apart by where the rampart stands.

import type { TownPlan } from "../shared/protocol";
import type { RoomObject, RoomObjects } from "../shared/realm";

export type RampartKind =
  // A cottage's door or its floor: the house is drawn instead.
  | "house"
  // A town watch post: a wooden platform for the militia.
  | "post"
  // Under one of the castle's works, which it wards: a low plinth.
  | "plinth"
  // In a line of the curtain wall: a gatehouse the castle's people pass.
  | "gate"
  // Anywhere else: a stone fighting platform.
  | "battlement";

// Neighbours as a mask: north, east, south, west.
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;
const SIDES: Array<[number, number, number]> = [
  [N, 0, -1],
  [E, 1, 0],
  [S, 0, 1],
  [W, -1, 0],
];

export interface RoomPlan {
  // Everything standing on each tile (y * 50 + x) but creeps.
  at: Map<number, RoomObject[]>;
  roads: Set<number>;
  // Walls standing free: the curtain wall, not a cottage's nor the fountain.
  curtain: Set<number>;
  ramparts: Map<number, RampartKind>;
  // The cottage each tile of a house belongs to, by its index in the town plan.
  house: Map<number, number>;
  posts: Set<number>;
  fountain: number | undefined;
}

// What lies on the ground rather than standing on it.
const LYING = new Set(["road", "rampart", "energy", "resource", "tombstone", "ruin", "creep", "powerCreep"]);

export const tileOf = (x: number, y: number) => y * 50 + x;

function tileKey(k: string): number {
  const comma = k.indexOf(",");
  return tileOf(Number(k.slice(0, comma)), Number(k.slice(comma + 1)));
}

/** Reads the room's works and the town's plan into a RoomPlan. */
export function planRoom(objects: RoomObjects, town: TownPlan | null): RoomPlan {
  const at = new Map<number, RoomObject[]>();
  const roads = new Set<number>();
  const walls: number[] = [];
  const ramparts: number[] = [];
  for (const id in objects) {
    const o = objects[id];
    if (o.type === "creep" || o.type === "powerCreep") continue;
    const i = tileOf(o.x, o.y);
    let list = at.get(i);
    if (!list) at.set(i, (list = []));
    list.push(o);
    if (o.type === "road") roads.add(i);
    else if (o.type === "constructedWall") walls.push(i);
    else if (o.type === "rampart") ramparts.push(i);
  }

  const house = new Map<number, number>();
  town?.cottages.forEach((c, n) => {
    for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 5; dx++) house.set(tileOf(c.x + dx, c.y + dy), n);
  });
  const posts = new Set((town?.posts ?? []).map(tileKey));
  const fountain = town?.fountain ? tileKey(town.fountain) : undefined;

  const curtain = new Set(walls.filter((i) => !house.has(i) && i !== fountain));
  const kinds = new Map<number, RampartKind>();
  for (const i of ramparts) {
    const x = i % 50;
    const y = (i - x) / 50;
    let kind: RampartKind;
    if (house.has(i)) kind = "house";
    else if (posts.has(i)) kind = "post";
    else if (at.get(i)!.some((o) => !LYING.has(o.type))) kind = "plinth";
    else if (SIDES.some(([, dx, dy]) => curtain.has(tileOf(x + dx, y + dy)))) kind = "gate";
    else kind = "battlement";
    kinds.set(i, kind);
  }
  return { at, roads, curtain, ramparts: kinds, house, posts, fountain };
}

/** Whether a tile is part of the castle's ring: curtain, gate or battlement. */
export function inRing(plan: RoomPlan, i: number): boolean {
  if (plan.curtain.has(i)) return true;
  const k = plan.ramparts.get(i);
  return k === "gate" || k === "battlement";
}

/** Which of a tile's four neighbours are part of the ring. */
export function ringMask(plan: RoomPlan, x: number, y: number): number {
  let mask = 0;
  for (const [bit, dx, dy] of SIDES) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < 50 && ny < 50 && inRing(plan, tileOf(nx, ny))) mask |= bit;
  }
  return mask;
}

// Tiles round the barracks a camp may use, in order of preference: the fire
// takes the first open one and the tents the next three, as the bot has it.
const CAMP_RING: Array<[number, number]> = [
  [0, 2],
  [-2, 2],
  [2, 2],
  [-2, 0],
  [2, 0],
  [0, -2],
  [-2, -2],
  [2, -2],
];

/** The pilgrims' campfire and up to three tents round the barracks at (x, y), or null when none fits. */
export function campTiles(x: number, y: number, terrain: string): { fire: [number, number]; tents: Array<[number, number]> } | null {
  const open = CAMP_RING.map(([dx, dy]): [number, number] => [x + dx, y + dy]).filter(
    ([cx, cy]) => cx > 0 && cx < 49 && cy > 0 && cy < 49 && ((terrain.charCodeAt(cy * 50 + cx) - 48) & 1) === 0,
  );
  if (open.length === 0) return null;
  return { fire: open[0], tents: open.slice(1, 4) };
}
