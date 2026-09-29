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

## How the plan is laid out

Each step works around everything placed before it.

1. **What already stands.** Spawns, storage, terminal, towers, labs, links,
   factory, power spawn, nuker and observer stay where they are. Walls,
   sources, the mineral and the controller are solid.
2. **Storage.** Storage is the hub every road starts from.
3. **Labs.** Ten labs go on a 4x4 "flower" with a road on one diagonal. Two
   labs reach all the others. The flower goes where it keeps the most labs
   already built.
4. **The castle stamp** around the first spawn. A stamp cell that lands on a
   wall is not squeezed in nearby. It goes to step 6 instead.
5. **Trunk roads** run from storage to each source, the controller, the mineral
   and each side of the room that has exits. Each trunk ends in a container,
   plus a link except at the mineral. Later trunks reuse earlier ones, and
   trunks route around standing extensions.
6. **Everything else**, extensions last, goes on the nearest free tiles of a
   diagonal lattice, so every building touches a walkway. Extensions that
   already stand are placed first.
7. **Roads.** A road is built only on the shortest walk from storage to a
   building. Other walkway tiles stay bare ground.

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
   older planners put there. The ring (`stamp_ramparts`), the ramparts over
   buildings and the town's keys are kept. A source that is not safe
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
