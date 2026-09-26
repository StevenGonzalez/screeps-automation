import { PLANNER_KEYS, STAMP_PLANNER } from "../config/config.structures";
import {
  addPlannedStructureToMemory,
  plannedPositionsFromMemory,
  structureTypeForKey,
} from "../services/services.structures";
import type { StampCell } from "./planner.stamp";
import {
  CASTLE_STAMP,
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
  // An existing spawn is immovable, so it — not a re-optimized guess — must be
  // the stamp origin (cell {0,0}). Pinning the anchor to it keeps the auto
  // layout aligned with the real spawn and stops the base drifting whenever the
  // room-wide optimizer re-runs (which previously happened on every RCL change).
  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length > 0) {
    const cached = room.memory.castleAnchor;
    // Once several spawns exist (RCL 7+), the center is the one the anchor
    // already sat on; if none matches (e.g. correcting an old offset anchor),
    // fall back to the spawn nearest the previous anchor, else the first spawn.
    let center = cached
      ? spawns.find((s) => s.pos.x === cached.x && s.pos.y === cached.y)
      : undefined;
    if (!center) {
      center = cached
        ? spawns.reduce((best, s) =>
            chebyshevDist(s.pos.x - cached.x, s.pos.y - cached.y) <
            chebyshevDist(best.pos.x - cached.x, best.pos.y - cached.y)
              ? s
              : best
          )
        : spawns[0];
    }
    const anchor = { x: center.pos.x, y: center.pos.y };
    room.memory.castleAnchor = anchor;
    return anchor;
  }

  // No spawn yet (unclaimed room or a fresh GCL expansion): optimize once and
  // cache so the layout is stable before the first spawn is placed.
  if (room.memory.castleAnchor) return room.memory.castleAnchor;
  const anchor = findOptimalAnchor(room);
  if (anchor) room.memory.castleAnchor = anchor;
  return anchor;
}

function chebyshevDist(dx: number, dy: number): number {
  return Math.max(Math.abs(dx), Math.abs(dy));
}

type BlockedCheck = (x: number, y: number, type: StructureConstant | null) => boolean;

// A tile is unusable for a planned structure when it is terrain wall, holds a
// source, mineral or controller, or already carries a different structure that
// cannot share the tile (roads, ramparts and containers can be built over).
function buildBlockedCheck(room: Room, terrain: RoomTerrain): BlockedCheck {
  const natural = new Set<string>();
  for (const s of room.find(FIND_SOURCES)) natural.add(`${s.pos.x},${s.pos.y}`);
  for (const m of room.find(FIND_MINERALS)) natural.add(`${m.pos.x},${m.pos.y}`);
  if (room.controller) natural.add(`${room.controller.pos.x},${room.controller.pos.y}`);

  const builtType = new Map<string, StructureConstant>();
  for (const st of room.find(FIND_STRUCTURES)) {
    if (
      st.structureType === STRUCTURE_ROAD ||
      st.structureType === STRUCTURE_RAMPART ||
      st.structureType === STRUCTURE_CONTAINER ||
      st.structureType === STRUCTURE_CONTROLLER
    ) continue;
    builtType.set(`${st.pos.x},${st.pos.y}`, st.structureType);
  }

  return (x, y, type) => {
    if (terrain.get(x, y) === TERRAIN_MASK_WALL) return true;
    const k = `${x},${y}`;
    if (natural.has(k)) return true;
    const existing = builtType.get(k);
    return existing !== undefined && existing !== type;
  };
}

export function shouldUseFallbackForStampCell(cell: StampCell): boolean {
  return cell.type === "tower" || Boolean(cell.critical);
}

