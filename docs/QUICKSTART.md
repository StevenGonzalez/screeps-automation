# Quick Start Guide

Welcome to **the Bug Pile** - a Screeps bot themed around a colony of dumb little
bugs (nibblers and munchers gather the food, pokers and stackers build up the nest,
biters and spitters deal with trouble), but the architecture is plain: a set of
per-system `loop()` modules run in order from `main.ts`. There's no central AI
object or class hierarchy. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full picture.

## How It's Organized

```
main.ts  ->  runs each orchestrator in order, wrapped in try/catch (runSafe)
   +-- orchestrators/  per-system loops (spawning, structures, labs, military, ...)
   +-- roles/          per-creep behavior (one file per role)
   +-- services/       shared helpers (combat, labs, movement, structures)
   +-- planning/       stamp / road / rampart planners
   +-- config/         role names, spawn bodies, structure + factory config
```

## Getting Started

### 1. Build the Code

```bash
yarn build
```

### 2. Deploy to Screeps

```bash
yarn deploy        # Deploy to MMO
yarn deploy:sim    # Deploy to simulation
```

### 3. Watch the Colony Come to Life

The bot automatically spawns nibblers and munchers to gather energy, draggers to haul
it, pokers to upgrade the controller, and stackers to build as the colony
grows. It reports CPU and creep counts every 100 ticks.

## Creep Roster

| Name | Role | Notes |
|------|------|-------|
| **nibbler** | Early harvester | Gathers directly from sources; phases out once munchers are up |
| **muncher** | Stationary miner | Sits on a container at a source; maximizes WORK parts |
| **dragger** | Hauler | Hauls source energy to storage (fills the core directly until a stuffer exists); also borrowed by the factory and nuker as a courier |
| **stuffer** | Filler | Distributes energy from storage to spawns, extensions, and towers; appears once the room has storage (RCL 4+) |
| **poker** | Upgrader | Upgrades the controller to advance RCL |
| **stacker** | Builder | Constructs queued construction sites |
| **patcher** | Repairer | Repairs damaged structures |
| **gnawer** | Mineral miner | Extracts minerals for lab chains (RCL 6+) |
| **mixer** | Lab logistics | Loads lab reagents, drains product, boosts creeps |
| **wobbler** | Scout | Surveys adjacent rooms and records intel |
| **rover** | Remote miner | Mines sources in frontier rooms |
| **plodder** | Remote hauler | Carries remote energy back home |
| **squatter** | Reserver | Reserves remote controllers, doubling source yield |
| **sprawler** | Claimer | Claims new room controllers |
| **nester** | Bootstrapper | Establishes a freshly claimed room |
| **biter** | Melee | Offensive squads + home defense |
| **spitter** | Ranged | Offensive squads + home defense |
| **licker** | Healer | Offensive squads + home defense |
| **chewer** | Dismantler | Boosted breacher for fortified rooms |
| **basher / drooler / lugger** | PowerBank squad | Crack and collect power banks |

## Implemented Systems

### Economy & Logistics
- Adaptive spawn priorities: core economy first, remote roles after local stability
- Scaled creep bodies: bigger bodies when more energy is available
- Energy-emergency detection: shed non-critical spawns to recover
- Remote mining: lookouts scout -> stringers mine -> mules haul -> collectors reserve
- Traffic manager: stuck-repath + guarded shove (toggle with `Game.arca.traffic`)

### RCL 6+ / 7+ / 8 Systems
- **Links**: instant energy transfer (source -> storage -> controller)
- **Labs**: automatic compound production, multi-tier reaction chains, and boosting
- **Terminal network**: market trades + inter-room energy/mineral/ghodium balancing
- **Factory** (RCL 7+): commodity production with factory-level gating
- **Power**: power-bank hunting (via observer), power creeps, power-spawn processing
- **Nuker** (RCL 8): kept loaded automatically; manual launch only

### Military & Defense
- Offensive squads with 4 formations x 5 tactics, run concurrently (one per home room)
  plus an offensive queue
