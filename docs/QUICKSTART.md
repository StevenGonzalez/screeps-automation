# ARCA Quick Start Guide

Welcome to **ARCA** — the intelligence that rules the kingdom of **Lorencia**!

## What is ARCA?

ARCA is the central AI of Lorencia, a medieval fantasy Screeps empire. It manages
colonies through a hierarchical command structure: a central intelligence coordinates
per-room colony managers, which direct specialized creep teams. The creep roster draws
from the archetypes of a classic fantasy realm — peasants and miners work the land, scholars
and masons build the cities, and knights and wizards defend the kingdom.

## Architecture Overview

```
ARCA (Central AI)
    ├── Stronghold (Colony 1)
    │   ├── Warlords (creep team controllers)
    │   └── Sanctums (structure managers)
    └── Stronghold (Colony 2)
        └── ...
```

### Core Components

- **ARCA** — Central AI that coordinates all colonies
- **Stronghold** — Manages a single room/colony
- **Warlord** — Controls a team of creeps for a specific role
- **Hero** — Enhanced creep wrapper with smart movement
- **Crusade** — Flag-based strategic directives
- **Sanctum** — Structure group manager (links, labs, towers, etc.)

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

### 3. Watch the Realm Come to Life

The system will automatically:
- Spawn peasants and miners to gather energy
- Spawn porters to haul energy to spawns and storage
- Spawn scholars to upgrade the controller
- Spawn masons to build structures as the realm expands
- Report CPU and creep counts every 100 ticks

## Creep Roster

| Name | Role | Notes |
|------|------|-------|
| **peasant** | Early harvester | Gathers directly from sources; phases out once miners are up |
| **miner** | Stationary miner | Sits on a container at a source; maximizes WORK parts |
| **porter** | Hauler | Moves energy from containers to spawns, extensions, storage |
| **scholar** | Upgrader | Upgrades the controller to advance RCL |
| **mason** | Builder | Constructs queued construction sites |
| **blacksmith** | Repairer | Repairs structures below 50% hits |
| **alchemist** | Mineral miner | Extracts minerals for lab compound production (RCL 6+) |
| **ranger** | Scout | Explores adjacent rooms and records intel |
| **outrider** | Remote miner | Mines sources in frontier rooms |
| **peddler** | Remote hauler | Carries remote energy back to the home colony |
| **herald** | Reserver | Reserves remote room controllers, doubling source yield |

**Planned military roles:**
| Name | Role |
|------|------|
| **knight** | Melee defender |
| **wizard** | Ranged attacker |
| **cleric** | Healer / support |
| **dark knight** | Offensive raider |

## Core Gameplay Loop

1. **Miners** mine energy at source containers
2. **Porters** haul energy to spawns, extensions, towers, and storage
3. **Scholars** upgrade the controller for RCL progression
4. **Masons** build structures; **Blacksmiths** repair damage
5. **Alchemists** mine minerals → storage → labs (RCL 6+)
6. **Heralds** reserve remote rooms, doubling their source output
7. **Rangers** scout the wilderness; **Outriders** mine remote sources; **Peddlers** haul it home

## Implemented Systems

### Economy & Logistics
- Adaptive spawn priorities: core economy first, remote roles after local stability
- Scaled creep bodies: bigger bodies when more energy is available
- Energy emergency detection: shed non-critical spawns to recover
- Remote mining: scouts identify rooms → outriders mine → peddlers haul → heralds reserve

### RCL 6+ Advanced Systems
- **LinkSanctum**: Instant energy transfer (source → storage → controller)
- **ChaosSanctum**: Automatic compound production with multi-tier reaction chains
- **TerminalNetwork**: Empire-wide resource balancing across colonies

### Military & Defense
- Tower coordination with priority targeting
- Safe mode automatic activation
- War Council: threat scanning and squad management (planned)
- Knight/Wizard squads with formation tactics (planned)

### Intelligence & Expansion
- Scout rangers survey adjacent rooms and record source/threat intel
- Herald reservers stake claim to frontier rooms
- Autonomous expansion: evaluates targets, spawns conquerors and settlers (planned)

## Further Reading

- [ARCHITECTURE.md](ARCHITECTURE.md) — Detailed system architecture
- [LAB_SYSTEM.md](LAB_SYSTEM.md) — Lab automation and compound production
- [TERMINAL_NETWORK.md](TERMINAL_NETWORK.md) — Resource sharing and trading
- [EXPANSION_SYSTEM.md](EXPANSION_SYSTEM.md) — Autonomous expansion system
- [MILITARY_GUIDE.md](MILITARY_GUIDE.md) — Combat and defense
- [CPU_OPTIMIZATION.md](CPU_OPTIMIZATION.md) — Performance tuning
- [Screeps API Docs](https://docs.screeps.com/) — Game mechanics

---

*"From the gates of Lorencia, the empire stretches to the farthest dungeon."*
