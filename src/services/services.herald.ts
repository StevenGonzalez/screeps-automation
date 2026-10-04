// Battle cries and proclamations: things creeps shout because something happened,
// as opposed to the idle chatter they repeat on a timer. Cries live on the heap
// for the tick they were raised; a cry lost to a global reset is no loss. What
// is worth remembering also goes into the Royal Chronicle.

import { Annals, annal, castleName, chronicle, formatK, lordName, tally, wildsName } from "./services.chronicle";
import { isPlayerCreep, isSourceKeeperRoom } from "./services.combat";
import { NIGHT_START, townAurora, townDragon, townFeast, townHowl, townSeason } from "./services.town";
import { TOWN_DAY_LENGTH, TOWN_DAYS_PER_SEASON, TownSeason } from "../config/config.town";
import { LANDMARKS } from "../config/config.structures";

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
  heraldRenown();
  heraldTrade();
  heraldSeason();
  heraldSky();
  const castles: Room[] = [];
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (room.controller?.my) {
      castles.push(room);
      heraldRise(room);
      heraldVisitors(room);
      heraldWorks(room);
    }
    heraldKills(room);
  }
  heraldDragon(castles);
  heraldWolves(castles);
}

// "Embercrag", "Embercrag and Grimford", "Embercrag, Grimford and Ashford".
function castleList(castles: Room[]): string {
  const names = castles.map((r) => castleName(r.name));
  const last = names.pop()!;
  return names.length ? `${names.join(", ")} and ${last}` : last;
}

// A new GCL is one more castle the realm may hold.
function heraldRenown(): void {
  const level = Game.gcl.level;
  const known = Memory.heraldGcl;
  Memory.heraldGcl = level;
  if (known === undefined || level <= known) return;
  chronicle(`The Crown's renown grows. The realm may now hold ${level} castles.`);
}

const SEASON_TIDINGS: Record<TownSeason, string> = {
  spring: "Spring comes to the realm. The snow melts from the castle walls.",
  summer: "Summer comes to the realm. The days run long on the vendors' roads.",
  autumn: "Autumn comes to the realm. Leaves blow across the wilds.",
  winter: "Winter comes to the realm. Snow settles on the battlements.",
};

function heraldSeason(): void {
  const season = townSeason(Game.time);
  const known = Memory.heraldSeason;
  Memory.heraldSeason = season;
  if (known === undefined || known === season) return;
  const annals = Memory.annals;
  Memory.annals = { since: Game.time, gold: 0, slain: 0, fallen: 0 };
  if (annals) chronicle(annalsLine(known, annals));
  const feast = townFeast(Game.time);
  chronicle(feast ? `${SEASON_TIDINGS[season]} The ${feast} begins.` : SEASON_TIDINGS[season]);
}

function annalsLine(season: string, a: Annals): string {
  const whole = a.since <= Game.time - TOWN_DAY_LENGTH * TOWN_DAYS_PER_SEASON;
  const when = whole ? "This season" : "Since the scribes took up their pens";
  const slain = a.slain === 0 ? "slew no foe" : `slew ${a.slain} ${a.slain === 1 ? "foe" : "foes"}`;
  const fallen = a.fallen === 0 ? "lost none of its own" : `buried ${a.fallen} of its own`;
  return `So ends the ${season}. ${when} the realm gathered ${formatK(a.gold)} gold, ${slain} and ${fallen}.`;
}

// Trade with other players, read from the market's own records every few
// ticks. A partner taking an order in several bites makes one line.
const TRADE_CHECK_PERIOD = 25;
const TRADE_WINDOW = 1500;
const WARES: Record<string, string> = {
  energy: "gold",
  H: "hydrogen",
  O: "oxygen",
  U: "utrium",
  L: "lemergium",
  K: "keanium",
  Z: "zynthium",
  X: "catalyst",
};

function heraldTrade(): void {
  if (Game.time % TRADE_CHECK_PERIOD !== 0) return;
  const seen = Memory.heraldTradeAt;
  // Only ticks already over: a deal made this tick may not be on the books yet.
  Memory.heraldTradeAt = Game.time - 1;
  if (seen === undefined) return;
  const fresh = (t: Transaction) => t.time > seen && t.time < Game.time;
  for (const t of Game.market.outgoingTransactions) {
    if (fresh(t)) chronicleTrade(t, "sold", t.from, t.recipient?.username, t.sender?.username);
  }
  for (const t of Game.market.incomingTransactions) {
    if (fresh(t)) chronicleTrade(t, "bought", t.to, t.sender?.username, t.recipient?.username);
  }
}

function chronicleTrade(t: Transaction, verb: "sold" | "bought", ours: string, them?: string, us?: string): void {
  // A send between our own castles is no trade.
  if (them !== undefined && them === us) return;
  const ware = WARES[t.resourceType] ?? t.resourceType;
  const partner = them ? `the merchants of ${lordName(them)}` : "the free markets";
  const dir = verb === "sold" ? "to" : "from";
  tally(
    `trade:${verb}:${ours}:${them ?? ""}:${t.resourceType}`,
    t.amount,
    (n) => `${castleName(ours)} ${verb} ${n} ${ware} ${dir} ${partner}.`,
    TRADE_WINDOW
  );
}

// A player's creeps in one of our castles make one line a visit, however long
// they stay: spies when none of them can fight, a war party when one can.
const VISIT_WINDOW = 1500;

