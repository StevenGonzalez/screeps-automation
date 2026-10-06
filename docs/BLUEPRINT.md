# The Blueprint: a Castle Planned for Every Age

Each owned room has one plan, the **blueprint**, for every structure and
road it will ever have at RCL 8. The plan is laid out once against the real
terrain and kept in memory. Every entry carries the RCL at which it is built,
called its **age**. Each time the controller levels up, the next age unlocks
and the castle grows into the plan. Nothing is placed that a later age has to
tear down.

The code is in `src/planning/planner.blueprint.ts`. Tests run it against
the terrain of ten real rooms in `test/fixtures/blueprint.rooms.json`, most of
them full of walls. The live castle W48S8 is one of them.

## The ages

| RCL | Age | What it brings |
|---|---|---|
| 1 | Founding | The first spawn |
| 2 | Palisade | The first extensions, the source and controller containers, and trunk roads |
| 3 | Watchtower | The first tower and more extensions |
| 4 | Keep | Storage |
| 5 | Linked Halls | The storage link and the far source's link, and a second tower |
| 6 | Alchemy | Terminal, the first labs, the controller link, the extractor and mineral container, and the mineral road |
| 7 | Kingdom | The second spawn, the factory, more labs, a third tower and the near source's link |
| 8 | Empire | The third spawn, the observer, power spawn, nuker, the last labs and towers |

That is the order for a new room. The exact split follows the engine's limits
per RCL (`CONTROLLER_STRUCTURES`), so no age ever plans more of a type than the
engine allows. In a room that already has buildings, the ones standing take
the first slots, so a link or tower that exists is counted in the earliest age.

## The keep

Every castle is built around the **keep**, a square of 13 by 13 tiles
centred on the first spawn (`src/planning/planner.stamp.ts`). It is the same
on its left and right. Rings of buildings alternate with rings of road, so
every building has a road beside it:

```
+eeeeeBeeeee+      S spawn       O storage    M terminal
e+++++++++++e      F factory     P power spawn
e+Teee+eeeT+e      N nuker       B observer   K storage link
e+e+++++++e+e      T tower       L lab        e extension
e+e++FMP++e+e      + road
e+e+e+++e+e+e
T+++S+S+S+++T      The three spawns stand in a row across the middle,
e+e+e+++e+e+e      with storage below and the terminal above. Walkers
e+e++KON++e+e      cross between the rings at the middle of the top and
e+e+++++++e+e      of each side, and leave the keep at its four corners.
e+TeLLLLLeT+e      The ten labs stand in two rows of five with a road
e+++++++++++e      between them; the two in the middle reach all the
+eeeLLLLLeee+      others.
```

The keep holds all 60 extensions, so on open ground the whole castle fits
inside it. Its outer row of buildings stands as the castle's wall. Each age
keeps the keep balanced where the count allows: the second and third spawns
flank the first, the first two towers guard the top corners, the first three
labs stand in the middle of the upper row, and extensions come in mirrored
pairs.

## How the plan is laid out

Each step works around everything placed before it.

1. **What already stands.** Spawns, storage, terminal, towers, labs, links,
   factory, power spawn, nuker and observer stay where they are. Walls,
   sources, the mineral and the controller are solid. In a new room the
   first spawn goes where most of the keep lands on open ground, close to
   the sources and the controller. Every tile to them counts against a
   spot, since haulers walk it for as long as the room stands.
2. **Storage.** Storage is the hub every road starts from.
3. **Labs.** In a room with no labs, the labs take the keep's two lab rows
   if they fit. Otherwise ten labs go on a 4x4 "flower" with a road on one
   diagonal, where it keeps the most labs already built. Two labs reach all
   the others.
4. **The keep** around the first spawn. Its extension and lab cells are saved
   for step 6, and roads pay to cross them, so they go round by the keep's
   own walkways. A keep cell that lands on a wall is not squeezed in nearby.
   It goes to step 6 instead.
5. **Trunk roads** run from storage to each source, the controller, the mineral
   and each side of the room that has exits. Each trunk ends in a container,
   plus a link except at the mineral. Where the ground around a container is
   all taken, as when two sources stand side by side, its link may take a
   tile of the ground kept clear for working, if that cuts nothing off.
   Later trunks reuse earlier ones, and trunks route around standing
   extensions. Every road pays a little for each bend, more the sharper it
   is, so roads run in long straight lines and turn gently, like a cart
   road, instead of zigzagging. A road takes a short detour to stay
   straight, never a long one. Where a trunk passes right beside the
   mineral, its container sits on the road.
