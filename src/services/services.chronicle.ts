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

// What the realm did this season, read out when the season turns.
export interface Annals {
  // Tick the scribes began this season's annals.
  since: number;
  gold: number;
  slain: number;
  fallen: number;
  // Creeps raised in the barracks. Annals begun before this was counted lack it.
  recruits?: number;
}

declare global {
  interface Memory {
    chronicle?: ChronicleEntry[];
    // Tick of the chronicle's first day.
    chronicleEpoch?: number;
    annals?: Annals;
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

/** Adds n to this season's annals. */
export function annal(key: "gold" | "slain" | "fallen" | "recruits", n: number): void {
  if (!Memory.annals) Memory.annals = { since: Game.time, gold: 0, slain: 0, fallen: 0, recruits: 0 };
  // Annals begun before a count was kept leave it out until the next season,
  // rather than read out part of a season's count as the whole.
  const count = Memory.annals[key];
  if (count !== undefined) Memory.annals[key] = count + n;
}

export function formatK(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

/**
 * Adds n to a running count, such as raiders slain in one fight, instead of
 * writing a line for each. The count grows while its entry is no older than
 * `window` ticks since it last grew; after that a new entry starts. Returns
 * whether it started a new entry.
 */
export function tally(key: string, n: number, describe: (total: number) => string, window: number): boolean {
  const log = entries();
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.key !== key) continue;
    if (Game.time - (e.last ?? e.t) > window) break;
    e.n = (e.n ?? 0) + n;
    e.last = Game.time;
    e.text = describe(e.n);
    return false;
  }
  write({ t: Game.time, text: describe(n), key, n, last: Game.time });
  return true;
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

// The FNV hash's low bits barely change between names that differ in their
// last character, such as neighbouring rooms; mixing it again keeps the next
// room over from sharing half its name.
function mixedHash(s: string): number {
  let h = nameHash(s);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
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

const EPITHETS = [
  "the Red", "the Grey", "the Bold", "the Pale", "the Grim", "the Silent", "the Wanderer", "the Elder",
  "the Black", "Ironhand", "the Unbowed", "the Fair", "the Cunning", "the Restless", "the Far-Seeing", "the Stern",
];

/**
 * Another player as the chronicle knows them, with an epithet drawn from the
 * name: "Jumpp the Bold". The name is written as a lord's would be, so
 * "_oleksii" and "screps" read "Oleksii the Grim" and "Screps the Stern".
 */
export function lordName(username: string): string {
  const name = username.replace(/^[^A-Za-z]+|[^A-Za-z0-9]+$/g, "") || username;
  return `${name[0].toUpperCase()}${name.slice(1)} ${EPITHETS[nameHash(username) % EPITHETS.length]}`;
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
  const h = mixedHash(roomName);
  return `${WILD_HEADS[(h >>> 4) % WILD_HEADS.length]} ${WILD_LANDS[(h >>> 12) % WILD_LANDS.length]}`;
}

const WARLORDS = [
  "Grask", "Mordrek", "Vulk", "Skarn", "Brakka", "Gorm", "Thrask", "Vilgrot",
  "Krug", "Raznak", "Ulfgar", "Hask", "Dregga", "Orvik", "Odrik", "Zagra",
];
const WARLORD_EPITHETS = [
  "the Flayer", "One-Eye", "the Gaunt", "Black-Tooth", "the Burner", "Red-Hand",
  "the Unwashed", "Ironjaw", "the Hungry", "Crow-Feeder", "Half-Ear", "the Fen-Rat",
];

// Raiders live this long, so no raid outlasts it.
const WARBAND_LIFE = 1500;

// A remote next to two castles is marked raided once for each, and the second
// may see the raiders a few ticks after the first. The chronicle writes the
// raid once for both, so both take the warlord it names.
const WARBAND_MUSTER = 10;

/** Names the warlord leading a raid that begins in `roomName` this tick. */
export function raiseWarband(roomName: string): string {
  const known = Memory.warbands?.[roomName];
  if (known && Game.time - known.at <= WARBAND_MUSTER) return known.name;
  const h = mixedHash(`${roomName}:${Game.time}`);
  const name = `${WARLORDS[h % WARLORDS.length]} ${WARLORD_EPITHETS[(h >>> 8) % WARLORD_EPITHETS.length]}`;
  (Memory.warbands ??= {})[roomName] = { name, at: Game.time };
  return name;
}

/** The warlord whose raid on `roomName` may still be going on, if one is. */
export function warbandIn(roomName: string): string | undefined {
  const band = Memory.warbands?.[roomName];
  if (!band) return undefined;
  if (Game.time - band.at <= WARBAND_LIFE) return band.name;
  delete Memory.warbands![roomName];
  return undefined;
}