export function applyCastleStamp(room: Room): void {
  const anchor = getOrFindAnchor(room);
  if (!anchor) return;

  const rcl = room.controller?.level ?? 0;
  const cells = getStampCellsForRcl(rcl);
  const terrain = room.getTerrain();
  const isBlocked = buildBlockedCheck(room, terrain);

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
  const naturalCells = new Set(cells.map((c) => `${anchor.x + c.dx},${anchor.y + c.dy}`));

  for (const cell of cells) {
    const absX = anchor.x + cell.dx;
    const absY = anchor.y + cell.dy;
    if (absX < 1 || absX > 48 || absY < 1 || absY > 48) continue;

    const posKey = `${absX},${absY}`;

    // Count towers before skipping already-planned cells, or towers planned on
    // earlier runs go uncounted and the RCL cap is overshot.
    if (cell.type === "tower") {
      if (towerCount >= towerCap) continue;
      towerCount++;
    }

    if (occupiedSet.has(posKey)) continue;

    let finalX = absX;
    let finalY = absY;

    const memKey = stampMemoryKeyFor(cell);
    const type = structureTypeForKey(memKey);

    if (isBlocked(absX, absY, type)) {
      if (!shouldUseFallbackForStampCell(cell)) continue;
      const plan = room.memory.plannedStructures as Record<string, string[]> | undefined;
      const prior = plan?.[memKey];
      if (plan && prior && prior.length > 0) {
        if (prior.length > 1) plan[memKey] = [prior[0]];
        occupiedSet.add(prior[0]);
        continue;
      }
      const builtRelocated = room.find(FIND_MY_STRUCTURES, {
        filter: (st) =>
          st.structureType === type &&
          !naturalCells.has(`${st.pos.x},${st.pos.y}`) &&
          !occupiedSet.has(`${st.pos.x},${st.pos.y}`) &&
          Math.max(Math.abs(st.pos.x - absX), Math.abs(st.pos.y - absY)) <= STAMP_PLANNER.bfsMaxRadius,
      })[0];
      if (builtRelocated) {
        occupiedSet.add(`${builtRelocated.pos.x},${builtRelocated.pos.y}`);
        continue;
      }
      const fallback = findNearestBuildable(
        absX,
        absY,
        occupiedSet,
        (x, y) => isBlocked(x, y, type)
      );
      if (!fallback) continue;
      finalX = fallback.x;
      finalY = fallback.y;
    }

    addPlannedStructureToMemory(
      room,
      memKey,
      new RoomPosition(finalX, finalY, room.name)
    );

    if (cell.type !== "road") {
      occupiedSet.add(`${finalX},${finalY}`);
    }
  }

  planMerchantRingExtensions(room, anchor, occupiedSet, rcl, isBlocked);
}

function planMerchantRingExtensions(
  room: Room,
  anchor: { x: number; y: number },
  occupiedSet: Set<string>,
  rcl: number,
  isBlocked: BlockedCheck
): void {
  if (!room.memory.plannedStructures) return;
  const mem = room.memory.plannedStructures as Record<string, string[]>;

  const cap = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][rcl] ?? 0;
  if (cap <= 0) {
    delete mem[PLANNER_KEYS.STAMP_EXTENSION_KEY];
    return;
  }

  const positions: string[] = [];
  for (const { dx, dy } of MERCHANT_RING_EXTENSION_OFFSETS) {
    if (positions.length >= cap) break;
    const x = anchor.x + dx;
    const y = anchor.y + dy;
    if (x < 1 || x > 48 || y < 1 || y > 48) continue;
    if (isBlocked(x, y, STRUCTURE_EXTENSION)) continue;
    const key = `${x},${y}`;
    if (occupiedSet.has(key)) continue;
    positions.push(key);
  }

  if (positions.length < cap) {
    fillExtensionShortfall(room, anchor, occupiedSet, isBlocked, positions, cap);
  }

  mem[PLANNER_KEYS.STAMP_EXTENSION_KEY] = positions;
  if (!room.memory.plannedStructuresMeta) room.memory.plannedStructuresMeta = {} as any;
  const meta = room.memory.plannedStructuresMeta as Record<string, { createdAt: number }>;
  if (!meta[PLANNER_KEYS.STAMP_EXTENSION_KEY]) {
    meta[PLANNER_KEYS.STAMP_EXTENSION_KEY] = { createdAt: Game.time };
  }
}

const EXTENSION_FALLBACK_MAX_RADIUS = 12;

