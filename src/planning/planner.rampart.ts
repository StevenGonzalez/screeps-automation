import { PLANNER_KEYS, PERIMETER_PLANNER } from "../config/config.structures";
import { addPlannedStructureToMemory } from "../services/services.structures";
import { getCutTiles, Rect } from "../services/services.mincut";
import { readBlueprint } from "./planner.blueprint";
import { townProtectedRects } from "./planner.town";

// The ring wraps the castle's buildings at RCL 8, not just the current age,
// so it does not creep outward (leaving old rings behind) as the castle grows.
// Containers, links and the extractor out at the sources, controller and
// mineral are left out: pulling them in would stretch the ring across the
// room. The controller gets its own rect when it is close enough.
function coreBoundingBox(
  room: Room
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const bp = readBlueprint(room);
  if (!bp) return null;

  let minX = 50;
  let minY = 50;
  let maxX = -1;
  let maxY = -1;
  for (const e of bp.entries) {
    if (e.type === STRUCTURE_ROAD || e.type === STRUCTURE_CONTAINER || e.type === STRUCTURE_EXTRACTOR) continue;
    if (e.tag && e.tag !== "storage") continue;
    if (e.x < minX) minX = e.x;
    if (e.y < minY) minY = e.y;
    if (e.x > maxX) maxX = e.x;
    if (e.y > maxY) maxY = e.y;
  }

  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}

function protectedRects(
  room: Room,
  box: { minX: number; minY: number; maxX: number; maxY: number }
): Rect[] {
  const rects: Rect[] = [
    {
      x1: Math.max(1, box.minX),
      y1: Math.max(1, box.minY),
      x2: Math.min(48, box.maxX),
      y2: Math.min(48, box.maxY),
    },
  ];

  const controller = room.controller;
  if (controller) {
    const dx = Math.max(box.minX - controller.pos.x, 0, controller.pos.x - box.maxX);
    const dy = Math.max(box.minY - controller.pos.y, 0, controller.pos.y - box.maxY);
    if (Math.max(dx, dy) <= 5) {
      rects.push({
        x1: Math.max(1, controller.pos.x - 1),
        y1: Math.max(1, controller.pos.y - 1),
        x2: Math.min(48, controller.pos.x + 1),
        y2: Math.min(48, controller.pos.y + 1),
      });
    }
  }
  rects.push(...townProtectedRects(room));
  return rects;
}

/**
 * Ring tiles that must stay passable to our creeps: wherever a blueprint road
 * (of any age) or an exit road crosses the ring. They get rampart doors; the
 * rest of the ring is constructed wall, which does not decay. Null without a
 * blueprint, and then the whole ring is ramparts.
 */
export function perimeterDoorTiles(room: Room): Set<string> | null {
  const bp = readBlueprint(room);
  if (!bp) return null;
  const doors = new Set<string>();
  for (const e of bp.entries) if (e.type === STRUCTURE_ROAD) doors.add(`${e.x},${e.y}`);
  for (const path of Object.values(bp.exits)) {
    for (const p of path ?? []) doors.add(`${p.x},${p.y}`);
  }
  return doors;
}

function storePerimeter(room: Room, tiles: Array<{ x: number; y: number }>): void {
  const mem = (room.memory.plannedStructures ?? {}) as Record<string, string[]>;
  mem[PLANNER_KEYS.STAMP_RAMPART_KEY] = [];
  mem[PLANNER_KEYS.STAMP_WALL_KEY] = [];
  if (room.memory.plannedStructuresMeta) {
    delete room.memory.plannedStructuresMeta[PLANNER_KEYS.STAMP_RAMPART_KEY];
  }
  const doors = perimeterDoorTiles(room);
  for (const t of tiles) {
    const door = !doors || doors.has(`${t.x},${t.y}`);
    addPlannedStructureToMemory(
      room,
      door ? PLANNER_KEYS.STAMP_RAMPART_KEY : PLANNER_KEYS.STAMP_WALL_KEY,
      new RoomPosition(t.x, t.y, room.name)
    );
  }
  // The planned lists drop each tile once it is built; this copy keeps the
  // whole ring so repair logic can tell a perimeter rampart from a stale one.
  room.memory.perimeterTiles = tiles.map((t) => `${t.x},${t.y}`);
  if (!room.memory.plannedStructuresMeta) room.memory.plannedStructuresMeta = {} as any;
  room.memory.plannedStructuresMeta![PLANNER_KEYS.STAMP_RAMPART_KEY] = {
    createdAt: Game.time,
  };
}

function planBoundingBoxRing(
  room: Room,
  box: { minX: number; minY: number; maxX: number; maxY: number }
): Array<{ x: number; y: number }> {
  const { margin, minEdge, maxEdge } = PERIMETER_PLANNER;
  const minX = Math.max(minEdge, box.minX - margin);
  const minY = Math.max(minEdge, box.minY - margin);
  const maxX = Math.min(maxEdge, box.maxX + margin);
  const maxY = Math.min(maxEdge, box.maxY + margin);
  if (minX >= maxX || minY >= maxY) return [];

  const terrain = room.getTerrain();
  const tiles: Array<{ x: number; y: number }> = [];
  const seen = new Set<string>();
  const place = (x: number, y: number) => {
    const k = `${x},${y}`;
    if (seen.has(k)) return;
    seen.add(k);
    if (terrain.get(x, y) === TERRAIN_MASK_WALL) return;
    tiles.push({ x, y });
  };

  for (let x = minX; x <= maxX; x++) {
    place(x, minY);
    place(x, maxY);
  }
  for (let y = minY + 1; y < maxY; y++) {
    place(minX, y);
    place(maxX, y);
  }
  return tiles;
}

export function shouldPlanDefensivePerimeter(rcl: number): boolean {
  return rcl >= PERIMETER_PLANNER.minRcl;
}

export function planDefensivePerimeter(room: Room): void {
  const rcl = room.controller?.level ?? 0;
  if (!shouldPlanDefensivePerimeter(rcl)) return;

  const mem = (room.memory.plannedStructures ?? {}) as Record<string, string[]>;
  const meta = (room.memory.plannedStructuresMeta ?? {}) as Record<string, { createdAt: number }>;
  // The planned list empties as the ring gets built, so its length says nothing
  // about when we last planned; only the timestamp does.
  const lastPlanned = meta[PLANNER_KEYS.STAMP_RAMPART_KEY]?.createdAt;
  // A ring stored before the ring had walls is planned again at once.
  if (
    room.memory.perimeterTiles &&
    mem[PLANNER_KEYS.STAMP_WALL_KEY] !== undefined &&
    lastPlanned !== undefined &&
    Game.time - lastPlanned < PERIMETER_PLANNER.replanInterval
  ) {
    return;
  }

  const box = coreBoundingBox(room);
  if (!box) return;

  const cut = getCutTiles(room.name, protectedRects(room, box));
  if (cut.length > 0) {
    storePerimeter(room, cut);
    return;
  }

  storePerimeter(room, planBoundingBoxRing(room, box));
}
