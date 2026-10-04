import { castleName, formatK, wildsName } from "../services/services.chronicle";
import { parkOn, parseTile, spotHolder, townFeast, townSeason } from "../services/services.town";
import { TownSeason } from "../config/config.town";

// A minstrel comes to a castle's square on a feast day and walks round the
// fountain singing ballads of the realm: its castles, the season's feast, the
// raiders slain and the gold gathered, and the realm's legends. It leaves when
// the feast is over.

// How long the minstrel stands at one place on its round, and how long it
// sings each couplet.
const STROLL_TICKS = 10;
const VERSE_TICKS = 25;
// Something to hum between the couplets, in 10 characters or less.
const HUMS = ["♪ la la ♪", "♪ hey ho ♪", "♪ fa la la", "♪ ♪ ♪"];
const HUM_PERIOD = 4;

const FEAST_VERSES: Record<TownSeason, (feast: string) => [string, string]> = {
  spring: (feast) => ["Sow the barley, sow the rye,", `the ${feast} drinks the cellars dry!`],
  summer: (feast) => ["The sun is high, the hay is in,", `so let the ${feast} begin!`],
  autumn: (feast) => ["The barns are full, the cider's sweet,", `at ${feast} we drink and eat!`],
  winter: (feast) => ["The snow is deep, the hearth is bright,", `we keep the ${feast} through the night!`],
};

/** Every couplet of the ballad sung in `room`, in the order it is sung. */
export function ballad(room: Room, time: number): Array<[string, string]> {
  const home = castleName(room.name);
  const verses: Array<[string, string]> = [[`Sing of ${home}, its walls of stone,`, "that bow to none but the Crown alone!"]];

  const feast = townFeast(time);
  if (feast) verses.push(FEAST_VERSES[townSeason(time)](feast));

  let castles = 0;
  for (const name in Game.rooms) {
    if (!Game.rooms[name].controller?.my) continue;
    castles++;
    if (name === room.name) continue;
    verses.push([`In the ${wildsName(name)} where the cold winds blow,`, `the banners of ${castleName(name)} stand row on row!`]);
  }

  const annals = Memory.annals;
  const slain = annals?.slain ?? 0;
  if (slain === 0) {
    verses.push([`No raider came to our gates this ${townSeason(time)};`, "they fear our archers, and with reason!"]);
  } else {
    verses.push(
      slain === 1
        ? ["A raider came to steal our gold;", "now it lies in the earth so cold!"]
        : [`${slain} raiders came to steal our gold;`, "now they lie in the earth so cold!"]
    );
  }
  const slayer = Memory.greatestSlayer;
  if (slayer) {
    const foes = slayer.kills === 1 ? "a foe" : `${slayer.kills} foes`;
    verses.push([`Of ${slayer.name} let the minstrels sing,`, `who slew ${foes} for Crown and King!`]);
  }
  const rout = Memory.lastRout;
  if (rout) {
    verses.push([
      `${rout.band} came for our gold and grain;`,
      rout.slayer ? `${rout.slayer} left the warband slain!` : `in the ${wildsName(rout.room)} the band lies slain!`,
    ]);
  }
  const gold = annals?.gold ?? 0;
  if (gold > 0) verses.push([`${formatK(gold)} gold the mines have brought,`, "and not a coin of it for naught!"]);
  if (Memory.richestHauler) {
    verses.push([
      `Of ${Memory.richestHauler}, who walked the vendors' road`,
      `and brought home ${formatK(Memory.richestHaul ?? 0)} gold, the richest load!`,
    ]);
  }
  const road = richestRoad(room.name);
  if (road) verses.push([`Down the road from the ${wildsName(road.remote)} wild,`, `${formatK(road.gold)} gold our merchants piled!`]);
  const recruits = annals?.recruits ?? 0;
  if (recruits > 0) {
    verses.push([`${recruits === 1 ? "One recruit" : `${recruits} recruits`} marched out the barracks door,`, "to serve the Crown as those before!"]);
  }
  const fallen = annals?.fallen ?? 0;
  if (fallen > 0) {
    verses.push([`Pour one out for the ${fallen === 1 ? "one" : fallen} we lost,`, "who held the line and paid the cost."]);
  }
  verses.push(["Raise a cup to the Crown so high,", `whose banners over ${castles} ${castles === 1 ? "castle" : "castles"} fly!`]);
  return verses;
}

// The remote this castle's merchants have brought the most gold home from.
function richestRoad(home: string): { remote: string; gold: number } | undefined {
  let best: { remote: string; gold: number } | undefined;
  for (const key in Memory.roadGold) {
    const [from, remote] = key.split(">");
    const gold = Memory.roadGold[key];
    if (from === home && gold > (best?.gold ?? 0)) best = { remote, gold };
  }
  return best;
}

/** The couplet being sung in `room` at `time`. */
export function currentVerse(room: Room, time: number): [string, string] {
  const verses = ballad(room, time);
  return verses[Math.floor(time / VERSE_TICKS) % verses.length];
}

export function runMinstrel(creep: Creep): void {
  // The feast is over: on to the next town.
  if (!townFeast(Game.time)) {
    creep.suicide();
    return;
  }
  const home = creep.memory.homeRoom ?? creep.room.name;
  if (creep.room.name !== home) {
    creep.moveTo(new RoomPosition(25, 25, home), { reusePath: 20 });
    return;
  }
  const town = creep.room.memory.town;
  if (!town || town.square.length === 0) return;

  // Round the fountain, a step every STROLL_TICKS, passing anyone standing in
  // the way.
  const ring = squareRing(town);
  const at = Math.floor(Game.time / STROLL_TICKS) % ring.length;
  for (let i = 0; i < ring.length; i++) {
    const tile = ring[(at + i) % ring.length];
    const holder = spotHolder(creep.room.name, tile);
    if (holder && holder !== creep.name) continue;
    parkOn(creep, [tile]);
    break;
  }
  if (Game.time % HUM_PERIOD === 0) creep.say(HUMS[(Game.time / HUM_PERIOD) % HUMS.length], true);
}

// The square's tiles in order round the fountain.
function squareRing(town: TownMemory): string[] {
  if (!town.fountain) return town.square;
  const c = parseTile(town.fountain);
  const angle = (k: string) => {
    const { x, y } = parseTile(k);
    return Math.atan2(y - c.y, x - c.x);
  };
  return [...town.square].sort((a, b) => angle(a) - angle(b));
}
