// ── Diplomacy / SimpleAllies ──────────────────────────────────────────────────────
//
// A self-contained ally-communication module implementing the community "SimpleAllies"
// pattern: a single public RawMemory segment that allies read to learn what help we
// need, and that we read on theirs to learn what help THEY need. Combat / economy code
// elsewhere queues outgoing requests via requestHelp() and reads incoming ones via
// getAllyRequests(); this module only moves the data, it never acts on it.
//
// Two layers, kept deliberately simple:
//   1. Ally identity — a username list in Memory.allies, with isAlly() used by combat
//      code so we never shoot a friend (and tower/squad targeting can skip them).
//   2. Segment protocol — once per tick runAllies() flushes our outgoing requests to
//      our public segment and pulls in one ally's segment (round-robined across the
//      list, since only ONE foreign segment is readable per tick).
//
// EVERYTHING touching RawMemory / JSON is wrapped in try/catch: a malformed or hostile
// ally segment must never be able to throw and break the whole tick.

declare global {
  interface Memory {
    // Usernames we treat as friendly. Absent / empty ⇒ we have no allies.
    allies?: string[];
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────────

// The public segment we broadcast our requests on, and the one we read on allies.
// By SimpleAllies convention everyone uses the same fixed ID. Must be 0–99; pick a
// high number to stay clear of any segments game code might use for other purposes.
const ALLIES_SEGMENT = 90;

// Protocol version we stamp on outgoing data and tolerate on incoming. Lets us reject
// a neighbour speaking a wildly different dialect instead of mis-parsing it.
const PROTOCOL_VERSION = 1;

// ── Request types ───────────────────────────────────────────────────────────────────
//
// A pragmatic subset of the SimpleAllies spec. `priority` is 0..1 (higher = more
// urgent) so an ally can triage. All requests are plain JSON-serialisable objects.

export type AllyRequestType =
  | "resource" // please send us a resource (energy, minerals, …)
  | "defense"  // please help defend a room of ours under attack
  | "attack"   // please join us attacking a room
  | "work"     // please send builders/upgraders (work creeps) to a room
  | "economy"  // share of our economic state, for coordination
  | "room";    // please scout / hold a specific room

export interface AllyRequest {
  type: AllyRequestType;
  // Target room for room-scoped requests (defense/attack/work/room). Omitted for a
  // pure resource ask that isn't tied to a room.
  roomName?: string;
  // For "resource": which resource and how much we'd like.
  resourceType?: ResourceConstant;
  amount?: number;
  // 0 (nice-to-have) .. 1 (critical). Defaults applied on read if missing.
  priority?: number;
}

// What we serialise into our public segment each tick.
interface OutgoingSegment {
  v: number;            // protocol version
  time: number;        // Game.time we wrote it (lets a reader spot stale data)
  requests: AllyRequest[];
}

// ── Ally identity helpers ───────────────────────────────────────────────────────────

// Always returns the live array, creating an empty one on first use so callers never
// have to null-check Memory.allies.
export function getAllies(): string[] {
  if (!Memory.allies) Memory.allies = [];
  return Memory.allies;
}

export function isAlly(username: string | undefined): boolean {
  if (!username) return false;
  return getAllies().includes(username);
}

export function addAlly(username: string): void {
  const list = getAllies();
  if (!list.includes(username)) list.push(username);
}

export function removeAlly(username: string): void {
  const list = getAllies();
  const i = list.indexOf(username);
  if (i !== -1) list.splice(i, 1);
}

// ── Outgoing request queue ───────────────────────────────────────────────────────────
//
// Accumulated in a module-level buffer during the tick (so any system can call
// requestHelp at any point) and flushed to the segment by runAllies(). Reset every
// tick — requests are a snapshot of "what we need right now", not a persistent log.

let outgoing: AllyRequest[] = [];
let outgoingTick = -1;

// Queue one outgoing request to broadcast to allies this tick.
export function requestHelp(req: AllyRequest): void {
  // Lazily clear the buffer at the first call of a new tick so a flush from a previous
  // tick can't leak into this one even if runAllies hasn't run yet.
  if (outgoingTick !== Game.time) {
    outgoing = [];
    outgoingTick = Game.time;
  }
  outgoing.push(req);
}

// ── Incoming requests ────────────────────────────────────────────────────────────────
//
// Parsed allies' requests, keyed by ally username, refreshed as each ally's segment is
// read. We keep the last successfully-read snapshot per ally so consumers always have
// something to work with even on ticks where no new foreign segment arrived (we can
// only fetch one per tick).

interface AllyIntel {
  time: number;          // Game.time we received this snapshot
  requests: AllyRequest[];
}

const incoming: Record<string, AllyIntel> = {};

// All currently-known ally requests, flattened across every ally. Combat / economy code
// uses this to decide whether to honour a defense call, send resources, etc.
export function getAllyRequests(): AllyRequest[] {
  const all: AllyRequest[] = [];
  for (const username in incoming) {
    for (const req of incoming[username].requests) all.push(req);
  }
  return all;
}

// Same data grouped by ally, for callers that care who asked.
export function getAllyRequestsByUser(): Record<string, AllyRequest[]> {
  const out: Record<string, AllyRequest[]> = {};
  for (const username in incoming) out[username] = incoming[username].requests;
  return out;
}

// ── Validation ───────────────────────────────────────────────────────────────────────
//
// A neighbour's segment is untrusted input. Coerce it into our shape and drop anything
// malformed rather than trusting fields blindly.

const VALID_TYPES: ReadonlySet<string> = new Set([
  "resource", "defense", "attack", "work", "economy", "room",
]);

function sanitizeRequest(raw: unknown): AllyRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.type !== "string" || !VALID_TYPES.has(r.type)) return null;

  const req: AllyRequest = { type: r.type as AllyRequestType };
  if (typeof r.roomName === "string") req.roomName = r.roomName;
  if (typeof r.resourceType === "string") req.resourceType = r.resourceType as ResourceConstant;
  if (typeof r.amount === "number" && isFinite(r.amount)) req.amount = r.amount;
  // Clamp priority into 0..1; default mid-priority when absent or junk.
  const p = typeof r.priority === "number" && isFinite(r.priority) ? r.priority : 0.5;
  req.priority = Math.max(0, Math.min(1, p));
  return req;
}

