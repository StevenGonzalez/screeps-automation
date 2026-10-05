// Battle cries and proclamations: things creeps shout because something happened,
// as opposed to the idle chatter they repeat on a timer. Cries live on the heap
// for the tick they were raised; a cry lost to a global reset is no loss. What
// is worth remembering also goes into the Royal Chronicle.

import { Annals, annal, castleName, chronicle, formatK, lordName, ordinal, tally, tallyPlaces, warbandBounty, warbandIn, warbandLoss, wildsName } from "./services.chronicle";
import { isArmedHostile, isPlayerCreep, isSourceKeeperRoom } from "./services.combat";
import { NIGHT_START, townAurora, townDragon, townFeast, townHowl, townSeason, townWisps } from "./services.town";
import { TOWN_DAY_LENGTH, TOWN_DAYS_PER_SEASON, TOWN_MOON_DAYS, TOWN_SEASONS, TownSeason } from "../config/config.town";
import { LANDMARKS } from "../config/config.structures";
import { remotePaved } from "./services.remote";
import { ROLE_REMOTE_MINER } from "../config/config.roles";

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

// A raid is told as one line however long it lasts, up to this many ticks.
const REFUGE_WINDOW = 1500;

// A peddler gone over a border to wait out a raid, told once a raid for each
// room the peddlers of a remote hide in.
export function heraldRefuge(creep: Creep, remote: string, refuge: string): void {
  const band = warbandIn(remote);
  const from = band ? `${band}'s raiders` : "the raiders";
  const where = Game.rooms[refuge]?.controller?.my ? castleName(refuge) : `the ${wildsName(refuge)}`;
  tally(
    `refuge:${remote}:${refuge}`,
    1,
    (n) => `${n === 1 ? creep.name : `${n} peddlers`} slipped over the border into ${where} to hide from ${from}.`,
    REFUGE_WINDOW
  );
}

// A peddler resting on its full container, its gold piled up beside it, calls
// for a buyer now and then, so a watcher can see why it is not digging.
const GLUT_CRY_PERIOD = 25;

export function cryGlut(creep: Creep): void {
  if (Game.time % GLUT_CRY_PERIOD !== 0) return;
  freshCries();
  creepCries[creep.name] = "no buyers";
}

// A merchant unloading at the treasury calls out what it brought home. A load
// is at most a few thousand, so the line fits in what creep.say shows.
export function cryHaul(creep: Creep, amount: number): void {
  creep.memory.hauled = (creep.memory.hauled ?? 0) + amount;
  freshCries();
  creepCries[creep.name] = `+${amount} gold`;
  heraldRoadGold(creep, amount);
}

// The gold one castle's merchants have brought home from one remote, told as
// it passes each mark: a watcher sees which roads carry the realm.
const ROAD_GOLD_MARKS: [number, string][] = [
  [10_000, "ten thousand"],
  [50_000, "fifty thousand"],
  [100_000, "a hundred thousand"],
  [250_000, "a quarter of a million"],
  [500_000, "half a million"],
  [1_000_000, "a million"],
];

function roadGoldMark(before: number, after: number): string | undefined {
  for (const [at, words] of ROAD_GOLD_MARKS) if (before < at && after >= at) return words;
  const millions = Math.floor(after / 1_000_000);
  if (millions >= 2 && Math.floor(before / 1_000_000) < millions) return `${millions} million`;
  return undefined;
}

function heraldRoadGold(creep: Creep, amount: number): void {
  const { homeRoom, targetRoom } = creep.memory;
  if (!homeRoom || !targetRoom) return;
  const roads = (Memory.roadGold ??= {});
  const key = `${homeRoom}>${targetRoom}`;
  const before = roads[key] ?? 0;
  roads[key] = before + amount;
  const season = Memory.annals?.roads;
  if (season) season[key] = (season[key] ?? 0) + amount;
  const mark = roadGoldMark(before, before + amount);
  if (!mark) return;
  chronicle(
    `With ${creep.name}'s load, the merchants of ${castleName(homeRoom)} have brought ${mark} gold home from the ${wildsName(targetRoom)}.`
  );
}

export function settleFlight(creep: Creep): void {
  if (creep.memory.fled) delete creep.memory.fled;
}

// How long after the last knight rode out against a warband's raid another
// knight riding out against it joins that line.
const SORTIE_WINDOW = 1500;

