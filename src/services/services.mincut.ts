// Minimum-cut wall planner for Screeps. Given a set of rectangles to protect, this computes
// the smallest set of tiles where ramparts must be placed to fully seal those rectangles from
// the room edges (the exits). This is the classic max-flow / min-cut problem on the 50x50 grid,
// originally popularised in the Screeps community by Saruss. We model each passable tile as a
// pair of vertices joined by a capacity-1 edge (placing a rampart "cuts" that edge), run Dinic's
// max-flow, and read the min-cut back off the residual graph.
//
// The module is pure: it only READS terrain via Game.map.getRoomTerrain and never mutates game
// state. It is intended to run rarely (re-plan every ~1500 ticks), so it favours a correct,
// minimal cut over raw speed — Dinic on ~5000 vertices is comfortably within the CPU budget.

// An inclusive rectangle in room coordinates (0..49 on each axis).
export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface MinCutOptions {
  // Restrict the cut to within this rectangle. Tiles outside it are treated as "must not be
  // walled" — useful to bound the search away from a room's far edges. Defaults to the whole
  // interior (1..48), which keeps the cut off the exit tiles themselves.
  bounds?: Rect;
  // When true, ties between equally-sized cuts are broken toward tiles nearer the protected
  // area (a tighter ring). When false (default) the cut may sit further out where terrain helps.
  preferCloserToProtected?: boolean;
}

// Tile-state codes used while building the graph.
const UNWALKABLE = -1; // natural wall or outside bounds: never part of the flow graph.
const NORMAL = 0; // ordinary passable tile: cuttable with weight 1.
const PROTECTED = 1; // inside a protected rect: never cuttable (infinite weight).
const EXIT = 2; // a passable border tile (a room exit): drains to the sink.

// "Infinite" capacity for edges that must never be cut. Far larger than any achievable flow
// (the whole interior is < 2500 tiles, so 2500 flow units is the hard ceiling).
const INF = 1 << 20;

// Room is 50x50. We index tiles by y * 50 + x for compactness.
const ROOM_SIZE = 50;

// A single directed edge in the flow network. `cap` is the residual capacity; `flow` is implied
// by the paired reverse edge. `to` is the destination vertex; `rev` indexes the reverse edge in
// the destination's adjacency list.
interface Edge {
  to: number;
  cap: number;
  rev: number;
}

// Dinic's algorithm over an adjacency-list flow network. Vertices are plain integers.
class MaxFlow {
  public readonly graph: Edge[][];
  private readonly level: Int32Array;
  private readonly iter: Int32Array;

  public constructor(vertexCount: number) {
    this.graph = Array.from({ length: vertexCount }, () => []);
    this.level = new Int32Array(vertexCount);
    this.iter = new Int32Array(vertexCount);
  }

  // Add a directed edge from->to with the given capacity, plus its (zero-capacity) reverse edge.
  public addEdge(from: number, to: number, cap: number): void {
    this.graph[from].push({ to, cap, rev: this.graph[to].length });
    this.graph[to].push({ to: from, cap: 0, rev: this.graph[from].length - 1 });
  }

  // BFS to assign levels in the residual graph; returns whether the sink is still reachable.
  private bfs(source: number, sink: number): boolean {
    this.level.fill(-1);
    const queue: number[] = [source];
    this.level[source] = 0;
    for (let head = 0; head < queue.length; head++) {
      const v = queue[head];
      for (const e of this.graph[v]) {
        if (e.cap > 0 && this.level[e.to] < 0) {
          this.level[e.to] = this.level[v] + 1;
          queue.push(e.to);
        }
      }
    }
    return this.level[sink] >= 0;
  }

  // DFS to push blocking flow along level-graph edges. Returns the flow pushed (0 if stuck).
  private dfs(v: number, sink: number, pushed: number): number {
    if (v === sink) return pushed;
    for (; this.iter[v] < this.graph[v].length; this.iter[v]++) {
      const e = this.graph[v][this.iter[v]];
      if (e.cap > 0 && this.level[v] < this.level[e.to]) {
        const d = this.dfs(e.to, sink, Math.min(pushed, e.cap));
        if (d > 0) {
          e.cap -= d;
          this.graph[e.to][e.rev].cap += d;
          return d;
        }
      }
    }
    return 0;
  }

  // Run Dinic's to completion and return the max-flow value.
  public maxflow(source: number, sink: number): number {
    let flow = 0;
    while (this.bfs(source, sink)) {
      this.iter.fill(0);
      let f = this.dfs(source, sink, INF);
      while (f > 0) {
        flow += f;
        f = this.dfs(source, sink, INF);
      }
    }
    return flow;
  }

