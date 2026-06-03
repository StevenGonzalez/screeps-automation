# Architecture

## Overview

**"From the gates of Lorencia, the empire stretches to the farthest dungeon."**

This is a Screeps automation bot built around a medieval fantasy empire theme.
Peasants and miners work the earth, scholars and masons build the cities, and
knights and wizards defend the realm. The flavor is medieval; the architecture
is a flat, pragmatic set of per-system loops — no central AI object, no class
hierarchy.

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
logs any thrown error. The order matters — some systems intentionally run after
others (e.g. the factory and nuker borrow an idle hauler *after* the creep
orchestrator has dispatched roles, so their move/transfer intents win for the tick).

The loop is gated by two CPU mechanisms:
- **Structure planning** (heavy pathfinding) is skipped when CPU used so far this
  tick is above 70% of `cpu.limit`, or when the bucket is below 2000.
- **Visuals** (cosmetic) are skipped above 60% of `cpu.limit`, or when the bucket
  is critical.

Run order each tick (from `main.ts`):

1. `memory` — memory cleanup + per-room ID caching
2. `expansion` — GCL-driven claiming + bootstrap lifecycle + expansion queue
3. `creeps` — dispatch every creep to its role handler
4. `spawning` — per-room spawn priority
5. `structures` — castle stamp / road / rampart-perimeter planning *(CPU-gated)*
6. `labs` — reaction chains, T4 auto-production, boosting
7. `factory` — commodity production (borrows a hauler as a courier)
8. `links` — link energy distribution
9. `towers` — tower targeting + safe-mode triggers
10. `terminal` — mineral sell/buy, energy/mineral/ghodium inter-room balancing
11. `military` — WarCouncil intel, DefenseCouncil, offensive squads + queue
12. `nukes` — **defense** against incoming nukes (rampart reinforcement)
13. `nuker` — **offensive** nuker loading (energy + ghodium)
14. `sourcekeeper` — Source Keeper room mining ops
15. `powercreep` — power creep (Operator) spawning + power use
16. `observer` — highway power-bank scanning + power-spawn processing
17. `pixels` — pixel generation from spare CPU
18. `visuals` — room visuals *(CPU-gated)*

A side-effect import of `services/services.movement` installs a traffic-managed
`moveTo` override on `Creep.prototype` before the loop runs.

---

## Console API

The bot exposes a console namespace at `Game.arca.*` (set up by `console.ts`).
See [QUICKSTART.md](QUICKSTART.md) for the full command list. There is no
`Game.arca.showPlan()`, `intel()`, `threats()`, or `sendEnergy()` — those were
never built. The real commands include `expand`, `queueExpand`, `claim`,
`status`, `ops`, `labs`, `produce`, `network`, `attack`, `squads`, `warcouncil`,
`threat`, `nukes`, `nuker`, `launchNuke`, `factory`, `sk`, `power`, and more.

---

## Castle Architecture of Lorencia

Automatic structure placement (`planning/planner.stamp.ts`,
`planning/planner.room.ts`) follows a castle district layout:

**THE KEEP** — Storage at the castle heart (treasury). Terminal, Factory, Power
Spawn, Nuker, and Observer sit around it.

**LORDS' BASTIONS** — Spawns placed within the stamp.

**MERCHANT RINGS** — Extensions in concentric rings representing the city
districts, growing outward as RCL rises.

**SENTINEL TOWERS** — Towers placed around the keep (count scales with RCL: 1 at
RCL 3, up to 6 at RCL 8) for overlapping fields of fire.

**APOTHECARY'S QUARTER** — Labs clustered so reaction chains stay in range.

### Defense layers

- **On-top ramparts.** The stamp drops a rampart on top of every key structure
  (spawns, storage, towers, labs, terminal, factory, nuker, power spawn,
  observer, containers) so a nuke can't one-shot them.
- **Defensive perimeter** (`planning/planner.rampart.ts`). At RCL 4+ a continuous
  ring of ramparts is laid around the padded bounding box of all core structures
  (the castle stamp + Merchant Ring extensions), sealing the base against a ground
  assault. It uses a robust padded bounding-box ring rather than an exit min-cut,
  skips natural-wall tiles, and re-plans only every ~1500 ticks. The ring is stored
  under the stamp-rampart memory key, so it inherits the existing low build priority
  (after economy and roads) and the normal rampart repair/tower upkeep.