// A knight riding out against raiders in a remote cries out, and the chronicle
// tells of it, once for each raid rather than on every tick of the ride. The
// knights riding out against one raid share a line, whether they mustered and
// left together or rode out one after another as they were raised: Hamo,
// Alaric and Ralph each had a line of their own against Mordrek the Flayer's
// raid on the Misty Thicket. Raiders under no named warlord are told of only
// with the knights that leave on the same tick.
export function crySortie(creep: Creep, roomName: string): void {
  if (creep.memory.sortie === roomName) return;
  creep.memory.sortie = roomName;
  freshCries();
  creepCries[creep.name] = "Ride out!";
  const band = Memory.warbands?.[roomName];
  const foe = `${band ? `${band.name}'s` : "the"} raiders in the ${wildsName(roomName)}`;
  const line = (names: string[]) =>
    `${andList(names)} ${names.length === 1 ? "rides" : "ride"} out against ${foe}.`;
  tallyPlaces(`sortie:${roomName}:${band?.at ?? ""}`, creep.name, line, band ? SORTIE_WINDOW : 0);
}

// How long the realm talks of a piece of news.
const GOSSIP_TICKS = 600;

// News outlives its cry: for a while after it happens, every creep now and then
// repeats it in its idle chatter. Newer news replaces older. Kept in Memory so
// a global reset does not cut the talk short.
export function spreadWord(line: string): void {
  Memory.gossip = { line: line.slice(0, 10), until: Game.time + GOSSIP_TICKS };
}

export function gossip(): string | undefined {
  const word = Memory.gossip;
  if (!word) return undefined;
  if (word.until > Game.time) return word.line;
  delete Memory.gossip;
  return undefined;
}

// "Blacksmith Wulfric" -> "† Wulfric".
function mourn(name: string): string {
  return `† ${name.slice(name.lastIndexOf(" ") + 1)}`;
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
      heraldStir(room);
      heraldFirstBorn(room);
      heraldVisitors(room);
      heraldWorks(room);
      heraldRoads(room);
      heraldVendors(room);
      heraldVein(room);
      heraldWalls(room);
    }
    heraldKills(room);
  }
  for (const castle of castles) {
    for (const remote of castle.memory.remoteRooms ?? []) {
      const wilds = Game.rooms[remote.roomName];
      if (wilds && !wilds.controller?.my) heraldWayfarers(wilds, remote);
    }
  }
  heraldDragon(castles);
  heraldWolves(castles);
  heraldWisps(castles);
}

// "Embercrag", "Embercrag and Grimford", "Embercrag, Grimford and Ashford".
function castleList(castles: Room[]): string {
  return andList(castles.map((r) => castleName(r.name)));
}

function andList(items: string[]): string {
  const rest = items.slice(0, -1);
  const last = items[items.length - 1];
  return rest.length ? `${rest.join(", ")} and ${last}` : last;
}

// A new GCL is one more castle the realm may hold.
function heraldRenown(): void {
  const level = Game.gcl.level;
  const known = Memory.heraldGcl;
  Memory.heraldGcl = level;
  if (known === undefined || level <= known) return;
  spreadWord("renown!");
  chronicle(`The Crown's renown grows. The realm may now hold ${level} castles.`);
}

const SEASON_TIDINGS: Record<TownSeason, string> = {
  spring: "Spring comes to the realm. The snow melts from the castle walls.",
  summer: "Summer comes to the realm. The days run long on the vendors' roads.",
  autumn: "Autumn comes to the realm. Leaves blow across the wilds.",
  winter: "Winter comes to the realm. Snow settles on the battlements.",
};

// The realm counts its years from the shard's first tick, the Old Reckoning,
// so every castle keeps the same calendar. Year 1 began at tick 0.
function reckoningYear(time: number): number {
  return Math.floor(time / (TOWN_DAY_LENGTH * TOWN_DAYS_PER_SEASON * TOWN_SEASONS.length)) + 1;
}

function heraldSeason(): void {
  const season = townSeason(Game.time);
  const known = Memory.heraldSeason;
  Memory.heraldSeason = season;
  if (known === undefined || known === season) return;
  const annals = Memory.annals;
  Memory.annals = { since: Game.time, gold: 0, slain: 0, fallen: 0, recruits: 0, roads: {} };
  if (annals) chronicle(annalsLine(known, annals));
  const road = annals && richestRoadLine(known, annals);
  if (road) chronicle(road);
  const year = season === "spring" ? ` It is the year ${reckoningYear(Game.time)} of the Old Reckoning.` : "";
  const feast = townFeast(Game.time);
  chronicle(`${SEASON_TIDINGS[season]}${year}${feast ? ` The ${feast} begins.` : ""}`);
  if (season === "spring") heraldCensus();
}

// The scribes count the realm's souls as each year begins, and name the lords
// the scouts know of beyond its borders.
function heraldCensus(): void {
  const souls = Object.keys(Game.creeps).length;
  let castles = 0;
  for (const name in Game.rooms) if (Game.rooms[name].controller?.my) castles++;
  const held = castles === 1 ? "its one castle" : `its ${castles} castles`;
  chronicle(`The scribes count ${souls} ${souls === 1 ? "soul" : "souls"} in the realm and ${held}.${neighboursLine()}`);
}

