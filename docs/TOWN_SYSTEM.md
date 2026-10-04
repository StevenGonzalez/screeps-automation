# The Town Quarter

As a castle rises, a town grows up inside its perimeter, a step at each level:
watch posts behind the ramparts, a market square around a fountain, stone
cottages for the townsfolk, and the townsfolk themselves, a militia of archers
who keep the watch by day and sleep in their beds by night.

Everything in the town is built from plain walls and ramparts. Walls block
movement and never decay; ramparts let our own creeps walk through and shelter
whoever stands on them. The town is therefore also a set of places to stand:
posts to guard from, a square to idle in, and beds to hide in.

It is not a fortification. The perimeter is. Town barriers are kept at a modest
20k hits, and the whole quarter costs about 3 energy a tick at RCL 8.

---

## How it grows

Each stage waits for the room to afford it.

| Stage | Needs | Adds |
|---|---|---|
| Watch posts + square | RCL 4, anchor and perimeter planned, 90% of the perimeter built | Up to 3 rampart posts behind the ring for each side with exits; a 3x3 square around a fountain wall |
| First cottage | RCL 5 | The House of Aldermere: 15 walls, a rampart door, 9 rampart beds |
| Militia | A built bed each, posture not `RECOVER`, no energy emergency | Up to 2 militia at RCL 5, 4 at RCL 6, 8 at RCL 7, 12 at RCL 8 |
| Second cottage | RCL 7 | The House of Blackwood |
| Third cottage | RCL 8 | The House of Cotter |
| Lookouts | RCL 8, militia at strength | Up to 4, one per neighbouring room nobody else owns or reserves and we do not already mine |

Cottages and townsfolk also need 10k energy in storage. That is the upgraders'
floor: they spend everything above it, so storage settles near 10k and a higher
gate would never open.

Townsfolk spawn after the castle's own workers and defenders (miners,
porters, smiths, masons, enchanters) but ahead of expeditions, scouts and
vendors, and never while the room is blockaded. Each takes only a few ticks of
spawn time, and a castle sending pilgrims keeps its spawn busy for hundreds of
ticks at a stretch, so a town at the end of the line was never raised. The
economy-critical line that stops war and expansion (25k in storage) does not
apply to them: the town's own 10k gate does. Below
the storage gate the town keeps what it has and stops growing.

All thresholds live in `src/config/config.town.ts`.

---

## The layout

Planning runs in `planning/planner.town.ts`, on the normal 50-tick structure
pass, after the defensive perimeter. The result is saved in
`room.memory.town`, and the unbuilt tiles go into two planner keys,
`town_walls` and `town_ramparts`, which the ordinary construction pipeline
builds at priority 13 (after the core, before cosmetic roads).

Everything the planner places avoids planned and built structures, every
tile of the castle's blueprint (all ages, not just the current one), the
stamp's core square, roads, and the ring itself. The blueprint in turn keeps
off the town's tiles, so roads route around it (see
[BLUEPRINT.md](BLUEPRINT.md)).

**Watch posts.** For each room edge with exits, the planner finds the middle of
the exits, takes the ring tile nearest it as the gate, and places up to three
posts just inside the ring within three tiles of that gate. Each post is a
rampart, so whoever stands there is covered. When the perimeter is re-planned,
the posts move with it.

**The market square.** The planner looks for a clear 3x3 plaza inside the ring,
3 to 10 tiles from storage, with no structure next to it. The centre becomes a
fountain (one wall) and the eight tiles around it are the square, where idle
porters and resting lookouts wait. With no room for a plaza, it falls back to
six loose tiles near storage. If a later structure lands next to the square,
the square is planned again.

**Cottages.** A cottage is a 5x5 footprint:

```
W W W W W
W b b b W
D b b b W      W  wall
W b b b W      D  door (rampart), on the side facing the castle
W W W W W      b  bed (rampart)
```

The planner scans every position that is clear of the stamp, three tiles from
sources and the mineral, four from the controller, with a free one-tile margin
around it. Positions inside the ring come first, nearest the castle first. For
each of up to 40 candidates it checks, with a flood fill, that the tile outside
the door can be reached from the castle and that the new walls cut nothing off.
A cottage never walls in a source, a road or a corner of the base.

When no position inside the ring works, a cottage may sit just outside it,
within 14 tiles of the anchor. The planner then asks the perimeter to be
re-planned, and the min-cut wraps the new house inside the walls. A failed
search is retried 1500 ticks later.

Cottages take their names from the families of the realm: Aldermere, Blackwood,
Cotter, Fairweather, Holloway, Marsh, Thatcher and Wren.

---

## The townsfolk

