import { PLANNER_KEYS, STAMP_PLANNER } from "../config/config.structures";
import {
  addPlannedStructureToMemory,
  plannedPositionsFromMemory,
} from "../services/services.structures";
import {
  CASTLE_STAMP,
  StampCell,
  MERCHANT_RING_EXTENSION_OFFSETS,
  getStampCellsForRcl,
  stampMemoryKeyFor,
} from "./planner.stamp";

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
      if (
        cx - halfSize < 1 ||
        cx + halfSize > 48 ||
        cy - halfSize < 1 ||
        cy + halfSize > 48
      )
        continue;

      let score = 0;

      for (const cell of seedCells) {
        const ax = cx + cell.dx;
        const ay = cy + cell.dy;
        if (ax < 1 || ax > 48 || ay < 1 || ay > 48) continue;
        if (terrain.get(ax, ay) !== TERRAIN_MASK_WALL) score++;
      }

      const edgeDist = Math.min(cx, cy, 49 - cx, 49 - cy);
      score += edgeDist * 0.3;

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

export function applyCastleStamp(room: Room): void {
  const anchor = getOrFindAnchor(room);
  if (!anchor) return;

  const rcl = room.controller?.level ?? 0;
  const cells = getStampCellsForRcl(rcl);
  const terrain = room.getTerrain();

  const occupiedSet = new Set<string>();
  if (room.memory.plannedStructures) {
    const mem = room.memory.plannedStructures as Record<string, string[]>;
    for (const key of Object.keys(mem)) {
      if (isRoadKey(key)) continue;
      if (key === PLANNER_KEYS.STAMP_EXTENSION_KEY) continue;
      for (const p of mem[key]) occupiedSet.add(p);
    }
  }

  let towerCount = 0;
  const towerCap = CONTROLLER_STRUCTURES[STRUCTURE_TOWER][rcl] ?? 0;

  for (const cell of cells) {
    const absX = anchor.x + cell.dx;
    const absY = anchor.y + cell.dy;
    if (absX < 1 || absX > 48 || absY < 1 || absY > 48) continue;

    const posKey = `${absX},${absY}`;

    if (occupiedSet.has(posKey)) continue;

    if (cell.type === "tower") {
      if (towerCount >= towerCap) continue;
      towerCount++;
    }

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

  planMerchantRingExtensions(room, anchor, occupiedSet, rcl);
}

function planMerchantRingExtensions(
  room: Room,
  anchor: { x: number; y: number },
  occupiedSet: Set<string>,
  rcl: number
): void {
  if (!room.memory.plannedStructures) return;
  const mem = room.memory.plannedStructures as Record<string, string[]>;

  const cap = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][rcl] ?? 0;
  if (cap <= 0) {
    delete mem[PLANNER_KEYS.STAMP_EXTENSION_KEY];
    return;
  }

  const terrain = room.getTerrain();
  const positions: string[] = [];
  for (const { dx, dy } of MERCHANT_RING_EXTENSION_OFFSETS) {
    if (positions.length >= cap) break;
    const x = anchor.x + dx;
    const y = anchor.y + dy;
    if (x < 1 || x > 48 || y < 1 || y > 48) continue;
    if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
    const key = `${x},${y}`;
    if (occupiedSet.has(key)) continue;
    positions.push(key);
  }

  mem[PLANNER_KEYS.STAMP_EXTENSION_KEY] = positions;
  if (!room.memory.plannedStructuresMeta) room.memory.plannedStructuresMeta = {} as any;
  const meta = room.memory.plannedStructuresMeta as Record<string, { createdAt: number }>;
  if (!meta[PLANNER_KEYS.STAMP_EXTENSION_KEY]) {
    meta[PLANNER_KEYS.STAMP_EXTENSION_KEY] = { createdAt: Game.time };
  }
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

export function planCardinalArteries(room: Room): void {
  const anchor = getOrFindAnchor(room);
  if (!anchor) return;

  const cm = buildSharedRoadCostMatrix(room);

  const anchorPos = new RoomPosition(anchor.x, anchor.y, room.name);

  for (const source of room.find(FIND_SOURCES)) {
    const containerPos = plannedPositionsFromMemory(
      room,
      `${PLANNER_KEYS.CONTAINER_SOURCE_PREFIX}${source.id}`
    )[0];
    const target = containerPos ?? source.pos;
    planRoadKey(room, `cardinal_connector_source_${source.id}`, anchorPos, target, cm);
  }

  if (room.controller) {
    const ccPos = plannedPositionsFromMemory(room, PLANNER_KEYS.CONTAINER_CONTROLLER)[0];
    const target = ccPos ?? room.controller.pos;
    planRoadKey(room, "cardinal_connector_controller", anchorPos, target, cm);
  }

  const mineral = room.find(FIND_MINERALS)[0] as Mineral | undefined;
  if (mineral) {
    const mpos = plannedPositionsFromMemory(
      room,
      `${PLANNER_KEYS.CONTAINER_MINERAL_PREFIX}${mineral.id}`
    )[0];
    const target = mpos ?? mineral.pos;
    planRoadKey(room, `cardinal_connector_mineral_${mineral.id}`, anchorPos, target, cm);
  }

  planCardinalArteriesToRemotes(room, anchor, cm);
}

function planCardinalArteriesToRemotes(
  room: Room,
  anchor: { x: number; y: number },
  cm: CostMatrix
): void {
  const mem = (room.memory.plannedStructures ?? {}) as Record<string, string[]>;
  const meta = (room.memory.plannedStructuresMeta ?? {}) as Record<string, any>;

  const dirsWithRemote = remoteDirectionsFor(room);

  const targets: Record<string, { x: number; y: number } | null> = {
    cardinal_road_north: dirsWithRemote.has("N") ? { x: anchor.x, y: 2 }  : null,
    cardinal_road_south: dirsWithRemote.has("S") ? { x: anchor.x, y: 47 } : null,
    cardinal_road_west:  dirsWithRemote.has("W") ? { x: 2,  y: anchor.y } : null,
    cardinal_road_east:  dirsWithRemote.has("E") ? { x: 47, y: anchor.y } : null,
  };

  const anchorPos = new RoomPosition(anchor.x, anchor.y, room.name);
  for (const [key, target] of Object.entries(targets)) {
    if (!target) {
      if (mem[key]) { delete mem[key]; delete meta[key]; }
      continue;
    }
    const targetPos = new RoomPosition(target.x, target.y, room.name);
    planRoadKey(room, key, anchorPos, targetPos, cm);
  }
}

function remoteDirectionsFor(room: Room): Set<"N" | "S" | "E" | "W"> {
  const out = new Set<"N" | "S" | "E" | "W">();
  const remotes = room.memory.remoteRooms ?? [];
  for (const r of remotes) {
    if (r.hostile) continue;
    const dir = roomExitDirection(room.name, r.roomName);
    if (dir) out.add(dir);
  }
  return out;
}

function roomExitDirection(
  from: string,
  to: string
): "N" | "S" | "E" | "W" | null {
  const parse = (name: string) => {
    const m = /^([WE])(\d+)([NS])(\d+)$/.exec(name);
    if (!m) return null;
    const x = (m[1] === "W" ? -1 : 1) * parseInt(m[2], 10);
    const y = (m[3] === "N" ? -1 : 1) * parseInt(m[4], 10);
    return { x, y };
  };
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === -1) return "N";
  if (dx === 0 && dy ===  1) return "S";
  if (dx === 1 && dy ===  0) return "E";
  if (dx === -1 && dy === 0) return "W";
  return null;
}