// Ring offsets lost to walls or obstacles would otherwise cost extensions for
// good. Top up from just outside the stamp, nearest first, on a checkerboard so
// every extension keeps free walkable neighbours and nothing gets sealed in.
function fillExtensionShortfall(
  room: Room,
  anchor: { x: number; y: number },
  occupiedSet: Set<string>,
  isBlocked: BlockedCheck,
  positions: string[],
  cap: number
): void {
  const mem = room.memory.plannedStructures as Record<string, string[]>;
  const taken = new Set<string>(positions);
  for (const key of Object.keys(mem)) {
    if (!isRoadKey(key)) continue;
    for (const p of mem[key]) taken.add(p);
  }

  // Roads, containers and ramparts are real tiles we path over; don't wall them in.
  for (const st of room.find(FIND_STRUCTURES)) {
    if (st.structureType !== STRUCTURE_EXTENSION) taken.add(`${st.pos.x},${st.pos.y}`);
  }

  const keepClear: Array<{ pos: RoomPosition; range: number }> = [
    ...room.find(FIND_SOURCES).map((s) => ({ pos: s.pos, range: 1 })),
    ...room.find(FIND_MINERALS).map((m) => ({ pos: m.pos, range: 1 })),
  ];
  // Upgraders and the controller container work within range 2.
  if (room.controller) keepClear.push({ pos: room.controller.pos, range: 2 });

  // A checkerboard in a one-wide corridor would cut it, so only fill open ground.
  const terrain = room.getTerrain();
  const nextToWall = (x: number, y: number): boolean => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (terrain.get(x + dx, y + dy) === TERRAIN_MASK_WALL) return true;
      }
    }
    return false;
  };

  const parity = (anchor.x + anchor.y) % 2;
  const start = `${anchor.x},${anchor.y}`;
  const queue: Array<{ x: number; y: number }> = [{ x: anchor.x, y: anchor.y }];
  const visited = new Set<string>([start]);

  for (let head = 0; head < queue.length && positions.length < cap; head++) {
    const { x, y } = queue[head];
    const key = `${x},${y}`;
    if (
      chebyshevDist(x - anchor.x, y - anchor.y) > STAMP_PLANNER.halfSize &&
      x >= 2 && x <= 47 && y >= 2 && y <= 47 &&
      (x + y) % 2 === parity &&
      !taken.has(key) &&
      !occupiedSet.has(key) &&
      !isBlocked(x, y, STRUCTURE_EXTENSION) &&
      !keepClear.some(({ pos, range }) => chebyshevDist(pos.x - x, pos.y - y) <= range) &&
      !nextToWall(x, y)
    ) {
      positions.push(key);
      taken.add(key);
    }

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 1 || nx > 48 || ny < 1 || ny > 48) continue;
        if (chebyshevDist(nx - anchor.x, ny - anchor.y) > EXTENSION_FALLBACK_MAX_RADIUS) continue;
        const nk = `${nx},${ny}`;
        if (visited.has(nk)) continue;
        visited.add(nk);
        if (isBlocked(nx, ny, null)) continue;
        queue.push({ x: nx, y: ny });
      }
    }
  }
}

function findNearestBuildable(
  startX: number,
  startY: number,
  occupiedSet: Set<string>,
  isBlocked: (x: number, y: number) => boolean
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
      cur.x >= 1 && cur.x <= 48 &&
      cur.y >= 1 && cur.y <= 48 &&
      !isBlocked(cur.x, cur.y) &&
      !occupiedSet.has(`${cur.x},${cur.y}`)
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

// `remotes` are the remotes the home is working; only their exits get an
// artery, so a remote dropped from the active set stops pulling roads.
export function planCardinalArteries(room: Room, remotes: RemoteRoomData[]): void {
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

  planCardinalArteriesToRemotes(room, anchor, cm, remotes);
}

function planCardinalArteriesToRemotes(
  room: Room,
  anchor: { x: number; y: number },
  cm: CostMatrix,
  remotes: RemoteRoomData[]
): void {
  const mem = (room.memory.plannedStructures ?? {}) as Record<string, string[]>;
  const meta = (room.memory.plannedStructuresMeta ?? {}) as Record<string, any>;

  const exitsWithRemote = remoteExitsFor(room, remotes);

  const anchorPos = new RoomPosition(anchor.x, anchor.y, room.name);
  const exitRoadKeys: Array<[ExitConstant, string]> = [
    [FIND_EXIT_TOP,    "cardinal_road_north"],
    [FIND_EXIT_BOTTOM, "cardinal_road_south"],
    [FIND_EXIT_LEFT,   "cardinal_road_west"],
    [FIND_EXIT_RIGHT,  "cardinal_road_east"],
  ];
  for (const [exit, key] of exitRoadKeys) {
    if (!exitsWithRemote.has(exit)) {
      if (mem[key]) { delete mem[key]; delete meta[key]; }
      continue;
    }
    // Aim at the nearest real exit tile on that side, not a fixed point that
    // may be wall or far from where the exit actually is.
    const exitTiles = room.find(exit);
    if (exitTiles.length === 0) continue;
    planRoadKey(room, key, anchorPos, exitTiles, cm);
  }
}

function remoteExitsFor(room: Room, remotes: RemoteRoomData[]): Set<ExitConstant> {
  const out = new Set<ExitConstant>();
  for (const r of remotes) {
    const exit = room.findExitTo(r.roomName);
    if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS) continue;
    out.add(exit);
  }
  return out;
}

function buildSharedRoadCostMatrix(room: Room): CostMatrix {
  const cm = new PathFinder.CostMatrix();
  const terrain = room.getTerrain();

  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) cm.set(x, y, 255);
    }
  }

  for (const s of room.find(FIND_STRUCTURES)) {
    if (s.structureType === STRUCTURE_ROAD) {
      if (cm.get(s.pos.x, s.pos.y) !== 255) cm.set(s.pos.x, s.pos.y, 1);
    } else if (
      s.structureType !== STRUCTURE_CONTAINER &&
      !(s.structureType === STRUCTURE_RAMPART && (s as StructureRampart).my)
    ) {
      cm.set(s.pos.x, s.pos.y, 255);
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
  to: RoomPosition | RoomPosition[],
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
    Array.isArray(to) ? to.map((pos) => ({ pos, range: 1 })) : { pos: to, range: 1 },
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