Townsfolk are role `townsfolk` (`roles/role.townsfolk.ts`), spawned by
`orchestrators/orchestrator.spawning.town.ts`. Their `job` in memory says which
kind they are.

### Militia: `[RANGED_ATTACK, MOVE]`, 200 energy

A militiaman shoots the weakest hostile within range 3 every tick, whatever else
it is doing.

In peace it follows the town clock:

- **Dawn and day:** stand the watch posts. With every post taken, wait in the
  square, then in a bed. On a feast day they gather in the square instead,
  and only overflow to the posts.
- **Dusk and night:** sleep in a cottage bed, or wait in the square if every
  bed is taken. With two or more militia, one keeps the night watch on a post
  instead, a different one each night by name, and cries "all's well" every
  100 ticks.
- On the first tick of each phase the whole town calls it out ("cock-a-doo!",
  "lamps lit", "zzz"). At daybreak the talk is of the season ("blossoms!",
  "hay to cut", "cider time", "snow again"), or of the storm on a storm day
  ("storm!", "bar doors"). On a feast day the square
  cheers every hundred ticks while the sun is up ("Huzzah!", "ale!").

When raiders are in the room and safe mode is off:

1. The militiaman shouts "To arms!" and drops the post or bed it held.
2. It runs for the free built rampart, a door in the perimeter or a post,
   nearest the closest raider, and fights from under it.
3. With no such rampart within bow range (3) of the raider, it stands on the
   open ground just inside the wall nearest the raider and shoots over it.
   Melee raiders cannot reach it across the wall.
4. With nowhere free at all, it bars itself into a bed.

Each tile is claimed by one creep at a time. A claim lapses after one tick
unused, so a dead or reassigned creep frees its spot at once.

### Lookout: `[MOVE]`, 50 energy

A lookout walks to a tile three steps inside a neighbouring room, facing our
exit, and stands there so the castle keeps vision of its approaches. Rooms we
already mine are skipped, since our miners already see them.

It runs home when an armed, non-allied creep comes within six tiles, or when it
finds the room has been claimed by another player (towers). It shouts
"Raiders!", then waits in the square for 300 ticks before going back out.

### Minstrel: `[MOVE]`, 50 energy

