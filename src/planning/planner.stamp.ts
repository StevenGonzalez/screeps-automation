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
  | "road";

export interface StampCell {
  dx: number;
  dy: number;
  type: StampStructureType;
}

// The keep: the heart of every castle, 13 tiles square and centred on the
// first spawn. Rings of buildings alternate with rings of road (every odd
// ring out from the spawn is a road), so every building has a road beside
// it, and the whole keep is the same on its left and right. Walkers cross
// between the rings at the middle of the top and of each side, and leave
// the keep at its four corners.
//
// The heart holds the three spawns in a row, storage below them and the
// terminal above, with the factory and power spawn beside the terminal and
// the storage link and nuker beside storage. Towers stand at the corners of
// the middle ring and at the ends of the spawn row. The ten labs stand below
// storage in two rows of five, with a road between them; the two in the
// middle reach all the others.
//
//   S spawn  O storage  M terminal  F factory  P power spawn  N nuker
//   B observer  K storage link  T tower  L lab  e extension  + road
const KEEP = [
  "+eeeeeBeeeee+",
  "e+++++++++++e",
  "e+Teee+eeeT+e",
  "e+e+++++++e+e",
  "e+e++FMP++e+e",
  "e+e+e+++e+e+e",
  "T+++S+S+S+++T",
  "e+e+e+++e+e+e",
  "e+e++KON++e+e",
  "e+e+++++++e+e",
  "e+TeLLLLLeT+e",
  "e+++++++++++e",
  "+eeeLLLLLeee+",
];

const KEEP_TYPES: Record<string, StampStructureType> = {
  S: "spawn", O: "storage", M: "terminal", F: "factory", P: "power_spawn", N: "nuker",
  B: "observer", K: "link", T: "tower", L: "lab", e: "extension", "+": "road",
};

// The order spawns, towers and labs come in as the castle grows, which sets
// the age each is built at. Each age keeps the keep balanced where the count
// allows: the second and third spawns flank the first, the first two towers
// guard the top corners, and the first three labs stand in the middle of
// the upper row.
const KEEP_ORDER: Partial<Record<StampStructureType, Array<[number, number]>>> = {
  spawn: [[0, 0], [-2, 0], [2, 0]],
  tower: [[-4, -4], [4, -4], [-4, 4], [4, 4], [-6, 0], [6, 0]],
  lab: [[0, 4], [-1, 4], [1, 4], [0, 6], [-1, 6], [1, 6], [-2, 4], [2, 4], [-2, 6], [2, 6]],
};

function keepCells(): StampCell[] {
  const half = STAMP_PLANNER.halfSize;
  const cells: StampCell[] = [];
  KEEP.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      cells.push({ dx: x - half, dy: y - half, type: KEEP_TYPES[row[x]] });
    }
  });
  const rank = (c: StampCell): number => {
    const order = KEEP_ORDER[c.type];
    return order ? order.findIndex(([dx, dy]) => dx === c.dx && dy === c.dy) : 0;
  };
  return cells.sort((a, b) => rank(a) - rank(b));
}

export const CASTLE_STAMP: StampCell[] = keepCells();

/** The keep's extension cells. */
export const MERCHANT_RING_EXTENSION_OFFSETS: ReadonlyArray<{ dx: number; dy: number }> =
  CASTLE_STAMP.filter((c) => c.type === "extension").map(({ dx, dy }) => ({ dx, dy }));