  // After maxflow, the source side of the min-cut is exactly the vertices still reachable from
  // the source through edges with residual capacity. Returns a boolean array over all vertices.
  public minCutReachable(source: number): Uint8Array {
    const reachable = new Uint8Array(this.graph.length);
    const queue: number[] = [source];
    reachable[source] = 1;
    for (let head = 0; head < queue.length; head++) {
      const v = queue[head];
      for (const e of this.graph[v]) {
        if (e.cap > 0 && !reachable[e.to]) {
          reachable[e.to] = 1;
          queue.push(e.to);
        }
      }
    }
    return reachable;
  }
}

// Clamp a rectangle to the room interior and normalise so x1<=x2, y1<=y2.
function normaliseRect(r: Rect): Rect {
  return {
    x1: Math.max(0, Math.min(r.x1, r.x2)),
    y1: Math.max(0, Math.min(r.y1, r.y2)),
    x2: Math.min(ROOM_SIZE - 1, Math.max(r.x1, r.x2)),
    y2: Math.min(ROOM_SIZE - 1, Math.max(r.y1, r.y2)),
  };
}

// Build the per-tile state grid: natural walls and out-of-bounds tiles are UNWALKABLE, protected
// rects are PROTECTED, passable border tiles are EXIT, everything else is NORMAL.
function buildGrid(roomName: string, protect: Rect[], bounds: Rect): Int8Array {
  const terrain = Game.map.getRoomTerrain(roomName);
  const grid = new Int8Array(ROOM_SIZE * ROOM_SIZE);

  for (let y = 0; y < ROOM_SIZE; y++) {
    for (let x = 0; x < ROOM_SIZE; x++) {
      const idx = y * ROOM_SIZE + x;
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
        grid[idx] = UNWALKABLE;
        continue;
      }
      // A passable tile on the very edge of the room is an exit: it drains to the sink.
      if (x === 0 || y === 0 || x === ROOM_SIZE - 1 || y === ROOM_SIZE - 1) {
        grid[idx] = EXIT;
        continue;
      }
      // Tiles outside the search bounds can never be walls (we don't want the cut wandering off).
      if (x < bounds.x1 || x > bounds.x2 || y < bounds.y1 || y > bounds.y2) {
        grid[idx] = UNWALKABLE;
        continue;
      }
      grid[idx] = NORMAL;
    }
  }

  // Paint protected rectangles last so they override NORMAL (but not UNWALKABLE natural walls —
  // a natural wall inside a protected rect is still impassable and needs no rampart).
  for (const rect of protect) {
    const r = normaliseRect(rect);
    for (let y = r.y1; y <= r.y2; y++) {
      for (let x = r.x1; x <= r.x2; x++) {
        const idx = y * ROOM_SIZE + x;
        if (grid[idx] !== UNWALKABLE) grid[idx] = PROTECTED;
      }
    }
  }

  return grid;
}

// The eight neighbour offsets (diagonals included: Screeps creeps move diagonally, so the cut
// must block diagonal leaks too).
const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