- WarCouncil: threat scanning + optional auto-attack on soft targets
- DefenseCouncil: auto-raises a standing defensive squad when an owned room is threatened
- Towers with priority targeting and automatic safe-mode activation
- Defensive rampart perimeter (RCL 4+) and incoming-nuke rampart reinforcement

### Intelligence & Expansion
- Lookouts survey adjacent rooms; collectors reserve frontier rooms
- Autonomous, GCL-driven expansion: ranks candidates, claims, bootstraps, and runs a
  multi-target expansion queue

## Console Commands (`Game.arca.*`)

### Expansion
```javascript
Game.arca.expand()                  // ranked expansion candidates from scout data
Game.arca.claim('W5N5')             // claim now
Game.arca.queueExpand('W5N5')       // add to the expansion pipeline
Game.arca.dequeueExpand('W5N5')     // remove a queued target
Game.arca.autoexpand(true)          // toggle auto-expansion
Game.arca.status()                  // active expansion + queue
Game.arca.cancel()                  // abort the active expansion
Game.arca.ops()                     // overview of all pipelines
```

### Labs & Factory
```javascript
Game.arca.labs()                    // lab status per room
Game.arca.produce('XUHO2', 3000)    // queue a compound
Game.arca.autoLabs('W1N1', true)    // toggle lab auto-production
Game.arca.factory()                 // factory status per room
Game.arca.produceCommodity('W1N1', 'battery')
Game.arca.autoFactory('W1N1', true) // toggle factory auto-production
```

### Terminal
```javascript
Game.arca.network()                 // per-room energy/mineral/pending-send status
```

### Military
```javascript
Game.arca.attack('W2N1')            // launch an offensive op (queues if home busy)
Game.arca.dequeueAttack('W2N1')     // remove a queued offensive target
Game.arca.squads()                  // active ops + offensive queue (alias: military())
Game.arca.formation('wedge')        // change formation (optionally per home room)
Game.arca.tactic('siege')           // change tactic (optionally per home room)
Game.arca.recall()                  // stand down ops (optionally per home room)
Game.arca.warcouncil(true)          // ranked enemy rooms + toggle auto-attack
```

### Defense & threats
```javascript
Game.arca.threat()                  // per-room threat severity, hostiles, safemode
Game.arca.safemode('W1N1')          // manually activate safe mode
Game.arca.nukes()                   // incoming-nuke status + rampart reinforcement
```

### Nuker (offensive)
```javascript
Game.arca.nuker()                   // nuker load status
Game.arca.launchNuke('W1N1', 'W5N5', 25, 25)   // manual launch (also accepts a flag name)
```

### Source Keeper & Power
```javascript
Game.arca.sk('W5N4')                // start SK mining (no arg = status)
Game.arca.skstop('W5N4')            // cancel an SK op
Game.arca.power()                   // power-bank ops + power-spawn status
Game.arca.powercreeps()             // power creep (Operator) status
```

### Misc
```javascript
Game.arca.traffic(true)             // toggle the traffic manager
```

## Further Reading

- [ARCHITECTURE.md](ARCHITECTURE.md) - system architecture + source tree
- [LAB_SYSTEM.md](LAB_SYSTEM.md) - lab automation and compound production
- [FACTORY_SYSTEM.md](FACTORY_SYSTEM.md) - commodity production
- [TERMINAL_NETWORK.md](TERMINAL_NETWORK.md) - trading + inter-room balancing
- [EXPANSION_SYSTEM.md](EXPANSION_SYSTEM.md) - autonomous expansion
- [MILITARY_GUIDE.md](MILITARY_GUIDE.md) - combat, defense, WarCouncil/DefenseCouncil
- [NUKER_SYSTEM.md](NUKER_SYSTEM.md) - offensive nuker
- [OBSERVER_SYSTEM.md](OBSERVER_SYSTEM.md) - scouting + observer
- [CPU_OPTIMIZATION.md](CPU_OPTIMIZATION.md) - performance tuning
- [Screeps API Docs](https://docs.screeps.com/) - game mechanics

---

*"many legs. one pile. good pile."*
