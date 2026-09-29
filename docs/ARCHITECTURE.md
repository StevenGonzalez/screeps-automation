# Architecture

## Overview

**"By decree of the crown, this room now flies our banner."**

This is a Screeps automation bot built around a small MU-style kingdom where every owned room is a castle.
Villagers and miners gather the energy, enchanters and masons build up the keep,
and dragon knights and dark wizards deal with anything that comes near the walls. The flavor is medieval;
the architecture is a flat, pragmatic set of per-system loops - no central AI
object, no class hierarchy.

### Core Philosophy
- **Flat orchestrators, not an OOP hierarchy.** Each game system is a plain
  module exporting a `loop()`. `main.ts` runs them in order, each wrapped in a
  try/catch so one failing system can't take down the tick.
- **Roles are behavior, orchestrators are policy.** A role file (`roles/role.*.ts`)
  decides what one creep does this tick; an orchestrator decides what gets
  spawned, built, produced, traded, or attacked.
- **Services are shared helpers.** Threat scoring, lab stock math, movement, and
  structure-planning helpers live in `services/` and are imported wherever needed.
- **CPU-aware execution.** Expensive, non-critical systems (structure planning,
  visuals) are skipped when the tick is already loaded or the bucket is drained.

---

## Execution Model

`main.ts` runs every system through a `runSafe(name, fn)` wrapper that catches and
logs any thrown error. The order matters - some systems intentionally run after
others (e.g. the factory and nuker borrow an idle hauler *after* the creep
orchestrator has dispatched roles, so their move/transfer intents win for the tick).

The loop is gated by two CPU mechanisms:
- **Structure planning** (heavy pathfinding) is skipped when CPU used so far this
  tick is above 70% of `cpu.limit`, or when the bucket is below 2000.
- **Visuals** (cosmetic) are skipped above 60% of `cpu.limit`, or when the bucket
  is critical.

Run order each tick (from `main.ts`):

1. `memory` - memory cleanup + per-room ID caching + deep-scout BFS queue
2. `strategy` - sets empire-wide posture (EXPAND/TURTLE/WAR/RECOVER) the rest of the tick reads
3. `allies` - refresh SimpleAllies identity + exchange ally segment requests (before combat)
4. `expansion` - GCL-driven claiming + multi-factor room scoring + expansion queue
5. `creeps` - dispatch every creep to its role handler
6. `spawning` - per-room spawn priority
7. `structures` - core stamp / road / min-cut rampart-perimeter planning *(CPU-gated)*
8. `labs` - reaction chains, T4 auto-production, boosting
9. `factory` - commodity production incl. deep Tier 3-5 chains (borrows a hauler as a courier)
10. `links` - link energy distribution
11. `towers` - tower targeting + safe-mode triggers (conservation-aware)
12. `terminal` - market making (sell orders), energy trading, inter-room balancing
13. `military` - value-based WarCouncil, DefenseCouncil, formation offense + queue
14. `nukes` - **defense** against incoming nukes (rampart reinforcement + terminal evac)
15. `nuker` - **offensive** nuker loading (energy + ghodium)
16. `sourcekeeper` - Source Keeper room mining ops
17. `powercreep` - per-room Operator spawning + power use (REGEN_SOURCE etc.)
18. `observer` - highway power-bank scanning + power-spawn processing
19. `pixels` - pixel generation from spare CPU
20. `visuals` - room visuals *(CPU-gated)*

A side-effect import of `services/services.movement` installs a traffic-managed
`moveTo` override on `Creep.prototype` before the loop runs.

---

## Console API

The bot exposes a console namespace at `Game.arca.*` (set up by `console.ts`).
See [QUICKSTART.md](QUICKSTART.md) for the full command list. There is no
`Game.arca.showPlan()`, `intel()`, `threats()`, or `sendEnergy()` - those were
never built. The real commands include `expand`, `queueExpand`, `claim`,
`status`, `ops`, `labs`, `produce`, `network`, `attack`, `squads`, `warcouncil`,
`threat`, `nukes`, `nuker`, `launchNuke`, `factory`, `sk`, `power`, `deposits`,
`town`, `razeTown`, `blueprint`, and more.

