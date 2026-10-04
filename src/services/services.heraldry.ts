// Every castle bears arms of its own, drawn from its room name: a field of one
// tincture with a charge on it, or a field divided between a metal and a
// colour. They hang over the throne, stand beside the castle's name on the
// realm map, and the chronicle blazons them when a keep comes into its own.

type Point = [number, number];

export interface ArmsPiece {
  points: Point[];
  fill: string;
}

interface Tincture {
  name: string;
  hex: string;
}

const METALS: Tincture[] = [
  { name: "or", hex: "#d4af37" },
  { name: "argent", hex: "#e6e6e6" },
];

const COLOURS: Tincture[] = [
  { name: "gules", hex: "#a3202a" },
  { name: "azure", hex: "#24489c" },
  { name: "vert", hex: "#2f7a3a" },
  { name: "sable", hex: "#1c1c1c" },
  { name: "purpure", hex: "#6a2c8a" },
];

// "plain" twice over: a charged field is the handsomer, so a third of castles
// bear one.
const DIVISIONS = ["plain", "plain", "per pale", "per fess", "per bend", "quarterly"] as const;
const CHARGES = ["a cross", "a saltire", "a chevron", "a fess", "a roundel"] as const;

type Division = (typeof DIVISIONS)[number];
type Charge = (typeof CHARGES)[number];

interface Arms {
  division: Division;
  // The field, or its first part, and the metal or colour set against it.
  field: Tincture;
  other: Tincture;
  charge?: Charge;
}

function armsHash(roomName: string): number {
  let h = 0x811c9dc5 ^ 0x5eed;
  for (let i = 0; i < roomName.length; i++) h = Math.imul(h ^ roomName.charCodeAt(i), 0x01000193);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function castleArmsOf(roomName: string): Arms {
  const h = armsHash(roomName);
  const division = DIVISIONS[h % DIVISIONS.length];
  const metal = METALS[(h >>> 4) % METALS.length];
  const colour = COLOURS[(h >>> 8) % COLOURS.length];
  // Metal on colour, colour on metal: a plain field is always a colour with a
  // metal charge; a divided one starts with whichever the hash says.
  if (division === "plain") return { division, field: colour, other: metal, charge: CHARGES[(h >>> 12) % CHARGES.length] };
  const metalFirst = (h >>> 16) & 1;
  return { division, field: metalFirst ? metal : colour, other: metalFirst ? colour : metal };
}

/** The castle's arms in words, e.g. "azure, a cross or" or "per pale gules and argent". */
export function blazon(roomName: string): string {
  const a = castleArmsOf(roomName);
  if (a.division === "plain") return `${a.field.name}, ${a.charge} ${a.other.name}`;
  return `${a.division} ${a.field.name} and ${a.other.name}`;
}

// A heater shield two wide and 2.4 tall, centred on 0,0: a flat top, straight
// sides and two arcs meeting in a point at the base. It is convex, so every
// part of the arms is the shield cut by straight lines.
const SHIELD: Point[] = (() => {
  const pts: Point[] = [[-1, -1.2], [1, -1.2]];
  // Each side's arc is centred on the far side of the middle, so the two
  // meet in a point at 0,1.2.
  const c = -0.22;
  const r = 1 - c;
  const end = Math.atan2(1.2, -c);
  const STEPS = 8;
  for (let i = 0; i <= STEPS; i++) {
    const a = (end * i) / STEPS;
    pts.push([c + r * Math.cos(a), r * Math.sin(a)]);
  }
  for (let i = STEPS - 1; i >= 0; i--) {
    const a = (end * i) / STEPS;
    pts.push([-(c + r * Math.cos(a)), r * Math.sin(a)]);
  }
  return pts;
})();

// The middle of the shield's field, a little above its centre.
const HEART_Y = -0.1;

/** Keeps the part of `poly` where a*x + b*y <= c. */
function clip(poly: Point[], a: number, b: number, c: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const dp = a * p[0] + b * p[1] - c;
    const dq = a * q[0] + b * q[1] - c;
    if (dp <= 0) out.push(p);
    if (dp * dq < 0) {
      const t = dp / (dp - dq);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  return out;
}

// The part of the shield within `w` of the line through x0,y0 at `angle`.
function band(x0: number, y0: number, angle: number, w: number, shape: Point[] = SHIELD): Point[] {
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  const d = nx * x0 + ny * y0;
  return clip(clip(shape, nx, ny, d + w), -nx, -ny, -d + w);
}

function chargePieces(charge: Charge): Point[][] {
  const BEND = Math.atan2(2.4, 2);
  switch (charge) {
    case "a cross":
      return [band(0, 0, Math.PI / 2, 0.22), band(0, HEART_Y, 0, 0.22)];
    case "a saltire":
      return [band(0, HEART_Y, BEND, 0.2), band(0, HEART_Y, -BEND, 0.2)];
    case "a fess":
      return [band(0, HEART_Y, 0, 0.32)];
    case "a chevron": {
      // Two arms rising to a peak above the heart, each cut at the middle.
      const left = clip(SHIELD, 1, 0, 0);
      const right = clip(SHIELD, -1, 0, 0);
      return [band(0, -0.3, -0.75, 0.2, left), band(0, -0.3, 0.75, 0.2, right)];
    }
    case "a roundel": {
      const pts: Point[] = [];
      for (let i = 0; i < 16; i++) {
        const a = (2 * Math.PI * i) / 16;
        pts.push([0.5 * Math.cos(a), HEART_Y + 0.5 * Math.sin(a)]);
      }
      return [pts];
    }
  }
}

// A castle's arms never change, so each is cut out once per global.
const piecesCache = new Map<string, ArmsPiece[]>();

/**
 * The castle's arms as filled polygons on a shield two wide and 2.4 tall,
 * centred on 0,0, field first; the outline is `shieldOutline()`.
 */
export function armsPieces(roomName: string): ArmsPiece[] {
  let pieces = piecesCache.get(roomName);
  if (!pieces) {
    pieces = cutArms(castleArmsOf(roomName));
    piecesCache.set(roomName, pieces);
  }
  return pieces;
}

function cutArms(a: Arms): ArmsPiece[] {
  const f = a.field.hex;
  const o = a.other.hex;
  switch (a.division) {
    case "plain":
      return [{ points: SHIELD, fill: f }, ...chargePieces(a.charge!).map((points) => ({ points, fill: o }))];
    case "per pale":
      return [{ points: clip(SHIELD, 1, 0, 0), fill: f }, { points: clip(SHIELD, -1, 0, 0), fill: o }];
    case "per fess":
      return [{ points: clip(SHIELD, 0, 1, HEART_Y), fill: f }, { points: clip(SHIELD, 0, -1, -HEART_Y), fill: o }];
    case "per bend":
      // From the top corner on the bearer's right (the viewer's left) down
      // across the shield.
      return [{ points: clip(SHIELD, -1.2, 1, 0), fill: f }, { points: clip(SHIELD, 1.2, -1, 0), fill: o }];
    case "quarterly": {
      const top = clip(SHIELD, 0, 1, HEART_Y);
      const base = clip(SHIELD, 0, -1, -HEART_Y);
      return [
        { points: clip(top, 1, 0, 0), fill: f },
        { points: clip(top, -1, 0, 0), fill: o },
        { points: clip(base, 1, 0, 0), fill: o },
        { points: clip(base, -1, 0, 0), fill: f },
      ];
    }
  }
}

export function shieldOutline(): Point[] {
  return SHIELD;
}