// Strongholds and lairs have owners too, but no lord.
const NOT_LORDS = new Set(["Invader", "Source Keeper"]);
const NEIGHBOURS_NAMED = 3;

// The lords holding the most keeps the scouts have seen, from the war
// council's player model.
function neighboursLine(): string {
  const lords = Object.values(Memory.players ?? {})
    .filter((p) => !NOT_LORDS.has(p.username))
    .sort((a, b) => b.roomCount - a.roomCount)
    .slice(0, NEIGHBOURS_NAMED)
    .map((p) => lordName(p.username));
  return lords.length ? ` Beyond its borders the scouts know of ${andList(lords)}.` : "";
}

function annalsLine(season: string, a: Annals): string {
  const whole = a.since <= Game.time - TOWN_DAY_LENGTH * TOWN_DAYS_PER_SEASON;
  const when = whole ? "This season" : "Since the scribes took up their pens";
  const slain = a.slain === 0 ? "slew no foe" : `slew ${a.slain} ${a.slain === 1 ? "foe" : "foes"}`;
  const fallen = a.fallen === 0 ? "lost none of its own" : `buried ${a.fallen} of its own`;
  const raised = a.recruits ? ` raised ${a.recruits} ${a.recruits === 1 ? "recruit" : "recruits"},` : "";
  const ended = season === "winter" ? `, and with it the year ${reckoningYear(Game.time - 1)}` : "";
  return `So ends the ${season}${ended}. ${when} the realm gathered ${formatK(a.gold)} gold,${raised} ${slain} and ${fallen}.`;
}

// The road that brought the most gold home over the season, so a watcher sees
// which of the realm's roads carried it that season and not only overall.
function richestRoadLine(season: string, a: Annals): string | undefined {
  let best: [string, number] | undefined;
  for (const [key, gold] of Object.entries(a.roads ?? {})) {
    if (gold > (best?.[1] ?? 0)) best = [key, gold];
  }
  if (!best) return undefined;
  const [home, remote] = best[0].split(">");
  return `The road from ${castleName(home)} to the ${wildsName(remote)} was the richest of the ${season}: ${formatK(best[1])} gold came home along it.`;
}