---

## The Castle Layout

Automatic structure placement follows a castle layout
(`planning/planner.stamp.ts`), fitted to each room's terrain by the blueprint
planner (`planning/planner.blueprint.ts`). The blueprint plans every structure
and road up to RCL 8 at once, and each RCL unlocks the next "age" of it. See
[BLUEPRINT.md](BLUEPRINT.md).

**THE VAULT** - Storage at the heart of the base (where the zen is). Terminal, Factory,
Power Spawn, Nuker, and Observer sit around it.

**THE GREAT HALL** - Spawns placed within the stamp, where new subjects are sworn in.

**THE VILLAGE** - Extensions in concentric rings around the vault,
growing outward as RCL rises.

**WATCHTOWERS** - Towers placed around the vault (count scales with RCL: 1 at
RCL 3, up to 6 at RCL 8) for overlapping fields of fire.

**THE CHAOS MACHINE** - Labs clustered so reaction chains stay in range.

### Defense layers

- **On-top ramparts.** The stamp drops a rampart on top of every key structure
  (spawns, storage, towers, labs, terminal, factory, nuker, power spawn,
  observer, containers) so a nuke can't one-shot them.
- **Defensive perimeter** (`planning/planner.rampart.ts`). At RCL 4+ a **min-cut**
  rampart wall is computed (`services/services.mincut.ts`, max-flow/min-cut on the
  50x50 grid) to seal the core structures (the blueprint's buildings at RCL 8,
  plus the controller when it sits near the vault) from the room exits with the
  *fewest* tiles - concentrating HP on far fewer ramparts than a bounding box. It
  hugs natural walls automatically and re-plans only every ~1500 ticks. If the
  min-cut is degenerate (already sealed by terrain), it falls back to the old
  padded bounding-box ring so a room is never left wall-less. Stored under the
  stamp-rampart memory key, inheriting the existing build priority (raised site cap)
  and the normal rampart repair/tower upkeep.
- **Nuke defense** (`orchestrators/orchestrator.nukes.ts`). Reinforces ramparts
  on impact tiles when an incoming nuke is detected. Distinct from the *offensive*
  nuker (see [NUKER_SYSTEM.md](NUKER_SYSTEM.md)).
- **The town quarter** (`planning/planner.town.ts`). At RCL 6+ watch posts sit
  behind the ring at each exit side, and at RCL 7+ cottages house an archer
  militia that mans the ramparts in a raid. See [TOWN_SYSTEM.md](TOWN_SYSTEM.md).
- **Standing defense** (DefenseCouncil in `orchestrator.military.ts`). Auto-raises
  a defensive squad when an owned room is meaningfully threatened. See
  [MILITARY_GUIDE.md](MILITARY_GUIDE.md).

---

## Current Source Structure