// Compute the minimum set of tiles to rampart so the protected rectangles are sealed from the
// room edges. Returns the positions where ramparts should be placed.
//
// Returns an empty array for degenerate input: no protected tiles, or a protected area that
// already touches an exit (impossible to seal — nothing sensible to return).
export function getCutTiles(roomName: string, protect: Rect[], options: MinCutOptions = {}): RoomPosition[] {
  if (protect.length === 0) return [];

  // Default bounds keep the cut inside 1..48 so it never lands on the exit ring itself.
  const bounds = normaliseRect(options.bounds ?? { x1: 1, y1: 1, x2: ROOM_SIZE - 2, y2: ROOM_SIZE - 2 });
  const grid = buildGrid(roomName, protect, bounds);

  // Vertex layout: each tile t owns two vertices — "in" at 2*t and "out" at 2*t+1. The source
  // and sink are two extra vertices appended after the per-tile ones.
  const tileCount = ROOM_SIZE * ROOM_SIZE;
  const inV = (t: number): number => 2 * t;
  const outV = (t: number): number => 2 * t + 1;
  const SOURCE = 2 * tileCount;
  const SINK = 2 * tileCount + 1;

  const flow = new MaxFlow(2 * tileCount + 2);

  let hasProtected = false;
  let hasNormal = false;

  for (let y = 0; y < ROOM_SIZE; y++) {
    for (let x = 0; x < ROOM_SIZE; x++) {
      const t = y * ROOM_SIZE + x;
      const state = grid[t];
      if (state === UNWALKABLE) continue;

      if (state === PROTECTED) {
        hasProtected = true;
        // Protected tiles are the flow source: the source pushes unlimited flow into them, and
        // their internal in->out edge is uncuttable (infinite) so they're never selected.
        flow.addEdge(SOURCE, inV(t), INF);
        flow.addEdge(inV(t), outV(t), INF);
      } else if (state === EXIT) {
        // Exits drain to the sink. Their internal edge is irrelevant (they sit on the border and
        // are excluded from the cut by construction), so model them as a pass-through to SINK.
        flow.addEdge(inV(t), SINK, INF);
        flow.addEdge(inV(t), outV(t), INF);
      } else {
        // NORMAL: the in->out edge has capacity 1. Saturating it == placing one rampart here.
        hasNormal = true;
        flow.addEdge(inV(t), outV(t), 1);
      }

      // Connect this tile's "out" to each walkable neighbour's "in" with infinite capacity. Flow
      // can move freely between adjacent tiles; the only bottleneck is each tile's internal edge.
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= ROOM_SIZE || ny >= ROOM_SIZE) continue;
        const nt = ny * ROOM_SIZE + nx;
        if (grid[nt] === UNWALKABLE) continue;
        flow.addEdge(outV(t), inV(nt), INF);
      }
    }
  }

  // Nothing to protect, or no cuttable tiles exist between the protected area and the exits.
  if (!hasProtected || !hasNormal) return [];

  flow.maxflow(SOURCE, SINK);
  const reachable = flow.minCutReachable(SOURCE);

  // A tile is a cut tile when its "in" vertex is on the source side but its "out" vertex is not:
  // that is precisely the capacity-1 internal edge that the min-cut severs. Only NORMAL tiles can
  // be in this state (protected/exit internal edges are infinite and never saturated).
  const cut: RoomPosition[] = [];
  for (let t = 0; t < tileCount; t++) {
    if (grid[t] !== NORMAL) continue;
    if (reachable[inV(t)] && !reachable[outV(t)]) {
      cut.push(new RoomPosition(t % ROOM_SIZE, Math.floor(t / ROOM_SIZE), roomName));
    }
  }

  // The min-cut is unique in size, but the SET of cut tiles is only unique up to ties. By default
  // Dinic's residual-reachability yields the cut nearest the SINK (further from the protected
  // area). When the caller prefers a tighter ring, re-derive the cut from the SOURCE side instead
  // by walking the residual graph backwards from the sink.
  if (options.preferCloserToProtected) {
    return cutNearestSource(flow, grid, SINK, tileCount, roomName, inV, outV);
  }

  return cut;
}

// Alternative cut extraction: the set of saturated tiles whose "out" vertex can reach the SINK in
// the residual graph but whose "in" cannot — i.e. the cut hugging the source/protected side.
function cutNearestSource(
  flow: MaxFlow,
  grid: Int8Array,
  sink: number,
  tileCount: number,
  roomName: string,
  inV: (t: number) => number,
  outV: (t: number) => number,
): RoomPosition[] {
  // Reverse-reachability from the sink: a vertex is sink-reachable if it can reach the sink along
  // residual-capacity edges. We compute it by scanning reverse edges with residual capacity.
  const sinkReachable = new Uint8Array(flow.graph.length);
  const queue: number[] = [sink];
  sinkReachable[sink] = 1;
  for (let head = 0; head < queue.length; head++) {
    const v = queue[head];
    for (const e of flow.graph[v]) {
      // The reverse edge e.rev in graph[e.to] points back to v; v can reach e.to's chain if that
      // reverse edge has residual capacity (meaning forward flow exists / capacity remains).
      const rev = flow.graph[e.to][e.rev];
      if (rev.cap > 0 && !sinkReachable[e.to]) {
        sinkReachable[e.to] = 1;
        queue.push(e.to);
      }
    }
  }

  const cut: RoomPosition[] = [];
  for (let t = 0; t < tileCount; t++) {
    if (grid[t] !== NORMAL) continue;
    if (sinkReachable[outV(t)] && !sinkReachable[inV(t)]) {
      cut.push(new RoomPosition(t % ROOM_SIZE, Math.floor(t / ROOM_SIZE), roomName));
    }
  }
  return cut;
}
