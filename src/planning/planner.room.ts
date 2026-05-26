import { PLANNER_KEYS, STAMP_PLANNER } from "../config/config.structures";
import {
  addPlannedStructureToMemory,
  plannedPositionsFromMemory,
} from "../services/services.structures";
import {
  CASTLE_STAMP,
  StampCell,
  getStampCellsForRcl,
  stampMemoryKeyFor,
} from "./planner.stamp";

// ── Anchor selection ──────────────────────────────────────────────────────────

export function findOptimalAnchor(
  room: Room
): { x: number; y: number } | null {
  const terrain = room.getTerrain();
  const { halfSize, anchorMinEdgeDistance } = STAMP_PLANNER;
  const seedCells = CASTLE_STAMP.filter((c) => c.minRcl <= 1);
  const sources = room.find(FIND_SOURCES);

  let bestScore = -Infinity;
  let bestAnchor: { x: number; y: number } | null = null;

  const lo = anchorMinEdgeDistance;
  const hi = 49 - anchorMinEdgeDistance;

  for (let cx = lo; cx <= hi; cx++) {
    for (let cy = lo; cy <= hi; cy++) {
      // Ensure the full stamp fits inside room boundaries
      if (
        cx - halfSize < 1 ||
        cx + halfSize > 48 ||
        cy - halfSize < 1 ||
        cy + halfSize > 48
      )
        continue;

      let score = 0;

      // Walkable seed cells
      for (const cell of seedCells) {
        const ax = cx + cell.dx;
        const ay = cy + cell.dy;
        if (ax < 1 || ax > 48 || ay < 1 || ay > 48) continue;
        if (terrain.get(ax, ay) !== TERRAIN_MASK_WALL) score++;
      }

      // Prefer positions closer to room center
      const edgeDist = Math.min(cx, cy, 49 - cx, 49 - cy);
      score += edgeDist * 0.3;

      // Penalise positions too close to sources (interference with containers)
      for (const source of sources) {
        const dist = Math.max(
          Math.abs(cx - source.pos.x),
          Math.abs(cy - source.pos.y)
        );
        if (dist < 8) score -= (8 - dist) * 2;
      }

      if (score > bestScore) {
        bestScore = score;
        bestAnchor = { x: cx, y: cy };
      }
    }
  }

  return bestAnchor;
}

export function getOrFindAnchor(
  room: Room
): { x: number; y: number } | null {
  const rcl = room.controller?.level ?? 0;
  if (room.memory.castleAnchor && room.memory.lastRcl === rcl) {
    return room.memory.castleAnchor;
  }
  const anchor = findOptimalAnchor(room);
  if (anchor) {
    room.memory.castleAnchor = anchor;
    room.memory.lastRcl = rcl;
  }
  return anchor;
}

// ── Stamp application ─────────────────────────────────────────────────────────

export function applyCastleStamp(room: Room): void {
  const anchor = getOrFindAnchor(room);
  if (!anchor) return;

  const rcl = room.controller?.level ?? 0;
  const cells = getStampCellsForRcl(rcl);
  const terrain = room.getTerrain();

  // Build occupiedSet from all existing non-road planned positions
  const occupiedSet = new Set<string>();
  if (room.memory.plannedStructures) {
    const mem = room.memory.plannedStructures as Record<string, string[]>;
    for (const key of Object.keys(mem)) {
      if (isRoadKey(key)) continue;
      for (const p of mem[key]) occupiedSet.add(p);
    }
  }

  for (const cell of cells) {
    const absX = anchor.x + cell.dx;
    const absY = anchor.y + cell.dy;
    if (absX < 1 || absX > 48 || absY < 1 || absY > 48) continue;

    const posKey = `${absX},${absY}`;

    // Non-road cells skip positions already claimed by another stamp cell
    if (cell.type !== "road" && occupiedSet.has(posKey)) continue;

    let finalX = absX;
    let finalY = absY;

    if (terrain.get(absX, absY) === TERRAIN_MASK_WALL) {
      if (!cell.critical) continue;
      const fallback = findNearestBuildable(
        room,
        absX,
        absY,
        occupiedSet,
        terrain
      );
      if (!fallback) continue;
      finalX = fallback.x;
      finalY = fallback.y;
    }

    const memKey = stampMemoryKeyFor(cell);
    addPlannedStructureToMemory(
      room,
      memKey,
      new RoomPosition(finalX, finalY, room.name)
    );

    if (cell.type !== "road") {
      occupiedSet.add(`${finalX},${finalY}`);
    }
  }

  if (rcl >= 5) planStampRampartPerimeter(room, anchor);
}

