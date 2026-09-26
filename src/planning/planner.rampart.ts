import { PLANNER_KEYS, PERIMETER_PLANNER, STAMP_PLANNER } from "../config/config.structures";
import { addPlannedStructureToMemory } from "../services/services.structures";
import { getCutTiles, Rect } from "../services/services.mincut";
import { CASTLE_STAMP, MERCHANT_RING_EXTENSION_OFFSETS } from "./planner.stamp";

function isCoreStructureKey(key: string): boolean {
  if (key === PLANNER_KEYS.STAMP_RAMPART_KEY) return false;
  if (key === PLANNER_KEYS.RAMPARTS_KEY) return false;
  if (key === PLANNER_KEYS.STAMP_ROAD_KEY) return false;
  if (key.startsWith(PLANNER_KEYS.ROAD_PREFIX)) return false;
  if (key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX)) return false;
  if (key.startsWith(PLANNER_KEYS.CARDINAL_ROAD_PREFIX)) return false;
  if (key.startsWith("cardinal_connector_")) return false;
  if (key.startsWith(PLANNER_KEYS.CONTAINER_SOURCE_PREFIX)) return false;
  if (key.startsWith(PLANNER_KEYS.CONTAINER_MINERAL_PREFIX)) return false;
  if (key === PLANNER_KEYS.CONTAINER_CONTROLLER) return false;
  // Outlying structures: pulling them in would stretch the ring to the mineral
  // or a far source. The controller gets its own rect when it is close enough.
  if (key.startsWith(PLANNER_KEYS.EXTRACTOR_PREFIX)) return false;
  if (key.startsWith(PLANNER_KEYS.LINK_SOURCE_PREFIX)) return false;
  if (key === PLANNER_KEYS.LINK_CONTROLLER) return false;
  return true;
}

function coreBoundingBox(
  room: Room
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const mem = room.memory.plannedStructures as Record<string, string[]> | undefined;
  if (!mem) return null;

  let minX = 50;
  let minY = 50;
  let maxX = -1;
  let maxY = -1;

  // Size the box from the full RCL 8 stamp, not what the current RCL has
  // planned, so the ring does not creep outward (leaving old rings behind) as
  // the base grows.
  const anchor = room.memory.castleAnchor;
  if (anchor) {
    for (const o of [...CASTLE_STAMP, ...MERCHANT_RING_EXTENSION_OFFSETS]) {
      const x = anchor.x + o.dx;
      const y = anchor.y + o.dy;
      if (x < 1 || x > 48 || y < 1 || y > 48) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  for (const key of Object.keys(mem)) {
    if (!isCoreStructureKey(key)) continue;
    for (const p of mem[key]) {
      const comma = p.indexOf(",");
      const x = +p.slice(0, comma);
      const y = +p.slice(comma + 1);
      if (x < 0 || x >= 50 || y < 0 || y >= 50) continue;
      // Make-up extensions can sit far out from the stamp; stretching the box
      // to cover them would balloon the ring. They go unprotected instead.
      if (
        anchor &&
        key === PLANNER_KEYS.STAMP_EXTENSION_KEY &&
        Math.max(Math.abs(x - anchor.x), Math.abs(y - anchor.y)) > STAMP_PLANNER.halfSize
      ) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
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
  return rects;
}

function storePerimeter(room: Room, tiles: Array<{ x: number; y: number }>): void {
  const mem = (room.memory.plannedStructures ?? {}) as Record<string, string[]>;
  mem[PLANNER_KEYS.STAMP_RAMPART_KEY] = [];
  if (room.memory.plannedStructuresMeta) {
    delete room.memory.plannedStructuresMeta[PLANNER_KEYS.STAMP_RAMPART_KEY];
  }
  for (const t of tiles) {
    addPlannedStructureToMemory(
      room,
      PLANNER_KEYS.STAMP_RAMPART_KEY,
      new RoomPosition(t.x, t.y, room.name)
    );
  }
  // The planned list drops each tile once its rampart is built; this copy keeps
  // the whole ring so repair logic can tell a perimeter rampart from a stale one.
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
  if (
    room.memory.perimeterTiles &&
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
