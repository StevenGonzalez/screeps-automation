import { STAMP_PLANNER } from "../config/config.structures";

export type StampStructureType =
  | "spawn"
  | "storage"
  | "terminal"
  | "factory"
  | "tower"
  | "extension"
  | "lab"
  | "nuker"
  | "power_spawn"
  | "observer"
  | "link"
  | "road"
  | "rampart";

export interface StampCell {
  dx: number;
  dy: number;
  type: StampStructureType;
  minRcl: number;
  critical?: boolean;
}

export const CASTLE_STAMP: StampCell[] = [
  { dx:  0, dy:  0, type: "spawn",       minRcl: 1, critical: true },
  { dx: -2, dy:  0, type: "spawn",       minRcl: 7, critical: true },
  { dx:  2, dy:  0, type: "spawn",       minRcl: 8, critical: true },
  { dx:  0, dy:  2, type: "storage",     minRcl: 4, critical: true },
  { dx:  0, dy: -2, type: "terminal",    minRcl: 6, critical: true },
  { dx:  0, dy: -4, type: "factory",     minRcl: 7, critical: true },
  { dx:  0, dy: -6, type: "observer",    minRcl: 8 },
  { dx:  2, dy: -4, type: "power_spawn", minRcl: 8, critical: true },
  { dx: -2, dy: -4, type: "nuker",       minRcl: 8 },
  { dx:  1, dy:  3, type: "link",        minRcl: 5 },
  { dx: -4, dy: -4, type: "tower",       minRcl: 3 },
  { dx:  4, dy: -4, type: "tower",       minRcl: 5 },
  { dx: -4, dy:  4, type: "tower",       minRcl: 5 },
  { dx:  4, dy:  4, type: "tower",       minRcl: 6 },
  { dx: -4, dy:  0, type: "tower",       minRcl: 7 },
  { dx:  4, dy:  0, type: "tower",       minRcl: 8 },
  { dx:  3, dy:  2, type: "lab",         minRcl: 6 },
  { dx:  4, dy:  2, type: "lab",         minRcl: 6 },
  { dx:  3, dy:  3, type: "lab",         minRcl: 6 },
  { dx:  4, dy:  3, type: "lab",         minRcl: 7 },
  { dx:  5, dy:  2, type: "lab",         minRcl: 7 },
  { dx:  5, dy:  3, type: "lab",         minRcl: 7 },
  { dx:  3, dy:  4, type: "lab",         minRcl: 7 },
  { dx:  5, dy:  4, type: "lab",         minRcl: 8 },
  { dx:  3, dy:  1, type: "lab",         minRcl: 8 },
  { dx:  4, dy:  1, type: "lab",         minRcl: 8 },
  { dx: -1, dy:  0, type: "road", minRcl: 1 },
  { dx:  1, dy:  0, type: "road", minRcl: 1 },
  { dx: -3, dy:  0, type: "road", minRcl: 1 },
  { dx:  3, dy:  0, type: "road", minRcl: 1 },
  { dx: -5, dy:  0, type: "road", minRcl: 1 },
  { dx:  5, dy:  0, type: "road", minRcl: 1 },
  { dx:  0, dy: -1, type: "road", minRcl: 1 },
  { dx:  0, dy:  1, type: "road", minRcl: 1 },
  { dx:  0, dy: -3, type: "road", minRcl: 1 },
  { dx:  0, dy:  3, type: "road", minRcl: 1 },
  { dx:  0, dy: -5, type: "road", minRcl: 1 },
  { dx:  0, dy:  5, type: "road", minRcl: 1 },
  { dx: -1, dy: -1, type: "road", minRcl: 1 },
  { dx: -2, dy: -2, type: "road", minRcl: 1 },
  { dx: -3, dy: -3, type: "road", minRcl: 1 },
  { dx:  1, dy: -1, type: "road", minRcl: 1 },
  { dx:  2, dy: -2, type: "road", minRcl: 1 },
  { dx:  3, dy: -3, type: "road", minRcl: 1 },
  { dx: -1, dy:  1, type: "road", minRcl: 1 },
  { dx: -2, dy:  2, type: "road", minRcl: 1 },
  { dx: -3, dy:  3, type: "road", minRcl: 1 },
  { dx:  1, dy:  1, type: "road", minRcl: 1 },
  { dx:  2, dy:  2, type: "road", minRcl: 1 },
  { dx:  1, dy:  2, type: "road", minRcl: 1 },
  { dx: -1, dy:  2, type: "road", minRcl: 1 },
  { dx:  1, dy: -2, type: "road", minRcl: 1 },
  { dx: -1, dy: -2, type: "road", minRcl: 1 },
  { dx:  1, dy: -4, type: "road", minRcl: 1 },
  { dx: -1, dy: -4, type: "road", minRcl: 1 },
];