// Trade with other players, read from the market's own records every few
// ticks. A partner taking an order in several bites makes one line.
const TRADE_CHECK_PERIOD = 25;
const TRADE_WINDOW = 1500;
// The two common minerals go by the alchemists' names, which a jeweler could
// dig: hydrogen and oxygen read like a modern laboratory's stock.
const WARES: Record<string, string> = {
  energy: "gold",
  H: "brimstone",
  O: "quicksilver",
  U: "utrium",
  L: "lemergium",
  K: "keanium",
  Z: "zynthium",
  X: "philosopher's salt",
  // Dug by the nomads from the deposits on the highways.
  silicon: "glass sand",
  metal: "star iron",
  biomass: "witchroot",
  mist: "wraith mist",
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

// A caravan walks to a deposit on the highway and back in a few hundred ticks,
// so the loads it brings home from one deposit make one line.
const CARAVAN_WINDOW = 1500;

/** A castle's first nomad sets out to dig a deposit on the highway. */
export function heraldNomads(home: string, roomName: string, resource: string): void {
  chronicle(`Nomads ride out from ${castleName(home)} to dig the ${WARES[resource] ?? resource} of the ${wildsName(roomName)}.`);
}

/** A castle's nomads kept home while their last haul finds no buyer. */
export function heraldNomadsIdle(home: string, resource: string): void {
  const ware = WARES[resource] ?? resource;
  tally(
    `unsold:${home}:${resource}`,
    0,
    () => `The nomads of ${castleName(home)} stay in camp. No merchant will pay a fair price for the ${ware} they dug.`,
    CARAVAN_WINDOW
  );
}

/** A caravan brings a deposit's goods home. */
export function heraldCaravan(home: string, roomName: string, resource: string, amount: number): void {
  const ware = WARES[resource] ?? resource;
  tally(
    `caravan:${home}:${roomName}:${resource}`,
    amount,
    (n) => `The caravans of ${castleName(home)} bring ${n} ${ware} home from the ${wildsName(roomName)}.`,
    CARAVAN_WINDOW
  );
}

// What the labs brew, in the realm's tongue. A boost is named for what it does
// to the creep that drinks it, and by strength: a draught, an elixir, or, once
// catalyzed, a philter.
const BREW_VIRTUES: Record<string, string> = {
  UH: "strength",
  UO: "delving",
  KH: "the packhorse",
  KO: "the far shot",
  LH: "masonry",
  LO: "mending",
  ZH: "sundering",
  ZO: "swiftness",
  GH: "the crown",
  GO: "iron skin",
};
// Brimstone and quicksilver together make cinnabar, as in the old alchemy.
const REAGENTS: Record<string, string> = {
  OH: "cinnabar",
  ZK: "zynthium keanite",
  UL: "utrium lemergite",
  G: "ghodium",
};

export function brewName(compound: string): string {
  const reagent = REAGENTS[compound];
  if (reagent) return reagent;
  const m = /^(X?)([UKLZG])(H2O|HO2|H|O)$/.exec(compound);
  if (!m) return compound;
  const [, catalyzed, element, rest] = m;
  const kind = catalyzed ? "philters" : rest.length > 1 ? "elixirs" : "draughts";
  return `${kind} of ${BREW_VIRTUES[element + (rest === "HO2" ? "O" : rest[0])]}`;
}

// A lab chain finishing the compound it was planned for. One that stops short
// for want of an input tells what it made before it did.
const BREW_WINDOW = 1500;

export function heraldBrew(roomName: string, compound: string, amount: number): void {
  tally(
    `brew:${roomName}:${compound}`,
    amount,
    (n) => `The goblin of ${castleName(roomName)}'s labs brewed ${formatK(n)} ${brewName(compound)}.`,
    BREW_WINDOW
  );
}

// A player's creeps in one of our castles make one line a visit, however long
// they stay: spies when none of them can fight, a war party when one can. A
// lord's spies are told once for every castle they reach; a war party has a
// line for each castle it comes to, since each one calls its people to arms.
const VISIT_WINDOW = 1500;

function heraldVisitors(room: Room): void {
  for (const c of room.find(FIND_HOSTILE_CREEPS)) {
    if (!isPlayerCreep(c)) continue;
    const who = c.owner.username;
    const armed = c.body.some((p) => p.type === ATTACK || p.type === RANGED_ATTACK || p.type === WORK);
    if (!armed) {
      const text = (rooms: string[]) => `Spies of ${lordName(who)} crept about ${andList(rooms.map(castleName))}.`;
      tallyPlaces(`visit:${who}:spy`, room.name, text, VISIT_WINDOW);
      continue;
    }
    const text = `A war party of ${lordName(who)} came in arms to the walls of ${castleName(room.name)}.`;
    // The castle calls its people to arms once, as the war party is first seen.
    if (tally(`visit:${room.name}:${who}:war`, 0, () => text, VISIT_WINDOW)) {
      roomCries[room.name] = "To arms!";
      spreadWord("raiders!");
    }
  }
}

// Another player's creeps crossing our remotes unarmed make one line a visit,
// named for what they came as and for every remote they cross. Armed ones are
// told as holding it.
const WAYFARER_WINDOW = 3000;
const WAYFARERS: [BodyPartConstant | undefined, string, string][] = [
  [CLAIM, "An envoy", "Envoys"],
  [WORK, "A labourer", "Labourers"],
  [CARRY, "A carter", "Carters"],
  [undefined, "A scout", "Scouts"],
];

function heraldWayfarers(room: Room, remote: RemoteRoomData): void {
  const parties = new Map<string, Creep[]>();
  for (const c of room.find(FIND_HOSTILE_CREEPS)) {
    if (!isPlayerCreep(c)) continue;
    const party = parties.get(c.owner.username);
    if (party) party.push(c);
    else parties.set(c.owner.username, [c]);
  }
  for (const [who, party] of parties) {
    if (party.some(isArmedHostile) || (remote.hostile && remote.rival === who)) continue;
    const [, one, many] = WAYFARERS.find(
      ([part]) => !part || party.some((c) => c.body.some((p) => p.type === part))
    )!;
    const text = (rooms: string[]) =>
      `${party.length === 1 ? one : many} of ${lordName(who)} passed through ${andList(rooms.map((r) => `the ${wildsName(r)}`))}.`;
    tallyPlaces(`wayfarers:${who}:${many}`, room.name, text, WAYFARER_WINDOW);
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
  // A keep still being founded is built by the pilgrims sent to it.
  const exp = Memory.expansion;
  const builders = exp?.roomName === room.name && exp.phase === "bootstrapping" ? "pilgrims" : "masons";
  for (const type of Object.keys(LANDMARKS) as StructureConstant[]) {
    const gained = (counts[type] ?? 0) - (known[type] ?? 0);
    if (gained <= 0) continue;
    const [one, many] = LANDMARKS[type]!;
    const a = /^[aeiou]/.test(one) ? "an" : "a";
    tally(
      `works:${room.name}:${type}`,
      gained,
      (n) => `The ${builders} of ${castleName(room.name)} raise ${n === 1 ? `${a} ${one}` : `${n} ${many}`}.`,
      WORKS_WINDOW
    );
  }
}

// A peddler laying the last of the container at its source. Until then its
// dig lies on the ground, where it rots before the merchants carry it home.
// Told once per site, even if two peddlers finish it together. The second
// waystation in a remote is told as such: the Bleak Vale's two each said no
// more gold rotted in the mud, and the second read as the first told again.
// One another castle's peddler digs at is that castle's, and does not count.
export function heraldWaystation(creep: Creep, site: ConstructionSite): void {
  const home = creep.memory.homeRoom;
  if (!home) return;
  const wilds = wildsName(site.pos.roomName);
  const theirs = new Set<string>();
  for (const name in Game.creeps) {
    const mem = Game.creeps[name].memory;
    if (mem.homeRoom !== home && mem.assignedContainerId) theirs.add(mem.assignedContainerId);
  }
  const second = creep.room
    .find(FIND_STRUCTURES)
    .some((s) => s.structureType === STRUCTURE_CONTAINER && !theirs.has(s.id));
  const fresh = tally(
    `waystation:${site.id}`,
    0,
    () =>
      second
        ? `${creep.name} raised a second waystation in the ${wilds}, so the merchants of ${castleName(home)} load at both its diggings.`
        : `${creep.name} raised a waystation in the ${wilds}. No more of ${castleName(home)}'s gold rots in the mud.`,
    CREEP_LIFE_TIME
  );
  if (fresh) spreadWord("waystation");
}

// The road out to a remote, told once when it is first mostly built.
function heraldRoads(room: Room): void {
  if (Game.time % WORKS_CHECK_PERIOD !== 0) return;
  for (const remote of room.memory.remoteRooms ?? []) {
    const told = room.memory.heraldRoads ?? [];
    if (told.includes(remote.roomName) || !remotePaved(remote)) continue;
    room.memory.heraldRoads = [...told, remote.roomName];
    spreadWord("new road!");
    chronicle(
      `The road from ${castleName(room.name)} to the ${wildsName(remote.roomName)} is paved. Its merchants travel light.`
    );
  }
}

// A castle's first vendors setting out for the wilds, told once. A castle
// whose vendors were already on the road when the herald first looked has a
// peddler older than a couple of checks, and is passed over quietly.
const VENDOR_NEWS_AGE = 2 * WORKS_CHECK_PERIOD;

function heraldVendors(room: Room): void {
  if (room.memory.heraldVendors || Game.time % WORKS_CHECK_PERIOD !== 0) return;
  const peddlers: Creep[] = [];
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.memory.role === ROLE_REMOTE_MINER && c.memory.targetRoom) peddlers.push(c);
  }
  const ours = peddlers.filter((c) => c.memory.homeRoom === room.name);
  if (ours.length === 0) return;
  room.memory.heraldVendors = true;
  if (ours.some((c) => (c.ticksToLive ?? CREEP_LIFE_TIME) < CREEP_LIFE_TIME - VENDOR_NEWS_AGE)) return;
  const target = ours[0].memory.targetRoom!;
  const neighbour = peddlers.find((c) => c.memory.homeRoom !== room.name && c.memory.targetRoom === target);
  const shared = neighbour?.memory.homeRoom ? ` ${castleName(neighbour.memory.homeRoom)}'s vendors already dig there.` : "";
  roomCries[room.name] = "Godspeed!";
  spreadWord("vendors!");
  chronicle(`${castleName(room.name)} sends its first vendors out into the ${wildsName(target)}.${shared}`);
}