- **Nuke defense** (`orchestrators/orchestrator.nukes.ts`). Reinforces ramparts
  on impact tiles when an incoming nuke is detected. Distinct from the *offensive*
  nuker (see [NUKER_SYSTEM.md](NUKER_SYSTEM.md)).
- **Standing defense** (DefenseCouncil in `orchestrator.military.ts`). Auto-raises
  a defensive squad when an owned room is meaningfully threatened. See
  [MILITARY_GUIDE.md](MILITARY_GUIDE.md).

---

## Current Source Structure

```
src/
├── main.ts                          # Entry point: run order + CPU budgeting
├── console.ts                       # Game.arca.* console API
├── types.d.ts                       # Global type declarations
├── config/
│   ├── config.roles.ts              # Role-name constants + deposit priorities
│   ├── config.spawning.ts           # Body patterns and spawn energy reserve
│   ├── config.structures.ts         # Stamp / planner config, perimeter, towers
│   └── config.factory.ts            # Commodity tiers + factory tunables
├── orchestrators/
│   ├── orchestrator.creep.ts        # Dispatches creep roles each tick (lookup map)
│   ├── orchestrator.spawning.ts     # Spawn priority logic per room
│   ├── orchestrator.structures.ts   # Stamp + road + rampart-perimeter planning
│   ├── orchestrator.tower.ts        # Tower targeting + safe-mode triggers
│   ├── orchestrator.links.ts        # Link energy distribution
│   ├── orchestrator.labs.ts         # Reaction chains, T4 auto-production, boosting
│   ├── orchestrator.factory.ts      # Commodity production (borrowed courier)
│   ├── orchestrator.terminal.ts     # Market trades + inter-room energy/mineral/ghodium balancing
│   ├── orchestrator.military.ts     # WarCouncil, DefenseCouncil, offensive squads + queue
│   ├── orchestrator.nukes.ts        # DEFENSE: incoming-nuke rampart reinforcement
│   ├── orchestrator.nuker.ts        # OFFENSE: keep our nuker loaded (energy + ghodium)
│   ├── orchestrator.sourcekeeper.ts # Source Keeper room mining operations
│   ├── orchestrator.powercreep.ts   # Power creep spawning + power usage
│   ├── orchestrator.observer.ts     # Highway power-bank scan + power-spawn processing
│   ├── orchestrator.expansion.ts    # GCL-driven claiming + bootstrap lifecycle + queue
│   ├── orchestrator.memory.ts       # Memory cleanup and ID caching
│   ├── orchestrator.visuals.ts      # Room visuals
│   └── orchestrator.pixels.ts       # Pixel generation
├── roles/
│   ├── role.harvester.ts            # peasant — early energy gathering
│   ├── role.miner.ts                # miner — stationary source miner
│   ├── role.hauler.ts               # porter — energy logistics
│   ├── role.upgrader.ts             # scholar — controller upgrading
│   ├── role.builder.ts              # mason — construction
│   ├── role.repairer.ts             # blacksmith — structure repair
│   ├── role.mineral_miner.ts        # prospector — mineral extraction
│   ├── role.apothecary.ts           # apothecary — lab compound logistics
│   ├── role.scout.ts                # ranger — room scouting
│   ├── role.remote_miner.ts         # outrider — remote source mining
│   ├── role.remote_hauler.ts        # peddler — remote energy hauling
│   ├── role.reserver.ts             # herald — remote room reservation
│   ├── role.conqueror.ts            # conqueror — room claiming
│   ├── role.settler.ts              # settler — new-room bootstrap
│   ├── role.knight.ts               # knight — melee (offense + defense)
│   ├── role.wizard.ts               # wizard — ranged (offense + defense)
│   ├── role.cleric.ts               # cleric — healing (offense + defense)
│   ├── role.sieger.ts               # sapper — boosted dismantler/breacher
│   ├── role.tower.ts                # tower targeting + safe-mode helpers
│   ├── role.sk_miner.ts             # Source Keeper room miner
│   ├── role.sk_hauler.ts            # Source Keeper room hauler
│   ├── role.sk_guardian.ts          # Source Keeper killer / guardian
│   ├── role.powerattacker.ts        # breacher — PowerBank assault
│   ├── role.powerhealer.ts          # battlepriest — PowerBank squad healing
│   └── role.powercarrier.ts         # caravan — power collection
├── planning/
│   ├── planner.stamp.ts             # Castle stamp layout generation
│   ├── planner.room.ts              # Road planning and structure placement
│   └── planner.rampart.ts           # Defensive rampart perimeter (RCL 4+)
└── services/
    ├── services.memory.ts           # Room memory helpers
    ├── services.creep.ts            # Creep utilities + shared find caches
    ├── services.combat.ts           # Threat scoring, target/formation helpers
    ├── services.labs.ts             # Compound stock + reaction-chain helpers
    ├── services.structures.ts       # Structure planning helpers
    └── services.movement.ts         # Traffic-managed moveTo override
```