6. **Everything else**, extensions last. First the keep's saved cells, then
   rings beyond the keep that carry on its pattern out to 10 tiles from the
   first spawn: every odd ring is road, and so are the eight spokes out from
   the first spawn. A ring tile that is near on the map but a long walk
   round a wall is skipped. The rings fill nearest first. In each ring,
   extensions already standing keep their tiles first, then extensions go
   in pairs mirrored across the keep's middle. A tile whose mirror already
   holds a building goes in alone, as does one whose mirror is lost to a
   wall, once the ring's pairs are placed. Only when the rings are full do
   the last go on a diagonal lattice further out, so every building
   touches a walkway.
7. **Roads.** The keep's walkways are paved beside each of its buildings
   from RCL 3, and the rings' walkways beside each building in the rings.
   The road around the keep is laid only beside buildings out in the rings.
   Beyond that, a road is built only on the cheapest walk from storage to a
   building, bends counted as in step 5. Other walkway tiles stay bare
   ground.

**No build is cut off by a wall.** Each placement is checked before it is
accepted. The planner rejects a building if it would leave any of these
unreachable from storage:

- the building itself;
- any walkway or trunk road;
- any building placed before it.

Nothing is placed on a wall or next to the room edge.

## What the live room does with it

The structure pass runs every 50 ticks, in `processRoomStructures`:

1. **Plan** when the room has no blueprint, when the planner's version
   changed, or when no spawn stands on the plan's anchor. A new plan also
   re-plans the defensive ring.
2. **Materialize.** Every entry the room's age has unlocked goes into
   `plannedStructures`, under the usual keys (`stamp_extensions`,
   `link_source_<id>`, `road_blueprint` and so on). This replaces whatever
   older planners put there. The ring (`stamp_walls` and `stamp_ramparts`),
   the ramparts over buildings and the town's keys are kept. A source that is not safe
   (a keeper or an invader core) gets no container or link until it is.
3. **Clear the way.** At most one structure per pass is torn down, and none
   while enemies are in the room:
   - a structure standing on a tile where an unlocked building is planned, or
   - an extension, lab, link or container built off the plan, when the type is
     at its cap and a planned one is waiting. The one farthest from storage
     goes first.
4. **Perimeter and town.** The min-cut ring wraps the blueprint's buildings at
   RCL 8, so it does not creep outward as the castle grows. The town keeps off
   the blueprint's tiles, and the blueprint keeps off the town's tiles.
5. **Walls and doors.** The ring is built of walls, which do not decay. Where
   a blueprint road of any age or an exit road crosses the ring, it gets a
   rampart instead, so our creeps can pass. When nothing else was torn down
   this pass, one ring tile is swapped to what the plan wants: a rampart
   under 100,000 hits where a wall is planned, or a wall where a door is now
   needed. Stronger ramparts are kept.

Construction (`applyPlannedConstruction`) then builds what is missing, in
the usual priority order.

## Roads

Only the blueprint's roads are repaired. Two exceptions are kept up as well:

- the exit roads to sides with a worked remote;
- in rooms with no blueprint (remotes), every road.

Every other road is left to decay and disappears on its own. In W48S8 this
cuts the roads kept up from 471 to about 115.

## Memory

`room.memory.blueprint` holds the plan in compact form:

```
{ v, at, anchor, hub, s: "S25,25,1;E24,24,2;...", exits: { top: "x,y;..." }, lanes: ["top"] }
```

Each entry in `s` is a type letter, then x, y and age, and a tag for the
containers, links and extractor that serve a source, the controller, the
mineral or storage. The whole plan is a few kilobytes. It is decoded once and
kept on the heap until it changes.

## Console

| Command | Does |
|---|---|
| `Game.arca.blueprint('W1N1')` | Lists what each age brings and how much of it stands, and how many roads are left to decay. Draws the plan in the room for 50 ticks, coloured by age |
| `Game.arca.blueprint('W1N1', 'replan')` | Forgets the plan; the next tick plans the room afresh around what stands |

Raising `BLUEPRINT_VERSION` in `planner.blueprint.ts` re-plans every room on
the next deploy.
