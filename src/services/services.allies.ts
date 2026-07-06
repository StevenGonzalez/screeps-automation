declare global {
  interface Memory {
    allies?: string[];
  }
}

const ALLIES_SEGMENT = 90;

const PROTOCOL_VERSION = 1;

export type AllyRequestType =
  | "resource"
  | "defense"
  | "attack"
  | "work"
  | "economy"
  | "room";

export interface AllyRequest {
  type: AllyRequestType;
  roomName?: string;
  resourceType?: ResourceConstant;
  amount?: number;
  priority?: number;
}

interface OutgoingSegment {
  v: number;
  time: number;
  requests: AllyRequest[];
}

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

let outgoing: AllyRequest[] = [];
let outgoingTick = -1;

export function requestHelp(req: AllyRequest): void {
  if (outgoingTick !== Game.time) {
    outgoing = [];
    outgoingTick = Game.time;
  }
  outgoing.push(req);
}

interface AllyIntel {
  time: number;
  requests: AllyRequest[];
}

const incoming: Record<string, AllyIntel> = {};

export function getAllyRequests(): AllyRequest[] {
  const all: AllyRequest[] = [];
  for (const username in incoming) {
    for (const req of incoming[username].requests) all.push(req);
  }
  return all;
}

export function getAllyRequestsByUser(): Record<string, AllyRequest[]> {
  const out: Record<string, AllyRequest[]> = {};
  for (const username in incoming) out[username] = incoming[username].requests;
  return out;
}

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
  const p = typeof r.priority === "number" && isFinite(r.priority) ? r.priority : 0.5;
  req.priority = Math.max(0, Math.min(1, p));
  return req;
}

let foreignIndex = 0;

export function runAllies(): void {
  const toSend = outgoingTick === Game.time ? outgoing : [];
  outgoing = [];
  outgoingTick = Game.time;

  writeOutgoingSegment(toSend);
  readForeignSegment();
  requestNextForeignSegment();
}

function writeOutgoingSegment(requests: AllyRequest[]): void {
  try {
    if (requests.length === 0 && getAllies().length === 0) return;
    RawMemory.setActiveSegments([ALLIES_SEGMENT]);
    const payload: OutgoingSegment = {
      v: PROTOCOL_VERSION,
      time: Game.time,
      requests,
    };
    const json = JSON.stringify(payload);
    if (json.length < 100 * 1024) {
      RawMemory.segments[ALLIES_SEGMENT] = json;
      RawMemory.setPublicSegments([ALLIES_SEGMENT]);
    }
  } catch (e) {
  }
}

function readForeignSegment(): void {
  try {
    const fs = RawMemory.foreignSegment;
    if (!fs || fs.id !== ALLIES_SEGMENT || typeof fs.data !== "string") return;
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
  }
}

function requestNextForeignSegment(): void {
  try {
    const allies = getAllies();

    for (const username in incoming) {
      if (!allies.includes(username)) delete incoming[username];
    }

    if (allies.length === 0) {
      RawMemory.setActiveForeignSegment(null);
      return;
    }

    if (foreignIndex >= allies.length) foreignIndex = 0;
    const target = allies[foreignIndex];
    foreignIndex = (foreignIndex + 1) % allies.length;

    RawMemory.setActiveForeignSegment(target, ALLIES_SEGMENT);
  } catch (e) {
  }
}
