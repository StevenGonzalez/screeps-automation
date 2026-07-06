export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface MinCutOptions {
  bounds?: Rect;
  preferCloserToProtected?: boolean;
}

const UNWALKABLE = -1;
const NORMAL = 0;
const PROTECTED = 1;
const EXIT = 2;

const INF = 1 << 20;

const ROOM_SIZE = 50;

interface Edge {
  to: number;
  cap: number;
  rev: number;
}

class MaxFlow {
  public readonly graph: Edge[][];
  private readonly level: Int32Array;
  private readonly iter: Int32Array;

  public constructor(vertexCount: number) {
    this.graph = Array.from({ length: vertexCount }, () => []);
    this.level = new Int32Array(vertexCount);
    this.iter = new Int32Array(vertexCount);
  }

  public addEdge(from: number, to: number, cap: number): void {
    this.graph[from].push({ to, cap, rev: this.graph[to].length });
    this.graph[to].push({ to: from, cap: 0, rev: this.graph[from].length - 1 });
  }

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

function normaliseRect(r: Rect): Rect {
  return {
    x1: Math.max(0, Math.min(r.x1, r.x2)),
    y1: Math.max(0, Math.min(r.y1, r.y2)),
    x2: Math.min(ROOM_SIZE - 1, Math.max(r.x1, r.x2)),
    y2: Math.min(ROOM_SIZE - 1, Math.max(r.y1, r.y2)),
  };
}

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
      if (x === 0 || y === 0 || x === ROOM_SIZE - 1 || y === ROOM_SIZE - 1) {
        grid[idx] = EXIT;
        continue;
      }
      if (x < bounds.x1 || x > bounds.x2 || y < bounds.y1 || y > bounds.y2) {
        grid[idx] = UNWALKABLE;
        continue;
      }
      grid[idx] = NORMAL;
    }
  }

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

export function getCutTiles(roomName: string, protect: Rect[], options: MinCutOptions = {}): RoomPosition[] {
  if (protect.length === 0) return [];

  const bounds = normaliseRect(options.bounds ?? { x1: 1, y1: 1, x2: ROOM_SIZE - 2, y2: ROOM_SIZE - 2 });
  const grid = buildGrid(roomName, protect, bounds);

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
        flow.addEdge(SOURCE, inV(t), INF);
        flow.addEdge(inV(t), outV(t), INF);
      } else if (state === EXIT) {
        flow.addEdge(inV(t), SINK, INF);
        flow.addEdge(inV(t), outV(t), INF);
      } else {
        hasNormal = true;
        flow.addEdge(inV(t), outV(t), 1);
      }

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

  if (!hasProtected || !hasNormal) return [];

  flow.maxflow(SOURCE, SINK);
  const reachable = flow.minCutReachable(SOURCE);

  const cut: RoomPosition[] = [];
  for (let t = 0; t < tileCount; t++) {
    if (grid[t] !== NORMAL) continue;
    if (reachable[inV(t)] && !reachable[outV(t)]) {
      cut.push(new RoomPosition(t % ROOM_SIZE, Math.floor(t / ROOM_SIZE), roomName));
    }
  }

  if (options.preferCloserToProtected) {
    return cutNearestSource(flow, grid, SINK, tileCount, roomName, inV, outV);
  }

  return cut;
}

function cutNearestSource(
  flow: MaxFlow,
  grid: Int8Array,
  sink: number,
  tileCount: number,
  roomName: string,
  inV: (t: number) => number,
  outV: (t: number) => number,
): RoomPosition[] {
  const sinkReachable = new Uint8Array(flow.graph.length);
  const queue: number[] = [sink];
  sinkReachable[sink] = 1;
  for (let head = 0; head < queue.length; head++) {
    const v = queue[head];
    for (const e of flow.graph[v]) {
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
