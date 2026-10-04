// The Royal Exchequer keeps each castle's books: the gold its own mines and the
// visiting vendors bring in, and what recruiting, enchanting the controller,
// masonry, the smithy and the watchtowers spend. The HUD shows the books, and
// Game.arca.ledger() prints them.
//
// Event logs are read on one tick in SAMPLE_EVERY and averaged per sampled
// tick, which is plenty for a running average and keeps the JSON parsing off
// most ticks. Spawning is counted exactly, when the order is placed.

export type LedgerIncome = "mines" | "vendors";
export type LedgerSpend = "recruits" | "enchant" | "masonry" | "smithy" | "towers";

export interface LedgerBooks {
  // Tick the books were last closed.
  at: number;
  // Gold a tick, by where it came from and where it went.
  in: Partial<Record<LedgerIncome, number>>;
  out: Partial<Record<LedgerSpend, number>>;
  // Change in the castle's stored gold (storage plus terminal) a tick.
  trend?: number;
}

declare global {
  interface Memory {
    exchequer?: Record<string, LedgerBooks>;
  }
}

const SAMPLE_EVERY = 5;
const CLOSE_BOOKS_EVERY = 100;
// A window cut short by a global reset is folded into the next one rather than
// closed on a handful of samples.
const MIN_WINDOW_TICKS = 50;
// Weight of the newest window in the running average.
const SMOOTHING = 0.3;

interface LedgerWindow {
  start: number;
  samples: number;
  // Summed over sampled ticks only.
  sampled: Record<string, number>;
  // Summed over every tick.
  exact: Record<string, number>;
  stored: number;
}

// Kept on the heap: a window lost to a global reset only delays the next close.
const windows: Record<string, LedgerWindow> = {};

function storedGold(room: Room): number {
  return (room.storage?.store[RESOURCE_ENERGY] ?? 0) + (room.terminal?.store[RESOURCE_ENERGY] ?? 0);
}

function windowFor(room: Room): LedgerWindow {
  let w = windows[room.name];
  if (!w) {
    w = { start: Game.time, samples: 0, sampled: {}, exact: {}, stored: storedGold(room) };
    windows[room.name] = w;
  }
  return w;
}

function add(bucket: Record<string, number>, key: string, amount: number): void {
  bucket[key] = (bucket[key] ?? 0) + amount;
}

/** Counts gold a castle spent outside the event log, such as a spawn order. */
export function recordSpend(roomName: string, kind: LedgerSpend, amount: number): void {
  const room = Game.rooms[roomName];
  if (!room?.controller?.my) return;
  add(windowFor(room).exact, kind, amount);
}

// Remote room name -> the castle that works it.
function remoteHomes(homes: Room[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const home of homes) {
    for (const r of home.memory.remoteRooms ?? []) map[r.roomName] = home.name;
  }
  return map;
}

function isMine(id: string): boolean {
  const obj = Game.getObjectById(id as Id<Creep>);
  return !!obj && obj.my;
}