function buildSharedRoadCostMatrix(room: Room): CostMatrix {
  const cm = new PathFinder.CostMatrix();
  const terrain = room.getTerrain();

  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) cm.set(x, y, 255);
    }
  }

  const mem = room.memory.plannedStructures as Record<string, string[]> | undefined;
  if (mem) {
    for (const key of Object.keys(mem)) {
      const road = isRoadKey(key);
      for (const p of mem[key]) {
        const comma = p.indexOf(",");
        const px = +p.slice(0, comma);
        const py = +p.slice(comma + 1);
        if (px < 0 || px >= 50 || py < 0 || py >= 50) continue;
        if (road) {
          if (cm.get(px, py) !== 255) cm.set(px, py, 1);
        } else {
          cm.set(px, py, 255);
        }
      }
    }
  }
  return cm;
}

function planRoadKey(
  room: Room,
  key: string,
  from: RoomPosition,
  to: RoomPosition,
  cm: CostMatrix
): void {
  const mem = room.memory.plannedStructures as Record<string, string[]> | undefined;
  if (mem && mem[key] && mem[key].length > 0) {
    for (const p of mem[key]) {
      const comma = p.indexOf(",");
      const px = +p.slice(0, comma);
      const py = +p.slice(comma + 1);
      if (cm.get(px, py) !== 255) cm.set(px, py, 1);
    }
    return;
  }

  const result = PathFinder.search(
    from,
    { pos: to, range: 1 },
    {
      roomCallback: (rn) => (rn === room.name ? cm : false),
      plainCost: 2,
      swampCost: 10,
      maxOps: 4000,
    }
  );

  if (result.incomplete || result.path.length === 0) return;

  for (const step of result.path) {
    addPlannedStructureToMemory(room, key, new RoomPosition(step.x, step.y, room.name));
    if (cm.get(step.x, step.y) !== 255) cm.set(step.x, step.y, 1);
  }
}

function isRoadKey(key: string): boolean {
  return (
    key.startsWith(PLANNER_KEYS.ROAD_PREFIX) ||
    key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX) ||
    key === PLANNER_KEYS.STAMP_ROAD_KEY ||
    key.startsWith(PLANNER_KEYS.CARDINAL_ROAD_PREFIX) ||
    key.startsWith("cardinal_connector_")
  );
}