function findNearestBuildable(
  room: Room,
  startX: number,
  startY: number,
  occupiedSet: Set<string>,
  terrain: RoomTerrain
): { x: number; y: number } | null {
  const { bfsMaxRadius } = STAMP_PLANNER;
  const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
  const visited = new Set<string>([`${startX},${startY}`]);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const dist =
      Math.abs(cur.x - startX) + Math.abs(cur.y - startY);
    if (dist > bfsMaxRadius) continue;

    if (
      terrain.get(cur.x, cur.y) !== TERRAIN_MASK_WALL &&
      !occupiedSet.has(`${cur.x},${cur.y}`) &&
      cur.x >= 1 && cur.x <= 48 &&
      cur.y >= 1 && cur.y <= 48
    ) {
      return cur;
    }

    const dirs = [
      { x: cur.x + 1, y: cur.y },
      { x: cur.x - 1, y: cur.y },
      { x: cur.x, y: cur.y + 1 },
      { x: cur.x, y: cur.y - 1 },
    ];
    for (const n of dirs) {
      const nk = `${n.x},${n.y}`;
      if (!visited.has(nk) && n.x >= 0 && n.x < 50 && n.y >= 0 && n.y < 50) {
        visited.add(nk);
        queue.push(n);
      }
    }
  }
  return null;
}

function planStampRampartPerimeter(
  room: Room,
  anchor: { x: number; y: number }
): void {
  const { halfSize } = STAMP_PLANNER;
  const terrain = room.getTerrain();

  for (let dx = -halfSize; dx <= halfSize; dx++) {
    for (let dy = -halfSize; dy <= halfSize; dy++) {
      if (Math.abs(dx) !== halfSize && Math.abs(dy) !== halfSize) continue;
      const ax = anchor.x + dx;
      const ay = anchor.y + dy;
      if (ax < 1 || ax > 48 || ay < 1 || ay > 48) continue;
      if (terrain.get(ax, ay) === TERRAIN_MASK_WALL) continue;
      addPlannedStructureToMemory(
        room,
        PLANNER_KEYS.STAMP_RAMPART_KEY,
        new RoomPosition(ax, ay, room.name)
      );
    }
  }
}

// ── Cardinal arteries ─────────────────────────────────────────────────────────

export function planCardinalArteries(room: Room): void {
  const anchor = getOrFindAnchor(room);
  if (!anchor) return;

  const { halfSize } = STAMP_PLANNER;
  const tap = halfSize + 1; // first tile outside stamp edge

  planStraightArtery(
    room,
    "cardinal_road_north",
    anchor.x,
    anchor.y - tap,
    anchor.x,
    2,
    "vertical"
  );
  planStraightArtery(
    room,
    "cardinal_road_south",
    anchor.x,
    anchor.y + tap,
    anchor.x,
    47,
    "vertical"
  );
  planStraightArtery(
    room,
    "cardinal_road_west",
    anchor.x - tap,
    anchor.y,
    2,
    anchor.y,
    "horizontal"
  );
  planStraightArtery(
    room,
    "cardinal_road_east",
    anchor.x + tap,
    anchor.y,
    47,
    anchor.y,
    "horizontal"
  );

  connectEconomicNodesToArteries(room, anchor);
}