// A castle's mineral vein, told when its jewelers dig it dry and again when it
// fills back up, tens of thousands of ticks later.
function heraldVein(room: Room): void {
  if (Game.time % WORKS_CHECK_PERIOD !== 0) return;
  const mineral = room.find(FIND_MINERALS)[0];
  if (!mineral) return;
  const dry = mineral.mineralAmount === 0;
  const known = room.memory.heraldVeinDry;
  room.memory.heraldVeinDry = dry;
  if (known === undefined || known === dry) return;
  const vein = `The ${WARES[mineral.mineralType] ?? mineral.mineralType} vein beneath ${castleName(room.name)}`;
  if (dry) {
    const days = Math.max(1, Math.round((mineral.ticksToRegeneration ?? 0) / TOWN_DAY_LENGTH));
    chronicle(`${vein} is dug dry. Its jewelers lay down their picks for ${days} days.`);
  } else {
    chronicle(`${vein} runs full again. Its jewelers take up their picks.`);
  }
}

// A castle's walls passing each mark, told once. The smiths pour more gold into
// the walls than into anything but the throne, and until now a watcher never
// learned where it went. The walls are only as strong as their weakest stretch,
// and a ring with a gap in it is no wall at all, so a new keep's walls are told
// once the ring closes.
const WALL_MARKS: [number, string][] = [
  [100_000, "a hundred thousand"],
  [300_000, "three hundred thousand"],
  [1_000_000, "a million"],
  [3_000_000, "three million"],
  [10_000_000, "ten million"],
];

