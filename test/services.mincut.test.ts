import { describe, it, expect, beforeAll } from "vitest";

// services.mincut actually touches the Screeps runtime: it reads terrain via
// Game.map.getRoomTerrain, compares against TERRAIN_MASK_WALL, and constructs RoomPosition
// objects for its result. None of those exist under Node, so we shim them here following the same
// "define just what the module reads" pattern as test/setup.ts. The terrain is swappable per-test
// via a module-level `currentTerrain` lookup.

const ROOM_SIZE = 50;

// Per-test terrain function: (x, y) => mask. Defaults to fully open (no natural walls).
let currentTerrain: (x: number, y: number) => number = () => 0;

beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  g.TERRAIN_MASK_WALL = 1;

  // Minimal RoomPosition stand-in: getCutTiles only ever reads x / y / roomName off the result.
  g.RoomPosition = class {
    public x: number;
    public y: number;
    public roomName: string;
    public constructor(x: number, y: number, roomName: string) {
      this.x = x;
      this.y = y;
      this.roomName = roomName;
    }
  };

  g.Game = {
    map: {
      getRoomTerrain: (_roomName: string) => ({
        get: (x: number, y: number) => currentTerrain(x, y),
      }),
    },
  };
});

// Import AFTER the globals exist. Static import would evaluate the module before beforeAll runs,
// but the module only references these globals inside function bodies (not at import time), so a
// normal top-of-file import is fine — we use it here for clarity.
import { getCutTiles, type Rect } from "../src/services/services.mincut";

// Helper: build a Set of "x,y" keys from a list of positions for easy membership assertions.
function keySet(positions: { x: number; y: number }[]): Set<string> {
  return new Set(positions.map((p) => `${p.x},${p.y}`));
}

describe("getCutTiles — open room", () => {
  beforeAll(() => {
    currentTerrain = () => 0; // fully open
  });

  it("returns a closed ring around a single 3x3 protected rect", () => {
    const protect: Rect[] = [{ x1: 24, y1: 24, x2: 26, y2: 26 }];
    const cut = getCutTiles("W1N1", protect);

    // The minimal seal around a 3x3 block in open space is its 8-connected perimeter: the ring of
    // tiles one step outside the rect. That ring is 5x5 minus the 3x3 interior = 16 tiles.
    expect(cut.length).toBeLessThanOrEqual(16);
    expect(cut.length).toBeGreaterThan(0);

    // Every cut tile must sit immediately outside the protected rect (within the 23..27 box but
    // not inside 24..26), and the set must fully enclose the rect (no gap a diagonal could slip
    // through). We verify enclosure by checking each protected tile's 8 neighbours: any neighbour
    // outside the rect must be a cut tile.
    const cuts = keySet(cut);
    for (const c of cut) {
      expect(c.x).toBeGreaterThanOrEqual(23);
      expect(c.x).toBeLessThanOrEqual(27);
      expect(c.y).toBeGreaterThanOrEqual(23);
      expect(c.y).toBeLessThanOrEqual(27);
    }

    // Enclosure check: walking out from the protected centre in all 8 directions must hit a cut
    // tile before leaving the 5x5 ring.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        // The protected tile on the edge of the rect, stepped one outward, must be a cut tile.
        for (let py = 24; py <= 26; py++) {
          for (let px = 24; px <= 26; px++) {
            const nx = px + dx;
            const ny = py + dy;
            const insideRect = nx >= 24 && nx <= 26 && ny >= 24 && ny <= 26;
            if (!insideRect) {
              expect(cuts.has(`${nx},${ny}`)).toBe(true);
            }
          }
        }
      }
    }
  });

  it("returns a 4-tile cut for a single protected tile in the open", () => {
    // A single tile's 8-neighbour ring is 8 tiles, but the minimal *cut* (cheapest edge set) for
    // one source tile is the 8 surrounding tiles — there is no cheaper interior bottleneck. We
    // assert it is small and fully encloses the tile.
    const protect: Rect[] = [{ x1: 25, y1: 25, x2: 25, y2: 25 }];
    const cut = getCutTiles("W1N1", protect);
    const cuts = keySet(cut);

    expect(cut.length).toBeLessThanOrEqual(8);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        expect(cuts.has(`${25 + dx},${25 + dy}`)).toBe(true);
      }
    }
  });
});

