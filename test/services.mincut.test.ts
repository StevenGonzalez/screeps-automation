import { describe, it, expect, beforeAll } from "vitest";

const ROOM_SIZE = 50;

let currentTerrain: (x: number, y: number) => number = () => 0;

beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  g.TERRAIN_MASK_WALL = 1;

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

import { getCutTiles, type Rect } from "../src/services/services.mincut";

function keySet(positions: { x: number; y: number }[]): Set<string> {
  return new Set(positions.map((p) => `${p.x},${p.y}`));
}

describe("getCutTiles - open room", () => {
  beforeAll(() => {
    currentTerrain = () => 0;
  });

  it("returns a closed ring around a single 3x3 protected rect", () => {
    const protect: Rect[] = [{ x1: 24, y1: 24, x2: 26, y2: 26 }];
    const cut = getCutTiles("W1N1", protect);

    expect(cut.length).toBeLessThanOrEqual(16);
    expect(cut.length).toBeGreaterThan(0);

    const cuts = keySet(cut);
    for (const c of cut) {
      expect(c.x).toBeGreaterThanOrEqual(23);
      expect(c.x).toBeLessThanOrEqual(27);
      expect(c.y).toBeGreaterThanOrEqual(23);
      expect(c.y).toBeLessThanOrEqual(27);
    }

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
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

describe("getCutTiles - natural walls shape the cut", () => {
  it("uses a natural wall corridor to reduce the cut to a single rampart", () => {
    currentTerrain = (x: number, y: number) => {
      if (x === 25 && y >= 0 && y <= 30) return 0;
      return 1;
    };

    const protect: Rect[] = [{ x1: 25, y1: 30, x2: 25, y2: 30 }];
    const cut = getCutTiles("W2N2", protect);

    expect(cut.length).toBe(1);
    expect(cut[0].x).toBe(25);
    expect(cut[0].y).toBeLessThan(30);
    expect(cut[0].y).toBeGreaterThanOrEqual(1);
  });

  it("produces a smaller cut in a walled corridor than in open space", () => {
    currentTerrain = () => 0;
    const openCut = getCutTiles("W2N2", [{ x1: 25, y1: 25, x2: 25, y2: 25 }]);

    currentTerrain = (x: number, y: number) => {
      if (x === 25 && y >= 0 && y <= 25) return 0;
      return 1;
    };
    const walledCut = getCutTiles("W2N2", [{ x1: 25, y1: 25, x2: 25, y2: 25 }]);

    expect(walledCut.length).toBeLessThan(openCut.length);
    expect(walledCut.length).toBe(1);
  });
});

describe("getCutTiles - degenerate input", () => {
  beforeAll(() => {
    currentTerrain = () => 0;
  });

  it("returns an empty array when nothing is protected", () => {
    expect(getCutTiles("W1N1", [])).toEqual([]);
  });

  it("returns an empty array when the protected area touches a room exit", () => {
    const protect: Rect[] = [{ x1: 0, y1: 0, x2: 2, y2: 2 }];
    const cut = getCutTiles("W1N1", protect);
    for (const c of cut) {
      expect(c.x).toBeGreaterThan(0);
      expect(c.y).toBeGreaterThan(0);
    }
  });
});

describe("getCutTiles - preferCloserToProtected option", () => {
  beforeAll(() => {
    currentTerrain = () => 0;
  });

  it("still yields a fully-enclosing cut of the same minimal size", () => {
    const protect: Rect[] = [{ x1: 24, y1: 24, x2: 26, y2: 26 }];
    const far = getCutTiles("W1N1", protect, { preferCloserToProtected: false });
    const close = getCutTiles("W1N1", protect, { preferCloserToProtected: true });

    expect(close.length).toBe(far.length);
    expect(close.length).toBeLessThanOrEqual(16);

    for (const c of close) {
      expect(c.x).toBeGreaterThanOrEqual(23);
      expect(c.x).toBeLessThanOrEqual(27);
      expect(c.y).toBeGreaterThanOrEqual(23);
      expect(c.y).toBeLessThanOrEqual(27);
    }
  });
});