function heraldWalls(room: Room): void {
  const ring = room.memory.perimeterTiles;
  if (!ring?.length || Game.time % WORKS_CHECK_PERIOD !== 0) return;
  const tiles = new Set(ring);
  let standing = 0;
  let weakest = Infinity;
  for (const s of room.find(FIND_STRUCTURES)) {
    if (s.structureType !== STRUCTURE_WALL && s.structureType !== STRUCTURE_RAMPART) continue;
    if (!tiles.has(`${s.pos.x},${s.pos.y}`)) continue;
    standing++;
    weakest = Math.min(weakest, s.hits);
  }
  const reached = standing < tiles.size ? 0 : WALL_MARKS.filter(([at]) => weakest >= at).length;
  const known = room.memory.heraldWalls;
  if (known !== undefined && reached <= known) return;
  room.memory.heraldWalls = reached;
  if (known === undefined) return;
  chronicle(`The smiths of ${castleName(room.name)} have raised its walls ${WALL_MARKS[reached - 1][1]} strong.`);
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
  if (dragon.t !== 0) return;
  spreadWord("a dragon!");
  chronicle(DRAGON_TIDINGS[dragon.day % DRAGON_TIDINGS.length](castleList(castles)));
}

const HOWL_CRIES = ["Wolves!", "Hark!", "Hear that?", "Awoo?!"];

// Every castle starts at each howl on a full-moon night, and the chronicle
// notes the first in one line.
function heraldWolves(castles: Room[]): void {
  const howl = townHowl(Game.time);
  if (castles.length === 0 || !howl || howl.t !== 0) return;
  for (const room of castles) roomCries[room.name] = HOWL_CRIES[howl.n % HOWL_CRIES.length];
  if (howl.n !== 0) return;
  spreadWord("wolves...");
  chronicle(`Wolves howled beneath the full moon outside the walls of ${castleList(castles)}.`);
}

// On a new-moon night the wisps come out over the marshes. Every castle mutters
// at them as night falls, and the chronicle notes them once.
const WISP_CRIES = ["Wisps!", "Don't go!", "Spirits..."];
const WISP_TIDINGS = [
  "Under the dark moon, will-o'-the-wisps drifted over the marshes. None who followed them came back.",
  "Pale lights wandered the bogs all night beneath the new moon.",
  "The marsh-lights were out under the dark moon. The old folk barred their doors.",
];