On a feast day, once the militia is at strength, each castle with a square
calls one minstrel (role `minstrel`, `roles/role.minstrel.ts`). It is called by
daylight only, and the chronicle notes its coming ("A minstrel comes to
Embercrag Square for the Harvest Home.").

The minstrel walks round the fountain, a step every 10 ticks, passing tiles
others stand on, and hums ("♪ la la ♪") every few ticks. It sings a ballad of
the realm, a couplet every 25 ticks: the castle itself, the feast, every other
castle of the realm, the raiders slain this season (or that none came), the
gold gathered, the realm's own who fell, and how many castles fly the banner.
The numbers come from the season's annals, so the song changes as the season
goes on. When the feast day ends, the minstrel leaves.

Under attack it runs for a cottage bed like any other civilian.

---

## Everyone else uses the town too

- **Idle porters** wait in the market square instead of crowding the spawn.
- **Idle knights, wizards and clerics** of the home guard stand the watch posts,
  so the posts face the exits and each guard stands under a rampart.
- **Civilians under attack** (builders, upgraders, repairers, haulers and the
  rest) run for a free cottage bed within 12 tiles, provided the bed is no
  closer to any threat than they already are. Once inside they stay until the
  threat is at least 3 tiles beyond its reach. With no safe bed, they flee
  across open ground as before.

---

## Day and night

A town day lasts 1000 ticks:

| Ticks | Phase | HUD hours |
|---|---|---|
| 0-99 | Dawn | 05:00-07:00 |
| 100-599 | Day | 07:00-19:00 |
| 600-699 | Dusk | 19:00-21:00 |
| 700-999 | Night | 21:00-05:00 |

Seven days make a season, and the year turns through spring, summer, autumn
and winter, the same in every castle. The Royal Chronicle notes each new
season, and first reads out the annals of the season just ended: the gold the
realm gathered, the foes it slew and how many of its own it buried. The gold
is counted from the exchequer's books, so it is the same figure the ledger
shows, summed over the season.

The first day of each season is a feast day: the Sowing Feast, the Midsummer
Fair, Harvest Home and the Yule Feast.

About one other day in five is a storm day, except in winter, when it snows
instead. Which days are stormy follows from the day's number alone, so every
castle has the same weather.

On about one day in six, never a feast day, a dragon crosses the realm's skies.
It flies over every castle at once, some time between morning and dusk, and
takes 48 ticks to cross a room from one edge to the other. While it is
overhead every castle cries out every 8 ticks ("Dragon!", "Look up!",
"Hide!"), and the chronicle notes its passing in one line naming them all
("The shadow of a dragon fell across Embercrag and Grimford."). Like the weather, the dragon's days follow from the day's
number alone.

The moon waxes and wanes over eight days, so its full moon falls on a
different day of each season. On a full-moon night the wolves howl from the
dark beyond the walls every 50 ticks; every castle starts at each howl
("Wolves!", "Hark!", "Hear that?"), and the chronicle notes the first in one
line ("Wolves howled beneath the full moon outside the walls of Embercrag and
Grimford.").

On about one winter night in three the northern lights hang over the realm,
and the chronicle notes them as night falls ("The northern lights burned green
over the realm."). On any clear night a star falls now and then. Both follow from the day's
number and the tick alone, so every castle sees the same sky.

Every castle's room HUD, town or none, shows the part of the day, the hour,
the season, any feast, any storm and, after dark, the moon and any northern
lights, then how many townsfolk there are, if any: `Day, 10:00 in autumn, Harvest Home · 8 townsfolk`, or
`Night, 23:00 in winter, full moon, northern lights · 8 townsfolk`.

---

## Visuals

When room visuals are on, the town draws itself. The sky, the watchtower
braziers and the barracks' hearth are drawn over every castle, so a young keep
with no town yet shares the realm's nights, moon and wolves. Until its town is
planned, such a keep is a pilgrims' camp: three tents pitched round its
barracks (or the ground marked out for it) and a campfire that burns after
dark and smoulders by day.

In full, sky and town together:

- the whole room darkens at night, and a little at dawn and dusk;
- each cottage gets a roof and a "House of ..." sign, and a lamp is lit in
  every occupied bed;
- a pennant in the castle's colours at each watch post, run up when someone
  stands there, and a flickering torch on each post after dark;
- after dark, a brazier burning atop each watchtower and the barracks' hearth
  glowing, and a swinging lantern carried by the night watchman;
- rippling water in the fountain and a "... Square" sign;
- the season: a faint green tint and drifting petals in spring, fireflies
  round the fountain on a summer night, an amber tint and falling leaves in
  autumn, and a pale tint and falling snow in winter;
- on a storm day, a grey sky and slanting rain in place of the season's
  drift, and every so often a bolt of lightning that lights the room white
  for a tick;
- on a dragon's day, the dragon itself crossing the room: wings beating, tail
  swinging, an ember of an eye, and its shadow sliding over the ground below;
- from dusk to dawn, unless a storm hides it, the moon in the north-east
  corner, lit as it is tonight and glowing when full; on a full-moon night, a
  wolf's eyes at the room's west or east edge with its howl rising over them;
- on a winter night with the northern lights, three ribbons of green, teal and
  violet rippling across the top of the room, fading in at nightfall;
- now and then on a clear night, a falling star streaking across the sky;
- on a feast day, a ring of lanterns round the fountain with the feast's name,
  and while the minstrel is in the square, the couplet it sings over the
  square's sign and a note bobbing over its head.

---

## Upkeep

| Item | Energy |
|---|---|
| Militia, 12 at RCL 8 | 12 x 200 per 1500 ticks = about 1.6 a tick |
| Lookouts, up to 4 | 4 x 50 per 1500 ticks = about 0.13 a tick |
| Minstrel | 50 per feast day, one feast in 7000 ticks |
| Rampart decay, about 40 town ramparts | 3 hits a tick each, at 0.01 energy per hit = about 1.2 a tick |
| Walls | Never decay; repaired only when shot |
| One-off build and reinforcement to 20k | About 200 energy a barrier, about 5k a cottage, roughly 17k in all |

About 3 energy a tick at RCL 8, a few percent of a mature room's income. At RCL 5
the town is one cottage and two militia, well under 1 energy a tick.

---

## Console

| Command | Does |
|---|---|
| `Game.arca.town()` | Town clock, then each town: posts, square, cottages and whether they are built, militia (and whether they are on the walls), lookouts (and whether they have fled home) |
| `Game.arca.town('W1N1')` | The same for one room |
| `Game.arca.razeTown('W1N1')` | Tears every town wall and rampart down and forgets the plan. The next structure pass plans the quarter afresh (useful after a stamp change) |

---

## Files

| File | Holds |
|---|---|
| `config/config.town.ts` | Every threshold, the day phases, cottage family names |
| `services/services.town.ts` | Town clock, cottage geometry, tile claims, `parkIdle` for other roles |
| `planning/planner.town.ts` | Site analysis, post / square / cottage placement, `describeTown`, `razeTown` |
| `roles/role.townsfolk.ts` | Militia and lookout behaviour |
| `orchestrators/orchestrator.spawning.town.ts` | What the town spawns next |
