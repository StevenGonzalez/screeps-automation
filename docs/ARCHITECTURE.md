# ARCA Architecture

## Overview

**"From the gates of Lorencia, the empire stretches to the farthest dungeon."**

ARCA is the central intelligence of Lorencia, a Screeps automation system built around a medieval fantasy empire theme. Peasants and miners work the earth, scholars and masons build the cities, and knights and wizards defend the realm.

### Core Philosophy
- **Distributed Intelligence**: Each Stronghold operates autonomously while coordinating with ARCA
- **Hierarchical Command**: Warlords manage specialized Hero teams for specific objectives
- **Dynamic Response**: Crusades allow flag-based strategic intervention
- **Efficient Execution**: Optimized three-phase execution (Build → Init → Run)

---

## Architecture Components

### ARCA _(planned)_
The central AI coordinator. Manages all Strongholds, coordinates Warlords across rooms, processes Crusades, and monitors global performance.

### Stronghold _(planned)_
Colony manager for a single owned room. Each Stronghold manages structures, spawns and coordinates Warlords, and determines the room's operational phase (bootstrap → developing → established → powerhouse).

### Warlord _(planned)_
Specialized creep controllers that manage teams of Heroes. Named after their role in Lorencia:

| Warlord | Responsibility |
|---------|---------------|
| **Harvest** | Energy harvesting at sources |
| **Caravan** | Resource logistics and hauling |
| **Forge** | Building and repairing structures |
| **Wizard** | Controller upgrading |
| **Rage** | Mineral mining (RCL 6+) |
| **Guild** | Terminal trading (RCL 6+) |
| **Blade Knight** | Defensive melee combat |
| **High Elf** | Defensive healing support |
| **Dark Lord** | Offensive combat operations |
| **Slayer** | Remote room defense |
| **Lancer** | Settler expansion |
| **Raider** | PowerBank assault |

### Hero _(planned)_
Enhanced creep wrapper providing smart movement, task management, boosting, and a unified creep control interface.

### Crusade _(planned)_
Flag-based directive system for dynamic strategic response: room claiming, defense operations, resource extraction, strategic objectives.

---

## Execution Model

ARCA uses a three-phase execution model each tick:

**Phase 1 — Build**: Construct the world state. Clean memory, create Stronghold objects, build Warlords, parse flags into Crusades.

**Phase 2 — Init**: Initialize systems. Strongholds initialize Warlords, Warlords refresh Hero teams and calculate spawn needs, Crusades initialize objectives.

**Phase 3 — Run**: Execute all operations. Warlords direct Heroes, Crusades execute strategies, structures perform automated tasks.

**Phase 4 — End of Tick**: Update stats, generate visuals, report performance metrics.

---

## Terminology

Lorencia is the seat of power — the first owned room, and the heart from which the empire grows. Frontier colonies are outposts carved from the wilderness: Devias in the frozen wastes, Noria deep in the forest, Atlans beneath the depths. ARCA is the intelligence that binds them all.

| Component | Description |
|-----------|-------------|
| **ARCA** | Central AI coordinator |
| **Stronghold** | Room/colony manager |
| **Warlord** | Creep team controller |
| **Hero** | Enhanced individual creep |
| **Crusade** | Flag-based strategic directive |
| **Sanctum** | Structure group manager |
| **War Council** | Combat target scanning and squad management |

---

## Core Sanctums _(planned)_

| Sanctum | Purpose | RCL |
|---------|---------|-----|
| **MiningSanctum** | Energy harvesting | 1 |
| **CommandSanctum** | Spawn queue and commands | 1 |
| **DefenseSanctum** | Tower coordination | 1 |
| **IntelSanctum** | Remote room scanning | 3+ |
| **LinkSanctum** | Instant energy transfer | 5+ |
| **ChaosSanctum** | Compound production | 6+ |
| **EnchantSanctum** | Creep boosting | 6+ |
| **PowerSanctum** | PowerBank harvesting | 8 |

---

## Castle Architecture of Lorencia

Automatic structure placement follows Lorencia's castle district layout:

**THE KEEP** — Storage at the castle heart (treasury). Terminal, Factory, Power Spawn form a cross around it.