// ── Segment round-robin ──────────────────────────────────────────────────────────────
//
// Only one foreign segment can be active per tick, and a request placed this tick is
// only readable NEXT tick. So we cycle through the ally list: read whichever ally we
// requested last tick (now sitting in foreignSegment), then request the next one for
// next tick. Index persists in module scope across ticks within one global reset.

let foreignIndex = 0;

// ── Main loop ────────────────────────────────────────────────────────────────────────
//
// Call once per tick (early, before combat code reads getAllyRequests()).
export function runAllies(): void {
  // Whatever buffer state we're in, snapshot it then reset so next tick starts clean.
  const toSend = outgoingTick === Game.time ? outgoing : [];
  outgoing = [];
  outgoingTick = Game.time;

  writeOutgoingSegment(toSend);
  readForeignSegment();
  requestNextForeignSegment();
}

// Serialise our requests into our public segment and mark it public. Guarded so a
// serialisation failure or segment-cap issue can't break the tick.
function writeOutgoingSegment(requests: AllyRequest[]): void {
  try {
    const payload: OutgoingSegment = {
      v: PROTOCOL_VERSION,
      time: Game.time,
      requests,
    };
    const json = JSON.stringify(payload);
    // 100 KB per segment is the hard cap; our requests are tiny, but guard anyway so a
    // runaway producer can't silently overflow and corrupt the segment.
    if (json.length < 100 * 1024) {
      RawMemory.segments[ALLIES_SEGMENT] = json;
      // Re-assert public status each tick (cheap, and survives a global reset).
      RawMemory.setPublicSegments([ALLIES_SEGMENT]);
    }
  } catch (e) {
    // Swallow — broadcasting is best-effort; allies simply see stale/no data.
  }
}

// Read whatever ally segment we requested last tick (now in foreignSegment) and fold it
// into `incoming`. Only that ally's slice is refreshed; others keep their last snapshot.
function readForeignSegment(): void {
  try {
    const fs = RawMemory.foreignSegment;
    // Nothing fetched, or the wrong segment came back — ignore.
    if (!fs || fs.id !== ALLIES_SEGMENT || typeof fs.data !== "string") return;
    // Only trust segments from confirmed allies.
    if (!isAlly(fs.username)) return;

    const parsed = JSON.parse(fs.data) as Partial<OutgoingSegment>;
    if (!parsed || parsed.v !== PROTOCOL_VERSION) return;

    const requests: AllyRequest[] = [];
    if (Array.isArray(parsed.requests)) {
      for (const raw of parsed.requests) {
        const req = sanitizeRequest(raw);
        if (req) requests.push(req);
      }
    }
    incoming[fs.username] = {
      time: typeof parsed.time === "number" ? parsed.time : Game.time,
      requests,
    };
  } catch (e) {
    // Malformed/hostile data — keep the previous snapshot for this ally and move on.
  }
}

// Request the next ally's segment for next tick, cycling through the list. Drop intel
// for allies who've been removed so getAllyRequests() never returns stale friends.
function requestNextForeignSegment(): void {
  try {
    const allies = getAllies();

    // Prune intel for anyone no longer an ally.
    for (const username in incoming) {
      if (!allies.includes(username)) delete incoming[username];
    }

    if (allies.length === 0) {
      // No allies — make sure we're not holding a foreign segment open.
      RawMemory.setActiveForeignSegment(null);
      return;
    }

    if (foreignIndex >= allies.length) foreignIndex = 0;
    const target = allies[foreignIndex];
    foreignIndex = (foreignIndex + 1) % allies.length;

    // Available in foreignSegment next tick, picked up by readForeignSegment() then.
    RawMemory.setActiveForeignSegment(target, ALLIES_SEGMENT);
  } catch (e) {
    // Best-effort — if the request fails we just won't have fresh intel next tick.
  }
}