---

## Role-name mapping

The medieval names map to plain Screeps roles. The left column is what shows up
in creep names and `Game.arca` output; the right is what it does.

| Name | Role file | Responsibility |
|------|-----------|----------------|
| **peasant** | `role.harvester.ts` | Early energy gathering (phases out once miners are up) |
| **miner** | `role.miner.ts` | Stationary source miner on a container |
| **porter** | `role.hauler.ts` | Energy logistics (also borrowed by factory/nuker as a courier) |
| **scholar** | `role.upgrader.ts` | Controller upgrading |
| **mason** | `role.builder.ts` | Construction |
| **blacksmith** | `role.repairer.ts` | Structure repair |
| **prospector** | `role.mineral_miner.ts` | Mineral extraction (RCL 6+) |
| **apothecary** | `role.apothecary.ts` | Lab reagent/product logistics + boosting |
| **ranger** | `role.scout.ts` | Adjacent-room scouting |
| **outrider** | `role.remote_miner.ts` | Remote source mining |
| **peddler** | `role.remote_hauler.ts` | Remote energy hauling |
| **herald** | `role.reserver.ts` | Remote controller reservation |
| **conqueror** | `role.conqueror.ts` | Room claiming |
| **settler** | `role.settler.ts` | New-room bootstrap |
| **knight** | `role.knight.ts` | Melee (offensive squads + home defense) |
| **wizard** | `role.wizard.ts` | Ranged kiter (offensive squads + home defense) |
| **cleric** | `role.cleric.ts` | Healer (offensive squads + home defense) |
| **sapper** | `role.sieger.ts` | Boosted dismantler / rampart breacher |
| **breacher** | `role.powerattacker.ts` | PowerBank assault |
| **battlepriest** | `role.powerhealer.ts` | PowerBank squad healing |
| **caravan** | `role.powercarrier.ts` | Power collection |

(Source Keeper roles — sk_miner / sk_hauler / sk_guardian — keep their plain names.)

---

## Further Reading

- [QUICKSTART.md](QUICKSTART.md) — getting started + full console command list
- [LAB_SYSTEM.md](LAB_SYSTEM.md) — compound production and boosting
- [FACTORY_SYSTEM.md](FACTORY_SYSTEM.md) — commodity production
- [TERMINAL_NETWORK.md](TERMINAL_NETWORK.md) — market trading + inter-room balancing
- [EXPANSION_SYSTEM.md](EXPANSION_SYSTEM.md) — autonomous claiming + expansion queue
- [MILITARY_GUIDE.md](MILITARY_GUIDE.md) — offense, defense, WarCouncil/DefenseCouncil
- [NUKER_SYSTEM.md](NUKER_SYSTEM.md) — offensive nuker loading + launch
- [OBSERVER_SYSTEM.md](OBSERVER_SYSTEM.md) — scouting + observer power-bank hunting
- [CPU_OPTIMIZATION.md](CPU_OPTIMIZATION.md) — performance tuning