// Adds one tick of a room's events to the books of the castle `home`. In a
// remote room other players' creeps can act too, so there each event's actor
// is checked.
function readEvents(room: Room, w: LedgerWindow, isHome: boolean): void {
  const events = room.getEventLog();
  if (events.length === 0) return;
  const sources = new Set(room.find(FIND_SOURCES).map((s) => s.id as string));
  const towers = isHome
    ? new Set((room.memory.towerIds ?? []).map((id) => id as string))
    : undefined;
  for (const e of events) {
    switch (e.event) {
      case EVENT_HARVEST:
        if (!sources.has(e.data.targetId)) break;
        if (!isHome && !isMine(e.objectId)) break;
        add(w.sampled, isHome ? "mines" : "vendors", e.data.amount);
        break;
      case EVENT_UPGRADE_CONTROLLER:
        if (isHome) add(w.sampled, "enchant", e.data.energySpent ?? 0);
        break;
      case EVENT_BUILD:
        if (isHome || isMine(e.objectId)) add(w.sampled, "masonry", e.data.energySpent ?? 0);
        break;
      case EVENT_REPAIR:
        // A tower pays a flat TOWER_ENERGY_COST a repair, whatever it mends.
        if (towers?.has(e.objectId)) add(w.sampled, "smithy", TOWER_ENERGY_COST);
        else if (isHome || isMine(e.objectId)) add(w.sampled, "smithy", e.data.energySpent ?? 0);
        break;
      case EVENT_ATTACK:
      case EVENT_HEAL:
        if (towers?.has(e.objectId)) add(w.sampled, "towers", TOWER_ENERGY_COST);
        break;
    }
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function blend(prev: number | undefined, next: number): number {
  return round1(prev === undefined ? next : prev * (1 - SMOOTHING) + next * SMOOTHING);
}

const INCOME_KEYS: LedgerIncome[] = ["mines", "vendors"];
const SPEND_KEYS: LedgerSpend[] = ["recruits", "enchant", "masonry", "smithy", "towers"];

function closeBooks(room: Room): void {
  const w = windows[room.name];
  if (!w) return;
  const ticks = Game.time - w.start;
  if (ticks < MIN_WINDOW_TICKS || w.samples === 0) return;

  if (!Memory.exchequer) Memory.exchequer = {};
  const prev = Memory.exchequer[room.name];
  const rate = (key: string): number =>
    (w.sampled[key] ?? 0) / w.samples + (w.exact[key] ?? 0) / ticks;

  const books: LedgerBooks = { at: Game.time, in: {}, out: {} };
  for (const k of INCOME_KEYS) books.in[k] = blend(prev?.in[k], rate(k));
  for (const k of SPEND_KEYS) books.out[k] = blend(prev?.out[k], rate(k));
  books.trend = blend(prev?.trend, (storedGold(room) - w.stored) / ticks);
  Memory.exchequer[room.name] = books;

  delete windows[room.name];
  windowFor(room);
}

export function loop(): void {
  const homes: Room[] = [];
  for (const name in Game.rooms) {
    const room = Game.rooms[name];
    if (room.controller?.my) homes.push(room);
  }
  for (const home of homes) windowFor(home);

  if (Game.time % SAMPLE_EVERY === 0) {
    const remotes = remoteHomes(homes);
    for (const home of homes) {
      const w = windowFor(home);
      w.samples++;
      readEvents(home, w, true);
    }
    for (const remoteName in remotes) {
      const remote = Game.rooms[remoteName];
      const home = Game.rooms[remotes[remoteName]];
      if (!remote || !home || remote.controller?.my) continue;
      readEvents(remote, windowFor(home), false);
    }
  }

  if (Game.time % CLOSE_BOOKS_EVERY === 0) {
    for (const home of homes) closeBooks(home);
    if (Memory.exchequer) {
      for (const name in Memory.exchequer) {
        if (!Game.rooms[name]?.controller?.my) delete Memory.exchequer[name];
      }
    }
  }
}

export function totalIn(books: LedgerBooks): number {
  return INCOME_KEYS.reduce((s, k) => s + (books.in[k] ?? 0), 0);
}

export function totalOut(books: LedgerBooks): number {
  return SPEND_KEYS.reduce((s, k) => s + (books.out[k] ?? 0), 0);
}

/** The books as short lines: a headline, then income, then spending. */
export function describeBooks(books: LedgerBooks): string[] {
  const part = (label: string, n: number | undefined) =>
    n && n >= 0.05 ? `${label} ${n.toFixed(1)}` : undefined;
  const income = INCOME_KEYS.map((k) => part(k, books.in[k])).filter(Boolean).join("  ");
  const spend = SPEND_KEYS.map((k) => part(k, books.out[k])).filter(Boolean).join("  ");
  const net = totalIn(books) - totalOut(books);
  const sign = (n: number) => (n >= 0 ? `+${n.toFixed(1)}` : n.toFixed(1));
  return [
    `Exchequer ${sign(net)}/t  (in ${totalIn(books).toFixed(1)}, out ${totalOut(books).toFixed(1)})`,
    `  in:  ${income || "nothing"}`,
    `  out: ${spend || "nothing"}`,
  ];
}