```
src/
+-- main.ts                          # Entry point: run order + CPU budgeting
+-- console.ts                       # Game.arca.* console API
+-- types.d.ts                       # Global type declarations
+-- config/
|   +-- config.roles.ts              # Role-name constants + deposit priorities
|   +-- config.spawning.ts           # Body patterns and spawn energy reserve
|   +-- config.structures.ts         # Stamp / planner config, perimeter, towers
|   +-- config.factory.ts            # Commodity tiers + factory tunables
|   +-- config.town.ts               # Town quarter gates, day phases, cottage names
+-- orchestrators/
|   +-- orchestrator.creep.ts        # Dispatches creep roles each tick (lookup map)
|   +-- orchestrator.spawning.ts     # Spawn priority logic per room
|   +-- orchestrator.spawning.town.ts # Townsfolk spawning (militia + lookouts)
|   +-- orchestrator.structures.ts   # Stamp + road + rampart-perimeter planning
|   +-- orchestrator.tower.ts        # Tower targeting + safe-mode triggers
|   +-- orchestrator.links.ts        # Link energy distribution
|   +-- orchestrator.labs.ts         # Reaction chains, T4 auto-production, boosting
|   +-- orchestrator.factory.ts      # Commodity production (borrowed courier)
|   +-- orchestrator.terminal.ts     # Market trades + inter-room energy/mineral/ghodium balancing
|   +-- orchestrator.military.ts     # WarCouncil, DefenseCouncil, offensive squads + queue
|   +-- orchestrator.nukes.ts        # DEFENSE: incoming-nuke rampart reinforcement
|   +-- orchestrator.nuker.ts        # OFFENSE: keep our nuker loaded (energy + ghodium)
|   +-- orchestrator.sourcekeeper.ts # Source Keeper room mining operations
|   +-- orchestrator.powercreep.ts   # Power creep spawning + power usage
|   +-- orchestrator.observer.ts     # Highway power-bank scan + power-spawn processing
|   +-- orchestrator.expansion.ts    # GCL-driven claiming + multi-factor room scoring + queue
|   +-- orchestrator.strategy.ts     # Central posture coordinator (EXPAND/TURTLE/WAR/RECOVER)
|   +-- orchestrator.memory.ts       # Memory cleanup, ID caching, deep-scout BFS + intel/player model
|   +-- orchestrator.visuals.ts      # Room visuals
|   +-- orchestrator.pixels.ts       # Pixel generation
+-- roles/
|   +-- role.harvester.ts            # villager - early energy gathering
|   +-- role.miner.ts                # miner - stationary source miner
|   +-- role.hauler.ts               # porter - energy logistics
|   +-- role.filler.ts               # barmaid - storage -> keep-core distribution (RCL 4+)
|   +-- role.upgrader.ts             # enchanter - controller upgrading
|   +-- role.builder.ts              # mason - construction
|   +-- role.repairer.ts             # blacksmith - structure repair
|   +-- role.mineral_miner.ts        # jeweler - mineral extraction
|   +-- role.apothecary.ts           # goblin - lab compound logistics
|   +-- role.scout.ts                # raven - room scouting
|   +-- role.remote_miner.ts         # wanderer - remote source mining
|   +-- role.remote_hauler.ts        # merchant - remote energy hauling
|   +-- role.reserver.ts             # envoy - remote room reservation
|   +-- role.conqueror.ts            # darklord - room claiming
|   +-- role.settler.ts              # pilgrim - new-room bootstrap
|   +-- role.knight.ts               # dragonknight - melee (offense + defense)
|   +-- role.wizard.ts               # darkwizard - ranged (offense + defense)
|   +-- role.cleric.ts               # fairyelf - healing (offense + defense)
|   +-- role.sieger.ts               # ragefighter - boosted dismantler/breacher
|   +-- role.tower.ts                # tower targeting + safe-mode helpers
|   +-- role.sk_miner.ts             # Source Keeper room miner
|   +-- role.sk_hauler.ts            # Source Keeper room hauler
|   +-- role.sk_guardian.ts          # Source Keeper killer / guardian
|   +-- role.powerattacker.ts        # blademaster - PowerBank assault
|   +-- role.powerhealer.ts          # museelf - PowerBank squad healing
|   +-- role.powercarrier.ts         # looter - power collection
|   +-- role.depositminer.ts         # nomad - highway deposit harvesting
|   +-- role.deposithauler.ts        # caravan - highway deposit hauling
|   +-- role.townsfolk.ts            # townsfolk - militia archers + lookouts
+-- planning/
|   +-- planner.stamp.ts             # Core stamp layout generation
|   +-- planner.blueprint.ts         # The room's plan for every RCL: structures, roads, ages
|   +-- planner.rampart.ts           # Defensive rampart perimeter (RCL 4+)
|   +-- planner.town.ts              # Town quarter: watch posts, square, cottages (RCL 6+)
+-- services/
    +-- services.memory.ts           # Room memory helpers
    +-- services.creep.ts            # Creep utilities + shared find caches
    +-- services.combat.ts           # Boost-aware threat scoring, target/formation/breach helpers
    +-- services.allies.ts           # SimpleAllies diplomacy (ally list + segment requests)
    +-- services.mincut.ts           # Min-cut max-flow utility (defensive wall planning)
    +-- services.labs.ts             # Compound stock + reaction-chain helpers
    +-- services.structures.ts       # Structure planning helpers
    +-- services.movement.ts         # Traffic-managed moveTo override (heap path/stuck cache) + civilian shelter
    +-- services.coordination.ts     # Per-tick fill-target claims + hauler-to-worker energy handoff
    +-- services.town.ts             # Town clock, cottage geometry, parking-spot claims
```

