import { PLANNER_KEYS, PERIMETER_PLANNER } from "../config/config.structures";
import { addPlannedStructureToMemory } from "../services/services.structures";
import { getCutTiles, Rect } from "../services/services.mincut";

// ── Defensive perimeter ─────────────────────────────────────────────────────────
//
// The stamp already drops ramparts ON TOP of key structures (spawns, storage,
// towers, …) so a nuke can't one-shot them, but nothing seals the base against a
// ground assault. This planner walls the whole core in: it gathers the tiles that
// must end up INSIDE the walls — every placed/planned core structure (the castle
// stamp AND the concentric Merchant Ring extensions), plus the controller when it
// sits economically close to the keep — and computes the minimal set of ramparts
// that seals them from the room exits.
//
// The seal is a proper MIN-CUT to the exits (see services.mincut): given the
// protected rectangle(s), it finds the fewest tiles to rampart so no path of
// walkable tiles leads from inside to a room edge. This hugs natural walls for
// free (a natural wall is already an impassable cut) and yields a far cheaper,
// tighter wall than a padded bounding-box ring — the room seals with tens of
// ramparts instead of a full rectangular curtain.
//
// The old padded bounding-box ring is kept as a FALLBACK (planBoundingBoxRing):
// if the min-cut comes back empty — degenerate input, or a base already sealed by
// natural walls such that the algorithm finds no cuttable tiles — we fall back to
// the rectangular curtain so a room is never left wall-less.
//
// Either way the tiles are STRUCTURE_RAMPARTs stored under the existing
// STAMP_RAMPART_KEY as a list of "x,y" strings, so the plan inherits the
// established build budgeting (low priority, after economy + roads) and is picked
// up unchanged by the rampart repair/tower logic — indistinguishable from the
// on-top ones.

// Planner keys whose tiles are real core structures we must enclose. Roads and the
// rampart key itself are excluded — roads sprawl out to sources/controller/exits
// and would balloon the box to the whole room, and the perimeter must not enclose
// itself.
function isCoreStructureKey(key: string): boolean {
  if (key === PLANNER_KEYS.STAMP_RAMPART_KEY) return false;
  if (key === PLANNER_KEYS.RAMPARTS_KEY) return false;
  if (key === PLANNER_KEYS.STAMP_ROAD_KEY) return false;
  if (key.startsWith(PLANNER_KEYS.ROAD_PREFIX)) return false;
  if (key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX)) return false;
  if (key.startsWith(PLANNER_KEYS.CARDINAL_ROAD_PREFIX)) return false;
  if (key.startsWith("cardinal_connector_")) return false;
  // Source / controller / mineral containers live out at the resources, far from
  // the keep — including them would stretch the wall across the whole room.
  if (key.startsWith(PLANNER_KEYS.CONTAINER_SOURCE_PREFIX)) return false;
  if (key.startsWith(PLANNER_KEYS.CONTAINER_MINERAL_PREFIX)) return false;
  if (key === PLANNER_KEYS.CONTAINER_CONTROLLER) return false;
  return true;
}