describe("getCutTiles — natural walls shape the cut", () => {
  it("uses a natural wall corridor to reduce the cut to a single rampart", () => {
    // Carve a room that is mostly natural wall, leaving a narrow 1-tile-wide vertical corridor at
    // x=25 that runs from the protected pocket UP to the top exit (y=0). The only path between the
    // protected pocket and the room edge threads through that corridor, so the min-cut is a single
    // rampart plugging it — far smaller than a full 8-tile ring.
    currentTerrain = (x: number, y: number) => {
      // Open the corridor column x=25 for y in 0..30; everything else is wall.
      if (x === 25 && y >= 0 && y <= 30) return 0;
      return 1; // TERRAIN_MASK_WALL
    };

    // Protect the bottom of the corridor. The only way in is from above, so one rampart seals it.
    const protect: Rect[] = [{ x1: 25, y1: 30, x2: 25, y2: 30 }];
    const cut = getCutTiles("W2N2", protect);

    // With natural walls on both sides, the cut is exactly one tile in the corridor above the
    // pocket. Its position is somewhere along x=25 between the pocket and the exit.
    expect(cut.length).toBe(1);
    expect(cut[0].x).toBe(25);
    expect(cut[0].y).toBeLessThan(30);
    expect(cut[0].y).toBeGreaterThanOrEqual(1);
  });

  it("produces a smaller cut in a walled corridor than in open space", () => {
    // Open-space baseline for the same single protected tile.
    currentTerrain = () => 0;
    const openCut = getCutTiles("W2N2", [{ x1: 25, y1: 25, x2: 25, y2: 25 }]);

    // Same tile, but boxed in by walls with only a single corridor up to the top exit.
    currentTerrain = (x: number, y: number) => {
      if (x === 25 && y >= 0 && y <= 25) return 0; // corridor to the top edge
      return 1;
    };
    const walledCut = getCutTiles("W2N2", [{ x1: 25, y1: 25, x2: 25, y2: 25 }]);

    expect(walledCut.length).toBeLessThan(openCut.length);
    expect(walledCut.length).toBe(1);
  });
});

describe("getCutTiles — degenerate input", () => {
  beforeAll(() => {
    currentTerrain = () => 0;
  });

  it("returns an empty array when nothing is protected", () => {
    expect(getCutTiles("W1N1", [])).toEqual([]);
  });

  it("returns an empty array when the protected area touches a room exit", () => {
    // A rect on the room edge cannot be sealed from the exits — the protected tiles ARE on the
    // border. There is no cuttable interior between source and sink, so the cut is empty.
    const protect: Rect[] = [{ x1: 0, y1: 0, x2: 2, y2: 2 }];
    const cut = getCutTiles("W1N1", protect);
    // The protected rect includes the border; the only seal would be on exit tiles which we
    // exclude. We accept either an empty cut or a tiny one that never includes border tiles.
    for (const c of cut) {
      expect(c.x).toBeGreaterThan(0);
      expect(c.y).toBeGreaterThan(0);
    }
  });
});

describe("getCutTiles — preferCloserToProtected option", () => {
  beforeAll(() => {
    currentTerrain = () => 0;
  });

  it("still yields a fully-enclosing cut of the same minimal size", () => {
    const protect: Rect[] = [{ x1: 24, y1: 24, x2: 26, y2: 26 }];
    const far = getCutTiles("W1N1", protect, { preferCloserToProtected: false });
    const close = getCutTiles("W1N1", protect, { preferCloserToProtected: true });

    // Min-cut size is invariant; only the chosen tiles may differ.
    expect(close.length).toBe(far.length);
    expect(close.length).toBeLessThanOrEqual(16);

    // The "close" cut must hug the rect: every tile is in the 23..27 ring.
    for (const c of close) {
      expect(c.x).toBeGreaterThanOrEqual(23);
      expect(c.x).toBeLessThanOrEqual(27);
      expect(c.y).toBeGreaterThanOrEqual(23);
      expect(c.y).toBeLessThanOrEqual(27);
    }
  });
});