function heraldWisps(castles: Room[]): void {
  if (castles.length === 0 || Game.time % TOWN_DAY_LENGTH !== NIGHT_START || !townWisps(Game.time)) return;
  castles.forEach((room, i) => (roomCries[room.name] = WISP_CRIES[i % WISP_CRIES.length]));
  const moon = Math.floor(Game.time / (TOWN_DAY_LENGTH * TOWN_MOON_DAYS));
  spreadWord("the wisps");
  chronicle(WISP_TIDINGS[moon % WISP_TIDINGS.length]);
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
// a keep raised, taken, abandoned, or grown a level. The first look at a room
// is news only when a lord holds it, as word of a neighbour the realm had not met.
export function heraldRival(roomName: string, before: RoomIntelData | undefined, owner: string | undefined, rcl: number): void {
  const wilds = `the ${wildsName(roomName)}`;
  if (!before) {
    if (owner) chronicle(`Scouts bring word of ${lordName(owner)}, who holds a keep of level ${rcl} in ${wilds}.`);
    return;
  }
  const was = before.owner;
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
  spreadWord(`level ${level}!`);
  const works = newWorks(level);
  chronicle(
    `Hear ye! ${castleName(room.name)} rises to level ${level}. Long live the Crown!` +
      (works ? ` Its masons may now raise ${works}.` : "")
  );
}

// The landmarks a level lets a castle raise that the one below did not:
// "a second barracks, a third watchtower, 3 more alchemy labs and a workshop".
function newWorks(level: number): string | undefined {
  const works: string[] = [];
  for (const type of Object.keys(LANDMARKS) as BuildableStructureConstant[]) {
    const was = CONTROLLER_STRUCTURES[type][level - 1] ?? 0;
    const now = CONTROLLER_STRUCTURES[type][level] ?? 0;
    if (now <= was) continue;
    const [one, many] = LANDMARKS[type]!;
    if (now - was > 1) works.push(`${now - was} ${was ? "more " : ""}${many}`);
    else if (was) works.push(`a ${ordinal(now)} ${one}`);
    else works.push(`${/^[aeiou]/.test(one) ? "an" : "a"} ${one}`);
  }
  return works.length ? andList(works) : undefined;
}

// The throne nearing its next level, told once per level. A castle's climb
// past level 5 takes tens of thousands of ticks, and this is the sign the
// next proclamation is close. Level 1 lasts too short a time to tell.
const STIR_SHARE = 0.9;
function heraldStir(room: Room): void {
  if (Game.time % WORKS_CHECK_PERIOD !== 0) return;
  const { level, progress, progressTotal } = room.controller!;
  if (level < 2 || !progressTotal || progress < progressTotal * STIR_SHARE) return;
  const next = level + 1;
  if (room.memory.heraldStirred === next) return;
  room.memory.heraldStirred = next;
  chronicle(`The enchanters of ${castleName(room.name)} feel the throne stir. Level ${next} is near.`);
}

// Until a new keep's barracks raises a creep of its own, everyone in it was sent
// from elsewhere. Its first is proclaimed once; a keep whose firstborn came
// before this was proclaimed (another of its own is already alive) passes
// quietly.
function heraldFirstBorn(room: Room): void {
  if (Memory.expansion?.roomName !== room.name || room.memory.heraldBorn) return;
  const birth = room.find(FIND_MY_SPAWNS).find((s) => s.spawning)?.spawning;
  if (!birth) return;
  room.memory.heraldBorn = true;
  for (const name in Game.creeps) {
    if (name !== birth.name && Game.creeps[name].memory.homeRoom === room.name) return;
  }
  room.memory.firstBorn = birth.name;
  roomCries[room.name] = "Huzzah!";
  spreadWord("firstborn!");
  chronicle(`The bells of ${castleName(room.name)} ring for the first born in its own barracks: ${birth.name}.`);
}

// The bells that rang for a keep's first born ring again when it dies of age.
function heraldFirstBornRest(name: string): void {
  for (const roomName in Memory.rooms) {
    const mem = Memory.rooms[roomName];
    if (mem.firstBorn !== name) continue;
    delete mem.firstBorn;
    spreadWord(mourn(name));
    chronicle(`${name}, the first born in the barracks of ${castleName(roomName)}, has died of old age. The keep's bells ring once more.`);
  }
}

// A fight's kills in one room gather into one line while it lasts.
const BATTLE_WINDOW = 300;

function whereIn(roomName: string): string {
  return Game.rooms[roomName]?.controller?.my
    ? `before the walls of ${castleName(roomName)}`
    : `in the ${wildsName(roomName)}`;
}

// `slayer` is the one creep of ours that struck the foe down, if one did it
// alone; a lone kill is told as that creep's deed. `dead` is the foe as its
// tombstone remembers it: another lord's scout was told as a raider.
function chronicleKill(room: Room, slayer?: string, dead?: AnyCreep): void {
  const lord = dead && isPlayerCreep(dead as Creep) ? dead.owner.username : undefined;
  const foe = isSourceKeeperRoom(room.name) ? "lair keeper" : "raider";
  annal("slain", 1);
  // Lair keepers fall every few hundred ticks where their lairs are farmed;
  // that is work, not news.
  if (lord || foe === "raider") spreadWord("victory!");
  const band = foe === "raider" && !lord ? warbandIn(room.name) : undefined;
  let one = band ? `A raider of ${band}'s band` : `A ${foe}`;
  let many = (n: number) => (band ? `${n} of ${band}'s raiders` : `${n} ${foe}s`);
  let key = `slain:${room.name}`;
  if (lord) {
    const armed = "body" in dead! && dead.body.some((p) => p.type === ATTACK || p.type === RANGED_ATTACK || p.type === WORK);
    const [kind, kinds] = armed ? ["man-at-arms", "men-at-arms"] : ["spy", "spies"];
    one = `A ${kind} of ${lordName(lord)}`;
    many = (n) => `${n} of ${lordName(lord)}'s ${kinds}`;
    key += `:${lord}:${kind}`;
  }
  tally(
    key,
    1,
    (n) => (n === 1 ? `${one} fell${slayer ? ` to ${slayer}` : ""}` : `${many(n)} fell`) + ` ${whereIn(room.name)}.`,
    BATTLE_WINDOW
  );
  if (band && warbandLoss(room.name)) {
    spreadWord("routed!");
    Memory.lastRout = { band, room: room.name, slayer };
    const bounty = slayer && warbandBounty(room.name) ? " and claims the Crown's bounty" : "";
    chronicle(
      `${slayer ? `${slayer} broke ${band}'s band` : `${band}'s band is broken`} ${whereIn(room.name)}${bounty}. The warlord is heard of no more.`
    );
  }
}

// Each of our creeps as it stood at the start of last tick. What a creep slew
// and hauled is read from its memory once it is gone, as the memory system
// clears a dead creep's memory only after the herald has run.
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
  if (isSourceKeeperRoom(roomName)) return "a lair keeper";
  const band = warbandIn(roomName);
  return band ? `${band}'s raiders` : "raiders";
}