const MERCHANT_RING_ROAD_RADII: ReadonlySet<number> = new Set([3, 5]);
const MERCHANT_RING_MAX_RADIUS = STAMP_PLANNER.halfSize;
const MERCHANT_RING_TARGET = 60;

function chebyshev(dx: number, dy: number): number {
  return Math.max(Math.abs(dx), Math.abs(dy));
}

function isReservedLane(dx: number, dy: number): boolean {
  if (dx === 0 && dy === 0) return false;
  const onSpoke = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
  return onSpoke || MERCHANT_RING_ROAD_RADII.has(chebyshev(dx, dy));
}

const STAMP_OCCUPIED_OFFSETS: ReadonlySet<string> = new Set(
  CASTLE_STAMP.map((c) => `${c.dx},${c.dy}`)
);

const CORE_STRUCTURE_OFFSETS: ReadonlySet<string> = new Set(
  CASTLE_STAMP.filter((c) => c.type !== "road").map((c) => `${c.dx},${c.dy}`)
);

function computeMerchantRingExtensionOffsets(): Array<{ dx: number; dy: number }> {
  const offsets: Array<{ dx: number; dy: number }> = [];
  const selected = new Set<string>();

  const walkableNeighbors = (dx: number, dy: number): number => {
    let n = 0;
    for (let ax = -1; ax <= 1; ax++) {
      for (let ay = -1; ay <= 1; ay++) {
        if (ax === 0 && ay === 0) continue;
        const k = `${dx + ax},${dy + ay}`;
        if (CORE_STRUCTURE_OFFSETS.has(k) || selected.has(k)) continue;
        n++;
      }
    }
    return n;
  };

  for (let r = 1; r <= MERCHANT_RING_MAX_RADIUS && offsets.length < MERCHANT_RING_TARGET; r++) {
    const ring: Array<{ dx: number; dy: number }> = [];
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (chebyshev(dx, dy) !== r) continue;
        if (Math.abs(dx) === r && Math.abs(dy) === r) continue;
        if (isReservedLane(dx, dy)) continue;
        if (STAMP_OCCUPIED_OFFSETS.has(`${dx},${dy}`)) continue;
        ring.push({ dx, dy });
      }
    }
    ring.sort((a, b) => Math.atan2(a.dy, a.dx) - Math.atan2(b.dy, b.dx));

    for (const { dx, dy } of ring) {
      if (offsets.length >= MERCHANT_RING_TARGET) break;
      if (walkableNeighbors(dx, dy) < 1) continue;
      let strands = false;
      for (let ax = -1; ax <= 1 && !strands; ax++) {
        for (let ay = -1; ay <= 1; ay++) {
          if (ax === 0 && ay === 0) continue;
          const nk = `${dx + ax},${dy + ay}`;
          if (selected.has(nk) && walkableNeighbors(dx + ax, dy + ay) <= 1) {
            strands = true;
            break;
          }
        }
      }
      if (strands) continue;
      offsets.push({ dx, dy });
      selected.add(`${dx},${dy}`);
    }
  }
  return offsets;
}

export const MERCHANT_RING_EXTENSION_OFFSETS: ReadonlyArray<{ dx: number; dy: number }> =
  computeMerchantRingExtensionOffsets();
