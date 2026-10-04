// The Royal Chronicle: a short, rolling record of what happened in the realm -
// castles rising, keeps founded, raiders slain, doom falling from the sky. The
// HUD shows the latest entries and Game.arca.chronicle() reads them all.

import { TOWN_DAY_LENGTH } from "../config/config.town";
import { townClock } from "./services.town";

export interface ChronicleEntry {
  // Tick the entry was written.
  t: number;
  text: string;
  // A tallied entry's kind and running count (see tally).
  key?: string;
  n?: number;
  // Tick a tallied entry last grew.
  last?: number;
}

declare global {
  interface Memory {
    chronicle?: ChronicleEntry[];
    // Tick of the chronicle's first day.
    chronicleEpoch?: number;
  }
}

const MAX_ENTRIES = 40;

function entries(): ChronicleEntry[] {
  if (!Memory.chronicle) Memory.chronicle = [];
  if (Memory.chronicleEpoch === undefined) Memory.chronicleEpoch = Game.time;
  return Memory.chronicle;
}

function write(entry: ChronicleEntry): void {
  const log = entries();
  log.push(entry);
  if (log.length > MAX_ENTRIES) log.splice(0, log.length - MAX_ENTRIES);
  console.log(`[Chronicle] ${entry.text}`);
}

export function chronicle(text: string): void {
  write({ t: Game.time, text });
}

/**
 * Adds n to a running count, such as raiders slain in one fight, instead of
 * writing a line for each. The count grows while its entry is no older than
 * `window` ticks since it last grew; after that a new entry starts.
 */
export function tally(key: string, n: number, describe: (total: number) => string, window: number): void {
  const log = entries();
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.key !== key) continue;
    if (Game.time - (e.last ?? e.t) > window) break;
    e.n = (e.n ?? 0) + n;
    e.last = Game.time;
    e.text = describe(e.n);
    return;
  }
  write({ t: Game.time, text: describe(n), key, n, last: Game.time });
}

/** When an entry was written, as the realm counts it: "Day 3, dusk". */
export function chronicleDate(t: number): string {
  const epoch = Memory.chronicleEpoch ?? t;
  const day = Math.floor((t - epoch) / TOWN_DAY_LENGTH) + 1;
  return `Day ${day}, ${townClock(t).phase}`;
}

export function recentChronicle(count: number): ChronicleEntry[] {
  return (Memory.chronicle ?? []).slice(-count);
}

const NAME_HEADS = [
  "Ash", "Raven", "Black", "Iron", "Grim", "Thorn", "Wolf", "Dusk",
  "Storm", "Ember", "Hollow", "Frost", "Gloam", "Bramble", "Crow", "Stone",
];
const NAME_TAILS = ["hold", "moor", "keep", "spire", "fell", "gate", "watch", "barrow", "crag", "mere", "ford", "reach"];

// FNV-1a, so neighbouring rooms rarely share a name.
function nameHash(roomName: string): number {
  let h = 2166136261;
  for (let i = 0; i < roomName.length; i++) {
    h ^= roomName.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** A castle's name: its town name if one was given, or one drawn from its room name. */
export function castleName(roomName: string): string {
  const given = Memory.rooms?.[roomName]?.townName;
  if (given) return given;
  const h = nameHash(roomName);
  const head = NAME_HEADS[h % NAME_HEADS.length];
  let t = (h >>> 8) % NAME_TAILS.length;
  // No "Wolffell": skip a tail that starts with the letter the head ends on.
  if (NAME_TAILS[t][0] === head[head.length - 1]) t = (t + 1) % NAME_TAILS.length;
  return head + NAME_TAILS[t];
}

const WILD_HEADS = [
  "Ashen", "Bleak", "Gallows", "Weeping", "Black", "Wolf", "Raven", "Thorn",
  "Misty", "Grey", "Witch", "Bone", "Sorrow", "Cinder", "Hollow", "Crow",
  "Blood", "Shadow", "Dread", "Barrow", "Silent", "Rotting", "Howling", "Wither",
];
const WILD_LANDS = [
  "Moor", "Fen", "Wood", "Vale", "Heath", "Marsh", "Waste", "Mire",
  "Glen", "Weald", "Forest", "March", "Bog", "Reach", "Thicket", "Scar",
];

/**
 * A name for the wild country of a room nobody holds a castle in, drawn from
 * its room name: "Weeping Fen". Callers put "the" before it.
 */
export function wildsName(roomName: string): string {
  // The hash's low bits barely change between neighbouring rooms; mixing it
  // again keeps the next room over from sharing half its name.
  let h = nameHash(roomName);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return `${WILD_HEADS[(h >>> 4) % WILD_HEADS.length]} ${WILD_LANDS[(h >>> 12) % WILD_LANDS.length]}`;
}