function heraldVisitors(room: Room): void {
  for (const c of room.find(FIND_HOSTILE_CREEPS)) {
    if (!isPlayerCreep(c)) continue;
    const who = c.owner.username;
    const armed = c.body.some((p) => p.type === ATTACK || p.type === RANGED_ATTACK || p.type === WORK);
    const text = armed
      ? `A war party of ${lordName(who)} came in arms to the walls of ${castleName(room.name)}.`
      : `Spies of ${lordName(who)} crept about ${castleName(room.name)}.`;
    tally(`visit:${room.name}:${who}:${armed ? "war" : "spy"}`, 0, () => text, VISIT_WINDOW);
  }
}

// New works in a castle, told once the masons finish them. Extensions, roads,
// walls and links are too many or too small to be news. What stands at the
// first look is not news either.
const WORKS_CHECK_PERIOD = 100;
const WORKS_WINDOW = 1500;
function heraldWorks(room: Room): void {
  if (Game.time % WORKS_CHECK_PERIOD !== 0) return;
  const counts: Record<string, number> = {};
  for (const s of room.find(FIND_MY_STRUCTURES)) {
    if (LANDMARKS[s.structureType]) counts[s.structureType] = (counts[s.structureType] ?? 0) + 1;
  }
  const known = room.memory.heraldWorks;
  room.memory.heraldWorks = counts;
  if (!known) return;
  for (const type of Object.keys(LANDMARKS) as StructureConstant[]) {
    const gained = (counts[type] ?? 0) - (known[type] ?? 0);
    if (gained <= 0) continue;
    const [one, many] = LANDMARKS[type]!;
    const a = /^[aeiou]/.test(one) ? "an" : "a";
    tally(
      `works:${room.name}:${type}`,
      gained,
      (n) => `The masons of ${castleName(room.name)} raise ${n === 1 ? `${a} ${one}` : `${n} ${many}`}.`,
      WORKS_WINDOW
    );
  }
}

// While a dragon is overhead every castle cries out every few ticks, and the
// chronicle notes its passing in one line.
const DRAGON_CRIES = ["Dragon!", "Look up!", "Hide!", "Run!", "Dragon!!"];
const DRAGON_CRY_PERIOD = 8;
const DRAGON_TIDINGS = [
  (c: string) => `A dragon passed over ${c}, black against the sky.`,
  (c: string) => `A dragon crossed the skies of ${c} and was gone.`,
  (c: string) => `The shadow of a dragon fell across ${c}.`,
];

function heraldDragon(castles: Room[]): void {
  const dragon = townDragon(Game.time);
  if (castles.length === 0 || !dragon || dragon.t % DRAGON_CRY_PERIOD !== 0) return;
  for (const room of castles) roomCries[room.name] = DRAGON_CRIES[(dragon.t / DRAGON_CRY_PERIOD) % DRAGON_CRIES.length];
  if (dragon.t === 0) chronicle(DRAGON_TIDINGS[dragon.day % DRAGON_TIDINGS.length](castleList(castles)));
}

const HOWL_CRIES = ["Wolves!", "Hark!", "Hear that?", "Awoo?!"];

// Every castle starts at each howl on a full-moon night, and the chronicle
// notes the first in one line.
function heraldWolves(castles: Room[]): void {
  const howl = townHowl(Game.time);
  if (castles.length === 0 || !howl || howl.t !== 0) return;
  for (const room of castles) roomCries[room.name] = HOWL_CRIES[howl.n % HOWL_CRIES.length];
  if (howl.n === 0) chronicle(`Wolves howled beneath the full moon outside the walls of ${castleList(castles)}.`);
}

// The northern lights hang over the whole realm at once, so the chronicle
// notes them once, as night falls.
const AURORA_TIDINGS = [
  "The northern lights burned green over the realm.",
  "Green fire danced in the winter sky. The old folk say the dead were dancing.",
  "Ribbons of light rippled over the battlements all night long.",
];

function heraldSky(): void {
  if (Game.time % TOWN_DAY_LENGTH !== NIGHT_START || !townAurora(Game.time)) return;
  chronicle(AURORA_TIDINGS[Math.floor(Game.time / TOWN_DAY_LENGTH) % AURORA_TIDINGS.length]);
}

// What changed in another lord's hold since the realm last looked at the room:
// a keep raised, taken, abandoned, or grown a level. The first look is not news.
export function heraldRival(roomName: string, before: RoomIntelData | undefined, owner: string | undefined, rcl: number): void {
  if (!before) return;
  const was = before.owner;
  const wilds = `the ${wildsName(roomName)}`;
  if (owner && owner !== was) {
    chronicle(
      was
        ? `${lordName(owner)} seizes ${wilds} from ${lordName(was)}.`
        : `${lordName(owner)} raises a keep in ${wilds}.`
    );
  } else if (!owner && was) {
    chronicle(`The keep of ${lordName(was)} in ${wilds} lies abandoned.`);
  } else if (owner && before.rcl > 0 && rcl > before.rcl) {
    chronicle(`The keep of ${lordName(owner)} in ${wilds} rises to level ${rcl}.`);
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
    : `in the ${wildsName(roomName)}`;
}

function chronicleKill(room: Room): void {
  const foe = isSourceKeeperRoom(room.name) ? "lair keeper" : "raider";
  annal("slain", 1);
  tally(`slain:${room.name}`, 1, (n) => `${n === 1 ? "A" : n} ${foe}${n === 1 ? "" : "s"} fell ${whereIn(room.name)}.`, BATTLE_WINDOW);
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
  if (player) return `the men of ${lordName(player.owner.username)}`;
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
    annal("fallen", 1);
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