function planStraightArtery(
  room: Room,
  key: string,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  axis: "vertical" | "horizontal"
): void {
  if (room.memory.plannedStructures) {
    const mem = room.memory.plannedStructures as Record<string, string[]>;
    if (mem[key] && mem[key].length > 0) return;
  }

  const terrain = room.getTerrain();
  const lo = axis === "vertical"
    ? Math.min(startY, endY)
    : Math.min(startX, endX);
  const hi = axis === "vertical"
    ? Math.max(startY, endY)
    : Math.max(startX, endX);

  for (let i = lo; i <= hi; i++) {
    const x = axis === "vertical" ? startX : i;
    const y = axis === "vertical" ? i : startY;
    if (x < 1 || x > 48 || y < 1 || y > 48) continue;
    if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
    addPlannedStructureToMemory(room, key, new RoomPosition(x, y, room.name));
  }
}

function connectEconomicNodesToArteries(
  room: Room,
  anchor: { x: number; y: number }
): void {
  const { halfSize } = STAMP_PLANNER;

  // Tap points on the 4 artery lines (just outside stamp)
  const tapPoints = [
    { x: anchor.x,           y: anchor.y - halfSize - 1, label: "N" },
    { x: anchor.x,           y: anchor.y + halfSize + 1, label: "S" },
    { x: anchor.x - halfSize - 1, y: anchor.y,           label: "W" },
    { x: anchor.x + halfSize + 1, y: anchor.y,           label: "E" },
  ];

  const sources = room.find(FIND_SOURCES);
  for (const source of sources) {
    const containerKey = `${PLANNER_KEYS.CONTAINER_SOURCE_PREFIX}${source.id}`;
    const containerPos = plannedPositionsFromMemory(room, containerKey)[0];
    const targetPos = containerPos ?? source.pos;
    const tap = nearestTap(targetPos, tapPoints);
    const roadKey = `cardinal_connector_source_${source.id}`;
    addArteryConnector(room, roadKey, tap, targetPos);
  }

  if (room.controller) {
    const ccPos = plannedPositionsFromMemory(room, PLANNER_KEYS.CONTAINER_CONTROLLER)[0];
    const targetPos = ccPos ?? room.controller.pos;
    const tap = nearestTap(targetPos, tapPoints);
    addArteryConnector(room, "cardinal_connector_controller", tap, targetPos);
  }
}

function nearestTap(
  pos: RoomPosition,
  tapPoints: Array<{ x: number; y: number; label: string }>
): { x: number; y: number } {
  let best = tapPoints[0];
  let bestDist = Infinity;
  for (const tap of tapPoints) {
    const d = Math.abs(pos.x - tap.x) + Math.abs(pos.y - tap.y);
    if (d < bestDist) {
      bestDist = d;
      best = tap;
    }
  }
  return best;
}

function addArteryConnector(
  room: Room,
  key: string,
  from: { x: number; y: number },
  to: RoomPosition
): void {
  if (room.memory.plannedStructures) {
    const mem = room.memory.plannedStructures as Record<string, string[]>;
    if (mem[key] && mem[key].length > 0) return;
  }

  const result = PathFinder.search(
    new RoomPosition(from.x, from.y, room.name),
    { pos: to, range: 1 },
    {
      roomCallback: (rn) => {
        if (rn !== room.name) return false;
        const cm = new PathFinder.CostMatrix();
        const terrain = room.getTerrain();
        for (let x = 0; x < 50; x++) {
          for (let y = 0; y < 50; y++) {
            if (terrain.get(x, y) === TERRAIN_MASK_WALL) cm.set(x, y, 255);
          }
        }
        return cm;
      },
      plainCost: 2,
      swampCost: 10,
      maxOps: 2000,
    }
  );

  for (const step of result.path) {
    addPlannedStructureToMemory(
      room,
      key,
      new RoomPosition(step.x, step.y, room.name)
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isRoadKey(key: string): boolean {
  return (
    key.startsWith(PLANNER_KEYS.ROAD_PREFIX) ||
    key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX) ||
    key === PLANNER_KEYS.STAMP_ROAD_KEY ||
    key.startsWith(PLANNER_KEYS.CARDINAL_ROAD_PREFIX) ||
    key.startsWith("cardinal_connector_")
  );
}