**LORDS' BASTIONS** — 3 spawns in a triangle: Lord of the Gate (north), Lord of the Market (SW), Lord of the Dungeon (SE).

**MERCHANT RINGS** — Extensions in concentric hexagonal rings representing the city districts. Inner ring: noble quarter; middle: craftsmen's ward; outer: commoner streets.

**SENTINEL TOWERS** — 6 towers form a protective ring at the six cardinal points of the city wall with overlapping fields of fire.

**APOTHECARY'S QUARTER** — Labs in a tight cluster optimized for compound reaction chains. Central reagent labs surrounded by reaction labs.

Toggle layout visualization with `Game.arca.showPlan()`.

---

## Current Source Structure

```
src/
├── main.ts                         # Entry point, CPU budget management
├── console.ts                      # Game.arca.* console API
├── types.d.ts                      # Global type declarations
├── config/
│   ├── config.roles.ts             # Creep role constants and deposit priorities
│   ├── config.spawning.ts          # Body patterns and spawn energy reserve
│   └── config.structures.ts        # Structure planner configuration
├── orchestrators/
│   ├── orchestrator.creep.ts       # Dispatches creep roles each tick (lookup map)
│   ├── orchestrator.spawning.ts    # Spawn priority logic per room
│   ├── orchestrator.structures.ts  # Structure placement and road planning
│   ├── orchestrator.tower.ts       # Tower targeting + safe-mode triggers
│   ├── orchestrator.links.ts       # Link energy distribution
│   ├── orchestrator.labs.ts        # Compound reaction chains
│   ├── orchestrator.terminal.ts    # Mineral selling via market orders
│   ├── orchestrator.military.ts    # Offensive squad coordination
│   ├── orchestrator.observer.ts    # Observer scanning queue
│   ├── orchestrator.memory.ts      # Memory cleanup and ID caching
│   ├── orchestrator.visuals.ts     # Room visuals
│   └── orchestrator.pixels.ts      # Pixel generation
├── roles/
│   ├── role.harvester.ts           # peasant — early energy gathering
│   ├── role.miner.ts               # miner — stationary source miner
│   ├── role.hauler.ts              # porter — energy logistics
│   ├── role.upgrader.ts            # scholar — controller upgrading
│   ├── role.builder.ts             # mason — construction
│   ├── role.repairer.ts            # blacksmith — structure repair
│   ├── role.mineral_miner.ts       # prospector — mineral extraction
│   ├── role.apothecary.ts          # apothecary — lab compound logistics
│   ├── role.scout.ts               # ranger — room scouting
│   ├── role.remote_miner.ts        # outrider — remote source mining
│   ├── role.remote_hauler.ts       # peddler — remote energy hauling
│   ├── role.reserver.ts            # herald — remote room reservation
│   ├── role.conqueror.ts           # conqueror — room claiming
│   ├── role.settler.ts             # settler — new-room bootstrap
│   ├── role.knight.ts              # knight — defensive melee
│   ├── role.wizard.ts              # wizard — defensive ranged
│   ├── role.cleric.ts              # cleric — defensive healing
│   ├── role.tower.ts               # tower targeting + safe-mode helpers
│   ├── role.powerattacker.ts       # breacher — PowerBank assault
│   ├── role.powerhealer.ts         # battlepriest — PowerBank squad healing
│   └── role.powercarrier.ts        # caravan — power collection
├── planning/
│   ├── planner.stamp.ts            # Castle stamp layout generation
│   └── planner.room.ts             # Road planning and structure placement
└── services/
    ├── services.memory.ts          # Room memory helpers
    ├── services.creep.ts           # Creep utility functions + shared find caches
    ├── services.combat.ts          # Threat scoring and severity
    ├── services.labs.ts            # Compound stock helpers
    └── services.structures.ts      # Structure planning helpers
```

---

## Military Systems _(planned)_

- **War Council**: Scans nearby rooms for attack targets, evaluates threat levels
- **Dark Lord**: Coordinates attack/healer squads for offensive operations
- **Blade Knight**: Defensive melee combat operations
- **High Elf**: Defensive healing support (pairs with Knights during high-threat scenarios)
- **Raider**: PowerBank assault and collection operations