// Bounding box (inclusive) of every planned core-structure tile. Returns null if
// there's nothing to enclose yet.
function coreBoundingBox(
  room: Room
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const mem = room.memory.plannedStructures as Record<string, string[]> | undefined;
  if (!mem) return null;

  let minX = 50;
  let minY = 50;
  let maxX = -1;
  let maxY = -1;

  for (const key of Object.keys(mem)) {
    if (!isCoreStructureKey(key)) continue;
    for (const p of mem[key]) {
      const comma = p.indexOf(",");
      const x = +p.slice(0, comma);
      const y = +p.slice(comma + 1);
      if (x < 0 || x >= 50 || y < 0 || y >= 50) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return null; // no core tiles
  return { minX, minY, maxX, maxY };
}

// Build the list of protected rectangles (tiles that must end up inside the walls).
// The core box already covers the stamp + every Merchant Ring extension. The
// controller is added as its own small rect ONLY when it sits close to the keep:
// enclosing a far-flung controller would drag the min-cut across half the room for
// no defensive gain, so we leave a distant controller outside the curtain.
function protectedRects(
  room: Room,
  box: { minX: number; minY: number; maxX: number; maxY: number }
): Rect[] {
  // Clamp the core rect to the interior (1..48), like the controller rect below. A core
  // structure adjacent to an exit (coord 0/49) would otherwise connect the min-cut source
  // straight to the sink, collapsing the cut to empty — after which the fallback ring (clamped
  // to 2..47) walls that structure OUT, leaving the base unsealed. Clamping keeps the protected
  // region off the exit ring so the min-cut stays well-posed.
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
    // Distance from the controller to the core box (0 if already inside it).
    const dx = Math.max(box.minX - controller.pos.x, 0, controller.pos.x - box.maxX);
    const dy = Math.max(box.minY - controller.pos.y, 0, controller.pos.y - box.maxY);
    // Within ~5 tiles of the box edge the controller is effectively part of the
    // keep (upgraders work there constantly); enclose a 1-tile margin around it so
    // the upgrade tile is defended too.
    if (Math.max(dx, dy) <= 5) {
      // Clamp the controller rect to the interior (1..48). A controller hugging the room
      // edge would otherwise produce a protected rect touching an exit tile, which makes the
      // min-cut graph connect the source straight to the sink and return a bogus (non-empty)
      // cut — so the empty-result fallback to the bounding-box ring would never fire.
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

// Store a set of rampart tiles under STAMP_RAMPART_KEY, replacing whatever was
// there. Rewritten from scratch each replan so a grown base (or a relocated core)
// can't leave a stale inner wall behind. The on-top ramparts the orchestrator adds
// for built core structures live under RAMPARTS_KEY, not this key, so clearing here
// only drops perimeter tiles. Stamps createdAt so the throttle can measure the
// interval even when zero tiles end up stored.
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
  if (!room.memory.plannedStructuresMeta) room.memory.plannedStructuresMeta = {} as any;
  room.memory.plannedStructuresMeta![PLANNER_KEYS.STAMP_RAMPART_KEY] = {
    createdAt: Game.time,
  };
}

// FALLBACK: the original padded bounding-box ring. A solid rectangular curtain that
// always encloses the core — used when the min-cut returns no tiles, so a room is
// never left wall-less. Returns the ring tiles (natural-wall tiles skipped, since a
// wall already seals the tile and a rampart on one is wasted energy).
function planBoundingBoxRing(
  room: Room,
  box: { minX: number; minY: number; maxX: number; maxY: number }
): Array<{ x: number; y: number }> {
  const { margin, minEdge, maxEdge } = PERIMETER_PLANNER;
  const minX = Math.max(minEdge, box.minX - margin);
  const minY = Math.max(minEdge, box.minY - margin);
  const maxX = Math.min(maxEdge, box.maxX + margin);
  const maxY = Math.min(maxEdge, box.maxY + margin);
  if (minX >= maxX || minY >= maxY) return []; // degenerate box, nothing to wall

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

  // Top and bottom edges.
  for (let x = minX; x <= maxX; x++) {
    place(x, minY);
    place(x, maxY);
  }
  // Left and right edges (corners already handled above).
  for (let y = minY + 1; y < maxY; y++) {
    place(minX, y);
    place(maxX, y);
  }
  return tiles;
}

// Compute and store the defensive perimeter. Gated by RCL and throttled so it only
// recomputes occasionally (the base footprint grows slowly). Reuses the stamp
// rampart memory key so the rest of the pipeline needs no changes.
export function planDefensivePerimeter(room: Room): void {
  const rcl = room.controller?.level ?? 0;
  if (rcl < PERIMETER_PLANNER.minRcl) return;

  // Throttle: only replan when the plan is missing or the interval has elapsed.
  const mem = (room.memory.plannedStructures ?? {}) as Record<string, string[]>;
  const meta = (room.memory.plannedStructuresMeta ?? {}) as Record<string, { createdAt: number }>;
  const existing = mem[PLANNER_KEYS.STAMP_RAMPART_KEY];
  const lastPlanned = meta[PLANNER_KEYS.STAMP_RAMPART_KEY]?.createdAt;
  if (
    existing &&
    existing.length > 0 &&
    lastPlanned !== undefined &&
    Game.time - lastPlanned < PERIMETER_PLANNER.replanInterval
  ) {
    return;
  }

  const box = coreBoundingBox(room);
  if (!box) return; // no storage/stamp yet — skip until the base exists

  // The min-cut seals the protected rects from the room exits with the fewest
  // ramparts, hugging natural walls for free. The mincut already excludes natural
  // walls (they're impassable cuts), so no manual wall-skip is needed here.
  const cut = getCutTiles(room.name, protectedRects(room, box));
  if (cut.length > 0) {
    storePerimeter(room, cut);
    return;
  }

  // FALLBACK: min-cut found nothing (degenerate, or already sealed by natural
  // walls). Lay the robust rectangular curtain so the base is never left open.
  storePerimeter(room, planBoundingBoxRing(room, box));
}