---

## Role-name mapping

The castle titles map to plain Screeps roles. The left column is what shows up
in creep names and `Game.arca` output; the right is what it does.

| Name | Role file | Responsibility |
|------|-----------|----------------|
| **villager** | `role.harvester.ts` | Early energy gathering (phases out once miners are up) |
| **miner** | `role.miner.ts` | Stationary source miner on a container |
| **porter** | `role.hauler.ts` | Source -> storage hauling (fills the keep core directly until a barmaid exists; also borrowed by factory/nuker as a courier) |
| **barmaid** | `role.filler.ts` | Distributes storage energy to spawn/extensions/towers; spawned once storage exists (RCL 4+) |
| **enchanter** | `role.upgrader.ts` | Controller upgrading |
| **mason** | `role.builder.ts` | Construction |
| **blacksmith** | `role.repairer.ts` | Structure repair |
| **jeweler** | `role.mineral_miner.ts` | Mineral extraction (RCL 6+) |
| **goblin** | `role.apothecary.ts` | Lab reagent/product logistics + boosting |
| **raven** | `role.scout.ts` | Adjacent-room scouting |
| **wanderer** | `role.remote_miner.ts` | Remote source mining |
| **merchant** | `role.remote_hauler.ts` | Remote energy hauling |
| **envoy** | `role.reserver.ts` | Remote controller reservation |
| **darklord** | `role.conqueror.ts` | Room claiming |
| **pilgrim** | `role.settler.ts` | New-room bootstrap |
| **dragonknight** | `role.knight.ts` | Melee (offensive squads + home defense) |
| **darkwizard** | `role.wizard.ts` | Ranged kiter (offensive squads + home defense) |
| **fairyelf** | `role.cleric.ts` | Healer (offensive squads + home defense) |
| **ragefighter** | `role.sieger.ts` | Boosted dismantler / rampart breacher |
| **blademaster** | `role.powerattacker.ts` | PowerBank assault |
| **museelf** | `role.powerhealer.ts` | PowerBank squad healing |
| **looter** | `role.powercarrier.ts` | Power collection |
| **nomad** | `role.depositminer.ts` | Highway deposit harvesting (silicon/metal/biomass/mist) |
| **caravan** | `role.deposithauler.ts` | Highway deposit hauling home |
| **townsfolk** | `role.townsfolk.ts` | Town militia (watch posts by day, cottage beds by night, ramparts in a raid) and lookouts in neighbouring rooms |

(Source Keeper roles: **delver** (`role.sk_miner.ts`), **packmule** (`role.sk_hauler.ts`),
**lancer** (`role.sk_guardian.ts`). The season-only score chaser is **seeker** (`role.scoreHunter.ts`).)

---

## Further Reading

- [QUICKSTART.md](QUICKSTART.md) - getting started + full console command list
- [LAB_SYSTEM.md](LAB_SYSTEM.md) - compound production and boosting
- [FACTORY_SYSTEM.md](FACTORY_SYSTEM.md) - commodity production
- [TERMINAL_NETWORK.md](TERMINAL_NETWORK.md) - market trading + inter-room balancing
- [EXPANSION_SYSTEM.md](EXPANSION_SYSTEM.md) - autonomous claiming + expansion queue
- [MILITARY_GUIDE.md](MILITARY_GUIDE.md) - offense, defense, WarCouncil/DefenseCouncil
- [NUKER_SYSTEM.md](NUKER_SYSTEM.md) - offensive nuker loading + launch
- [OBSERVER_SYSTEM.md](OBSERVER_SYSTEM.md) - scouting + observer power-bank hunting
- [CPU_OPTIMIZATION.md](CPU_OPTIMIZATION.md) - performance tuning
- [TOWN_SYSTEM.md](TOWN_SYSTEM.md) - the town quarter, its cottages and townsfolk