// One of ours gone before its time, last seen wounded, fell in a fight. A
// creep that dies of age or is recycled at full health is not mourned.
function heraldFallen(): void {
  const next = new Map<string, Muster>();
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.spawning) continue;
    next.set(name, {
      room: c.pos.roomName,
      hurt: c.hits < c.hitsMax,
      ttl: c.ticksToLive ?? 0,
    });
  }
  for (const [name, last] of muster) {
    if (next.has(name)) continue;
    const mem = Memory.creeps?.[name];
    const kills = mem?.kills ?? 0;
    const slew = kills > 0 ? `, who slew ${kills === 1 ? "a foe" : `${kills} foes`},` : "";
    if (!last.hurt || last.ttl <= 1) {
      // Age or an unhurt end is no news, unless it was a creep that fought.
      if (slew) {
        spreadWord(mourn(name));
        chronicle(`${name}${slew} was laid to rest with honours.`);
        heraldSlayer(name, kills);
      }
      heraldRetired(name, mem?.hauled ?? 0);
      if (last.ttl <= 1) heraldFirstBornRest(name);
      continue;
    }
    const foe = foeIn(last.room);
    const by = foe ? ` to ${foe}` : "";
    annal("fallen", 1);
    spreadWord(mourn(name));
    tally(
      `fallen:${last.room}`,
      1,
      (n) => `${n === 1 ? name + slew : `${n} of the realm's own`} fell${by} ${whereIn(last.room)}.`,
      BATTLE_WINDOW
    );
    heraldSlayer(name, kills);
  }
  muster = next;
}

// A creep that dies having slain more foes than any before it. The minstrels
// sing of it at every feast after (role.minstrel).
function heraldSlayer(name: string, kills: number): void {
  if (kills <= (Memory.greatestSlayer?.kills ?? 0)) return;
  Memory.greatestSlayer = { name, kills };
  chronicle(`The minstrels make a song of ${name}, who slew more foes than any before.`);
}

// A merchant who ends its days having brought home more gold than any before.
function heraldRetired(name: string, hauled: number): void {
  if (hauled <= (Memory.richestHaul ?? 0)) return;
  Memory.richestHaul = hauled;
  Memory.richestHauler = name;
  chronicle(`${name} retired from the road with ${formatK(hauled)} gold brought home, the most of any merchant yet.`);
}

// A hostile creep died last tick to something of ours. A creep that struck it
// shouts a kill cry; a kill by towers alone has the room cheer instead. The
// raw log is only parsed on a tick something was destroyed.
// A waystation in one of our remotes knocked down by raiders, as the line
// telling of its raising was told. One worn away by decay was struck by no one.
function heraldRazed(room: Room, events: EventItem[], id: string): void {
  if (room.controller?.my) return;
  const struck = events.some(
    (a) => a.event === EVENT_ATTACK && a.data.targetId === id && !Game.getObjectById(a.objectId as Id<Creep>)?.my
  );
  if (!struck) return;
  for (const name in Game.rooms) {
    const castle = Game.rooms[name];
    if (!castle.controller?.my || !castle.memory.remoteRooms?.some((r) => r.roomName === room.name)) continue;
    chronicle(`Raiders razed a waystation in the ${wildsName(room.name)}. ${castleName(name)}'s gold spills into the mud.`);
    return;
  }
}

function heraldKills(room: Room): void {
  const raw = room.getEventLog(true) as unknown as string;
  if (!raw.includes(`"event":${EVENT_OBJECT_DESTROYED},`)) return;
  const events = JSON.parse(raw) as EventItem[];
  for (const e of events) {
    if (e.event !== EVENT_OBJECT_DESTROYED) continue;
    if (e.data.type === STRUCTURE_CONTAINER) heraldRazed(room, events, e.objectId);
    if (e.data.type !== "creep") continue;
    const ours = events
      .filter((a) => a.event === EVENT_ATTACK && a.data.targetId === e.objectId)
      .map((a) => Game.getObjectById(a.objectId as Id<Creep | StructureTower>))
      .filter((o): o is Creep | StructureTower => !!o && o.my);
    if (ours.length === 0) continue;
    const creeps = [...new Set(ours.filter((o): o is Creep => o instanceof Creep))];
    const alone = creeps.length === 1 && creeps.length === new Set(ours).size;
    const dead = room.find(FIND_TOMBSTONES).find((t) => t.creep.id === e.objectId)?.creep;
    chronicleKill(room, alone ? creeps[0].name : undefined, dead);
    if (creeps.length === 0) {
      roomCries[room.name] = "Huzzah!";
      continue;
    }
    for (const c of creeps) {
      creepCries[c.name] = KILL_CRIES[(Game.time + c.name.length) % KILL_CRIES.length];
      c.memory.kills = (c.memory.kills ?? 0) + 1;
    }
  }
}
