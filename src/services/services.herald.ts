// Battle cries and proclamations: things creeps shout because something happened,
// as opposed to the idle chatter they repeat on a timer. Cries live on the heap
// for the tick they were raised; a cry lost to a global reset is no loss. What
// is worth remembering also goes into the Royal Chronicle.

import { castleName, chronicle, tally } from "./services.chronicle";
import { isPlayerCreep, isSourceKeeperRoom } from "./services.combat";

const KILL_CRIES = ["Slain!", "Begone!", "For Crown!", "Next!", "Fell one!"];

// Creep name -> what it shouts this tick, and room name -> what every creep in
// the room shouts this tick.
let cryTick = -1;
let creepCries: Record<string, string> = {};
let roomCries: Record<string, string> = {};

function freshCries(): void {
  if (cryTick === Game.time) return;
  cryTick = Game.time;
  creepCries = {};
  roomCries = {};
}

export function cryFor(creep: Creep): string | undefined {
  if (cryTick !== Game.time) return undefined;
  return creepCries[creep.name] ?? roomCries[creep.room.name];
}

// A remote vendor turning for home because its remote is contested cries out
// once, not every tick of the walk back.
export function cryFlight(creep: Creep): void {
  if (creep.memory.fled) return;
  creep.memory.fled = true;
  freshCries();
  creepCries[creep.name] = "Bandits!";
}

export function settleFlight(creep: Creep): void {
  if (creep.memory.fled) delete creep.memory.fled;
}

// Run once a tick, before creeps act.
export function heraldRooms(): void {
  freshCries();
  heraldFallen();
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (room.controller?.my) heraldRise(room);
    heraldKills(room);
  }
}

// The whole room cheers when the castle reaches a new controller level.
function heraldRise(room: Room): void {
  const level = room.controller!.level;
  const known = room.memory.heraldLevel;
  room.memory.heraldLevel = level;
  if (known === undefined || level <= known) return;
  roomCries[room.name] = "Long live!";
  chronicle(`Hear ye! ${castleName(room.name)} rises to level ${level}. Long live the Crown!`);
}

// A fight's kills in one room gather into one line while it lasts.
const BATTLE_WINDOW = 300;

function whereIn(roomName: string): string {
  return Game.rooms[roomName]?.controller?.my
    ? `before the walls of ${castleName(roomName)}`
    : `in the wilds of ${roomName}`;
}

function chronicleKill(room: Room): void {
  const foe = isSourceKeeperRoom(room.name) ? "lair keeper" : "raider";
  tally(`slain:${room.name}`, 1, (n) => `${n === 1 ? "A" : n} ${foe}${n === 1 ? "" : "s"} fell ${whereIn(room.name)}`, BATTLE_WINDOW);
}

// Each of our creeps as it stood at the start of last tick.
interface Muster {
  room: string;
  hurt: boolean;
  ttl: number;
}
let muster = new Map<string, Muster>();

// Who killed one of ours, judged from what is still in the room.
function foeIn(roomName: string): string | undefined {
  const hostiles = Game.rooms[roomName]?.find(FIND_HOSTILE_CREEPS) ?? [];
  const player = hostiles.find(isPlayerCreep);
  if (player) return `the men of ${player.owner.username}`;
  if (hostiles.length === 0) return undefined;
  return isSourceKeeperRoom(roomName) ? "a lair keeper" : "raiders";
}

// One of ours gone before its time, last seen wounded, fell in a fight. A
// creep that dies of age or is recycled at full health is not mourned.
function heraldFallen(): void {
  const next = new Map<string, Muster>();
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.spawning) continue;
    next.set(name, { room: c.pos.roomName, hurt: c.hits < c.hitsMax, ttl: c.ticksToLive ?? 0 });
  }
  for (const [name, last] of muster) {
    if (next.has(name) || !last.hurt || last.ttl <= 1) continue;
    const foe = foeIn(last.room);
    const by = foe ? ` to ${foe}` : "";
    tally(
      `fallen:${last.room}`,
      1,
      (n) => `${n === 1 ? name : `${n} of the realm's own`} fell${by} ${whereIn(last.room)}.`,
      BATTLE_WINDOW
    );
  }
  muster = next;
}

// A hostile creep died last tick to something of ours. A creep that struck it
// shouts a kill cry; a kill by towers alone has the room cheer instead. The
// raw log is only parsed on a tick something was destroyed.
function heraldKills(room: Room): void {
  const raw = room.getEventLog(true) as unknown as string;
  if (!raw.includes(`"event":${EVENT_OBJECT_DESTROYED},`)) return;
  const events = JSON.parse(raw) as EventItem[];
  for (const e of events) {
    if (e.event !== EVENT_OBJECT_DESTROYED || e.data.type !== "creep") continue;
    const ours = events
      .filter((a) => a.event === EVENT_ATTACK && a.data.targetId === e.objectId)
      .map((a) => Game.getObjectById(a.objectId as Id<Creep | StructureTower>))
      .filter((o): o is Creep | StructureTower => !!o && o.my);
    if (ours.length === 0) continue;
    chronicleKill(room);
    const creeps = ours.filter((o): o is Creep => o instanceof Creep);
    if (creeps.length === 0) {
      roomCries[room.name] = "Huzzah!";
      continue;
    }
    for (const c of creeps) creepCries[c.name] = KILL_CRIES[(Game.time + c.name.length) % KILL_CRIES.length];
  }
}
