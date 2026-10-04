import { describe, it, expect } from "vitest";

import { armsPieces, blazon, shieldOutline } from "../src/services/services.heraldry";

const METALS = ["or", "argent"];
const COLOURS = ["gules", "azure", "vert", "sable", "purpure"];

const rooms: string[] = [];
for (let x = 1; x <= 20; x++) for (let y = 1; y <= 20; y++) rooms.push(`W${x}N${y}`);

function area(pts: Array<[number, number]>): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

describe("castle arms", () => {
  it("blazons every castle's arms the same way each time, metal set against colour", () => {
    expect(blazon("W48S8")).toBe(blazon("W48S8"));
    for (const r of rooms) {
      const b = blazon(r);
      const plain = /^(\w+), a (cross|saltire|chevron|fess|roundel) (\w+)$/.exec(b);
      if (plain) {
        expect(COLOURS).toContain(plain[1]);
        expect(METALS).toContain(plain[3]);
        continue;
      }
      const divided = /^(per pale|per fess|per bend|quarterly) (\w+) and (\w+)$/.exec(b);
      expect(divided, b).not.toBeNull();
      const pair = [divided![2], divided![3]];
      expect(pair.filter((t) => METALS.includes(t))).toHaveLength(1);
      expect(pair.filter((t) => COLOURS.includes(t))).toHaveLength(1);
    }
  });

  it("gives castles all kinds of arms", () => {
    const kinds = new Set(rooms.map((r) => blazon(r).replace(/ (or|argent|gules|azure|vert|sable|purpure)/g, "").replace(/^\w+, /, "")));
    expect([...kinds].sort()).toEqual(
      ["a chevron", "a cross", "a fess", "a roundel", "a saltire", "per bend and", "per fess and", "per pale and", "quarterly and"].sort()
    );
  });

  it("divides the whole shield between a divided field's parts, and keeps every charge on it", () => {
    const shield = area(shieldOutline());
    for (const r of rooms) {
      const pieces = armsPieces(r);
      for (const p of pieces) {
        for (const [x, y] of p.points) {
          expect(Math.abs(x)).toBeLessThanOrEqual(1 + 1e-9);
          expect(Math.abs(y)).toBeLessThanOrEqual(1.2 + 1e-9);
        }
      }
      if (blazon(r).includes(",")) {
        expect(pieces[0].points).toBe(shieldOutline());
        expect(pieces.length).toBeGreaterThan(1);
      } else {
        const total = pieces.reduce((sum, p) => sum + area(p.points), 0);
        expect(total).toBeCloseTo(shield, 6);
      }
    }
  });
});
