import { PLANNER_KEYS, PERIMETER_PLANNER } from "../config/config.structures";
import { addPlannedStructureToMemory } from "../services/services.structures";

// ── Defensive perimeter ─────────────────────────────────────────────────────────
//
// The stamp already drops ramparts ON TOP of key structures (spawns, storage,
// towers, …) so a nuke can't one-shot them, but nothing seals the base against a
// ground assault. This planner walls the whole core in: it takes the bounding box
// of every placed/planned core structure (the castle stamp AND the concentric
// Merchant Ring extensions), pads it by a margin, and lays a continuous ring of
// ramparts around that rectangle.
//
// Why a padded bounding-box ring rather than a min-cut to exits: a min-cut is
// optimal (fewest ramparts) but fragile — it depends on the room's wall topology
// and can leave the base exposed if the cut is computed wrong. A solid rectangular
// curtain is the robust, no-surprises option the architecture favours: it always
// encloses everything, costs O(perimeter) to compute, and grows with the base as
// new extension rings push the bounding box outward. Natural walls already seal a
// tile, so we skip those (a rampart on a wall is wasted energy); a defender can
// build manual ramparts in any natural-wall gap if they ever want one closed.
//
// Road-crossing tiles get a rampart too — ramparts are walkable for the owner, so
// there's no need to leave open choke gaps, and an open gap is just an invitation.
//
// The plan is stored under the existing STAMP_RAMPART_KEY, so it inherits the
// established build budgeting (low priority, after economy + roads) and is picked
// up unchanged by the rampart repair/tower logic — these are ordinary
// STRUCTURE_RAMPARTs, indistinguishable from the on-top ones.

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
  if (!box) return;

  const { margin, minEdge, maxEdge } = PERIMETER_PLANNER;
  const minX = Math.max(minEdge, box.minX - margin);
  const minY = Math.max(minEdge, box.minY - margin);
  const maxX = Math.min(maxEdge, box.maxX + margin);
  const maxY = Math.min(maxEdge, box.maxY + margin);
  if (minX >= maxX || minY >= maxY) return; // degenerate box, nothing to wall

  const terrain = room.getTerrain();

  // Rewrite the ring from scratch each replan so a grown base (or a relocated
  // core) can't leave a stale inner wall behind. The on-top ramparts the
  // orchestrator adds for built core structures live under RAMPARTS_KEY, not this
  // key, so clearing here only drops perimeter tiles.
  mem[PLANNER_KEYS.STAMP_RAMPART_KEY] = [];
  if (room.memory.plannedStructuresMeta) {
    delete room.memory.plannedStructuresMeta[PLANNER_KEYS.STAMP_RAMPART_KEY];
  }

  const place = (x: number, y: number, seen: Set<string>) => {
    const k = `${x},${y}`;
    if (seen.has(k)) return;
    seen.add(k);
    // Natural walls already seal the tile — don't waste a rampart on one.
    if (terrain.get(x, y) === TERRAIN_MASK_WALL) return;
    addPlannedStructureToMemory(
      room,
      PLANNER_KEYS.STAMP_RAMPART_KEY,
      new RoomPosition(x, y, room.name)
    );
  };

  const seen = new Set<string>();
  // Top and bottom edges.
  for (let x = minX; x <= maxX; x++) {
    place(x, minY, seen);
    place(x, maxY, seen);
  }
  // Left and right edges (corners already handled above).
  for (let y = minY + 1; y < maxY; y++) {
    place(minX, y, seen);
    place(maxX, y, seen);
  }

  // Stamp createdAt so the throttle above can measure the interval. addPlanned…
  // only sets createdAt when it first creates the key, and we just cleared it, so
  // it's fresh — but set it explicitly in case every ring tile was a natural wall.
  if (!room.memory.plannedStructuresMeta) room.memory.plannedStructuresMeta = {} as any;
  room.memory.plannedStructuresMeta![PLANNER_KEYS.STAMP_RAMPART_KEY] = {
    createdAt: Game.time,
  };
}
